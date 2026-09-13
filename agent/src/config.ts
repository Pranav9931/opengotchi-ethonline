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
  mqttUrl: process.env.MQTT_URL ?? "mqtt://mqtt.opengotchi.com:1883",
  chain: (process.env.CHAIN ?? "arcTestnet") as "arcTestnet" | "arc",
  rpcUrl: process.env.ARC_RPC_URL,
  privateKey: req("AGENT_PRIVATE_KEY") as `0x${string}`,
  explorer: process.env.EXPLORER_URL ?? "https://testnet.arcscan.app",
  /** Local marketplace (services/) — included in the catalogue. */
  servicesUrl: process.env.SERVICES_URL ?? "http://localhost:4020",
  /** Circle discovery API (public, keyless). */
  discoveryUrl: process.env.DISCOVERY_URL ?? "https://api.circle.com/v2/x402/discovery/resources",
  network: process.env.X402_NETWORK ?? "eip155:5042002",
  /** Spending policy — the agent's own guardrails (CLI policies are mainnet-only). */
  maxPriceUsd: Number(process.env.MAX_PRICE_USD ?? 0.02),
  dailyBudgetUsd: Number(process.env.DAILY_BUDGET_USD ?? 0.25),
  minGatewayUsd: Number(process.env.MIN_GATEWAY_USD ?? 0.05),
  depositUsd: process.env.DEPOSIT_USD ?? "0.5",
  httpPort: Number(process.env.AGENT_PORT ?? 4010),
  ledgerPath: process.env.LEDGER_PATH ?? "./ledger.json",
  model: process.env.CLAUDE_MODEL ?? "claude-opus-5",
};
