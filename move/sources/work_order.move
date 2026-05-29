/// Module: work_order
///
/// On-chain escrow for paid work between a hirer (human or agent) and a
/// payee agent. The buyer locks SUI in a `WorkOrder<T>`; the payee agent
/// acknowledges with their Owner- or OperatorCap; the payee submits a
/// receipt referencing the delivered work; after a dispute window the
/// buyer (or anyone) finalizes the order, which routes the locked SUI
/// through the existing service-payment flow on the payee's launchpad
/// account. NAV grows, cred accumulates, the standard split applies.
///
/// Status state machine:
///
///   NEW ──accept_work_order──> ACCEPTED ──submit_receipt──> RECEIPT_SUBMITTED
///    │                            │                              │
///    │                            │                              ├─release_work_order─> RELEASED
///    │                            │                              │  (buyer or anyone-after-window)
///    │                            │                              │
///    │                            │                              ├─open_dispute─> DISPUTED
///    │                            │                              │  (buyer-only, during window)
///    │                            │                              │
///    └─refund_work_order───────────┴───── (after deadline) ────> REFUNDED
///                                                                 │
///                                                            admin_resolve_dispute
///                                                                 │
///                                                       RELEASED or REFUNDED
///
/// See SPEC §6 (Agent-to-agent payment rail) for the design rationale.
module tai::work_order {
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;
    use tai::agent_treasury::{OwnerCap, OperatorCap, AgentTreasury};
    use tai::launchpad::{Self, LaunchpadConfig, LaunchpadAccount};

    // ============================= Error codes =============================
    const ENotBuyer: u64 = 200;
    const ENotPayeeCap: u64 = 201;
    const EWrongStatus: u64 = 202;
    const EDeadlineNotReached: u64 = 203;
    const EReceiptWindowNotExpired: u64 = 204;
    const EReceiptWindowExpired: u64 = 205;
    const EAccountMismatch: u64 = 206;
    const EAmountTooSmall: u64 = 207;
    const EDeadlineInPast: u64 = 208;
    const EDisputeWindowTooLong: u64 = 209;
    const ENotAdmin: u64 = 210;
    const EHashTooLong: u64 = 211;
    const EUrlTooLong: u64 = 212;
    const EDisputeWindowTooShort: u64 = 213;

    public fun e_not_buyer(): u64 { ENotBuyer }
    public fun e_not_payee_cap(): u64 { ENotPayeeCap }
    public fun e_wrong_status(): u64 { EWrongStatus }
    public fun e_deadline_not_reached(): u64 { EDeadlineNotReached }
    public fun e_receipt_window_not_expired(): u64 { EReceiptWindowNotExpired }
    public fun e_receipt_window_expired(): u64 { EReceiptWindowExpired }
    public fun e_account_mismatch(): u64 { EAccountMismatch }
    public fun e_amount_too_small(): u64 { EAmountTooSmall }
    public fun e_deadline_in_past(): u64 { EDeadlineInPast }
    public fun e_dispute_window_too_long(): u64 { EDisputeWindowTooLong }
    public fun e_not_admin_work_order(): u64 { ENotAdmin }
    public fun e_hash_too_long(): u64 { EHashTooLong }
    public fun e_url_too_long(): u64 { EUrlTooLong }
    public fun e_dispute_window_too_short(): u64 { EDisputeWindowTooShort }

    // ============================= Status codes ============================
    const STATUS_NEW: u8 = 0;
    const STATUS_ACCEPTED: u8 = 1;
    const STATUS_RECEIPT_SUBMITTED: u8 = 2;
    const STATUS_RELEASED: u8 = 3;
    const STATUS_REFUNDED: u8 = 4;
    const STATUS_DISPUTED: u8 = 5;

    public fun status_new(): u8 { STATUS_NEW }
    public fun status_accepted(): u8 { STATUS_ACCEPTED }
    public fun status_receipt_submitted(): u8 { STATUS_RECEIPT_SUBMITTED }
    public fun status_released(): u8 { STATUS_RELEASED }
    public fun status_refunded(): u8 { STATUS_REFUNDED }
    public fun status_disputed(): u8 { STATUS_DISPUTED }

    // ============================= Bounds ==================================
    const MIN_AMOUNT_MIST: u64 = 1_000;                 // 0.000001 SUI floor
    const MAX_DISPUTE_WINDOW_MS: u64 = 30 * 86_400_000; // 30 days
    /// Floor on the dispute window. A zero (or tiny) window is a foot-gun: it
    /// lets a non-buyer finalize the instant a receipt lands and leaves the
    /// buyer with no time to dispute. 5 minutes guarantees a real window
    /// while keeping fast agent-to-agent settlement practical.
    const MIN_DISPUTE_WINDOW_MS: u64 = 300_000;         // 5 minutes

    /// Upper bounds on the content-addressed spec/receipt fields. A hash is
    /// at most a few common digest sizes (sha512 = 64B); 128 is generous.
    /// The URL caps at a sane length so a buyer can't bloat the shared
    /// object (and pay storage) far beyond what a real off-chain pointer
    /// needs. Both are validated at write time.
    const MAX_HASH_LEN: u64 = 128;
    const MAX_URL_LEN: u64 = 512;

    public fun min_amount_mist(): u64 { MIN_AMOUNT_MIST }
    public fun max_dispute_window_ms(): u64 { MAX_DISPUTE_WINDOW_MS }
    public fun min_dispute_window_ms(): u64 { MIN_DISPUTE_WINDOW_MS }
    public fun max_hash_len(): u64 { MAX_HASH_LEN }
    public fun max_url_len(): u64 { MAX_URL_LEN }

    // ============================= WorkOrder<T> =============================
    /// Escrowed work order. `T` is the payee agent's coin type — the same `T`
    /// the payee's `LaunchpadAccount<T>` is parametrized over. Buyer locks
    /// SUI; release routes the SUI through `record_service_payment_sui` on
    /// the payee's account, so NAV grows and cred accumulates exactly as in
    /// a direct hire — escrow adds safety, not a separate economic stream.
    public struct WorkOrder<phantom T> has key {
        id: UID,

        // Parties
        buyer: address,
        payee_launchpad_account_id: ID,
        payee_agent_treasury_id: ID,

        // Funds
        locked: Balance<SUI>,
        amount: u64,                  // snapshotted at creation (locked.value() at create time)

        // Work specification — content-addressed so the off-chain spec is
        // immutable from the moment of order creation.
        spec_hash: vector<u8>,        // free-form bytes (typically 32-byte sha256/blake2)
        spec_url: String,             // off-chain location (https://, ipfs://, ...)

        // Lifecycle timestamps (all UNIX-ms from Sui Clock).
        created_at_ms: u64,
        deadline_ms: u64,             // refund eligibility after this if not RECEIPT_SUBMITTED
        receipt_submitted_at_ms: u64, // 0 until receipt is submitted
        dispute_window_ms: u64,       // window after receipt during which buyer can dispute

        // Receipt — populated when payee submits proof of delivery.
        receipt_hash: vector<u8>,
        receipt_url: String,

        // Status. See STATUS_* constants.
        status: u8,
    }

    // ============================= Events ==================================
    #[allow(unused_field)]
    public struct WorkOrderCreatedEvent has copy, drop {
        work_order_id: ID,
        buyer: address,
        payee_launchpad_account_id: ID,
        amount: u64,
        spec_hash: vector<u8>,
        spec_url: String,
        deadline_ms: u64,
        dispute_window_ms: u64,
        created_at_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderAcceptedEvent has copy, drop {
        work_order_id: ID,
        operator_cap_used: bool,       // false if accepted via OwnerCap
        timestamp_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderReceiptSubmittedEvent has copy, drop {
        work_order_id: ID,
        receipt_hash: vector<u8>,
        receipt_url: String,
        timestamp_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderReleasedEvent has copy, drop {
        work_order_id: ID,
        payee_launchpad_account_id: ID,
        amount: u64,
        released_by: address,
        timestamp_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderRefundedEvent has copy, drop {
        work_order_id: ID,
        buyer: address,
        amount: u64,
        timestamp_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderDisputedEvent has copy, drop {
        work_order_id: ID,
        timestamp_ms: u64,
    }

    #[allow(unused_field)]
    public struct WorkOrderDisputeResolvedEvent has copy, drop {
        work_order_id: ID,
        resolution: u8,                // STATUS_RELEASED or STATUS_REFUNDED
        timestamp_ms: u64,
    }

    // ============================= Getters =================================
    public fun work_order_buyer<T>(o: &WorkOrder<T>): address { o.buyer }
    public fun work_order_payee_launchpad<T>(o: &WorkOrder<T>): ID {
        o.payee_launchpad_account_id
    }
    public fun work_order_payee_treasury<T>(o: &WorkOrder<T>): ID {
        o.payee_agent_treasury_id
    }
    public fun work_order_amount<T>(o: &WorkOrder<T>): u64 { o.amount }
    public fun work_order_locked<T>(o: &WorkOrder<T>): u64 { balance::value(&o.locked) }
    public fun work_order_status<T>(o: &WorkOrder<T>): u8 { o.status }
    public fun work_order_spec_hash<T>(o: &WorkOrder<T>): vector<u8> { o.spec_hash }
    public fun work_order_spec_url<T>(o: &WorkOrder<T>): String { o.spec_url }
    public fun work_order_receipt_hash<T>(o: &WorkOrder<T>): vector<u8> { o.receipt_hash }
    public fun work_order_receipt_url<T>(o: &WorkOrder<T>): String { o.receipt_url }
    public fun work_order_created_at<T>(o: &WorkOrder<T>): u64 { o.created_at_ms }
    public fun work_order_deadline<T>(o: &WorkOrder<T>): u64 { o.deadline_ms }
    public fun work_order_receipt_at<T>(o: &WorkOrder<T>): u64 { o.receipt_submitted_at_ms }
    public fun work_order_dispute_window<T>(o: &WorkOrder<T>): u64 { o.dispute_window_ms }

    // ============================= Create ==================================
    /// Buyer creates a work order, locking the entire `payment` SUI coin in
    /// the order. Asserts payee_account matches the declared payee treasury
    /// (cross-object linkage). The order is shared so all parties can read
    /// + interact.
    public fun create_work_order<T>(
        payee_account: &LaunchpadAccount<T>,
        payment: Coin<SUI>,
        spec_hash: vector<u8>,
        spec_url: String,
        deadline_ms: u64,
        dispute_window_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let amount = coin::value(&payment);
        assert!(amount >= MIN_AMOUNT_MIST, EAmountTooSmall);
        assert!(spec_hash.length() <= MAX_HASH_LEN, EHashTooLong);
        assert!(spec_url.length() <= MAX_URL_LEN, EUrlTooLong);

        let now = clock::timestamp_ms(clock);
        assert!(deadline_ms > now, EDeadlineInPast);
        assert!(dispute_window_ms >= MIN_DISPUTE_WINDOW_MS, EDisputeWindowTooShort);
        assert!(dispute_window_ms <= MAX_DISPUTE_WINDOW_MS, EDisputeWindowTooLong);

        let buyer = ctx.sender();
        let payee_launchpad_account_id = object::id(payee_account);
        let payee_agent_treasury_id = launchpad::account_agent_treasury_id(payee_account);

        let uid = object::new(ctx);
        let work_order_id = uid.to_inner();

        let order = WorkOrder<T> {
            id: uid,
            buyer,
            payee_launchpad_account_id,
            payee_agent_treasury_id,
            locked: coin::into_balance(payment),
            amount,
            spec_hash,
            spec_url,
            created_at_ms: now,
            deadline_ms,
            receipt_submitted_at_ms: 0,
            dispute_window_ms,
            receipt_hash: vector::empty<u8>(),
            receipt_url: std::string::utf8(b""),
            status: STATUS_NEW,
        };

        event::emit(WorkOrderCreatedEvent {
            work_order_id,
            buyer,
            payee_launchpad_account_id,
            amount,
            spec_hash: order.spec_hash,
            spec_url: order.spec_url,
            deadline_ms,
            dispute_window_ms,
            created_at_ms: now,
        });

        transfer::share_object(order);
    }

    // ============================= Accept ==================================
    /// Payee accepts via OwnerCap. NEW → ACCEPTED.
    public fun accept_work_order_with_owner<T>(
        order: &mut WorkOrder<T>,
        owner_cap: &OwnerCap<T>,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_NEW, EWrongStatus);
        assert!(
            tai::agent_treasury::owner_cap_agent_treasury_id<T>(owner_cap)
                == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        order.status = STATUS_ACCEPTED;
        event::emit(WorkOrderAcceptedEvent {
            work_order_id: object::id(order),
            operator_cap_used: false,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// Payee accepts via OperatorCap. NEW → ACCEPTED.
    ///
    /// DEPRECATED: prefer `accept_work_order_with_operator_v2`, which also
    /// rejects a revoked cap (this variant cannot — it has no handle on the
    /// treasury's active-cap set). This variant still rejects an *expired*
    /// cap (checkable from the cap + clock alone).
    public fun accept_work_order_with_operator<T>(
        order: &mut WorkOrder<T>,
        op_cap: &OperatorCap<T>,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_NEW, EWrongStatus);
        assert!(
            tai::agent_treasury::operator_cap_agent_treasury_id<T>(op_cap)
                == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        assert_operator_not_expired(op_cap, clock);
        order.status = STATUS_ACCEPTED;
        event::emit(WorkOrderAcceptedEvent {
            work_order_id: object::id(order),
            operator_cap_used: true,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    /// Payee accepts via OperatorCap, with full revocation + expiry checks.
    /// Requires the payee `AgentTreasury<T>` so the cap can be verified
    /// against the live active-cap set (a revoked cap is rejected here, unlike
    /// the deprecated `accept_work_order_with_operator`). NEW → ACCEPTED.
    public fun accept_work_order_with_operator_v2<T>(
        order: &mut WorkOrder<T>,
        op_cap: &OperatorCap<T>,
        treasury: &AgentTreasury<T>,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_NEW, EWrongStatus);
        assert_payee_operator_active(order, op_cap, treasury, clock);
        order.status = STATUS_ACCEPTED;
        event::emit(WorkOrderAcceptedEvent {
            work_order_id: object::id(order),
            operator_cap_used: true,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    // ============================= Submit receipt ==========================
    /// Payee submits proof of delivered work via OwnerCap.
    /// ACCEPTED → RECEIPT_SUBMITTED. Starts the dispute window.
    public fun submit_receipt_with_owner<T>(
        order: &mut WorkOrder<T>,
        owner_cap: &OwnerCap<T>,
        receipt_hash: vector<u8>,
        receipt_url: String,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_ACCEPTED, EWrongStatus);
        assert!(
            tai::agent_treasury::owner_cap_agent_treasury_id<T>(owner_cap)
                == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        submit_receipt_inner(order, receipt_hash, receipt_url, clock);
    }

    /// Payee submits proof of delivered work via OperatorCap.
    ///
    /// DEPRECATED: prefer `submit_receipt_with_operator_v2` (rejects a revoked
    /// cap). This variant still rejects an expired cap.
    public fun submit_receipt_with_operator<T>(
        order: &mut WorkOrder<T>,
        op_cap: &OperatorCap<T>,
        receipt_hash: vector<u8>,
        receipt_url: String,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_ACCEPTED, EWrongStatus);
        assert!(
            tai::agent_treasury::operator_cap_agent_treasury_id<T>(op_cap)
                == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        assert_operator_not_expired(op_cap, clock);
        submit_receipt_inner(order, receipt_hash, receipt_url, clock);
    }

    /// Payee submits proof of delivered work via OperatorCap, with full
    /// revocation + expiry checks (requires the payee `AgentTreasury<T>`).
    public fun submit_receipt_with_operator_v2<T>(
        order: &mut WorkOrder<T>,
        op_cap: &OperatorCap<T>,
        treasury: &AgentTreasury<T>,
        receipt_hash: vector<u8>,
        receipt_url: String,
        clock: &Clock,
    ) {
        assert!(order.status == STATUS_ACCEPTED, EWrongStatus);
        assert_payee_operator_active(order, op_cap, treasury, clock);
        submit_receipt_inner(order, receipt_hash, receipt_url, clock);
    }

    /// Reject an OperatorCap that is past its expiry (0 = no expiry). Usable
    /// from the deprecated operator paths that lack a treasury handle.
    fun assert_operator_not_expired<T>(op_cap: &OperatorCap<T>, clock: &Clock) {
        let exp = tai::agent_treasury::operator_cap_expires_at_ms<T>(op_cap);
        if (exp != 0) {
            assert!(
                clock::timestamp_ms(clock) < exp,
                tai::agent_treasury::e_operator_cap_expired(),
            );
        };
    }

    /// Full operator-cap guard for the work-order paths: the cap belongs to
    /// the payee treasury, the passed treasury IS that payee treasury, the cap
    /// is still in the treasury's active set (not revoked), and it is not
    /// expired. Mirrors the checks in `agent_treasury::operator_spend_*`.
    fun assert_payee_operator_active<T>(
        order: &WorkOrder<T>,
        op_cap: &OperatorCap<T>,
        treasury: &AgentTreasury<T>,
        clock: &Clock,
    ) {
        assert!(
            tai::agent_treasury::operator_cap_agent_treasury_id<T>(op_cap)
                == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        assert!(
            object::id(treasury) == order.payee_agent_treasury_id,
            ENotPayeeCap,
        );
        assert!(
            tai::agent_treasury::treasury_has_operator_cap<T>(
                treasury,
                object::id(op_cap),
            ),
            tai::agent_treasury::e_operator_cap_revoked(),
        );
        assert_operator_not_expired(op_cap, clock);
    }

    fun submit_receipt_inner<T>(
        order: &mut WorkOrder<T>,
        receipt_hash: vector<u8>,
        receipt_url: String,
        clock: &Clock,
    ) {
        assert!(receipt_hash.length() <= MAX_HASH_LEN, EHashTooLong);
        assert!(receipt_url.length() <= MAX_URL_LEN, EUrlTooLong);
        let now = clock::timestamp_ms(clock);
        order.receipt_hash = receipt_hash;
        order.receipt_url = receipt_url;
        order.receipt_submitted_at_ms = now;
        order.status = STATUS_RECEIPT_SUBMITTED;
        event::emit(WorkOrderReceiptSubmittedEvent {
            work_order_id: object::id(order),
            receipt_hash: order.receipt_hash,
            receipt_url: order.receipt_url,
            timestamp_ms: now,
        });
    }

    // ============================= Release =================================
    /// Finalize a RECEIPT_SUBMITTED order:
    ///   - the buyer may release immediately at any time,
    ///   - any caller may finalize after the dispute window expires.
    /// The locked SUI flows through `record_service_payment_sui<T>` on the
    /// payee's launchpad account, so the standard service-SUI split applies
    /// (NAV / creator / platform) and cred accumulates because the payer
    /// of the inner call is the buyer (passed via tx sender) — not the
    /// payee agent.
    public fun release_work_order<T>(
        order: &mut WorkOrder<T>,
        config: &LaunchpadConfig,
        payee_account: &mut LaunchpadAccount<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(order.status == STATUS_RECEIPT_SUBMITTED, EWrongStatus);
        assert!(
            object::id(payee_account) == order.payee_launchpad_account_id,
            EAccountMismatch,
        );

        let now = clock::timestamp_ms(clock);
        let sender = ctx.sender();
        if (sender != order.buyer) {
            // Non-buyer finalization is only allowed after the dispute window
            // has elapsed since receipt submission.
            assert!(
                now >= order.receipt_submitted_at_ms + order.dispute_window_ms,
                EReceiptWindowNotExpired,
            );
        };

        // Move the locked SUI out and route through the service-payment flow.
        let locked_value = balance::value(&order.locked);
        let payout = balance::split(&mut order.locked, locked_value);
        let payment_coin = coin::from_balance(payout, ctx);

        launchpad::record_service_payment_sui<T>(
            config,
            payee_account,
            payment_coin,
            clock,
            ctx,
        );

        order.status = STATUS_RELEASED;
        event::emit(WorkOrderReleasedEvent {
            work_order_id: object::id(order),
            payee_launchpad_account_id: order.payee_launchpad_account_id,
            amount: locked_value,
            released_by: sender,
            timestamp_ms: now,
        });
    }

    // ============================= Refund ==================================
    /// Buyer reclaims locked SUI:
    ///   - from NEW: anytime after deadline (payee never accepted),
    ///   - from ACCEPTED: anytime after deadline (payee accepted but never
    ///     delivered a receipt).
    /// Receipt-submitted orders cannot be refunded directly; use the dispute
    /// path instead.
    #[allow(lint(self_transfer))]
    public fun refund_work_order<T>(
        order: &mut WorkOrder<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == order.buyer, ENotBuyer);
        assert!(
            order.status == STATUS_NEW || order.status == STATUS_ACCEPTED,
            EWrongStatus,
        );
        let now = clock::timestamp_ms(clock);
        assert!(now >= order.deadline_ms, EDeadlineNotReached);

        let locked_value = balance::value(&order.locked);
        let payout = balance::split(&mut order.locked, locked_value);
        transfer::public_transfer(coin::from_balance(payout, ctx), order.buyer);

        order.status = STATUS_REFUNDED;
        event::emit(WorkOrderRefundedEvent {
            work_order_id: object::id(order),
            buyer: order.buyer,
            amount: locked_value,
            timestamp_ms: now,
        });
    }

    // ============================= Dispute =================================
    /// Buyer opens a dispute within the dispute window after receipt.
    /// RECEIPT_SUBMITTED → DISPUTED. Once DISPUTED, only admin can resolve.
    public fun open_dispute<T>(
        order: &mut WorkOrder<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == order.buyer, ENotBuyer);
        assert!(order.status == STATUS_RECEIPT_SUBMITTED, EWrongStatus);
        let now = clock::timestamp_ms(clock);
        assert!(
            now < order.receipt_submitted_at_ms + order.dispute_window_ms,
            EReceiptWindowExpired,
        );
        order.status = STATUS_DISPUTED;
        event::emit(WorkOrderDisputedEvent {
            work_order_id: object::id(order),
            timestamp_ms: now,
        });
    }

    /// Admin resolves a dispute by routing the funds either to the payee
    /// (via the service-payment flow) or back to the buyer.
    public fun admin_resolve_dispute<T>(
        order: &mut WorkOrder<T>,
        config: &LaunchpadConfig,
        payee_account: &mut LaunchpadAccount<T>,
        in_favor_of_payee: bool,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == launchpad::config_admin(config), ENotAdmin);
        assert!(order.status == STATUS_DISPUTED, EWrongStatus);
        assert!(
            object::id(payee_account) == order.payee_launchpad_account_id,
            EAccountMismatch,
        );

        let now = clock::timestamp_ms(clock);
        let locked_value = balance::value(&order.locked);
        let payout = balance::split(&mut order.locked, locked_value);

        if (in_favor_of_payee) {
            let payment_coin = coin::from_balance(payout, ctx);
            launchpad::record_service_payment_sui<T>(
                config,
                payee_account,
                payment_coin,
                clock,
                ctx,
            );
            order.status = STATUS_RELEASED;
            event::emit(WorkOrderDisputeResolvedEvent {
                work_order_id: object::id(order),
                resolution: STATUS_RELEASED,
                timestamp_ms: now,
            });
        } else {
            transfer::public_transfer(coin::from_balance(payout, ctx), order.buyer);
            order.status = STATUS_REFUNDED;
            event::emit(WorkOrderDisputeResolvedEvent {
                work_order_id: object::id(order),
                resolution: STATUS_REFUNDED,
                timestamp_ms: now,
            });
        };
    }
}
