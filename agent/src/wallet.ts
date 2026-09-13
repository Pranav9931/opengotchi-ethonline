/**
 * The agent's wallet on Arc: a Circle Gateway client. USDC sits in the
 * GatewayWallet contract on Arc testnet; every x402 payment is an offchain
 * EIP-3009 authorisation that Gateway settles in a batch on Arc.
 */
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { cfg } from "./config.js";

export type Wallet = GatewayClient;

export function makeWallet(): Wallet {
  return new GatewayClient({ chain: cfg.chain, privateKey: cfg.privateKey, rpcUrl: cfg.rpcUrl });
}

export interface BalanceView {
  address: string;
  walletUsdc: number;
  gatewayUsdc: number;
}

export async function balances(w: Wallet): Promise<BalanceView> {
  const b = await w.getBalances();
  return {
    address: w.account.address,
    walletUsdc: Number(b.wallet.balance) / 1_000_000,
    gatewayUsdc: Number(b.gateway.available) / 1_000_000,
  };
}

/** Top up the Gateway balance from the wallet when it runs low. This is the
 *  one real onchain transaction on Arc; the explorer link is shown on the pet. */
export async function ensureGateway(w: Wallet, minUsd: number, depositUsd: string): Promise<{ txHash?: string; balances: BalanceView }> {
  let b = await balances(w);
  if (b.gatewayUsdc >= minUsd) return { balances: b };
  if (b.walletUsdc < parseFloat(depositUsd)) {
    throw new Error(`wallet has ${b.walletUsdc} USDC, need ${depositUsd} to deposit — fund ${b.address} at https://faucet.circle.com`);
  }
  const d = await w.deposit(depositUsd);
  b = await balances(w);
  return { txHash: d.depositTxHash, balances: b };
}

export const explorerTx = (hash: string) => `${cfg.explorer}/tx/${hash}`;
export const explorerAddr = (addr: string) => `${cfg.explorer}/address/${addr}`;
