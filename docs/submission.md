# ETHGlobal submission draft

**Project name:** OpenGotchi Jobs on Arc

**Short description (≤ 280 chars):**
A voice-first pet that hires AI agents on Arc. Say "Jarvis, weather in Berlin"
and the pet opens an ERC-8183 job, escrows USDC, verifies the worker's
deliverable hash, settles on Arc, rates the worker's ERC-8004 identity, and
shows the receipt on its screen.

**Description:**
OpenGotchi is a palm-sized ESP32 pet with a wake word and a voice rail. For
ETHOnline we gave it a wallet on Arc and taught it to buy work from other
agents the way Arc's agentic-economy docs describe: identity (ERC-8004),
escrow-backed jobs (ERC-8183), USDC settlement with sub-second finality.

One spoken request produces six transactions on Arc testnet: createJob,
setBudget (worker), approve + fund (escrow), submit (worker, keccak of the
result), complete (pet, after verifying the hash), giveFeedback (reputation).
The pet decides whether to spend from live signals: its USDC balance minus a
reserve, today's spend, the per-job cap, whether the worker has an onchain
identity and a track record with us, its own battery from device telemetry,
and the planner's confidence. Declines are spoken and shown, not hidden.

The device firmware is untouched. The pet's existing MQTT and voice
interfaces carry the transcript in and the spoken answer, notification card
and receipt screen out.

**How it's made:**
TypeScript on Bun. `viem` against Arc testnet (`arcTestnet` chain, USDC as
gas). Arc's reference ERC-8183 AgenticCommerce contract and ERC-8004
Identity/Reputation/Validation registries. Claude (structured outputs) turns
the transcript into a skill + parameters + confidence, with a keyword planner
as fallback. Two processes: the pet agent (client + evaluator) and a worker
agent (provider) that registers itself in the IdentityRegistry on first start
and sells five skills (weather, crypto price, headline, snack, fortune) backed
by free public data. MQTT bridge to the gotchiOS agent shell: `say|` for TTS,
`ntf|` for a card, `frag` for a MicroPython receipt screen.

**Arc products used:** Arc testnet, USDC, ERC-8183 jobs, ERC-8004 identity +
reputation.

**Demo script (video):**
1. `bun run worker` → "registering ERC-8004 identity" → explorer link.
2. Say "Jarvis, what's the weather in Berlin?" → pet replies "Checking the
   sky for you!", receipt screen shows job #, escrow, settlement tx, balance.
3. Say "Jarvis, buy me a snack" → pet declines: "I haven't worked with this
   agent on anything that expensive yet" (policy on worker history), then
   approves after another cheap job.
4. Show `curl :4010/ledger` and the Arc explorer for the worker address:
   USDC arriving per completed job, feedback events on the registry.

**Links:** repo · video · Arc explorer (pet wallet, worker wallet, job txs)
