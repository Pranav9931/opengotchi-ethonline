# OpenGotchi Jobs on Arc

> **Say "Jarvis, what's the weather in Berlin?" to your pet.** The pet's agent opens an
> **ERC-8183 job on Arc**, funds **USDC escrow**, a worker agent with an **ERC-8004 onchain
> identity** does the work and submits the deliverable hash, the pet verifies it, **settles the
> USDC on Arc**, rates the worker, then **speaks the answer and shows the receipt on its screen**.
> Say **"buy one dollar of bitcoin"** and it executes a real Circle App Kit swap on Arc.

Built for **ETHGlobal ETHOnline 2026 · Arc track**. Full write-up with the process diagram:
[`docs/OpenGotchi-Jobs-on-Arc.pdf`](docs/OpenGotchi-Jobs-on-Arc.pdf). Demo prompts:
[`docs/questionnaire.md`](docs/questionnaire.md).

**Live on Arc testnet right now**

| | Address | Explorer |
|---|---|---|
| Pet agent wallet (funds escrow, executes swaps) | `0xfE8C4A56C628eb89c7F01A0671850DCDB9C67AD8` | [testnet.arcscan.app/address/0xfE8C…7AD8](https://testnet.arcscan.app/address/0xfE8C4A56C628eb89c7F01A0671850DCDB9C67AD8) |
| Worker agent wallet (ERC-8004 agentId 894780, receives settlements) | `0x99D60AAeD7e747D26B20FEd34A93ECC06f1C0372` | [testnet.arcscan.app/address/0x99D6…0372](https://testnet.arcscan.app/address/0x99D60AAeD7e747D26B20FEd34A93ECC06f1C0372) |
| ERC-8183 AgenticCommerce (jobs and escrow) | `0x0747EEf0706327138c69792bF28Cd525089e4583` | [testnet.arcscan.app/address/0x0747…4583](https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583) |

---

## Table of contents

1. [OpenGotchi and gotchiOS](#1-opengotchi-and-gotchios)
2. [What this repository adds](#2-what-this-repository-adds)
3. [Architecture](#3-architecture)
4. [Contracts and wallets](#4-contracts-and-wallets)
5. [Setup, step by step](#5-setup-step-by-step)
   1. [Get a pet running gotchiOS](#51-get-a-pet-running-gotchios)
   2. [Find the pet's identity](#52-find-the-pets-identity)
   3. [Install the tools on the computer that will host the agents](#53-install-the-tools)
   4. [Clone and install](#54-clone-and-install)
   5. [Create and fund the wallets](#55-create-and-fund-the-wallets)
   6. [Configure `.env`](#56-configure-env)
   7. [Start the worker and the agent](#57-start-the-worker-and-the-agent)
   8. [Deploy the app to the pet](#58-deploy-the-app-to-the-pet)
   9. [Talk to it](#59-talk-to-it)
6. [Using it without a device](#6-using-it-without-a-device)
7. [Decision logic](#7-decision-logic)
8. [The device app in detail](#8-the-device-app-in-detail)
9. [The agent and worker in detail](#9-the-agent-and-worker-in-detail)
10. [Troubleshooting](#10-troubleshooting)
11. [Repository map](#11-repository-map)
12. [Honesty notes](#12-honesty-notes)

---

## 1. OpenGotchi and gotchiOS

**OpenGotchi** is a palm-sized AI pet: an ESP32-S3 device with a 1.8-inch AMOLED screen, a
microphone, a speaker, touch and motion sensors, and a personality. It has needs you look after
(feed, clean, sleep, play), it reacts with animated "milady" eyes, and it talks. Say "Jarvis" and
it listens, transcribes, answers, and can open apps or take actions for you.

**gotchiOS** is the operating system that runs it, and our flagship. It is an ESP-IDF firmware
with an embedded MicroPython app runtime, so apps are single Python files deployed to the device
over the air. It provides:

* the on-device wake word (esp-sr WakeNet, "Jarvis");
* a voice rail with a background audio recorder and a speaker path;
* a TLS MQTT link to the OpenGotchi broker with a per-device identity and secret;
* a notification system and pet-state telemetry;
* a design system: dark AMOLED, violet gradients, proportional fonts, rounded surfaces, eye sprites.

**Anyone can flash gotchiOS onto their own ESP32 device from the open-source releases at
<https://github.com/opengotchi/gotchiOS-releases>.** This repository is an extension of gotchiOS:
everything here was written during the hackathon (4–13 Sept 2026) and runs *on top of* the stock
firmware through its public app and MQTT interfaces. No firmware code is modified or included.

## 2. What this repository adds

* **A wallet for the pet on Arc** and a second wallet for a **worker agent** that registers an
  ERC-8004 onchain identity.
* **Voice-commissioned jobs**: each request becomes an ERC-8183 job with USDC escrow, a hashed
  deliverable, verification, settlement, and reputation feedback. Seven Arc transactions per
  request.
* **Buying tokens by voice** through Circle App Kit swaps on Arc (USDC → cirBTC or EURC).
* **Decision logic on live signals** before any USDC moves, with declines spoken and shown.
* **A local voice rail**: whisper.cpp speech-to-text and TTS on the computer hosting the agents,
  so the pet needs no hosted speech service.
* **A new on-device app** (`device/arcvoice.py`) on the gotchiOS design language: eyes that
  react to the job, an orbit ring that lights one node per Arc transaction, a live waveform, a
  receipt sheet, wake word and tap to talk, a close button.

## 3. Architecture

```mermaid
flowchart LR
  U([User<br/>"Jarvis, weather in Berlin?"]) --> P
  subgraph P[OpenGotchi pet · gotchiOS]
    W[WakeNet "Jarvis"<br/>on-device] --> R[background recorder<br/>8 kHz PCM]
    A[arcvoice.py app<br/>eyes · orbit ring · receipt]
  end
  R -- "POST /voice/stt (LAN)" --> S
  subgraph S[Agent host · agent/ :4010]
    ST[whisper.cpp<br/>ggml-base.en] --> PL[planner<br/>Claude or keywords] --> PO[policy on live signals] --> J[viem: createJob · fund · complete · giveFeedback<br/>App Kit: swap]
    TTS[text-to-speech → 16 kHz PCM]
  end
  J -- "HTTP accept / run" --> WK
  subgraph WK[Worker agent · worker/ :4030 · ERC-8004 #894780]
    SK[weather · price · headline · polymarket · snack · fortune] --> SB[setBudget · submit keccak result]
  end
  J -- "7 txs per request" --> ARC[(Arc testnet<br/>ERC-8183 · ERC-8004 · USDC)]
  SB --> ARC
  S -- "MQTT rcpt · speak" --> B[(mqtt.opengotchi.com:8883)] --> A
  TTS -- "GET /voice/tts stream" --> A
```

**One request, end to end.** Wake word fires (or tap) → the app records with a live waveform and
stops on silence → PCM is posted over the LAN to the agent → whisper.cpp transcribes → the planner
maps the transcript to a worker skill and parameters (or to a purchase) with a confidence score →
the policy engine approves or declines → pet `createJob(provider=worker, evaluator=pet)` → worker
`setBudget` → pet `approve` + `fund` (escrow) → worker does the work, `submit(keccak(result))` →
pet checks `keccak(payload) == getJob().deliverable`, then `complete` (USDC → worker) →
`giveFeedback` on the worker's identity → the receipt goes to the pet as one MQTT message → the
answer is spoken through the pet's speaker.

## 4. Contracts and wallets

**No contract of our own was deployed.** The flow runs on the contracts Arc documents for its
agentic economy, live on Arc testnet (chain id 5042002; USDC is the native gas token).

| Contract | Address (Arc testnet) |
|---|---|
| USDC (native gas, ERC-20 interface, 6 dp) | `0x3600000000000000000000000000000000000000` |
| ERC-8183 AgenticCommerce (reference) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ERC-8004 ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

| Wallet (hackathon deployment) | Address |
|---|---|
| Pet agent (client + evaluator, funds escrow, executes swaps) | `0xfE8C4A56C628eb89c7F01A0671850DCDB9C67AD8` |
| Worker agent (provider, **ERC-8004 agentId 894780**) | `0x99D60AAeD7e747D26B20FEd34A93ECC06f1C0372` |

Worker identity mint: `0x1ded823a52981e79e971a8bff08e34bca727900a3cc1dcf91561ea0b5a4523a4`.
During the hackathon 20+ jobs settled (ids 186256–186283), several were held by policy and shown
on the pet, and two real App Kit swaps executed: 0.5 USDC → 0.3999 EURC
(`0xe76f13fb…b72747`) and 1 USDC → 0.00000271 cirBTC (`0xc91f8e3e…968a0b`).
Explorer: <https://testnet.arcscan.app>.

## 5. Setup, step by step

### 5.1 Get a pet running gotchiOS

1. Hardware: an OpenGotchi, or a Waveshare **ESP32-S3-Touch-AMOLED-1.8** (16 MB flash) which is
   the board gotchiOS targets.
2. Download the latest release from <https://github.com/opengotchi/gotchiOS-releases> and flash
   it following the release notes (the release bundles bootloader, partition table, the app, and
   the WakeNet model partition). Firmware **0.0.421 or newer** is required; that is the version
   this project was tested against.
3. First boot: join the pet to your Wi-Fi from its setup screen. The pet then **provisions
   itself**: it posts its device hash to the OpenGotchi API and receives a 64-hex **device
   secret**, stored in its flash. From then on it connects to `mqtts://mqtt.opengotchi.com:8883`.
4. The pet and the computer that will run the agents must be on the **same Wi-Fi network**: the
   pet streams audio to that computer over plain HTTP on the LAN.

### 5.2 Find the pet's identity

You need two values for `.env`:

* **`DEVICE_HASH`** — 32 hex characters, shown in the pet's settings / about screen. It is
  `sha256(MAC + salt)[:32]`; if you only have the MAC, set `DEVICE_MAC=AA:BB:CC:DD:EE:FF`
  instead and the agent derives the hash.
* **`GOTCHI_DEVICE_SECRET`** — the 64-hex secret the pet received at provisioning. It is
  available from your OpenGotchi account / server for your device (developer mode). It is the
  pet's own credential: keep it out of git (`.env` is gitignored). If your server issues scoped
  agent tokens, set `GOTCHI_AGENT_TOKEN` instead; the agent then logs in as `agent:<hash>`.

### 5.3 Install the tools

On the computer that will host the agents (tested on macOS; Linux notes below):

```bash
brew install node bun ffmpeg whisper-cpp     # Node 22+, Bun 1.2+, ffmpeg, whisper-cli
```

* **Speech-to-text** is [whisper.cpp](https://github.com/ggerganov/whisper.cpp) (`whisper-cli`)
  with the `ggml-base.en` model, downloaded in 5.4.
* **Text-to-speech** uses macOS's built-in `say`, converted by ffmpeg to 16 kHz PCM. On Linux,
  replace `synthesize()` in `agent/src/voice.ts` with piper or espeak-ng producing raw 16 kHz
  s16le mono PCM; everything else is portable.
* **Planner**: optional `ANTHROPIC_API_KEY` for Claude; a keyword planner runs without it.

### 5.4 Clone and install

```bash
git clone https://github.com/Pranav9931/opengotchi-ethonline
cd opengotchi-ethonline
bun install
mkdir -p models && curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin     # 148 MB
```

### 5.5 Create and fund the wallets

```bash
cp .env.example .env
bun run wallet new
# prints two fresh keys:
#   AGENT_PRIVATE_KEY=0x…    # <pet address>
#   WORKER_PRIVATE_KEY=0x…   # <worker address>
# paste both lines into .env
```

1. Fund the **pet address** with Arc testnet USDC at <https://faucet.circle.com> (choose
   *Arc Testnet*, *USDC*; one request of 20 USDC is plenty; USDC is also the gas token).
2. Give the worker some gas: `bun run wallet fund-worker 3` sends 3 USDC from the pet to the
   worker onchain.
3. Check: `bun run wallet status` prints both balances with explorer links.

### 5.6 Configure `.env`

```ini
# wallets (from bun run wallet new)
AGENT_PRIVATE_KEY=0x...
WORKER_PRIVATE_KEY=0x...
EXPLORER_URL=https://testnet.arcscan.app

# the pet
DEVICE_HASH=8d7bf9d0...                # or DEVICE_MAC=AA:BB:CC:DD:EE:FF
GOTCHI_DEVICE_SECRET=...               # 64 hex, or GOTCHI_AGENT_TOKEN=...
MQTT_URL=mqtts://mqtt.opengotchi.com:8883

# spending policy (the pet's own guardrails)
MAX_PRICE_USD=0.05                     # per job
DAILY_BUDGET_USD=10                    # jobs + purchases per calendar day
MIN_RESERVE_USD=0.2                    # never spend below this balance
MAX_SWAP_USD=2                         # per voice-triggered purchase

# services
WORKER_PORT=4030
WORKER_URL=http://localhost:4030
AGENT_PORT=4010
# AGENT_PUBLIC_URL=http://192.168.1.3:4010   # optional; deploy-app detects the LAN IP otherwise

# voice
VOICE_MODE=local                       # local = arcvoice app + whisper/say; hosted = firmware TTS
WHISPER_BIN=whisper-cli
WHISPER_MODEL=./models/ggml-base.en.bin
# SAY_VOICE=Samantha

# optional
# ANTHROPIC_API_KEY=                   # Claude planner (claude-opus-5); keyword planner otherwise
# CIRCLE_API_KEY=                      # raises the App Kit rate limit for swaps
```

### 5.7 Start the worker and the agent

```bash
bun run worker     # terminal 1 · :4030 · registers its ERC-8004 identity on first start (worker.json)
bun run agent      # terminal 2 · :4010 · connects to the pet's MQTT topics, serves STT/TTS
```

Expected log lines: `[worker] … agentId <n> · 6 skills`, `[agent] … USDC on Arc testnet`,
`[device] mqtt connected, listening to og/d/<hash>/commands`.

### 5.8 Deploy the app to the pet

```bash
bun run deploy-app                       # or: bun run deploy-app http://<host-ip>:4010
```

The script substitutes the host's LAN address into `device/arcvoice.py`, asks any running copy
to exit, sends the file to the pet's `app/deploy` topic with `launch:true`, and waits for the
pet to report `ready:arcvoice` and `wake:armed`. Nothing is flashed. The app also appears in the
pet's launcher afterwards, so it can be started by hand.

### 5.9 Talk to it

Say **"Jarvis"**, wait for the chirp, then for example:

| Say | What happens |
|---|---|
| "What's the weather in Berlin?" | weather job, 0.02 USDC, settled on Arc |
| "How much is bitcoin worth?" | price job |
| "What are the odds of a Fed rate cut?" | Polymarket job |
| "Buy one dollar of bitcoin" | App Kit swap USDC → cirBTC |
| "Buy one dollar of ethereum" | declined out loud: ETH does not exist on Arc |

Tap also starts listening. Press the BOOT button, tap the **x** in the top-right corner, swipe
down, or long-press to close the app. The full prompt list is in
[`docs/questionnaire.md`](docs/questionnaire.md).

## 6. Using it without a device

The identical pipeline runs from the agent's control plane:

```bash
curl -X POST localhost:4010/say -H 'content-type: application/json' -d '{"text":"what is the weather in Berlin"}'
curl localhost:4010/state       # wallet, worker, policy, spend today
curl localhost:4010/ledger      # every decision, job id and tx hash
curl localhost:4010/log         # live agent log
curl localhost:4030/identity    # worker agentId, balance, jobs done
bun run swap estimate 1 cirBTC  # quote a purchase; `bun run swap buy 0.5 EURC` executes one
```

## 7. Decision logic

Evaluated in `agent/src/policy.ts` and `handleBuy` before any USDC moves:

| Signal | Source | Rule |
|---|---|---|
| confidence | planner | < 0.6 → "say it again" |
| worker identity | ERC-8004 agentId via worker `/skills` | missing → never paid |
| price | catalogue, re-checked against onchain `setBudget` | > `MAX_PRICE_USD` → hold; quote above catalogue → abort |
| spent today | `ledger.json` | + price > `DAILY_BUDGET_USD` → hold |
| USDC balance | `balanceOf` on Arc | balance − price < `MIN_RESERVE_USD` → hold |
| worker history | ledger | first job with a worker must be ≤ half the cap |
| battery | pet telemetry | < 15 % → only snack jobs |
| purchase | `MAX_SWAP_USD` | larger purchases held; assets not on Arc declined by name |
| deliverable | `getJob().status` + hash compare | mismatch → never `complete()` |

Holds are spoken and shown on the pet as a "HELD" receipt.

## 8. The device app in detail

`device/arcvoice.py` is a single-file MicroPython app (~19 KB) on the stock gotchiOS runtime.

| Aspect | Configuration |
|---|---|
| Agent endpoint | `__AGENT_URL__` replaced at deploy time |
| Wake word | firmware WakeNet via `audio.wake_ready/start/detected/stop`; armed at idle, disarmed while recording or speaking (detector and recorder cannot share the mic), re-armed after |
| Recording | `audio.rec_start(16000, 12, False)` background recorder → 8 kHz PCM16 ring; energy VAD: floor learned in 300 ms, threshold 3×floor+350, stop after 800 ms silence, 1.2–7 s window; `POST /voice/stt` with `X-Sample-Rate: 8000` |
| Playback | `http.stream(GET /voice/tts)` → `audio.play()` at 16 kHz; odd trailing bytes carried between chunks |
| Directives in (MQTT `agent` topic) | `rcpt k␟v␞…` whole receipt in one message (firmware inbox holds 8; status applied last) · `data k v` · `speak text` · `note text` · `ping` · `exit` |
| Events out (`commands` topic) | `evt\|shell\|ready:arcvoice` · `wake:armed` · `rcpt:<status>` · `error:<repr>` |
| UI | gotchiOS token sheet via `rrect`, `rrect_grad`, `rrect_a`, `ftext` (Space Grotesk / Plex), `gray4` eye sprites; eyes react to state; six-node orbit ring lights one node per Arc tx; live waveform; particle burst on settlement; receipt sheet with chips; ticker of prompts at idle |
| Controls | tap = talk · BOOT button / top-right **x** / swipe down / long press = exit |

## 9. The agent and worker in detail

| File | Role |
|---|---|
| `agent/src/index.ts` | pipeline: voice → plan → policy → job lifecycle or purchase → receipt; control plane |
| `agent/src/brain.ts` | Claude planner (zod structured output: `action job\|buy\|none`, skill, params, amount, asset, confidence) + keyword fallback |
| `agent/src/policy.ts` | decision logic |
| `agent/src/swap.ts` | Circle App Kit: `createViemAdapterFromPrivateKey`, `kit.estimateSwap`, `kit.swap` on `Arc_Testnet` |
| `agent/src/voice.ts` | `/voice/stt` (ffmpeg resample → `whisper-cli -m ggml-base.en -nt -l en`) · `/voice/tts` (`say` → ffmpeg → raw PCM, cached) |
| `agent/src/device.ts` | MQTT bridge (TLS 8883, `gotchi-bridge-*` client id), subscribes `commands` + `telemetry`, sends `rcpt/data/speak/note` |
| `agent/src/ledger.ts` | append-only `ledger.json`: spend today, history per worker |
| `agent/src/deploy-app.ts` | pushes `device/arcvoice.py` over MQTT |
| `agent/src/wallet-cli.ts` | `new` · `status` · `fund-worker <usd>` |
| `worker/src/index.ts` | ERC-8004 registration (`worker.json`), `/skills`, `/identity`, `POST /jobs/:id/accept` (`setBudget`), `POST /jobs/:id/run` (do work, `submit(keccak)`) |
| `worker/src/skills.ts` | weather (Open-Meteo) · crypto_price (CoinGecko) · headline (Hacker News) · polymarket (Gamma API) · snack · fortune |
| `shared/arc.ts` | viem clients for `arcTestnet`, ABIs and helpers for ERC-8183 / ERC-8004 / USDC |

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `mqtt: Connection refused: Not authorized` | wrong `GOTCHI_DEVICE_SECRET`, or a client id starting with `agent-` (the broker's auth hook rejects it); the agent uses `gotchi-bridge-*` |
| `connack timeout` on port 1883 | the broker only serves TLS on 8883; use `mqtts://mqtt.opengotchi.com:8883` |
| pet says "agent unreachable (http 0)" | pet and host not on the same Wi-Fi, or `AGENT_PUBLIC_URL` points to the wrong IP; redeploy with `bun run deploy-app http://<host-ip>:4010` |
| pet plays noise instead of speech | TTS must be raw 16 kHz s16le mono; the agent strips WAV padding via ffmpeg and the app carries odd bytes between chunks |
| "heard nothing" | speak after the chirp; the agent log prints `[stt] … {peak, rms}` per capture; raise the mic distance or say the request more loudly |
| job held: "already spent … today" | `DAILY_BUDGET_USD` reached; raise it in `.env` and restart the agent |
| pet reboots during deploy | deploying over a running instance; `deploy-app` now sends `exit` first and waits |
| app never reports `ready` | it crashed at startup; the pet sends `evt\|shell\|error:<repr>` to the agent log |
| `WHISPER_MODEL not set or missing` | download the model into `models/` (step 5.4) |

## 11. Repository map

```
shared/arc.ts          Arc testnet clients, ERC-8183 / ERC-8004 / ERC-20 ABIs and helpers
agent/src/             pipeline, planner, policy, swap, voice, device bridge, ledger, CLIs
worker/src/            ERC-8004 worker agent and its six skills
device/arcvoice.py     the on-device app (deployed over MQTT)
device/receipt.py      legacy receipt fragment for the stock agent shell (hosted-voice mode)
docs/                  OpenGotchi-Jobs-on-Arc.pdf (write-up + diagram), questionnaire.md, architecture.md, submission.md
models/                whisper model (gitignored)
```

## 12. Honesty notes

* Arc testnet only; Arc mainnet was not yet in Circle's stack during the hackathon. Switching is
  the viem chain object plus the mainnet registry addresses once published.
* Wake word, mic, speaker and MQTT are gotchiOS features used through their public MicroPython
  APIs; the closed firmware source is not in this repo.
* Worker skills fetch free public data. What is bought and sold is the job and its onchain
  settlement.
* Wallets are self-managed keys for the demo; Arc's tutorials show the same flow with Circle
  developer-controlled wallets.
