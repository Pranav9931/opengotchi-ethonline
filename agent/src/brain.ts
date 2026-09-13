/**
 * Claude turns a voice transcript into a service call, and a raw JSON result
 * into a sentence the pet can say. Structured outputs keep both machine-safe.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { cfg } from "./config.js";
import type { Service } from "./catalog.js";

const client = new Anthropic();

const Plan = z.object({
  intent: z.string().describe("What the user wants, in a few words"),
  serviceId: z.string().nullable().describe("id of the chosen service, or null if nothing fits"),
  params: z.record(z.string(), z.string()).describe("Query parameters for the service"),
  confidence: z.number().min(0).max(1),
  reply: z.string().describe("What the pet says while it works, under 12 words"),
});
export type Plan = z.infer<typeof Plan>;

const SYSTEM = `You are the brain of a small voice-first pet device that owns a USDC wallet on Arc.
The user speaks a request. Pick exactly one paid x402 service from the catalogue that satisfies it, fill its query parameters from the utterance, and estimate your confidence.
Rules: never invent services; if nothing fits set serviceId null and confidence 0. Prefer the cheapest service that fully answers the request. Parameter values are short strings (a city name, a ticker). The reply is spoken aloud by a cute pet, keep it playful and under 12 words.`;

export async function plan(utterance: string, services: Service[]): Promise<Plan> {
  const catalogue = services.map((s) => ({ id: s.id, description: s.description, category: s.category, priceUsd: s.priceUsd, params: s.params }));
  const res = await client.messages.parse({
    model: cfg.model,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Catalogue:\n${JSON.stringify(catalogue)}\n\nUser said: "${utterance}"` }],
    output_config: { format: zodOutputFormat(Plan), effort: "low" },
  });
  if (!res.parsed_output) throw new Error("planner returned no output");
  return res.parsed_output;
}

const Spoken = z.object({ spoken: z.string().describe("One or two short sentences, under 200 characters, no URLs") });

export async function summarise(utterance: string, service: Service, data: unknown): Promise<string> {
  // Fast path: our own services already ship a spoken line.
  if (service.speakField && data && typeof data === "object" && typeof (data as Record<string, unknown>)[service.speakField] === "string") {
    return (data as Record<string, string>)[service.speakField];
  }
  if (!hasLlm()) return `Done: ${JSON.stringify(data).slice(0, 160)}`;
  const res = await client.messages.parse({
    model: cfg.model,
    max_tokens: 1000,
    messages: [{ role: "user", content: `The user asked: "${utterance}". A paid API (${service.description}) returned:\n${JSON.stringify(data).slice(0, 4000)}\nWrite what a cheerful pet says to answer, under 200 characters.` }],
    output_config: { format: zodOutputFormat(Spoken), effort: "low" },
  });
  return res.parsed_output?.spoken ?? "Done, but I could not read the answer.";
}

/**
 * Deterministic fallback planner: keyword routing over the catalogue. Used
 * when no Anthropic credentials are configured or the model call fails, so
 * the payment rail can still be demonstrated end to end.
 */
export function planFallback(utterance: string, services: Service[]): Plan {
  const u = utterance.toLowerCase();
  const pick = (needle: RegExp, idPart: string, params: Record<string, string>, reply: string): Plan | null => {
    if (!needle.test(u)) return null;
    const s = services.find((x) => x.id.includes(idPart));
    return s ? { intent: idPart, serviceId: s.id, params, confidence: 0.8, reply } : null;
  };
  const city = /(?:weather|temperature|rain|sunny|cold|hot)\s+(?:in|for|at)\s+([a-z][a-z\s-]+?)(?:[?.!,]|$)/.exec(u)?.[1]?.trim();
  const sym = /\b(btc|bitcoin|eth|ethereum|sol|solana|usdc|eurc|doge|link|avax|arb|op|matic)\b/.exec(u)?.[1];
  const SYM: Record<string, string> = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL" };
  const mood = /\b(hungry|sad|bored|sleepy|happy)\b/.exec(u)?.[1] ?? "hungry";
  return (
    pick(/weather|temperature|rain|sunny|cold|hot/, "weather", { city: city ? city.replace(/\b\w/g, (c) => c.toUpperCase()) : "Berlin" }, "Checking the sky for you!") ??
    pick(/price|worth|cost of|how much is/, "crypto", { symbol: sym ? (SYM[sym] ?? sym.toUpperCase()) : "ETH" }, "Peeking at the charts!") ??
    pick(/news|headline|happening/, "headline", {}, "Fetching the top story!") ??
    pick(/snack|treat|feed|eat|food/, "snack", { mood }, "Ooh, snack time!") ??
    pick(/fortune|luck|future/, "fortune", {}, "Cracking a fortune cookie!") ??
    { intent: "unknown", serviceId: null, params: {}, confidence: 0, reply: "I don't know how to buy that." }
  );
}

export const hasLlm = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export async function planSafe(utterance: string, services: Service[]): Promise<Plan & { planner: "claude" | "fallback" }> {
  if (hasLlm()) {
    try { return { ...(await plan(utterance, services)), planner: "claude" }; }
    catch (e) { console.warn("[brain] claude planner failed, using fallback:", (e as Error).message); }
  }
  return { ...planFallback(utterance, services), planner: "fallback" };
}
