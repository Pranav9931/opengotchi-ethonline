# opengotchi-ethonline — a voice-driven pet that commissions and settles jobs on Arc

> Say **"Jarvis, what's the weather in Berlin?"** to the OpenGotchi pet. The pet's
> agent opens an **ERC-8183 job on Arc**, funds **USDC escrow**, a worker agent with
> an **ERC-8004 identity** does the work and submits the deliverable hash, the pet
> verifies it, **settles the USDC on Arc**, records feedback on the worker's
> reputation, and reads the answer aloud with the receipt on its screen.

Built for **ETHGlobal ETHOnline 2026**, Arc track (*Best Agentic Economy
Application*). Everything here was written during the hacking period
(4–13 Sept 2026). It talks to the closed-source gotchiOS firmware over its
existing MQTT and voice interfaces; no firmware code is included or modified.

## What happens on one voice request

```
 user ──"Jarvis, weather in Berlin?"──▶ pet (gotchiOS: WakeNet + cloud STT)
                                          │ evt|voice|<text>   (MQTT)
                                          ▼
                                   pet agent  (agent/)         ← this repo
   plan ─── Claude: skill + params + confidence
   decide ─ policy on live signals: USDC balance, today's spend, price, worker
            track record, ERC-8004 identity present, pet battery, confidence
   1 createJob(provider=worker, evaluator=pet)          Arc tx
   2 worker: setBudget(price)                           Arc tx   ┐
   3 approve + fund(escrow in USDC)                     Arc tx   │ worker agent
   4 worker: do the work, submit(keccak(result))        Arc tx   │ (worker/)
   5 verify hash == onchain deliverable, complete()     Arc tx   ┘ USDC → worker
   6 giveFeedback(worker agentId, 100)                  Arc tx   (ERC-8004 reputation)
                                          │ say| ntf| frag receipt  (MQTT)
                                          ▼
                                   pet speaks the answer, shows job #, txs, balance
```

Six transactions on Arc testnet per request, sub-second finality, USDC as gas.

## Why this shape

* **Agents with clear decision logic tied to real signals.** `agent/src/policy.ts`
  approves or declines before any USDC moves: balance minus reserve, daily
  budget from the ledger, per-job cap, whether the worker has an onchain
  identity, how many jobs it has completed for us (new workers only get cheap
  jobs first), the pet's battery from device telemetry, planner confidence.
  Declines are spoken and shown on the receipt.
* **Autonomous payments and job settlement in USDC.** Escrow, deliverable,
  evaluation and settlement follow Arc's ERC-8183 reference contract; nothing
  is simulated. The pet only pays when the onchain deliverable hash matches
  the result it received.
* **Agent-to-agent.** Two wallets, two processes: the pet (client + evaluator)
  and the worker (provider). The worker registers itself in Arc's ERC-8004
  IdentityRegistry on first start and earns reputation per job.
* **Outcome on the device.** Spoken (`say|`), a notification card (`ntf|`),
  and a receipt screen (`device/receipt.py`, loaded into the pet's agent shell
  as a fragment) with skill, job id, settlement tx, balance and today's spend.

## Arc contracts used (testnet, chain id 5042002)

| Contract | Address |
|---|---|
| USDC (native gas, ERC-20 interface) | `0x3600000000000000000000000000000000000000` |
| ERC-8183 AgenticCommerce (reference) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

## Run it

Prerequisites: Node 22+, Bun 1.2+, two Arc-testnet wallets with USDC, an
Anthropic API key (optional, a keyword planner takes over without one).

```bash
bun install
cp .env.example .env
bun run wallet new          # prints AGENT_PRIVATE_KEY and WORKER_PRIVATE_KEY → paste into .env
# fund both addresses with Arc testnet USDC at https://faucet.circle.com
bun run wallet status

bun run worker              # terminal 1: registers ERC-8004 identity, serves skills on :4030
bun run agent               # terminal 2: pet agent, control plane on :4010
```

Set `DEVICE_HASH` (or `DEVICE_MAC`) in `.env` to your pet and say *"Jarvis,
what's ETH worth?"* Without a device, simulate the voice event:

```bash
curl -X POST localhost:4010/say -H 'content-type: application/json' -d '{"text":"what is the weather in Berlin"}'
curl localhost:4010/state      # wallet, worker, policy
curl localhost:4010/ledger     # every decision, job id and tx hash
curl localhost:4030/identity   # worker agentId, balance, jobs done
```

## Repository layout

```
shared/arc.ts        Arc testnet clients, ERC-8183 + ERC-8004 ABIs and helpers
agent/src/
  index.ts           pipeline + control plane        policy.ts    decision logic
  brain.ts           Claude planner (structured)     ledger.ts    spend / history
  device.ts          MQTT bridge to the pet          skills.ts    worker catalogue
  wallet-cli.ts      new | status
worker/src/
  index.ts           ERC-8004 registration, /jobs/:id/accept (setBudget), /jobs/:id/run (submit)
  skills.ts          weather (Open-Meteo) · crypto price (CoinGecko) · headline (HN) · snack · fortune
device/receipt.py    MicroPython fragment rendered by the pet's agent shell
docs/                architecture and sequence diagram
```

## Device protocol (reference only, firmware unchanged)

Broker: `mqtts://mqtt.opengotchi.com:8883` (TLS). Auth is the device hash as
username with the device's provisioned secret (`GOTCHI_DEVICE_SECRET`), or
`agent:<hash>` with an agent token (`GOTCHI_AGENT_TOKEN`).

| Direction | Topic | Payload |
|---|---|---|
| pet → agent | `og/d/<hash>/commands` | `evt\|voice\|<transcript>` after the wake word + STT |
| pet → agent | `og/d/<hash>/telemetry` | pet stats (battery etc.) used as policy signals |
| agent → pet | `og/d/<hash>/agent` | `say\|<text>` · `ntf\|<title>\|<body>` · `note <text>` · `data <k> <v>` · `frag receipt\n<python>` |

## Mainnet

Arc mainnet launches after the hackathon. The code targets the chain via
viem's `arcTestnet` definition and the contract addresses above; switching is
a chain object and five addresses once Circle publishes the mainnet
deployments of the ERC-8183 / ERC-8004 registries.

## Honesty notes

* Wake word, STT and TTS are the pet's existing voice rail (closed source);
  this repo starts at the transcript and ends at the screen.
* Worker skills fetch free public data; what is sold is the job and its
  onchain settlement, which is the point of the demo.
* Wallets are self-managed viem accounts. Circle developer-controlled wallets
  are a drop-in per Arc's tutorials if custody matters.
