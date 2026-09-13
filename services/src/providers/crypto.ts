const IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", USDC: "usd-coin", EURC: "euro-coin",
  ARB: "arbitrum", OP: "optimism", MATIC: "matic-network", AVAX: "avalanche-2", LINK: "chainlink", DOGE: "dogecoin",
};

export async function cryptoPrice(symbolRaw: string) {
  const symbol = symbolRaw.toUpperCase();
  const id = IDS[symbol];
  if (!id) throw new Error(`unsupported symbol: ${symbol}`);
  const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`).then((x) => x.json()) as Record<string, { usd: number; usd_24h_change: number }>;
  const p = r[id];
  if (!p) throw new Error("price unavailable");
  const chg = p.usd_24h_change ?? 0;
  return {
    symbol,
    usd: p.usd,
    change24hPct: Number(chg.toFixed(2)),
    spoken: `${symbol} is ${p.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })} dollars, ${chg >= 0 ? "up" : "down"} ${Math.abs(chg).toFixed(1)} percent today.`,
  };
}
