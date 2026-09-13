/**
 * Voice -> agent -> x402 payment on Arc -> outcome on the pet.
 *
 *   "Jarvis, what's the weather in Berlin"   (wake word + transcript, firmware)
 *      -> evt|voice|... over MQTT
 *      -> Claude plans: service + params + confidence
 *      -> policy checks live signals (balance, budget, price, pet state)
 *      -> GatewayClient.pay() signs an EIP-3009 auth, Gateway settles on Arc
 *      -> say| + receipt fragment back to the device
 */
import express from "express";
import { cfg } from "./config.js";
import { buildCatalog, type Service } from "./catalog.js";
import { planSafe, summarise, hasLlm } from "./brain.js";
import { decide } from "./policy.js";
import { makeWallet, balances, ensureGateway, explorerTx } from "./wallet.js";
import { record, recent, spentTodayUsd } from "./ledger.js";
import { connectDevice } from "./device.js";

const wallet = makeWallet();
const device = connectDevice();
let catalog: { services: Service[]; dropped: { id: string; why: string }[]; sources: Record<string, number> } = { services: [], dropped: [], sources: {} };
let busy = false;
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (log.length > 200) log.shift(); };

async function refreshCatalog() {
  catalog = await buildCatalog();
  say(`[catalog] ${catalog.services.length} voice-fit services (${JSON.stringify(catalog.sources)}), ${catalog.dropped.length} filtered out`);
}

// Spending guard inside the payment path itself, independent of the planner.
wallet.onBeforePaymentCreation(async (ctx) => {
  if (Number(ctx.selectedRequirements.amount) / 1_000_000 > cfg.maxPriceUsd) return { abort: true, reason: "over per-payment cap" };
  return undefined;
});

export async function handleUtterance(utterance: string) {
  if (busy) { device.say("One moment, still paying for the last thing."); return; }
  busy = true;
  const t0 = Date.now();
  try {
    say(`[voice] "${utterance}"`);
    const p = await planSafe(utterance, catalog.services);
    say(`[plan:${p.planner}] ${p.intent} -> ${p.serviceId} ${JSON.stringify(p.params)} (conf ${p.confidence})`);
    const service = catalog.services.find((s) => s.id === p.serviceId);
    if (!service) {
      device.say(p.reply || "I don't know a service for that.");
      record({ ts: new Date().toISOString(), utterance, service: "-", provider: "-", amountUsd: 0, network: cfg.network, transaction: "", status: "declined", reason: "no matching service" });
      return;
    }
    device.say(p.reply);
    device.note(`paying ${service.priceUsd} USDC on Arc...`);

    const bal = await balances(wallet);
    const d = decide(service, p.confidence, bal, device.pet());
    say(`[policy] ${d.ok ? "approve" : "decline"}: ${d.reason} ${JSON.stringify(d.signals)}`);
    if (!d.ok) {
      device.say(d.reason);
      device.receipt({ status: "declined", ask: utterance, service: service.id, price: service.priceUsd.toFixed(4), network: "Arc testnet", tx: "-", gateway: bal.gatewayUsdc.toFixed(3), today: spentTodayUsd().toFixed(3), result: d.reason });
      record({ ts: new Date().toISOString(), utterance, service: service.id, provider: service.provider, amountUsd: 0, network: cfg.network, transaction: "", status: "declined", reason: d.reason });
      return;
    }

    // Top up Gateway from the Arc wallet if needed (real onchain tx on Arc).
    const top = await ensureGateway(wallet, cfg.minGatewayUsd, cfg.depositUsd);
    if (top.txHash) { say(`[wallet] deposited ${cfg.depositUsd} USDC into Gateway on Arc: ${explorerTx(top.txHash)}`); device.ntf("Gateway top-up", `${cfg.depositUsd} USDC deposited on Arc`); }

    const url = new URL(service.resource);
    for (const [k, v] of Object.entries(p.params)) url.searchParams.set(k, v);
    const res = await wallet.pay(url.toString(), { method: service.method });
    say(`[pay] ${res.formattedAmount} USDC -> ${service.provider} tx ${res.transaction} status ${res.status}`);

    const spoken = await summarise(utterance, service, res.data);
    const after = await balances(wallet);
    record({ ts: new Date().toISOString(), utterance, service: service.id, provider: service.provider, amountUsd: Number(res.amount) / 1_000_000, network: service.network, transaction: res.transaction, status: "paid", spoken });
    device.say(spoken);
    device.receipt({
      status: "paid", ask: utterance, service: service.id, price: res.formattedAmount, network: "Arc testnet",
      tx: res.transaction ? res.transaction.slice(0, 10) + ".." + res.transaction.slice(-6) : "batched",
      gateway: after.gatewayUsdc.toFixed(3), today: spentTodayUsd().toFixed(3), result: spoken,
    });
    device.ntf("Paid on Arc", `${res.formattedAmount} USDC to ${service.provider}`);
    say(`[done] ${Date.now() - t0} ms`);
  } catch (e) {
    const msg = (e as Error).message;
    say(`[error] ${msg}`);
    device.say("Hmm, the payment did not go through.");
    device.receipt({ status: "failed", ask: utterance, service: "-", price: "-", network: "Arc testnet", tx: "-", gateway: "-", today: spentTodayUsd().toFixed(3), result: msg.slice(0, 160) });
    record({ ts: new Date().toISOString(), utterance, service: "-", provider: "-", amountUsd: 0, network: cfg.network, transaction: "", status: "failed", reason: msg });
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
  const bal = await balances(wallet).catch((e) => ({ error: (e as Error).message }));
  res.json({ device: { hash: cfg.deviceHash, mqtt: device.connected(), pet: device.pet() }, wallet: bal, chain: cfg.chain, network: cfg.network, policy: { maxPriceUsd: cfg.maxPriceUsd, dailyBudgetUsd: cfg.dailyBudgetUsd, spentToday: spentTodayUsd() }, catalog: { services: catalog.services.map((s) => ({ id: s.id, price: s.priceUsd, category: s.category, provider: s.provider })), dropped: catalog.dropped.length, sources: catalog.sources } });
});
app.get("/ledger", (_req, res) => res.json(recent()));
app.get("/log", (_req, res) => res.type("text/plain").send(log.join("\n")));
app.post("/catalog/refresh", async (_req, res) => { await refreshCatalog(); res.json(catalog.sources); });

await refreshCatalog();
const b = await balances(wallet);
say(`[wallet] ${b.address} wallet ${b.walletUsdc} USDC · gateway ${b.gatewayUsdc} USDC · chain ${cfg.chain}`);
app.listen(cfg.httpPort, () => say(`[agent] control plane on http://localhost:${cfg.httpPort}  (POST /say {"text":"..."})`));
