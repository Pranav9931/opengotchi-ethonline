import "dotenv/config";
import { createHash } from "node:crypto";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in .env`);
  return v;
}

/** Device identity: the firmware derives it from the MAC. Accept either the
 *  ready hash or the MAC (uppercase, colon separated) and derive it here. */
function deviceHash(): string {
  if (process.env.DEVICE_HASH) return process.env.DEVICE_HASH;
  const mac = process.env.DEVICE_MAC;
  if (!mac) throw new Error("DEVICE_HASH or DEVICE_MAC is required");
  return createHash("sha256").update(mac.toUpperCase() + "opengotchi-captain-virgin-sarv-monk").digest("hex").slice(0, 32);
}

export const cfg = {
  deviceHash: deviceHash(),
  mqttUrl: process.env.MQTT_URL ?? "mqtts://mqtt.opengotchi.com:8883",
  privateKey: req("AGENT_PRIVATE_KEY") as `0x${string}`,
  /** The worker agent (provider) the pet commissions jobs from. */
  workerUrl: process.env.WORKER_URL ?? "http://localhost:4030",
  /** Spending policy: the pet's own guardrails, enforced before escrow is funded. */
  maxPriceUsd: Number(process.env.MAX_PRICE_USD ?? 0.05),
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD ?? 0.5),
  minReserveUsd: Number(process.env.MIN_RESERVE_USD ?? 0.2),
  /** Cap for a single voice-triggered token purchase (App Kit swap on Arc). */
  maxSwapUsd: Number(process.env.MAX_SWAP_USD ?? 2),
  httpPort: Number(process.env.AGENT_PORT ?? 4010),
  ledgerPath: process.env.LEDGER_PATH ?? "./ledger.json",
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
};
