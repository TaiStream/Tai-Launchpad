/// Module: agent_display
///
/// Wallet-rendering for Tai agents. Each launched agent's `OwnerCap<T>`
/// is a transferable Sui object that semantically represents ownership
/// of the agent. With this module, the package admin can register a
/// `Display<OwnerCap<T>>` per agent so wallets show a rich card (name,
/// image, description, link, project URL) instead of the generic
/// `OwnerCap<...>` placeholder.
///
/// Permissions: registration requires the package's `Publisher` cap,
/// claimed in `tai::publisher` at upgrade-time and held by the admin.
/// Per-agent registration is therefore an admin step today; v1.5 plans
/// to wire it into `launch_agent_coin` so it auto-runs.
///
/// Sui Display schema used (matches the Sui Display Standard the major
/// wallets and Suiscan honour):
///
///   name         — short title shown in the wallet card
///   description  — multi-line caption / tooltip
///   image_url    — the agent's avatar
///   link         — per-agent landing / dashboard URL
///   project_url  — the Tai marketing page (constant)
///   creator      — the project name (constant)
///
/// All values are stored verbatim at registration time. The Display
/// template syntax supports `{field}` substitution from the displayed
/// object, but `OwnerCap<T>` only carries `id` and `agent_treasury_id`,
/// so we prefer pre-baked strings.
module tai::agent_display {
    use std::string::String;
    use sui::display;
    use sui::package::Publisher;
    use tai::agent_treasury::OwnerCap;

    /// Register a Display<OwnerCap<T>> with the provided rendering values.
    ///
    /// The resulting Display object is transferred to the caller, who is
    /// expected to be the package admin. After this returns, any wallet
    /// holding `OwnerCap<T>` will render with the provided card.
    #[allow(lint(self_transfer))]
    public fun register_owner_cap_display<T>(
        publisher: &Publisher,
        name: String,
        description: String,
        image_url: String,
        link: String,
        ctx: &mut TxContext,
    ) {
        let keys = vector[
            std::string::utf8(b"name"),
            std::string::utf8(b"description"),
            std::string::utf8(b"image_url"),
            std::string::utf8(b"link"),
            std::string::utf8(b"project_url"),
            std::string::utf8(b"creator"),
        ];
        let values = vector[
            name,
            description,
            image_url,
            link,
            std::string::utf8(b"https://tai-launchpad.vercel.app"),
            std::string::utf8(b"Tai"),
        ];

        let mut d = display::new_with_fields<OwnerCap<T>>(publisher, keys, values, ctx);
        display::update_version(&mut d);
        transfer::public_transfer(d, ctx.sender());
    }
}
