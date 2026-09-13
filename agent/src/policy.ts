/**
 * Decision logic tied to real signals. The LLM proposes; this module decides.
 * Signals: live Gateway balance, today's spend from the ledger, the service's
 * quoted price, the pet's own state (from telemetry), and intent confidence.
 */
import { cfg } from "./config.js";
import { spentTodayUsd } from "./ledger.js";
import type { Service } from "./catalog.js";
import type { BalanceView } from "./wallet.js";

export interface PetState { hunger?: number; happiness?: number; battery?: number; updatedAt?: number }

export interface Decision {
  ok: boolean;
  reason: string;
  signals: { price: number; gateway: number; spentToday: number; budget: number; confidence: number; pet: PetState };
}

export function decide(service: Service, confidence: number, bal: BalanceView, pet: PetState): Decision {
  const spent = spentTodayUsd();
  const signals = { price: service.priceUsd, gateway: bal.gatewayUsdc, spentToday: spent, budget: cfg.dailyBudgetUsd, confidence, pet };
  if (confidence < 0.6) return { ok: false, reason: "I am not sure what you want. Say it again?", signals };
  if (service.priceUsd > cfg.maxPriceUsd) return { ok: false, reason: `That costs ${service.priceUsd} USDC, over my ${cfg.maxPriceUsd} limit.`, signals };
  if (spent + service.priceUsd > cfg.dailyBudgetUsd) return { ok: false, reason: `I already spent ${spent.toFixed(3)} USDC today, budget is ${cfg.dailyBudgetUsd}.`, signals };
  if (bal.gatewayUsdc < service.priceUsd) return { ok: false, reason: `My Gateway balance is ${bal.gatewayUsdc.toFixed(3)} USDC, not enough.`, signals };
  // Pet-state rule: a low battery pet only spends on itself.
  if ((pet.battery ?? 100) < 15 && service.category !== "PET_CARE") return { ok: false, reason: "Battery is low, I will only buy snacks right now.", signals };
  return { ok: true, reason: "within budget and balance", signals };
}
