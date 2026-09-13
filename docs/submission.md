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
3. On a fresh ledger (delete ledger.json), say "Jarvis, buy me a snack" first
   → pet declines: "I haven't worked with this agent yet, let's start with
   something cheaper" (policy on worker history). After one cheap job the
   same request is approved and the snack job settles.
4. Show `curl :4010/ledger` and the Arc explorer for the worker address:
   USDC arriving per completed job, feedback events on the registry.

**Links:** repo · video · Arc explorer (pet wallet, worker wallet, job txs)

**Live proof (Arc testnet, 13 Sept 2026):**
- worker ERC-8004 identity: agentId 894780, tx 0x1ded823a52981e79e971a8bff08e34bca727900a3cc1dcf91561ea0b5a4523a4
- job 186256 (weather, 0.02 USDC): complete tx 0xa2824b3e4d3efefa17c2f594c9aabacff5159e077aa197e316bd14abe5dae757, feedback tx 0x58fd031761c9fc49a1e9f0efdc8e776c3812b683e28fbe5e0fb01449b261dc99
- job 186257 (crypto_price, 0.01 USDC): complete tx 0xe6da100c7353a6bebb0ae9a021ed5eb3c07abd9b584b5582bbe380cee496d668
