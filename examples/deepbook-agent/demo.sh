#!/usr/bin/env bash
#
# Tai × DeepBook — Autonomous Agent Wallet, end-to-end demo.
# Sui Overflow 2026 · Agentic Web track · Sub-track 2.
#
# Real Sui + DeepBook testnet, no mocks. Walks the whole story and prints a
# Suiscan link after every on-chain action:
#
#   1. launch an agent            -> it gets a treasury + a sovereign OwnerCap
#   2. grant an AI runtime a       -> a Move policy object: daily SUI cap,
#      SCOPED, REVOCABLE budget       TTL, instant revocation — enforced in Move
#   3. the agent AUTONOMOUSLY       -> ONE atomic tx: spend under the cap
#      trades on DeepBook              (Move enforces the ceiling) + deposit +
#                                      place a REAL DeepBook order
#   4. the owner REVOKES the cap   -> the agent's next trade is rejected on-chain
#
# Prereq: a funded testnet key (>= 3 SUI), the `sui` CLI, the `tai` CLI, and
# node. Run from examples/deepbook-agent/ after `npm install`.
#
#   export OPERATOR_KEY=suiprivkey1...   # from: sui keytool export --key-identity <addr>
#   ./demo.sh check     # no-spend preflight (binaries, address, balance)
#   ./demo.sh           # the full demo
#
set -euo pipefail
cd "$(dirname "$0")"

# ---- Tai v1.1.3 + DeepBook (matches @mysten/deepbook-v3 0.12.x) on testnet ----
TAI_PKG=0xf6a55d1f6b4961de636028ee967adf1999063140d9331027abcf4b39c5dc573b
TAI_CONFIG_ID=0x4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50
DEEPBOOK_PKG=0xcbf4748a965d469ea3a36cf0ccc5743b96c2d0ae6dee0762ed3eca65fac07f7e
CLOCK=0x6
GAS_BUDGET=200000000
TREASURY_FUND_MIST=1200000000   # 1.2 SUI into the agent treasury
DAILY_CAP_MIST=1000000000       # 1 SUI/day operator ceiling
BUDGET_MIST=1000000000          # agent spends 1 SUI this tick (== cap)
TAI_BIN="${TAI_BIN:-tai}"
SUI_BIN="${SUI_BIN:-sui}"

b=$'\033[1m'; d=$'\033[2m'; g=$'\033[32m'; y=$'\033[33m'; r=$'\033[0m'
beat() { echo; echo "${b}${y}━━ $* ━━${r}"; }
say()  { echo "   $*"; }
scan() { echo "   ${d}↳ https://suiscan.xyz/testnet/$1/$2${r}"; }
die()  { echo "${b}error:${r} $*" >&2; exit 1; }

command -v "$SUI_BIN" >/dev/null || die "sui CLI not on PATH (set SUI_BIN)"
command -v "$TAI_BIN" >/dev/null || die "tai CLI not on PATH (set TAI_BIN)"
command -v node >/dev/null || die "node not on PATH"
[ -n "${OPERATOR_KEY:-}" ] || die "set OPERATOR_KEY to a funded bech32 suiprivkey1... (>= 3 SUI)"
[ -d node_modules/@mysten/sui ] || die "run 'npm install' first"

# Derive the address from the key (reliable, no chain call).
ADDR=$(OPERATOR_KEY="$OPERATOR_KEY" node --input-type=module -e \
  "import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519'; console.log(Ed25519Keypair.fromSecretKey(process.env.OPERATOR_KEY).toSuiAddress())")
[ -n "$ADDR" ] || die "could not derive address from OPERATOR_KEY"

balance_sui() { $SUI_BIN client balance "$ADDR" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+ SUI' | head -1; }

if [ "${1:-}" = "check" ]; then
  beat "preflight (no spend)"
  say "operator/owner address: ${b}$ADDR${r}"
  say "balance: $(balance_sui || echo '?')   (need >= 3 SUI)"
  say "sui: $($SUI_BIN --version 2>/dev/null | head -1)   tai: $($TAI_BIN --version 2>/dev/null | head -1)"
  say "Tai package: $TAI_PKG"
  say "DeepBook package: $DEEPBOOK_PKG"
  echo; say "${g}preflight ok — run ./demo.sh for the full flow${r}"
  exit 0
fi

# ---- make the funded key the signer for sui, tai, and the runner ----------
# Back up + restore the user's tai config and active sui address on exit.
TAI_CFG="$HOME/.tai/config.toml"
TAI_CFG_BAK="$(mktemp)"; cp "$TAI_CFG" "$TAI_CFG_BAK" 2>/dev/null || true
ORIG_ADDR=$($SUI_BIN client active-address 2>/dev/null || true)
restore() {
  [ -f "$TAI_CFG_BAK" ] && cp "$TAI_CFG_BAK" "$TAI_CFG" 2>/dev/null || true
  [ -n "${ORIG_ADDR:-}" ] && $SUI_BIN client switch --address "$ORIG_ADDR" >/dev/null 2>&1 || true
}
trap restore EXIT

beat "0 · setup — funded key as the sole signer ($ADDR)"
$SUI_BIN keytool import "$OPERATOR_KEY" ed25519 >/dev/null 2>&1 || true   # idempotent
$SUI_BIN client switch --address "$ADDR" >/dev/null
KEYFILE="$HOME/.tai/keys/demo-operator.key"
OPERATOR_KEY="$OPERATOR_KEY" node --input-type=module -e \
  "import {decodeSuiPrivateKey} from '@mysten/sui/cryptography'; import {writeFileSync,chmodSync} from 'node:fs'; const {secretKey}=decodeSuiPrivateKey(process.env.OPERATOR_KEY); writeFileSync(process.argv[1], Buffer.from(secretKey).toString('hex')); chmodSync(process.argv[1],0o600)" "$KEYFILE"
$TAI_BIN init --force --network testnet --key-path "$KEYFILE" >/dev/null
export SUI_PRIVATE_KEY="$OPERATOR_KEY"
say "balance: $(balance_sui || echo '?')"

# ---- 1. launch ------------------------------------------------------------
beat "1 · launch an agent (publishes its coin, creates account + treasury + caps)"
LAUNCH=$($TAI_BIN launch --symbol DBT --name "DeepBook Demo" \
  --description "OperatorCap x DeepBook autonomous agent" --output json)
COIN_TYPE=$(echo "$LAUNCH" | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).coin_type))')
LAUNCH_TX=$(echo "$LAUNCH" | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).launch_tx_digest))')
say "coin: $COIN_TYPE"
scan tx "$LAUNCH_TX"
read -r ACCT TREASURY OWNERCAP < <(curl -s https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getTransactionBlock\",\"params\":[\"$LAUNCH_TX\",{\"showObjectChanges\":true}]}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).result.objectChanges;const f=t=>(c.find(x=>x.type==="created"&&x.objectType.includes(t))||{}).objectId;console.log(f("LaunchpadAccount"),f("AgentTreasury"),f("OwnerCap"))})')
say "account=$ACCT"; say "treasury=$TREASURY"; say "ownerCap=$OWNERCAP"

# ---- 2. fund treasury + issue a scoped, revocable operator budget ---------
beat "2 · fund the treasury, then grant the agent a SCOPED, REVOCABLE budget"
$SUI_BIN client ptb --split-coins gas "[$TREASURY_FUND_MIST]" --assign c \
  --move-call "$TAI_PKG::agent_treasury::top_up_sui" "<$COIN_TYPE>" @"$TREASURY" c.0 \
  --gas-budget "$GAS_BUDGET" >/dev/null
say "treasury funded: $((TREASURY_FUND_MIST/1000000000)).2 SUI"
ISSUE=$($SUI_BIN client ptb \
  --make-move-vec "<address>" "[]" --assign targets \
  --move-call "$TAI_PKG::agent_treasury::issue_operator_cap" "<$COIN_TYPE>" \
    @"$TREASURY" @"$OWNERCAP" @"$ADDR" "$DAILY_CAP_MIST" 0 targets 86400000 @"$CLOCK" \
  --gas-budget "$GAS_BUDGET" 2>&1)
ISSUE_TX=$(echo "$ISSUE" | grep -m1 'Transaction Digest' | grep -oE '[A-Za-z0-9]{43,44}')
OPCAP=$(curl -s https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getTransactionBlock\",\"params\":[\"$ISSUE_TX\",{\"showObjectChanges\":true}]}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).result.objectChanges;console.log((c.find(x=>x.type==="created"&&x.objectType.includes("OperatorCap"))||{}).objectId)})')
say "OperatorCap=$OPCAP  (cap: 1 SUI/day, 24h TTL, revocable — all enforced in Move)"
scan tx "$ISSUE_TX"

# ---- 3. agent autonomously trades on DeepBook -----------------------------
beat "3 · the agent autonomously places a REAL DeepBook order, under its cap"
export TAI_PACKAGE_ID="$TAI_PKG" AGENT_COIN_TYPE="$COIN_TYPE" AGENT_TREASURY_ID="$TREASURY"
export OPERATOR_CAP_ID="$OPCAP" DEEPBOOK_PACKAGE_ID="$DEEPBOOK_PKG" BUDGET_MIST="$BUDGET_MIST"
say "creating the agent's DeepBook BalanceManager..."
BM=$(npm run start --silent setup 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log((a.find(x=>x.type==="created"&&String(x.objectType).includes("BalanceManager"))||{}).objectId)})')
say "BalanceManager=$BM"
export BALANCE_MANAGER_ID="$BM"
npm run start --silent 2>&1 >/dev/null | sed 's/^\[agent\]/  /' || true

# ---- 4. owner revokes -> agent is cut off on-chain ------------------------
beat "4 · owner REVOKES the cap — the agent's next trade is rejected on-chain"
$SUI_BIN client ptb \
  --move-call "$TAI_PKG::agent_treasury::revoke_operator_cap" "<$COIN_TYPE>" @"$TREASURY" @"$OWNERCAP" @"$OPCAP" \
  --gas-budget "$GAS_BUDGET" >/dev/null
say "cap revoked. the agent tries to trade again..."
npm run start --silent 2>&1 >/dev/null | sed 's/^\[agent\]/  /' || true

beat "done"
say "${g}capped + revocable agent authority, composed atomically with a real DeepBook order — enforced by Move on Sui.${r}"
say "agent dashboard: https://tai-launchpad.vercel.app/agent/$ACCT"
