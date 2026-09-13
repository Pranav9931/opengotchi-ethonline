import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { cfg } from "./config.js";

export interface LedgerEntry {
  ts: string;
  utterance: string;
  skill: string;
  worker: string;
  jobId?: string;
  amountUsd: number;
  status: "paid" | "declined" | "failed";
  reason?: string;
  spoken?: string;
  txs?: Record<string, string>;
}

function load(): LedgerEntry[] {
  if (!existsSync(cfg.ledgerPath)) return [];
  try { return JSON.parse(readFileSync(cfg.ledgerPath, "utf8")); } catch { return []; }
}
export function record(e: LedgerEntry) { const all = load(); all.push(e); writeFileSync(cfg.ledgerPath, JSON.stringify(all, null, 2)); }
export function spentTodayUsd(): number {
  const day = new Date().toISOString().slice(0, 10);
  return load().filter((e) => e.status === "paid" && e.ts.startsWith(day)).reduce((a, e) => a + e.amountUsd, 0);
}
export function completedWith(worker: string): number {
  return load().filter((e) => e.status === "paid" && e.worker.toLowerCase() === worker.toLowerCase()).length;
}
export function recent(n = 20): LedgerEntry[] { return load().slice(-n).reverse(); }
