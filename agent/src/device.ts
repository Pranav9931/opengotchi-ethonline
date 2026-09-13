/**
 * The pet over MQTT. Firmware contract (no firmware changes needed):
 *   device -> og/d/<hash>/commands   JSON with cmd "evt|voice|<text>" (agent shell)
 *   device -> og/d/<hash>/telemetry  JSON sensor / pet stats
 *   server -> og/d/<hash>/agent      "say|<text>" (TTS), "ntf|<title>|<body>",
 *                                    "note <text>", "data <k> <v>", "frag <sid>\n<python>"
 */
import mqtt, { type MqttClient } from "mqtt";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cfg } from "./config.js";
import type { PetState } from "./policy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECEIPT_PY = readFileSync(path.join(here, "../../device/receipt.py"), "utf8");

export interface Device {
  onVoice(cb: (text: string) => void): void;
  say(text: string): void;
  speak(text: string): void;
  note(text: string): void;
  ntf(title: string, body: string): void;
  data(key: string, value: string): void;
  receipt(fields: Record<string, string>): void;
  pet(): PetState;
  connected(): boolean;
}

export function connectDevice(): Device {
  const t = (s: string) => `og/d/${cfg.deviceHash}/${s}`;
  // Broker auth (mirrors tools/agent_bridge): TLS on 8883; username is the
  // device hash with the provisioned device secret, or "agent:<hash>" with an
  // agent token. MQTT_USERNAME/MQTT_PASSWORD override everything.
  const secret = process.env.GOTCHI_DEVICE_SECRET || undefined;
  const token = process.env.GOTCHI_AGENT_TOKEN || undefined;
  const username = process.env.MQTT_USERNAME || (token ? `agent:${cfg.deviceHash}` : cfg.deviceHash);
  const password = process.env.MQTT_PASSWORD || token || secret || cfg.deviceHash;
  const client: MqttClient = mqtt.connect(cfg.mqttUrl, {
    clientId: `gotchi-bridge-${Date.now().toString(36)}`,   // "agent-*" client ids are rejected by the auth hook
    username,
    password,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });
  const voiceCbs: ((text: string) => void)[] = [];
  const pet: PetState = {};
  let up = false;

  client.on("connect", () => {
    up = true;
    console.log(`[device] mqtt connected, listening to ${t("commands")}`);
    client.subscribe([t("commands"), t("telemetry")], { qos: 1 });
  });
  client.on("close", () => { up = false; });
  client.on("error", (e) => console.warn("[device] mqtt:", e.message));
  client.on("message", (topic, payload) => {
    const raw = payload.toString();
    if (topic === t("telemetry")) {
      try {
        const j = JSON.parse(raw) as Record<string, number>;
        for (const k of ["hunger", "happiness", "battery"] as const) if (typeof j[k] === "number") pet[k] = j[k];
        pet.updatedAt = Date.now();
      } catch { /* ignore */ }
      return;
    }
    if (topic === t("commands")) {
      // Firmware wraps the command string in JSON; tolerate both.
      let cmd = raw;
      try { const j = JSON.parse(raw); cmd = j.cmd ?? j.command ?? j.c ?? raw; } catch { /* plain */ }
      const m = /^evt\|voice\|(.+)$/s.exec(String(cmd));
      if (m) { const text = m[1].trim(); console.log(`[device] voice: ${text}`); voiceCbs.forEach((cb) => cb(text)); }
      else if (String(cmd).startsWith("evt|")) console.log(`[device] ${cmd}`);
    }
  });

  const send = (s: string) => client.publish(t("agent"), s, { qos: 1 });
  return {
    onVoice: (cb) => voiceCbs.push(cb),
    say: (text) => send("say|" + text.slice(0, 240)),
    // Local voice mode: our arcvoice app fetches TTS from this agent; hosted mode: firmware TTS.
    speak: (text) => send(((process.env.VOICE_MODE ?? "local") === "hosted" ? "say|" : "speak ") + text.replace(/\n/g, " ").slice(0, 240)),
    note: (text) => send("note " + text.replace(/\n/g, " ").slice(0, 120)),
    ntf: (title, body) => send(`ntf|${title.slice(0, 30)}|${body.slice(0, 190)}`),
    data: (k, v) => send(`data ${k} ${v}`),
    receipt: (fields) => {
      if ((process.env.VOICE_MODE ?? "local") === "hosted") {
        // agent_shell path: field updates + the receipt fragment
        for (const [k, v] of Object.entries(fields)) send(`data ${k} ${v}`);
        send(`frag receipt\n${RECEIPT_PY}`);
      } else {
        // arcvoice path: one message, so nothing is lost while the pet is busy playing audio
        send("rcpt " + JSON.stringify(fields));
      }
    },
    pet: () => pet,
    connected: () => up,
  };
}
