/** What the worker agent can do for a fee. Each skill has a USDC price and
 *  returns JSON plus a `spoken` line for the pet. Data comes from free public
 *  APIs; the value the worker sells is doing the job and settling on Arc. */
export interface Skill {
  id: string;
  description: string;
  priceUsd: number;
  params: Record<string, { description: string; example: string; required?: boolean }>;
  run(params: Record<string, string>): Promise<Record<string, unknown> & { spoken: string }>;
}

const WX: Record<number, string> = { 0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail" };
const IDS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", USDC: "usd-coin", EURC: "euro-coin", ARB: "arbitrum", OP: "optimism", MATIC: "matic-network", AVAX: "avalanche-2", LINK: "chainlink", DOGE: "dogecoin" };
const FORTUNES = ["A small payment today opens a big door tomorrow.", "Your next block confirms faster than you think.", "Patience settles every escrow.", "The best wallet is a rested one. Take a nap.", "You will find a coin where you least expect it."];
const MENU: Record<string, { item: string; hunger: number; happiness: number }> = { hungry: { item: "rice ball", hunger: 30, happiness: 5 }, sad: { item: "strawberry mochi", hunger: 10, happiness: 25 }, bored: { item: "popping candy", hunger: 5, happiness: 20 }, sleepy: { item: "warm milk", hunger: 15, happiness: 10 }, happy: { item: "tiny cupcake", hunger: 10, happiness: 15 } };

export const SKILLS: Skill[] = [
  {
    id: "weather", description: "Current weather for a city (temperature, wind, sky)", priceUsd: 0.02,
    params: { city: { description: "City name", example: "Berlin", required: true } },
    async run({ city = "Berlin" }) {
      const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then((r) => r.json()) as { results?: { name: string; country: string; latitude: number; longitude: number }[] };
      const hit = geo.results?.[0];
      if (!hit) throw new Error(`unknown city: ${city}`);
      const wx = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,wind_speed_10m,weather_code`).then((r) => r.json()) as { current: { temperature_2m: number; wind_speed_10m: number; weather_code: number } };
      const c = wx.current; const sky = WX[c.weather_code] ?? "unknown sky";
      return { city: hit.name, country: hit.country, temperatureC: c.temperature_2m, windKmh: c.wind_speed_10m, condition: sky, spoken: `${hit.name}: ${Math.round(c.temperature_2m)} degrees, ${sky}, wind ${Math.round(c.wind_speed_10m)} km/h.` };
    },
  },
  {
    id: "crypto_price", description: "USD price and 24h change of a crypto asset (BTC, ETH, SOL, USDC...)", priceUsd: 0.01,
    params: { symbol: { description: "Ticker symbol", example: "ETH", required: true } },
    async run({ symbol = "ETH" }) {
      const sym = symbol.toUpperCase(); const id = IDS[sym];
      if (!id) throw new Error(`unsupported symbol: ${sym}`);
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`).then((x) => x.json()) as Record<string, { usd: number; usd_24h_change: number }>;
      const p = r[id]; if (!p) throw new Error("price unavailable");
      const chg = p.usd_24h_change ?? 0;
      return { symbol: sym, usd: p.usd, change24hPct: Number(chg.toFixed(2)), spoken: `${sym} is ${p.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} dollars, ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(1)} percent today.` };
    },
  },
  {
    id: "headline", description: "The current top technology headline (Hacker News)", priceUsd: 0.015,
    params: {},
    async run() {
      const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then((r) => r.json()) as number[];
      const it = await fetch(`https://hacker-news.firebaseio.com/v0/item/${ids[0]}.json`).then((r) => r.json()) as { title: string; score: number; url?: string; by: string };
      return { title: it.title, score: it.score, url: it.url ?? null, by: it.by, spoken: `Top story: ${it.title}. ${it.score} points.` };
    },
  },
  {
    id: "snack", description: "Deliver a virtual snack matched to the pet's mood", priceUsd: 0.03,
    params: { mood: { description: "Pet mood", example: "hungry" } },
    async run({ mood = "hungry" }) {
      const pick = MENU[mood.toLowerCase()] ?? MENU.hungry;
      return { item: pick.item, mood, effects: pick, orderId: `snk_${Date.now().toString(36)}`, spoken: `Yum, one ${pick.item} coming up.` };
    },
  },
  {
    id: "polymarket", description: "Prediction-market odds from Polymarket for a topic (e.g. Fed rate cut, bitcoin above a price, an election)", priceUsd: 0.02,
    params: { topic: { description: "What to look up", example: "Fed rate cut", required: true } },
    async run({ topic = "" }) {
      const q = topic.trim();
      const pick = async (): Promise<{ title: string; question: string; outcomes: string[]; prices: number[]; volume24h: number } | null> => {
        const norm = (e: { title?: string; markets?: { question?: string; outcomes?: string; outcomePrices?: string; volume24hr?: number; active?: boolean; closed?: boolean }[]; volume24hr?: number }) => {
          const m = (e.markets ?? []).filter((x) => x.active !== false && !x.closed).sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))[0];
          if (!m) return null;
          const parse = (v: unknown) => { try { return JSON.parse(String(v ?? "[]")); } catch { return []; } };
          return { title: e.title ?? "", question: m.question ?? e.title ?? "", outcomes: parse(m.outcomes) as string[], prices: (parse(m.outcomePrices) as string[]).map(Number), volume24h: Math.round(e.volume24hr ?? 0) };
        };
        if (q) {
          const r = await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=5`).then((x) => x.json()) as { events?: Parameters<typeof norm>[0][] };
          for (const e of r.events ?? []) { const n = norm(e); if (n && n.outcomes.length) return n; }
        }
        const top = await fetch("https://gamma-api.polymarket.com/events?limit=5&active=true&closed=false&order=volume24hr&ascending=false").then((x) => x.json()) as Parameters<typeof norm>[0][];
        for (const e of top) { const n = norm(e); if (n && n.outcomes.length) return n; }
        return null;
      };
      const m = await pick();
      if (!m) throw new Error("no market found");
      const pct = (p: number) => Math.round(p * 100);
      const odds = m.outcomes.slice(0, 2).map((o, i) => `${o} ${pct(m.prices[i] ?? 0)} percent`).join(", ");
      return { topic: q || "top market", question: m.question, outcomes: m.outcomes, prices: m.prices, volume24h: m.volume24h, source: "polymarket", spoken: `Polymarket says: ${m.question} ${odds}.` };
    },
  },
  {
    id: "fortune", description: "A one-line fortune", priceUsd: 0.005,
    params: {},
    async run() { const t = FORTUNES[Math.floor(Math.random() * FORTUNES.length)]; return { text: t, spoken: t }; },
  },
];

export const skillCatalog = () => SKILLS.map(({ id, description, priceUsd, params }) => ({ id, description, priceUsd, params }));
