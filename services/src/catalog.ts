/** Static description of every paid route: single source of truth for the
 *  OpenAPI document, the .well-known/x402 fan-out and the agent's local
 *  catalogue. Prices are USD strings exactly as passed to gateway.require(). */
export interface ServiceDef {
  path: string;
  method: "GET";
  price: string;
  category: string;
  summary: string;
  description: string;
  /** Query parameters the caller may supply. */
  params: Record<string, { description: string; example: string; required?: boolean }>;
  /** Voice-friendly: the field of the JSON reply to read aloud. */
  speakField: string;
}

export const SERVICES: ServiceDef[] = [
  {
    path: "/weather",
    method: "GET",
    price: "$0.002",
    category: "WEATHER",
    summary: "Current weather for a city",
    description: "Live temperature, wind and sky condition for any city (Open-Meteo)",
    params: { city: { description: "City name", example: "Berlin", required: true } },
    speakField: "spoken",
  },
  {
    path: "/crypto/price",
    method: "GET",
    price: "$0.001",
    category: "FINANCIAL_ANALYSIS",
    summary: "Spot price of a crypto asset in USD",
    description: "Current USD price and 24h change for BTC, ETH, SOL, USDC and other majors (CoinGecko)",
    params: { symbol: { description: "Ticker symbol", example: "ETH", required: true } },
    speakField: "spoken",
  },
  {
    path: "/news/headline",
    method: "GET",
    price: "$0.003",
    category: "WEB_SEARCH_RESEARCH",
    summary: "Top tech headline right now",
    description: "The current number-one story on Hacker News with its score",
    params: {},
    speakField: "spoken",
  },
  {
    path: "/pet/snack",
    method: "GET",
    price: "$0.005",
    category: "PET_CARE",
    summary: "Buy the pet a snack",
    description: "Orders a virtual snack matched to the pet's mood; the receipt feeds the pet",
    params: { mood: { description: "Pet mood", example: "hungry" } },
    speakField: "spoken",
  },
  {
    path: "/fortune",
    method: "GET",
    price: "$0.001",
    category: "CREATIVE",
    summary: "A one-line fortune",
    description: "A short fortune-cookie line for the pet to read out",
    params: {},
    speakField: "spoken",
  },
];

const priceAtomic = (usd: string) => String(Math.round(parseFloat(usd.replace("$", "")) * 1_000_000));

export function catalog(base: string, network: string, payTo: string) {
  return SERVICES.map((s) => ({
    resource: base + s.path,
    method: s.method,
    price: s.price,
    priceAtomic: priceAtomic(s.price),
    network,
    payTo,
    category: s.category,
    summary: s.summary,
    description: s.description,
    params: s.params,
    speakField: s.speakField,
  }));
}

/** x402scan discovery format: OpenAPI 3.1 with x-payment-info on paid ops. */
export function openapi(base: string) {
  const paths: Record<string, unknown> = {};
  for (const s of SERVICES) {
    paths[s.path] = {
      get: {
        summary: s.summary,
        description: s.description,
        parameters: Object.entries(s.params).map(([name, p]) => ({
          name,
          in: "query",
          required: !!p.required,
          description: p.description,
          schema: { type: "string" },
          example: p.example,
        })),
        "x-payment-info": {
          price: { mode: "fixed", currency: "USD", amount: s.price.replace("$", "") },
          protocols: [{ x402: {} }],
        },
        responses: {
          "200": { description: "Paid result", content: { "application/json": { schema: { type: "object" } } } },
          "402": { description: "Payment required (x402)" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Gotchi x402 services",
      version: "1.0.0",
      description: "Voice-friendly paid APIs settled in USDC on Arc testnet via Circle Gateway nanopayments.",
    },
    servers: [{ url: base }],
    paths,
  };
}

export function wellKnownX402(base: string) {
  return {
    version: 1,
    resources: SERVICES.map((s) => ({ url: base + s.path, method: s.method })),
  };
}
