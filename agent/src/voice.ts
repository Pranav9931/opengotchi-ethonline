/**
 * Local voice rail for the pet, replacing the hosted voice API:
 *   POST /voice/stt  raw PCM16 16 kHz mono  -> {text}   (whisper.cpp on this machine)
 *   GET  /voice/tts?t=<text>                -> raw PCM16 16 kHz mono (macOS `say`)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type express from "express";

const run = promisify(execFile);
const WORK = mkdtempSync(path.join(tmpdir(), "gotchi-voice-"));
const WHISPER = process.env.WHISPER_BIN ?? "whisper-cli";
const MODEL = process.env.WHISPER_MODEL ?? "";
const VOICE = process.env.SAY_VOICE ?? "";

function wavHeader(pcmLen: number, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcmLen, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcmLen, 40);
  return h;
}

export async function transcribe(pcm: Buffer, rate = 16000): Promise<string> {
  if (!MODEL || !existsSync(MODEL)) throw new Error("WHISPER_MODEL not set or missing");
  const base = path.join(WORK, `u${Date.now()}`);
  writeFileSync(base + ".wav", Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  await run(WHISPER, ["-m", MODEL, "-f", base + ".wav", "-nt", "-l", "en", "-otxt", "-of", base], { timeout: 60000 });
  const txt = readFileSync(base + ".txt", "utf8").replace(/\[.*?\]|\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return txt;
}

const ttsCache = new Map<string, Buffer>();
export async function synthesize(text: string): Promise<Buffer> {
  const key = createHash("sha1").update(text).digest("hex");
  const hit = ttsCache.get(key);
  if (hit) return hit;
  const out = path.join(WORK, key + ".wav");
  const args = ["-o", out, "--data-format=LEI16@16000"];
  if (VOICE) args.push("-v", VOICE);
  args.push(text);
  await run("say", args, { timeout: 30000 });
  const wav = readFileSync(out);
  const pcm = wav.subarray(44);
  ttsCache.set(key, pcm);
  return pcm;
}

export function mountVoice(app: express.Express, onText: (text: string) => void, log: (s: string) => void) {
  app.post("/voice/stt", (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const pcm = Buffer.concat(chunks);
      const t0 = Date.now();
      try {
        const text = await transcribe(pcm);
        log(`[stt] ${pcm.length} bytes -> "${text}" in ${Date.now() - t0} ms`);
        res.json({ text });
        if (text) onText(text);
      } catch (e) {
        log(`[stt] error ${(e as Error).message}`);
        res.status(500).json({ error: (e as Error).message });
      }
    });
  });
  app.get("/voice/tts", async (req, res) => {
    const text = String(req.query.t ?? "").slice(0, 240);
    if (!text) return res.status(400).end();
    try {
      const pcm = await synthesize(text);
      log(`[tts] "${text.slice(0, 40)}" -> ${pcm.length} bytes`);
      res.setHeader("content-type", "audio/L16; rate=16000; channels=1");
      res.setHeader("content-length", String(pcm.length));
      res.end(pcm);
    } catch (e) {
      log(`[tts] error ${(e as Error).message}`);
      res.status(500).end();
    }
  });
}
