/** `bun run wallet new` prints two fresh Arc keys; `bun run wallet status` shows balances. */
import "dotenv/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcClients, usdcBalance, addrUrl } from "../../shared/arc.js";

const [cmd] = process.argv.slice(2);
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
