/**
 * Claude turns a voice transcript into a job (skill + params), and a raw
 * result into a sentence the pet can say. Structured outputs keep both
 * machine-safe. A keyword planner takes over without credentials.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { cfg } from "./config.js";
import type { Skill } from "./skills.js";

const client = new Anthropic();

const Plan = z.object({
  intent: z.string().describe("What the user wants, in a few words"),
  action: z.enum(["job", "buy", "none"]).describe("job = hire the worker for a skill; buy = purchase a token with USDC; none = nothing fits"),
  skillId: z.string().nullable().describe("for action=job: id of the chosen skill"),
  params: z.record(z.string(), z.string()).describe("for action=job: parameters for the skill"),
  buyAmountUsd: z.number().nullable().describe("for action=buy: USD amount to spend"),
  buyAsset: z.string().nullable().describe("for action=buy: asset name as the user said it (bitcoin, euros, ethereum...)"),
  confidence: z.number().min(0).max(1),
  reply: z.string().describe("What the pet says while it works, under 12 words"),
});
export type Plan = z.infer<typeof Plan>;

const SYSTEM = `You are the brain of a small voice-first pet device that owns a USDC wallet on Arc and commissions jobs from worker agents.
The user speaks a request. Decide the action:
- "buy": the user wants to purchase/buy/get some amount of a token or currency with their money (e.g. "buy one dollar of bitcoin", "get me 2 dollars worth of euros"). Fill buyAmountUsd and buyAsset exactly as said.
- "job": otherwise pick exactly one skill from the catalogue that satisfies the request, fill its parameters from the utterance (use "polymarket" for odds / predictions / chances / will-X-happen questions, topic = the subject).
- "none": nothing fits.
Estimate your confidence. Never invent skills. Prefer the cheapest skill that fully answers the request. Parameter values are short strings (a city name, a ticker, a mood). The reply is spoken aloud by a cute pet, keep it playful and under 12 words.`;

export async function plan(utterance: string, skills: Skill[]): Promise<Plan> {
  const res = await client.messages.parse({
    model: cfg.model,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Catalogue:\n${JSON.stringify(skills)}\n\nUser said: "${utterance}"` }],
    output_config: { format: zodOutputFormat(Plan), effort: "low" },
  });
  if (!res.parsed_output) throw new Error("planner returned no output");
  return res.parsed_output;
}

const Spoken = z.object({ spoken: z.string().describe("One or two short sentences, under 200 characters, no URLs") });

export async function summarise(utterance: string, skill: Skill, data: unknown): Promise<string> {
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).spoken === "string") return (data as Record<string, string>).spoken;
  if (!hasLlm()) return `Done: ${JSON.stringify(data).slice(0, 160)}`;
  const res = await client.messages.parse({
    model: cfg.model,
    max_tokens: 1000,
    messages: [{ role: "user", content: `The user asked: "${utterance}". A worker agent (${skill.description}) returned:\n${JSON.stringify(data).slice(0, 4000)}\nWrite what a cheerful pet says to answer, under 200 characters.` }],
    output_config: { format: zodOutputFormat(Spoken), effort: "low" },
  });
  return res.parsed_output?.spoken ?? "Done, but I could not read the answer.";
}

export function planFallback(utterance: string, skills: Skill[]): Plan {
  const u = utterance.toLowerCase();
  const has = (id: string) => skills.some((s) => s.id === id);
  const pick = (re: RegExp, id: string, params: Record<string, string>, reply: string): Plan | null =>
    re.test(u) && has(id) ? { ...base, intent: id, action: "job", skillId: id, params, confidence: 0.8, reply } : null;
  const topic = /(?:odds|chance|chances|probability|likelihood|predict\w*|polymarket)\s+(?:of|on|for|that|about)?\s*(.+?)(?:[?.!]|$)/.exec(u)?.[1]?.trim() ?? u.replace(/[?.!]/g, "");
  const base = { skillId: null, params: {}, buyAmountUsd: null, buyAsset: null };
  const b = /\b(?:buy|purchase|get me|grab)\b.*?(?:\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|bucks|usdc|usd))?\s*(?:worth\s+)?(?:of\s+)?([a-z]+)?/.exec(u);
  if (/\b(buy|purchase|get me|grab)\b/.test(u)) {
    const amt = Number(b?.[1] ?? b?.[2] ?? 1);
    const asset = /\b(bitcoin|btc|euros?|eurc|ethereum|eth|ether|solana|sol|doge|dogecoin|usdt|dai|link|avax)\b/.exec(u)?.[1] ?? "";
    return { ...base, intent: "buy", action: "buy", buyAmountUsd: amt, buyAsset: asset, confidence: asset ? 0.85 : 0.5, reply: asset ? `Shopping for ${asset}!` : "Buy what, exactly?" };
  }
  const city = /(?:weather|temperature|rain|sunny|cold|hot)\s+(?:in|for|at)\s+([a-z][a-z\s-]+?)(?:[?.!,]|$)/.exec(u)?.[1]?.trim();
  const sym = /\b(btc|bitcoin|eth|ethereum|sol|solana|usdc|eurc|doge|link|avax|arb|op|matic)\b/.exec(u)?.[1];
  const SYM: Record<string, string> = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL" };
  const mood = /\b(hungry|sad|bored|sleepy|happy)\b/.exec(u)?.[1] ?? "hungry";
  return (
    pick(/odds|chance|chances|probability|likelihood|predict|polymarket|will .* (win|happen|cut|rise|fall)/, "polymarket", { topic }, "Asking the prediction market!") ??
    pick(/weather|temperature|rain|sunny|cold|hot/, "weather", { city: city ? city.replace(/\b\w/g, (c) => c.toUpperCase()) : "Berlin" }, "Checking the sky for you!") ??
    pick(/price|worth|cost of|how much is/, "crypto_price", { symbol: sym ? (SYM[sym] ?? sym.toUpperCase()) : "ETH" }, "Peeking at the charts!") ??
    pick(/news|headline|happening|what'?s up|what is up|going on/, "headline", {}, "Fetching the top story!") ??
    pick(/snack|treat|feed|eat|food/, "snack", { mood }, "Ooh, snack time!") ??
    pick(/fortune|luck|future/, "fortune", {}, "Cracking a fortune cookie!") ??
    { ...base, intent: "unknown", action: "none", confidence: 0, reply: "I don't know a worker for that." }
  );
}

export const hasLlm = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function planSafe(utterance: string, skills: Skill[]): Promise<Plan & { planner: "claude" | "fallback" }> {
  if (hasLlm()) {
    try { return { ...(await plan(utterance, skills)), planner: "claude" }; }
    catch (e) { console.warn("[brain] claude planner failed, using fallback:", (e as Error).message); }
  }
  return { ...planFallback(utterance, skills), planner: "fallback" };
}
