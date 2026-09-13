/**
 * Voice -> pet agent -> ERC-8183 job on Arc -> worker agent -> USDC settles -> outcome on the pet.
 *
 *   "Jarvis, what's the weather in Berlin"     (wake word + STT, firmware)
 *      -> evt|voice|... over MQTT
 *      -> Claude plans: skill + params + confidence
 *      -> policy on live signals (USDC balance, budget, price, worker record, battery)
 *      -> createJob(provider=worker, evaluator=pet)          [Arc tx]
 *      -> worker setBudget                                    [Arc tx]
 *      -> pet approve + fund escrow                           [Arc tx]
 *      -> worker does the job, submit(keccak(result))         [Arc tx]
 *      -> pet verifies the hash, complete() -> USDC to worker [Arc tx]
 *      -> pet giveFeedback on the worker's ERC-8004 identity  [Arc tx]
 *      -> say| + receipt fragment back to the device
 */
import express from "express";
import { cfg } from "./config.js";
import { loadWorker, type WorkerInfo, type Skill } from "./skills.js";
import { planSafe, summarise, hasLlm } from "./brain.js";
import { decide } from "./policy.js";
import { record, recent, spentTodayUsd, completedWith } from "./ledger.js";
import { connectDevice } from "./device.js";
import { arcClients, usdcBalance, createJob, fundJob, completeJob, giveFeedback, getJob, toAtomic, hashOf, txUrl, addrUrl } from "../../shared/arc.js";

const arc = arcClients(cfg.privateKey);
const device = connectDevice();
let worker: WorkerInfo = { provider: "0x0000000000000000000000000000000000000000", agentId: null, skills: [] };
let busy = false;
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (log.length > 300) log.shift(); };
const short = (h: string) => h.slice(0, 8) + ".." + h.slice(-4);

async function refreshWorker() {
  worker = await loadWorker();
  say(`[worker] ${worker.provider} agentId ${worker.agentId} · ${worker.skills.length} skills`);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${cfg.workerUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json() as T & { error?: string };
  if (!r.ok) throw new Error(`worker ${path}: ${j.error ?? r.status}`);
  return j;
}

function receipt(status: "paid" | "declined" | "failed" | "working", utterance: string, skill: Skill | undefined, extra: Record<string, string>) {
  device.receipt({ status, ask: utterance, skill: skill?.id ?? "-", price: skill ? skill.priceUsd.toFixed(3) : "-", network: "Arc testnet", job: "-", tx: "-", balance: "-", today: spentTodayUsd().toFixed(3), result: "", ...extra });
}

export async function handleUtterance(utterance: string) {
  if (busy) { device.say("One moment, still finishing the last job."); return; }
  busy = true;
  const t0 = Date.now();
  let skill: Skill | undefined;
  const txs: Record<string, string> = {};
  try {
    say(`[voice] "${utterance}"`);
    const p = await planSafe(utterance, worker.skills);
    say(`[plan:${p.planner}] ${p.intent} -> ${p.skillId} ${JSON.stringify(p.params)} (conf ${p.confidence})`);
    skill = worker.skills.find((s) => s.id === p.skillId);
    if (!skill) {
      device.say(p.reply || "I don't know a worker for that.");
      record({ ts: new Date().toISOString(), utterance, skill: "-", worker: worker.provider, amountUsd: 0, status: "declined", reason: "no matching skill" });
      return;
    }
    device.say(p.reply);
    receipt("working", utterance, skill, { step: "checking balance and budget" });
    const step = (t: string) => device.data("step", t);

    const balance = await usdcBalance(arc);
    const d = decide(skill, p.confidence, balance, { address: worker.provider, agentId: worker.agentId }, device.pet());
    say(`[policy] ${d.ok ? "approve" : "decline"}: ${d.reason} ${JSON.stringify(d.signals)}`);
    if (!d.ok) {
      device.say(d.reason);
      receipt("declined", utterance, skill, { balance: balance.toFixed(3), result: d.reason });
      record({ ts: new Date().toISOString(), utterance, skill: skill.id, worker: worker.provider, amountUsd: 0, status: "declined", reason: d.reason });
      return;
    }

    // 1. create the job on Arc (pet = client + evaluator)
    step("creating job on Arc");
    const desc = `voice job: ${skill.id} ${JSON.stringify(p.params)} | "${utterance.slice(0, 80)}"`;
    const { jobId, hash: createTx } = await createJob(arc, worker.provider, desc);
    txs.create = createTx; say(`[arc] job ${jobId} created ${txUrl(createTx)}`);
    device.data("job", `#${jobId}`); step("worker is quoting");

    // 2. worker quotes onchain (setBudget)
    const acc = await post<{ priceUsd: number; budgetTx: string }>(`/jobs/${jobId}/accept`, { skill: skill.id });
    txs.budget = acc.budgetTx; say(`[arc] worker set budget ${acc.priceUsd} USDC ${txUrl(acc.budgetTx)}`);
    if (acc.priceUsd > skill.priceUsd + 1e-9) throw new Error(`worker quoted ${acc.priceUsd} > catalogue ${skill.priceUsd}`);

    // 3. fund escrow
    device.data("price", acc.priceUsd.toFixed(3)); step("funding USDC escrow");
    const f = await fundJob(arc, jobId, toAtomic(acc.priceUsd));
    if (f.approveHash) txs.approve = f.approveHash;
    txs.fund = f.hash; say(`[arc] escrow funded ${txUrl(f.hash)}`);
    device.data("tx", short(f.hash)); step("worker is doing the job");

    // 4. worker does the job and submits the deliverable hash
    const run = await post<{ payload: string; deliverableHash: string; submitTx: string; result: Record<string, unknown> }>(`/jobs/${jobId}/run`, { skill: skill.id, params: p.params });
    txs.submit = run.submitTx; say(`[arc] deliverable submitted ${txUrl(run.submitTx)}`);

    // 5. evaluate: the onchain hash must match what the worker handed us
    step("verifying deliverable hash");
    const job = await getJob(arc, jobId);
    if (job.statusName !== "Submitted") throw new Error(`job is ${job.statusName}, expected Submitted`);
    if (hashOf(run.payload) !== run.deliverableHash) throw new Error("deliverable hash mismatch, refusing to pay");
    const completeTx = await completeJob(arc, jobId, `verified ${skill.id} for "${utterance.slice(0, 60)}"`);
    txs.complete = completeTx; say(`[arc] job ${jobId} completed, ${acc.priceUsd} USDC settled to worker ${txUrl(completeTx)}`);

    // 6. reputation for the worker's ERC-8004 identity
    step("settled, recording feedback");
    if (worker.agentId) {
      try {
        const fb = await giveFeedback(arc, BigInt(worker.agentId), 100, skill.id, `job ${jobId} delivered`, txUrl(completeTx));
        txs.feedback = fb; say(`[arc] feedback recorded ${txUrl(fb)}`);
      } catch (e) { say(`[arc] feedback skipped: ${(e as Error).message}`); }
    }

    const spoken = await summarise(utterance, skill, run.result);
    const after = await usdcBalance(arc);
    record({ ts: new Date().toISOString(), utterance, skill: skill.id, worker: worker.provider, jobId: jobId.toString(), amountUsd: acc.priceUsd, status: "paid", spoken, txs });
    device.say(spoken);
    receipt("paid", utterance, skill, { job: `#${jobId}`, tx: short(completeTx), balance: after.toFixed(3), result: spoken });
    device.ntf("Job settled on Arc", `#${jobId} ${skill.id} · ${acc.priceUsd} USDC`);
    say(`[done] job ${jobId} in ${Date.now() - t0} ms, ${Object.keys(txs).length} Arc txs`);
  } catch (e) {
    const msg = (e as Error).message;
    say(`[error] ${msg}`);
    device.say("Hmm, that job did not go through.");
    receipt("failed", utterance, skill, { result: msg.slice(0, 160) });
    record({ ts: new Date().toISOString(), utterance, skill: skill?.id ?? "-", worker: worker.provider, amountUsd: 0, status: "failed", reason: msg, txs });
  } finally {
    busy = false;
  }
}

device.onVoice((text) => { void handleUtterance(text); });

// Local control plane: simulate a voice event, inspect state.
const app = express();
app.use(express.json());
app.post("/say", (req, res) => { const text = String(req.body?.text ?? ""); if (!text) return res.status(400).json({ error: "text" }); void handleUtterance(text); res.json({ accepted: text }); });
app.get("/state", async (_req, res) => {
  const balance = await usdcBalance(arc).catch(() => -1);
  res.json({ device: { hash: cfg.deviceHash, mqtt: device.connected(), pet: device.pet() }, agent: { address: arc.account.address, usdc: balance, explorer: addrUrl(arc.account.address), planner: hasLlm() ? "claude" : "fallback" }, worker: { ...worker, jobsWithUs: completedWith(worker.provider) }, policy: { maxPriceUsd: cfg.maxPriceUsd, dailyBudgetUsd: cfg.dailyBudgetUsd, minReserveUsd: cfg.minReserveUsd, spentToday: spentTodayUsd() } });
});
app.get("/ledger", (_req, res) => res.json(recent()));
app.get("/log", (_req, res) => res.type("text/plain").send(log.join("\n")));
app.post("/worker/refresh", async (_req, res) => { await refreshWorker(); res.json(worker); });

await refreshWorker().catch((e) => say(`[worker] not reachable yet: ${(e as Error).message}`));
say(`[agent] ${arc.account.address} · ${await usdcBalance(arc)} USDC on Arc testnet · planner ${hasLlm() ? "claude" : "fallback"}`);
app.listen(cfg.httpPort, () => say(`[agent] control plane on http://localhost:${cfg.httpPort}  (POST /say {"text":"..."})`));
