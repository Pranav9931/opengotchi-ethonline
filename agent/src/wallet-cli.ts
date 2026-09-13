/** `bun run wallet new` prints two fresh Arc keys; `bun run wallet status` shows balances. */
import "dotenv/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcClients, usdcBalance, addrUrl } from "../../shared/arc.js";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "fund-worker") {
  // USDC is Arc's native gas token: a plain value transfer moves it (18 decimals on the native side).
  const { parseEther } = await import("viem");
  const { privateKeyToAccount: toAcct } = await import("viem/accounts");
  const a = arcClients(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
  const to = toAcct(process.env.WORKER_PRIVATE_KEY as `0x${string}`).address;
  const amount = arg ?? "3";
  const hash = await a.wallet.sendTransaction({ to, value: parseEther(amount) });
  await a.pub.waitForTransactionReceipt({ hash });
  console.log(`sent ${amount} USDC to worker ${to}  ${process.env.EXPLORER_URL ?? "https://testnet.arcscan.app"}/tx/${hash}`);
  process.exit(0);
}
if (cmd === "new") {
  for (const name of ["AGENT_PRIVATE_KEY", "WORKER_PRIVATE_KEY"]) {
    const pk = generatePrivateKey();
    console.log(`${name}=${pk}   # ${privateKeyToAccount(pk).address}`);
  }
  console.log("fund both addresses with Arc testnet USDC at https://faucet.circle.com (USDC is also the gas token)");
  process.exit(0);
}
for (const name of ["AGENT_PRIVATE_KEY", "WORKER_PRIVATE_KEY"]) {
  const pk = process.env[name] as `0x${string}` | undefined;
  if (!pk) { console.log(`${name}: not set`); continue; }
  const c = arcClients(pk);
  console.log(`${name.padEnd(19)} ${c.account.address}  ${(await usdcBalance(c)).toFixed(4)} USDC  ${addrUrl(c.account.address)}`);
}
