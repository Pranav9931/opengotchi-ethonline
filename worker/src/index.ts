/**
 * Worker agent: an ERC-8004-registered provider on Arc testnet that sells
 * skills through ERC-8183 jobs. Offchain HTTP for negotiation and delivery,
 * onchain for budget, escrow, deliverable hash and settlement.
 *
 *   GET  /skills               catalogue with prices
 *   GET  /identity             agentId, address, balances
 *   POST /jobs/:id/accept      provider sets the budget onchain for a job
 *   POST /jobs/:id/run         after escrow is funded: do the work, submit
 *                              keccak(result) onchain, return the result
 */
import "dotenv/config";
import express from "express";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { arcClients, usdcBalance, getJob, setBudget, submitDeliverable, registerIdentity, toAtomic, hashOf, txUrl, addrUrl } from "../../shared/arc.js";
import { SKILLS, skillCatalog } from "./skills.js";

const PORT = Number(process.env.WORKER_PORT ?? 4030);
const STATE = process.env.WORKER_STATE ?? "./worker.json";
const pk = process.env.WORKER_PRIVATE_KEY as `0x${string}` | undefined;
if (!pk) { console.error("WORKER_PRIVATE_KEY is required"); process.exit(1); }
const c = arcClients(pk);

interface State { agentId?: string; registerTx?: string; jobsDone: number }
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { jobsDone: 0 };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

async function ensureIdentity() {
  if (state.agentId) return;
  const meta = { name: "Gotchi Worker", description: "Sells weather, prices, headlines, snacks and fortunes to pets. Settles on Arc.", skills: skillCatalog().map((s) => s.id), owner: c.account.address, standard: "ERC-8004" };
  const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(meta)).toString("base64");
  console.log("[worker] registering ERC-8004 identity on Arc...");
  const r = await registerIdentity(c, uri);
  state.agentId = r.agentId.toString(); state.registerTx = r.hash; save();
  console.log(`[worker] agentId ${state.agentId}  ${txUrl(r.hash)}`);
}

const app = express();
app.use(express.json());
app.get("/skills", (_req, res) => res.json({ provider: c.account.address, agentId: state.agentId ?? null, skills: skillCatalog() }));
app.get("/identity", async (_req, res) => res.json({ address: c.account.address, agentId: state.agentId ?? null, registerTx: state.registerTx ?? null, usdc: await usdcBalance(c), jobsDone: state.jobsDone, explorer: addrUrl(c.account.address) }));

app.post("/jobs/:id/accept", async (req, res) => {
  try {
    const jobId = BigInt(req.params.id);
    const skill = SKILLS.find((s) => s.id === req.body?.skill);
    if (!skill) return res.status(400).json({ error: "unknown skill" });
    const job = await getJob(c, jobId);
    if (job.provider.toLowerCase() !== c.account.address.toLowerCase()) return res.status(403).json({ error: "job is not assigned to this worker" });
    if (job.statusName !== "Open") return res.status(409).json({ error: `job is ${job.statusName}` });
    const budget = toAtomic(skill.priceUsd);
    const hash = await setBudget(c, jobId, budget);
    console.log(`[worker] job ${jobId} budget ${skill.priceUsd} USDC  ${txUrl(hash)}`);
    res.json({ jobId: jobId.toString(), priceUsd: skill.priceUsd, budgetTx: hash });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

app.post("/jobs/:id/run", async (req, res) => {
  try {
    const jobId = BigInt(req.params.id);
    const skill = SKILLS.find((s) => s.id === req.body?.skill);
    if (!skill) return res.status(400).json({ error: "unknown skill" });
    const job = await getJob(c, jobId);
    if (job.statusName !== "Funded") return res.status(409).json({ error: `escrow not funded (job is ${job.statusName})` });
    const result = await skill.run(req.body?.params ?? {});
    const payload = JSON.stringify({ jobId: jobId.toString(), skill: skill.id, result });
    const deliverableHash = hashOf(payload);
    const hash = await submitDeliverable(c, jobId, deliverableHash);
    state.jobsDone++; save();
    console.log(`[worker] job ${jobId} delivered ${skill.id}  ${txUrl(hash)}`);
    res.json({ jobId: jobId.toString(), payload, deliverableHash, submitTx: hash, result });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

await ensureIdentity();
app.listen(PORT, async () => {
  console.log(`[worker] ${c.account.address} agentId ${state.agentId} · ${await usdcBalance(c)} USDC · http://localhost:${PORT}`);
  for (const s of skillCatalog()) console.log(`  ${s.priceUsd.toFixed(3)} USDC  ${s.id.padEnd(13)} ${s.description}`);
});
