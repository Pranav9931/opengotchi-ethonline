/**
 * Decision logic tied to real signals. The planner proposes a skill; this
 * module decides whether the pet funds escrow for it. Signals: the pet's USDC
 * balance on Arc, today's spend from the ledger, the quoted price, the
 * worker's track record (ERC-8004 identity present, jobs completed), the
 * pet's battery from device telemetry, and the planner's confidence.
 */
import { cfg } from "./config.js";
import { spentTodayUsd, completedWith } from "./ledger.js";
import type { Skill } from "./skills.js";

export interface PetState { hunger?: number; happiness?: number; battery?: number; updatedAt?: number }

export interface Decision {
  ok: boolean;
  reason: string;
  signals: Record<string, number | string | boolean | undefined>;
}

export function decide(skill: Skill, confidence: number, balanceUsd: number, worker: { address: string; agentId: string | null }, pet: PetState): Decision {
  const spent = spentTodayUsd();
  const history = completedWith(worker.address);
  const signals = { price: skill.priceUsd, balance: balanceUsd, spentToday: spent, dailyBudget: cfg.dailyBudgetUsd, reserve: cfg.minReserveUsd, confidence, workerAgentId: worker.agentId ?? undefined, workerJobsDone: history, battery: pet.battery };
  if (confidence < 0.6) return { ok: false, reason: "I am not sure what you want. Say it again?", signals };
  if (!worker.agentId) return { ok: false, reason: "That worker has no onchain identity, I won't pay it.", signals };
  if (skill.priceUsd > cfg.maxPriceUsd) return { ok: false, reason: `That costs ${skill.priceUsd} USDC, over my ${cfg.maxPriceUsd} limit.`, signals };
  if (spent + skill.priceUsd > cfg.dailyBudgetUsd) return { ok: false, reason: `I already spent ${spent.toFixed(3)} USDC today, my budget is ${cfg.dailyBudgetUsd}.`, signals };
  if (balanceUsd - skill.priceUsd < cfg.minReserveUsd) return { ok: false, reason: `Only ${balanceUsd.toFixed(3)} USDC left, I keep ${cfg.minReserveUsd} in reserve.`, signals };
  if ((pet.battery ?? 100) < 15 && skill.id !== "snack") return { ok: false, reason: "Battery is low, I will only buy snacks right now.", signals };
  // New workers get one small job first; bigger jobs need a track record.
  if (history === 0 && skill.priceUsd > cfg.maxPriceUsd / 2) return { ok: false, reason: "I haven't worked with this agent yet, let's start with something cheaper.", signals };
  return { ok: true, reason: history > 0 ? `worker has ${history} completed jobs, within budget` : "first job with this worker, within budget", signals };
}
