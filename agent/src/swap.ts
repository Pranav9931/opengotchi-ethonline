/**
 * "Buy me a dollar of bitcoin": a real same-chain swap on Arc testnet through
 * Circle App Kit. Arc testnet lists USDC, EURC and cirBTC, so the pet can buy
 * bitcoin (cirBTC) or euros (EURC) with its USDC. Anything else is declined
 * honestly.
 */
import "dotenv/config";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

export const BUYABLE: Record<string, { token: string; say: string }> = {
  bitcoin: { token: "cirBTC", say: "bitcoin" }, btc: { token: "cirBTC", say: "bitcoin" }, cirbtc: { token: "cirBTC", say: "bitcoin" },
  euro: { token: "EURC", say: "euros" }, euros: { token: "EURC", say: "euros" }, eurc: { token: "EURC", say: "euros" }, eur: { token: "EURC", say: "euros" },
};
export const NOT_BUYABLE = /\b(eth|ethereum|ether|sol|solana|doge|dogecoin|link|avax|matic|arb|op|usdt|dai)\b/i;

const kit = new AppKit();
let adapter: ReturnType<typeof createViemAdapterFromPrivateKey> | undefined;
const getAdapter = () => (adapter ??= createViemAdapterFromPrivateKey({ privateKey: process.env.AGENT_PRIVATE_KEY as string }));
const config = process.env.CIRCLE_API_KEY ? { apiKey: process.env.CIRCLE_API_KEY } : undefined;

export interface SwapOutcome { txHash: string; explorerUrl: string; amountIn: string; tokenOut: string; amountOut?: string; status: string }

export async function estimateBuy(amountUsd: number, tokenOut: string) {
  return kit.estimateSwap({ from: { adapter: getAdapter(), chain: "Arc_Testnet" }, tokenIn: "USDC", tokenOut, amountIn: amountUsd.toFixed(2), config } as never);
}

export async function buy(amountUsd: number, tokenOut: string): Promise<SwapOutcome> {
  const r = await kit.swap({ from: { adapter: getAdapter(), chain: "Arc_Testnet" }, tokenIn: "USDC", tokenOut, amountIn: amountUsd.toFixed(2), config } as never) as unknown as Record<string, unknown>;
  const dig = (o: unknown, keys: string[]): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    for (const k of keys) { const v = (o as Record<string, unknown>)[k]; if (typeof v === "string" && v) return v; }
    for (const v of Object.values(o as Record<string, unknown>)) { const f = dig(v, keys); if (f) return f; }
    return undefined;
  };
  return {
    txHash: dig(r, ["txHash", "transactionHash", "hash"]) ?? "",
    explorerUrl: dig(r, ["explorerUrl"]) ?? "",
    amountIn: amountUsd.toFixed(2),
    tokenOut,
    amountOut: dig(r, ["amountOut", "outputAmount", "toAmount"]),
    status: dig(r, ["status", "state"]) ?? "unknown",
  };
}

// CLI: bun run swap estimate|buy <usd> <cirBTC|EURC>
if (process.argv[1]?.endsWith("swap.ts")) {
  const [cmd, amt = "0.5", tok = "EURC"] = process.argv.slice(2);
  const t0 = Date.now();
  if (cmd === "estimate") console.log(JSON.stringify(await estimateBuy(Number(amt), tok), (_k, v) => typeof v === "bigint" ? v.toString() : v, 1));
  else if (cmd === "buy") console.log(JSON.stringify(await buy(Number(amt), tok), null, 1));
  else console.log("usage: bun run swap estimate|buy <usd> <cirBTC|EURC>");
  console.log(`${Date.now() - t0} ms`);
  process.exit(0);
}
