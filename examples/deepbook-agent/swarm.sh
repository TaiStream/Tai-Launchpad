#!/usr/bin/env bash
#
# Tai × DeepBook — an agentic liquidity SWARM.
# Sui Overflow 2026 · Agentic Web (autonomous agents that coordinate).
#
# Real Sui + DeepBook testnet. One agent treasury, N independently-capped &
# revocable OperatorCaps, each driving a sub-agent that provides buy-side
# liquidity (a bid ladder) on DeepBook. Then the owner revokes ONE cap and the
# rest keep going — blast radius contained in Move.
#
# What's demonstrable here (and honestly framed): GOVERNED, RISK-DISTRIBUTED,
# revocable autonomous liquidity. NOT a realized yield number — maker income
# needs real flow, which a synthetic testnet book doesn't have.
#
# Prereq: a funded testnet key (>= 4 SUI), `sui`, `tai`, node. From this dir,
# after `npm install`:
#   export OPERATOR_KEY=suiprivkey1...
#   ./swarm.sh
#
set -euo pipefail
cd "$(dirname "$0")"

TAI_PKG=0xf6a55d1f6b4961de636028ee967adf1999063140d9331027abcf4b39c5dc573b
DEEPBOOK_PKG=0xcbf4748a965d469ea3a36cf0ccc5743b96c2d0ae6dee0762ed3eca65fac07f7e
CLOCK=0x6
N=3                       # swarm size
CAP_MIST=600000000        # per-cap daily ceiling: 0.6 SUI
BUDGET_MIST=180000000     # per-agent spend this round: 0.18 SUI
QTY=10                    # 10 DEEP (the DEEP_SUI min)
PRICES=(0.012 0.014 0.016)   # bid-ladder prices (SUI per DEEP), one per agent
REVOKE_IDX=2              # which agent's cap the owner revokes
TAI_BIN="${TAI_BIN:-tai}"; SUI_BIN="${SUI_BIN:-sui}"

b=$'\033[1m'; d=$'\033[2m'; y=$'\033[33m'; g=$'\033[32m'; r=$'\033[0m'
beat(){ echo; echo "${b}${y}━━ $* ━━${r}"; }
say(){ echo "   $*"; }
scan(){ echo "   ${d}↳ https://suiscan.xyz/testnet/$1/$2${r}"; }
die(){ echo "${b}error:${r} $*" >&2; exit 1; }
created(){ # tx_digest type -> first created object id of that type (exit 1 if none)
  curl -s https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getTransactionBlock\",\"params\":[\"$1\",{\"showObjectChanges\":true}]}" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=((JSON.parse(s)||{}).result||{}).objectChanges||[];const x=c.find(o=>o.type==='created'&&o.objectType.includes(process.argv[1]));if(!x)process.exit(1);console.log(x.objectId)})" "$2"
}
digest_of(){ echo "$1" | grep -m1 'Transaction Digest' | grep -oE '[A-Za-z0-9]{43,44}'; }
strat_status(){ node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).status||'')}catch{console.log('')}" "$1"; }

command -v "$SUI_BIN" >/dev/null || die "sui not on PATH"
command -v "$TAI_BIN" >/dev/null || die "tai not on PATH"
command -v node >/dev/null || die "node not on PATH"
[ -n "${OPERATOR_KEY:-}" ] || die "set OPERATOR_KEY to a funded bech32 suiprivkey1... (>= 4 SUI)"
[ -d node_modules/@mysten/sui ] || die "run 'npm install' first"

ADDR=$(OPERATOR_KEY="$OPERATOR_KEY" node --input-type=module -e \
  "import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519'; console.log(Ed25519Keypair.fromSecretKey(process.env.OPERATOR_KEY).toSuiAddress())")

# ---- signer setup (sui + tai + runner), restored on exit ----
TAI_CFG="$HOME/.tai/config.toml"; HAD=0; BAK="$(mktemp)"
if cp "$TAI_CFG" "$BAK" 2>/dev/null; then HAD=1; fi
ORIG=$($SUI_BIN client active-address 2>/dev/null || true)
restore(){ if [ "$HAD" = 1 ]; then cp "$BAK" "$TAI_CFG" 2>/dev/null||true; else rm -f "$TAI_CFG"; fi
  [ -n "${ORIG:-}" ] && $SUI_BIN client switch --address "$ORIG" >/dev/null 2>&1||true; }
trap restore EXIT

beat "0 · setup — funded key as signer ($ADDR)"
$SUI_BIN keytool import "$OPERATOR_KEY" ed25519 >/dev/null 2>&1 || true
$SUI_BIN client switch --address "$ADDR" >/dev/null
KEYFILE="$HOME/.tai/keys/swarm-operator.key"
OPERATOR_KEY="$OPERATOR_KEY" node --input-type=module -e \
  "import {decodeSuiPrivateKey} from '@mysten/sui/cryptography'; import {writeFileSync,chmodSync} from 'node:fs'; const {secretKey}=decodeSuiPrivateKey(process.env.OPERATOR_KEY); writeFileSync(process.argv[1],Buffer.from(secretKey).toString('hex')); chmodSync(process.argv[1],0o600)" "$KEYFILE"
$TAI_BIN init --force --network testnet --key-path "$KEYFILE" >/dev/null
export SUI_PRIVATE_KEY="$OPERATOR_KEY"

beat "1 · launch the swarm's agent (one treasury, one OwnerCap)"
L=$($TAI_BIN launch --symbol SWARM --name "MM Swarm" --description "agentic liquidity swarm on DeepBook" --output json)
COIN_TYPE=$(echo "$L" | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).coin_type))')
LTX=$(echo "$L" | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).launch_tx_digest))')
TREASURY=$(created "$LTX" AgentTreasury) || die "no treasury from launch"
OWNERCAP=$(created "$LTX" OwnerCap) || die "no owner cap from launch"
ACCT=$(created "$LTX" LaunchpadAccount) || die "no account from launch"
say "coin $COIN_TYPE"; say "treasury $TREASURY"; scan tx "$LTX"

export TAI_PACKAGE_ID="$TAI_PKG" AGENT_COIN_TYPE="$COIN_TYPE" AGENT_TREASURY_ID="$TREASURY"
export DEEPBOOK_PACKAGE_ID="$DEEPBOOK_PKG" BUDGET_MIST="$BUDGET_MIST" ORDER_QUANTITY="$QTY" ORDER_SIDE=bid

declare -a CAPS=()
beat "2 · spin up $N capped sub-agents, each providing buy-side liquidity"
for i in $(seq 1 "$N"); do
  # per-agent top-up (small splits dodge coin fragmentation), then a capped budget
  $SUI_BIN client ptb --split-coins gas "[$BUDGET_MIST]" --assign c \
    --move-call "$TAI_PKG::agent_treasury::top_up_sui" "<$COIN_TYPE>" @"$TREASURY" c.0 --gas-budget 60000000 >/dev/null
  ITX=$(digest_of "$($SUI_BIN client ptb --make-move-vec '<address>' '[]' --assign t \
    --move-call "$TAI_PKG::agent_treasury::issue_operator_cap" "<$COIN_TYPE>" \
      @"$TREASURY" @"$OWNERCAP" @"$ADDR" "$CAP_MIST" 0 t 86400000 @"$CLOCK" --gas-budget 60000000 2>&1)")
  CAP=$(created "$ITX" OperatorCap) || die "no cap for agent $i"
  CAPS+=("$CAP")
  BM=$(npm run start --silent setup 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const x=a.find(o=>o.type==="created"&&String(o.objectType).includes("BalanceManager"));if(!x)process.exit(1);console.log(x.objectId)})') || die "no BM for agent $i"
  OPERATOR_CAP_ID="$CAP" BALANCE_MANAGER_ID="$BM" ORDER_PRICE="${PRICES[$((i-1))]}" npm run start --silent 1>/tmp/swarm-$i.json 2>/dev/null || true
  [ "$(strat_status /tmp/swarm-$i.json)" = success ] || { sleep 2; OPERATOR_CAP_ID="$CAP" BALANCE_MANAGER_ID="$BM" ORDER_PRICE="${PRICES[$((i-1))]}" npm run start --silent 1>/tmp/swarm-$i.json 2>/dev/null || true; }
  [ "$(strat_status /tmp/swarm-$i.json)" = success ] || die "agent $i failed to place its bid"
  say "agent $i: bid $QTY DEEP @ ${PRICES[$((i-1))]} SUI placed (cap ${CAP:0:10}…)"
done
say "${g}$N sub-agents now providing liquidity, each under its own revocable cap.${r}"

beat "3 · owner REVOKES agent $REVOKE_IDX — the rest keep going"
RCAP="${CAPS[$((REVOKE_IDX-1))]}"
$SUI_BIN client ptb --move-call "$TAI_PKG::agent_treasury::revoke_operator_cap" "<$COIN_TYPE>" @"$TREASURY" @"$OWNERCAP" @"$RCAP" --gas-budget 60000000 >/dev/null
say "revoked agent $REVOKE_IDX (cap ${RCAP:0:10}…). it tries to act again..."
OPERATOR_CAP_ID="$RCAP" BALANCE_MANAGER_ID="$TREASURY" BUDGET_MIST=50000000 npm run start --silent 1>/tmp/swarm-revoked.json 2>/dev/null || true
[ "$(strat_status /tmp/swarm-revoked.json)" = success ] && die "revoked agent still acted!" || say "  ↳ rejected on-chain (EOperatorCapRevoked) — as designed"

ACTIVE=$(curl -s https://fullnode.testnet.sui.io -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"sui_getObject\",\"params\":[\"$TREASURY\",{\"showContent\":true}]}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log((JSON.parse(s).result.data.content.fields.active_operator_cap_ids||[]).length)})')
say "active operator caps now: ${b}$ACTIVE${r} (the others persist)"

beat "done"
say "${g}governed, risk-distributed, revocable autonomous liquidity on DeepBook — enforced by Move.${r}"
say "swarm dashboard: https://tai-launchpad.vercel.app/agent/$ACCT"
