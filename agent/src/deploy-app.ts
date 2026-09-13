/** Deploy device/arcvoice.py to the pet over MQTT and launch it.
 *  `bun run deploy-app [agent-url]`  (default: http://<this machine's LAN IP>:AGENT_PORT) */
import "dotenv/config";
import mqtt from "mqtt";
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { cfg } from "./config.js";

function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  return "127.0.0.1";
}
const agentUrl = process.argv[2] ?? process.env.AGENT_PUBLIC_URL ?? `http://${lanIp()}:${cfg.httpPort}`;
const src = readFileSync(new URL("../../device/arcvoice.py", import.meta.url), "utf8").replace("__AGENT_URL__", agentUrl);
const t = (s: string) => `og/d/${cfg.deviceHash}/${s}`;
const secret = process.env.GOTCHI_DEVICE_SECRET || undefined;
const token = process.env.GOTCHI_AGENT_TOKEN || undefined;
const client = mqtt.connect(cfg.mqttUrl, { clientId: `gotchi-bridge-${Date.now().toString(36)}`, username: token ? `agent:${cfg.deviceHash}` : cfg.deviceHash, password: token || secret || cfg.deviceHash, connectTimeout: 12000, reconnectPeriod: 0 });
const id = "d" + Date.now().toString(36).slice(-6);
client.on("connect", () => {
  client.subscribe([t("app/ack"), t("commands")], () => {
    client.publish(t("app/deploy"), JSON.stringify({ action: "deploy", name: "arcvoice.py", data: Buffer.from(src).toString("base64"), launch: true, id }), { qos: 1 });
    console.log(`deploying arcvoice.py (${src.length} bytes) with AGENT=${agentUrl} ...`);
  });
});
client.on("message", (topic, p) => {
  const d = JSON.parse(p.toString());
  if (topic === t("app/ack") && d.id === id) console.log("ack:", JSON.stringify(d));
  if (topic === t("commands") && String(d.cmd).includes("ready:arcvoice")) { console.log("device: arcvoice running"); client.end(); process.exit(0); }
});
client.on("error", (e) => { console.error("mqtt:", e.message); process.exit(1); });
setTimeout(() => { console.log("timeout waiting for the app to start"); client.end(); process.exit(1); }, 30000);
