/** The pet's view of what it can buy: the worker agent's skill catalogue. */
import { cfg } from "./config.js";

export interface Skill {
  id: string;
  description: string;
  priceUsd: number;
  params: Record<string, { description: string; example?: string; required?: boolean }>;
}
export interface WorkerInfo { provider: `0x${string}`; agentId: string | null; skills: Skill[] }

export async function loadWorker(): Promise<WorkerInfo> {
  const r = await fetch(`${cfg.workerUrl}/skills`);
  if (!r.ok) throw new Error(`worker /skills ${r.status}`);
  return await r.json() as WorkerInfo;
}
