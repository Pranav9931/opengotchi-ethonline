# OpenGotchi Jobs on Arc

> **Say "Jarvis, what's the weather in Berlin?" to your pet.** The pet's agent opens an
> **ERC-8183 job on Arc**, funds **USDC escrow**, a worker agent with an **ERC-8004
> onchain identity** does the work and submits the deliverable hash, the pet verifies
> it, **settles the USDC on Arc**, rates the worker, then **speaks the answer and shows
> the receipt on its screen**.

Built for **ETHGlobal ETHOnline 2026 · Arc track**. Full write-up with the process
diagram: [`docs/OpenGotchi-Jobs-on-Arc.pdf`](docs/OpenGotchi-Jobs-on-Arc.pdf).

> **This repository is an extension of our flagship [gotchiOS](https://github.com/opengotchi/gotchiOS-releases).**
> gotchiOS is the ESP32-S3 pet operating system: wake word, voice rail, MQTT, MicroPython
> app runtime, AMOLED UI. Anyone can flash it onto their own ESP32 device from the
> open-source releases at <https://github.com/opengotchi/gotchiOS-releases>. Everything
> here was written during the hackathon (4–13 Sept 2026) and runs *on top of* the stock
> firmware through its public app and MQTT interfaces. No firmware code is modified or
> included.

---

## Pipeline

```mermaid
flowchart LR
  U([User<br/>"Jarvis, weather in Berlin?"]) --> P
  subgraph P[OpenGotchi pet · gotchiOS]
    W[WakeNet "Jarvis"<br/>on-device] --> R[background recorder<br/>8 kHz PCM]
    A[arcvoice.py app<br/>eyes · orbit ring · receipt]
  end
  R -- "POST /voice/stt (LAN)" --> S
  subgraph S[Agent PC · agent/ :4010]
    ST[whisper.cpp<br/>ggml-base.en] --> PL[planner<br/>Claude or keywords] --> PO[policy on live signals] --> J[viem: createJob · fund · complete · giveFeedback]
    TTS[macOS say → 16 kHz PCM]
  end
  J -- "HTTP accept / run" --> WK
  subgraph WK[Worker agent · worker/ :4030 · ERC-8004 #894780]
    SK[weather · price · headline · snack · fortune] --> SB[setBudget · submit keccak result]
  end
  J -- "7 txs per request" --> ARC[(Arc testnet<br/>ERC-8183 · ERC-8004 · USDC)]
  SB --> ARC
  S -- "MQTT rcpt · speak" --> B[(mqtt.opengotchi.com:8883)] --> A
  TTS -- "GET /voice/tts stream" --> A
```

One spoken request → **seven Arc transactions**: `createJob` (pet) · `setBudget` (worker) ·
`approve` + `fund` escrow (pet) · `submit(keccak(result))` (worker) · `complete` after the
pet verifies the hash (USDC → worker) · `giveFeedback` on the worker's ERC-8004 identity.

## Was a contract deployed? Addresses

**No contract of our own was deployed.** The flow runs on the contracts Arc documents
for its agentic economy, already live on Arc testnet (chain id 5042002, USDC is gas):

| Contract | Address (Arc testnet) |
|---|---|
| USDC (native gas, ERC-20 interface, 6 dp) | `0x3600000000000000000000000000000000000000` |
| ERC-8183 AgenticCommerce (reference) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

| Wallet | Address |
|---|---|
| Pet agent (client + evaluator, funds escrow) | `0xfE8C4A56C628eb89c7F01A0671850DCDB9C67AD8` |
| Worker agent (provider, **ERC-8004 agentId 894780**) | `0x99D60AAeD7e747D26B20FEd34A93ECC06f1C0372` |

Worker identity mint: `0x1ded823a52981e79e971a8bff08e34bca727900a3cc1dcf91561ea0b5a4523a4`.
During the hackathon **17 jobs settled** (ids 186256–186274, 0.230 USDC), 4 were declined by
policy and 2 failed and were reported on the pet. Explorer: <https://testnet.arcscan.app>.

## Decision logic (agent/src/policy.ts)

| Signal | Source | Rule |
|---|---|---|
| confidence | planner | < 0.6 → ask again |
| worker identity | ERC-8004 agentId via worker `/skills` | missing → never paid |
| price | catalogue, re-checked against onchain `setBudget` | > `MAX_PRICE_USD` (0.05) → decline; quote above catalogue → abort |
| spent today | `ledger.json` | + price > `DAILY_BUDGET_USD` (0.50) → decline |
| USDC balance | `balanceOf` on Arc | balance − price < `MIN_RESERVE_USD` (0.20) → decline |
| worker history | ledger | first job with a worker must be ≤ half the cap |
| battery | pet telemetry | < 15 % → only snack jobs |
| deliverable | `getJob().status` + hash compare | mismatch → never `complete()` |

Declines are spoken and shown on the pet ("HELD" state), not hidden.

## The device app · `device/arcvoice.py`

A single-file MicroPython app that runs inside the stock gotchiOS runtime. It is
**deployed over MQTT, not flashed**: `bun run deploy-app` asks any running copy to exit,
sends the file to `og/d/<hash>/app/deploy` with `launch:true`, and waits for the pet's
`ready` / `wake:armed` events. The app then also appears in the pet's launcher.

| Aspect | Configuration |
|---|---|
| Agent endpoint | `__AGENT_URL__` is replaced at deploy time with `http://<PC LAN IP>:4010` (or `AGENT_PUBLIC_URL`). Pet and PC share a Wi-Fi. |
| Wake word | firmware WakeNet "Jarvis" via `audio.wake_*`; armed at idle, disarmed while recording or speaking, re-armed after. Tap is the fallback. |
| Recording | `audio.rec_start()` background recorder → 8 kHz PCM16 ring; energy VAD (floor learned in 300 ms, stop after 800 ms silence, 1.2–7 s); `POST /voice/stt` with `X-Sample-Rate: 8000`. |
| Playback | `http.stream(GET /voice/tts)` → `audio.play()` 16 kHz, odd bytes carried between chunks. |
| Directives in | `rcpt k␟v␞…` (whole receipt in one message; the firmware inbox holds 8) · `data k v` · `speak text` · `note text` · `ping` · `exit` |
| Events out | `evt\|shell\|ready:arcvoice` · `wake:armed` · `rcpt:<status>` · `error:<repr>` |
| UI | gotchiOS token sheet (dark AMOLED, violet gradient, Space Grotesk / Plex via `display.ftext`), milady eye sprites reacting to the job, six-node orbit ring lighting one node per Arc tx with a comet, live waveform, particle burst on settlement, receipt sheet with chips |
| Gestures | tap = talk · swipe down / long press / button 1 = exit |

## The PC side

| Process | Port | Role |
|---|---|---|
| `bun run worker` | 4030 | registers its ERC-8004 identity on first start (`worker.json`), serves skills, `setBudget`, does jobs, `submit(keccak(result))` |
| `bun run agent` | 4010 | MQTT bridge, `/voice/stt` + `/voice/tts`, planner, policy, Arc job lifecycle, ledger, control plane (`POST /say`, `/state`, `/ledger`, `/log`) |

**Speech-to-text:** [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`whisper-cli`,
Homebrew `whisper-cpp`) with `ggml-base.en.bin` (148 MB), ~0.3 s per utterance on Apple
Silicon; ffmpeg resamples the pet's 8 kHz audio to 16 kHz.
**Text-to-speech:** macOS built-in `say` (voice via `SAY_VOICE`), rendered at 16 kHz and
converted by ffmpeg to raw s16le mono PCM, cached per sentence. On Linux swap
`synthesize()` in `agent/src/voice.ts` for piper or espeak-ng.
**Planner:** Claude (`claude-opus-5`, structured outputs) when `ANTHROPIC_API_KEY` is set,
otherwise a keyword planner. The hosted OpenGotchi voice API is not used.

### Run it on a new PC

```bash
# 1. tools (macOS; on Linux everything but `say`, see above)
brew install node bun ffmpeg whisper-cpp
git clone https://github.com/Pranav9931/opengotchi-ethonline && cd opengotchi-ethonline
bun install
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# 2. configuration
cp .env.example .env
bun run wallet new             # AGENT_PRIVATE_KEY + WORKER_PRIVATE_KEY → paste into .env
# fund the agent address with Arc testnet USDC at https://faucet.circle.com
bun run wallet fund-worker 3   # pet sends the worker 3 USDC for gas
# .env: DEVICE_HASH=<pet hash>  GOTCHI_DEVICE_SECRET=<pet secret>  WHISPER_MODEL=./models/ggml-base.en.bin

# 3. run, then push the app to the pet
bun run worker                 # terminal 1
bun run agent                  # terminal 2
bun run deploy-app             # substitutes this PC's LAN IP, deploys + launches on the pet
```

Requirements on the pet: gotchiOS ≥ 0.0.421 from
[gotchiOS-releases](https://github.com/opengotchi/gotchiOS-releases), provisioned (device
hash + secret), same Wi-Fi as the PC. MQTT is `mqtts://mqtt.opengotchi.com:8883`, username =
device hash, password = device secret, client id `gotchi-bridge-*`.

Without a device, the identical flow runs from the control plane:

```bash
curl -X POST localhost:4010/say -H 'content-type: application/json' -d '{"text":"what is the weather in Berlin"}'
curl localhost:4010/state      # wallet, worker, policy
curl localhost:4010/ledger     # every decision, job id and tx hash
curl localhost:4030/identity   # worker agentId, balance, jobs done
```

## Repository map

```
shared/arc.ts          Arc testnet clients (viem arcTestnet), ERC-8183 / ERC-8004 / ERC-20 ABIs + helpers
agent/src/index.ts     pipeline: voice → plan → policy → job lifecycle → receipt; control plane
agent/src/voice.ts     /voice/stt (whisper.cpp) · /voice/tts (macOS say → PCM)
agent/src/device.ts    MQTT bridge to the pet         agent/src/brain.ts   Claude planner + keyword fallback
agent/src/policy.ts    decision logic                 agent/src/ledger.ts  spend + history
agent/src/skills.ts    worker catalogue client        agent/src/config.ts  env
agent/src/wallet-cli.ts new | status | fund-worker   agent/src/deploy-app.ts  push the app to the pet
worker/src/index.ts    ERC-8004 registration, /skills, /jobs/:id/accept, /jobs/:id/run
worker/src/skills.ts   weather (Open-Meteo) · crypto_price (CoinGecko) · headline (HN) · snack · fortune
device/arcvoice.py     the on-device app (deployed over MQTT)
docs/                  OpenGotchi-Jobs-on-Arc.pdf (full write-up), architecture.md, submission.md
```

## Honesty notes

* Arc testnet only; Arc mainnet was not yet in Circle's stack during the hackathon.
  Switching is the viem chain object plus the mainnet registry addresses once published.
* Wake word, mic, speaker and MQTT are gotchiOS features used through their public
  MicroPython APIs; the closed firmware source is not in this repo.
* Worker skills fetch free public data. What is bought and sold is the job and its
  onchain settlement.
* Wallets are self-managed keys for the demo; Arc's tutorials show the same flow with
  Circle developer-controlled wallets.
