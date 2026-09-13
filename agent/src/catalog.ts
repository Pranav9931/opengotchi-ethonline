/**
 * Service discovery. Two sources, one shape:
 *   1. Circle Discovery API (mirrors the Agent Marketplace incl. x402scan
 *      registrations) — filtered to services that can actually be paid from
 *      this wallet's chain.
 *   2. The local Gotchi services (services/) — the Arc-testnet payees.
 * Then a voice-fitness filter: cheap, GET, no auth headers, small inputs.
 */
import { cfg } from "./config.js";

export interface Service {
  id: string;
  resource: string;
  method: "GET" | "POST";
  priceUsd: number;
  network: string;
  category: string;
  provider: string;
  description: string;
  params: Record<string, { description: string; example?: string; required?: boolean }>;
  speakField?: string;
  source: "gotchi" | "circle";
  gateway: boolean;
}

interface DiscoveryItem {
  resource: string;
  type: string;
  accepts: { network: string; amount: string; payTo: string; extra?: Record<string, unknown> }[];
  metadata?: {
    description?: string;
    provider?: { name?: string; category?: string };
    supportsCircleGateway?: boolean;
    supportsVanillax402?: boolean;
    input?: { method?: string; queryParams?: Record<string, { description?: string; example?: string; required?: boolean }> };
    requiredHeaders?: string[];
  };
}

const VOICE_CATEGORIES = new Set([
  "WEATHER", "FINANCIAL_ANALYSIS", "WEB_SEARCH_RESEARCH", "CREATIVE", "PET_CARE", "PREDICTION_MARKETS", "NEWS", "SPORTS", "ENTERTAINMENT",
]);

export async function loadLocal(): Promise<Service[]> {
  const r = await fetch(`${cfg.servicesUrl}/catalog`);
  if (!r.ok) throw new Error(`local catalog ${r.status}`);
  const items = await r.json() as { resource: string; method: "GET"; price: string; network: string; category: string; description: string; params: Service["params"]; speakField: string }[];
  return items.map((s) => ({
    id: new URL(s.resource).pathname,
    resource: s.resource,
    method: s.method,
    priceUsd: parseFloat(s.price.replace("$", "")),
    network: s.network,
    category: s.category,
    provider: "Gotchi services",
    description: s.description,
    params: s.params,
    speakField: s.speakField,
    source: "gotchi",
    gateway: true,
  }));
}

export async function loadCircle(network: string): Promise<Service[]> {
  const u = new URL(cfg.discoveryUrl);
  u.searchParams.set("network", network);
  u.searchParams.set("maxUsdPrice", String(cfg.maxPriceUsd));
  u.searchParams.set("supportsCircleGateway", "true");
  u.searchParams.set("limit", "100");
  const r = await fetch(u);
  if (!r.ok) throw new Error(`discovery ${r.status}`);
  const d = await r.json() as { items: DiscoveryItem[] };
  return d.items.map((it) => {
    const acc = it.accepts.find((a) => a.network === network) ?? it.accepts[0];
    const md = it.metadata ?? {};
    return {
      id: it.resource,
      resource: it.resource,
      method: (md.input?.method?.toUpperCase() === "POST" ? "POST" : "GET") as "GET" | "POST",
      priceUsd: Number(acc?.amount ?? 0) / 1_000_000,
      network: acc?.network ?? network,
      category: md.provider?.category ?? "OTHER",
      provider: md.provider?.name ?? new URL(it.resource).hostname,
      description: md.description ?? "",
      params: md.input?.queryParams ?? {},
      source: "circle" as const,
      gateway: !!md.supportsCircleGateway,
      _headers: md.requiredHeaders?.length ?? 0,
    };
  }).filter((s) => (s as { _headers: number })._headers === 0) as Service[];
}

/** Voice fitness: the pet can only *say* a result and only *ask* for one or
 *  two words of input, so keep services that fit that shape. */
export function voiceFilter(all: Service[]): { kept: Service[]; dropped: { id: string; why: string }[] } {
  const kept: Service[] = [];
  const dropped: { id: string; why: string }[] = [];
  for (const s of all) {
    const reqParams = Object.values(s.params).filter((p) => p.required).length;
    if (s.priceUsd > cfg.maxPriceUsd) dropped.push({ id: s.id, why: `price ${s.priceUsd} > cap ${cfg.maxPriceUsd}` });
    else if (s.method !== "GET") dropped.push({ id: s.id, why: "needs a request body" });
    else if (reqParams > 2) dropped.push({ id: s.id, why: `${reqParams} required inputs` });
    else if (!s.gateway) dropped.push({ id: s.id, why: "no Gateway nanopayments" });
    else if (!VOICE_CATEGORIES.has(s.category)) dropped.push({ id: s.id, why: `category ${s.category}` });
    else kept.push(s);
  }
  return { kept, dropped };
}

export async function buildCatalog(): Promise<{ services: Service[]; dropped: { id: string; why: string }[]; sources: Record<string, number> }> {
  const [local, circle] = await Promise.all([
    loadLocal(),
    loadCircle(cfg.network).catch((e) => { console.warn("discovery API:", (e as Error).message); return [] as Service[]; }),
  ]);
  const { kept, dropped } = voiceFilter([...local, ...circle]);
  return { services: kept, dropped, sources: { gotchi: local.length, circle: circle.length } };
}
