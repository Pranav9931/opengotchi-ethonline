# opengotchi-ethonline — voice-driven agentic x402 payments on Arc

> Say **"Jarvis, what's the weather in Berlin?"** to the OpenGotchi pet. The pet's
> agent picks a paid x402 API, checks its own budget and balance, pays in USDC
> on **Arc** through **Circle Gateway nanopayments**, and the pet reads the answer
> aloud and shows the receipt on its screen.

Built for **ETHGlobal ETHOnline 2026**, Arc track (*Best Agentic Economy
Application with Circle Agent Stack*). Everything in this repository was written
during the hacking period (4–13 Sept 2026). It talks to the closed-source
gotchiOS firmware over its existing MQTT and voice interfaces; no firmware code
is included or modified.

## What it does

```
 ┌────────────┐  wake word "Jarvis"  ┌─────────────────┐   evt|voice|<text>   ┌──────────────────┐
 │  OpenGotchi│ ───── on-device ───▶ │ gotchiOS voice   │ ──── MQTT ─────────▶ │  agent/ (this    │
 │  pet (ESP32│      WakeNet         │ rail (STT cloud) │                      │  repo, Node)     │
 └────────────┘                      └─────────────────┘                      └────────┬─────────┘
       ▲                                                                              │
       │ say| (TTS)  ntf| card  frag receipt screen                                   │ 1. discover: Circle Discovery API
       │                                                                              │    + local Arc-testnet services,
       │                                                                              │    voice-fitness filter
       │                                                                              │ 2. plan: Claude picks service + params
       │                                                                              │ 3. decide: balance, budget, price,
       │                                                                              │    pet state, confidence
       │                                                                              ▼
       │                                   ┌──────────────────┐   x402 (402 → signed EIP-3009)   ┌──────────────────┐
       └───────────────────────────────────│ Circle Gateway   │ ◀────────────────────────────── │ GatewayClient    │
                                           │ (facilitator)    │      settles batch on Arc        │ wallet on Arc    │
                                           └────────┬─────────┘                                  └──────────────────┘
                                                    │ paid request
                                                    ▼
                                           ┌──────────────────┐
                                           │ services/ x402   │  weather · crypto price · headline
                                           │ sellers on Arc   │  pet snack · fortune  ($0.001–$0.005)
                                           └──────────────────┘
```

* **Agent with a wallet.** The agent holds a private-key wallet on Arc testnet and
  keeps its spending money in Circle Gateway (`@circle-fin/x402-batching`
  `GatewayClient`, chain `arcTestnet`). The Gateway deposit is an onchain Arc
  transaction; each purchase is a gasless EIP-3009 authorisation that Gateway
  batches and settles on Arc.
* **Decision logic tied to real signals.** `agent/src/policy.ts` approves or
  declines every purchase from live inputs: Gateway balance, today's spend from
  the ledger, the service's quoted price versus a per-payment cap, the pet's
  battery from device telemetry, and the planner's confidence. Declines are
  spoken and shown, not hidden.
* **Discovery.** `agent/src/catalog.ts` merges Circle's keyless
  [Discovery API](https://developers.circle.com/agent-stack/agent-marketplace/discovery-api)
  (the Agent Marketplace, which also mirrors x402scan registrations) with the
  local catalogue, then applies a *voice-fitness* filter: Gateway-enabled, GET,
  ≤ 2 required inputs, no auth headers, under the price cap, in a category the
  pet can read aloud.
* **Outcome on the device.** The result is spoken (`say|`), pushed as a
  notification card (`ntf|`), and drawn as a receipt screen
  (`device/receipt.py`, loaded into the pet's agent shell as a fragment) with
  service, price, network, transaction, Gateway balance and today's spend.
* **Arc-native sellers.** No public x402 service accepts Arc yet (Arc mainnet
  is not live in Gateway until after the hackathon), so `services/` hosts five
  tiny, genuinely useful paid endpoints pinned to `eip155:5042002` with real
  data behind them. They expose `openapi.json` with `x-payment-info` and
  `.well-known/x402` so they are x402scan-discoverable.

## Circle products used

| Product | Where |
|---|---|
| **Arc** (testnet, chain id 5042002, USDC as gas) | wallet, Gateway deposit tx, settlement |
| **USDC** | every price, every payment |
| **Agent Stack → Nanopayments (Gateway)** | `GatewayClient.pay()` buyer side, `createGatewayMiddleware` seller side |
| **Agent Stack → Agent Marketplace Discovery API** | `agent/src/catalog.ts` |
| **Circle CLI / Skills** | development workflow (`circle services inspect`, `circle gateway balance`) |

## Run it

Prerequisites: Node 22+, Bun 1.2+, an Arc-testnet-funded wallet, an Anthropic
API key (optional, a keyword planner takes over without one).

```bash
bun install
cp .env.example .env
bun run wallet new          # prints AGENT_PRIVATE_KEY + address → put the key in .env
# fund the address with Arc testnet USDC at https://faucet.circle.com
bun run wallet status       # wallet / Gateway balances
bun run wallet deposit 0.5  # optional; the agent tops up Gateway itself when low

# terminal 1 – the Arc-testnet x402 sellers
bun run services            # http://localhost:4020  (/catalog, /openapi.json)

# terminal 2 – the agent
bun run agent               # http://localhost:4010  control plane
```

Set `DEVICE_HASH` (or `DEVICE_MAC`) in `.env` to your pet. Say *"Jarvis, what's
ETH worth?"* — or, without a device, simulate the voice event:

```bash
curl -X POST localhost:4010/say -H 'content-type: application/json' -d '{"text":"what is the weather in Berlin"}'
curl localhost:4010/state     # wallet, policy, catalogue
curl localhost:4010/ledger    # every decision and payment
```

## Repository layout

```
agent/src/
  index.ts     pipeline + control plane        catalog.ts   discovery + voice filter
  brain.ts     Claude planner (structured)     policy.ts    decision logic on live signals
  wallet.ts    GatewayClient on Arc            ledger.ts    spend history / daily budget
  device.ts    MQTT bridge to the pet          wallet-cli.ts new | status | deposit
services/src/
  index.ts     Express + createGatewayMiddleware (eip155:5042002)
  catalog.ts   single source of truth → /catalog, /openapi.json, /.well-known/x402
  providers/   weather (Open-Meteo) · crypto (CoinGecko) · headline (HN) · snack · fortune
device/receipt.py   MicroPython fragment rendered by the pet's agent shell
docs/               architecture notes and diagram
```

## Device protocol (reference only, firmware unchanged)

| Direction | Topic | Payload |
|---|---|---|
| pet → agent | `og/d/<hash>/commands` | `evt\|voice\|<transcript>` after the wake word + STT |
| pet → agent | `og/d/<hash>/telemetry` | pet stats (battery etc.) used as policy signals |
| agent → pet | `og/d/<hash>/agent` | `say\|<text>` TTS · `ntf\|<title>\|<body>` · `note <text>` · `data <k> <v>` · `frag receipt\n<python>` |

## Mainnet

Arc mainnet is scheduled after the hackathon. The same code runs there with
`CHAIN=arc`, `X402_NETWORK=eip155:<arc-mainnet-id>` and an `ARC_RPC_URL`; once
Arc is in Gateway on mainnet, the discovery filter will start returning the
public marketplace sellers and the local services become optional.

## Status / honesty notes

* Tested on Arc testnet with Gateway's testnet facilitator.
* Wake word, STT and TTS are the pet's existing voice rail (closed source);
  this repo starts at the transcript and ends at the screen.
* Spending policies via the Circle CLI are mainnet-only today, so the
  guardrails here are implemented in the agent (`policy.ts` + a
  `onBeforePaymentCreation` hook inside the payment path).
