/** Wallet helper: `bun run wallet new|status|deposit <usd>` */
import "dotenv/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const [cmd, arg] = process.argv.slice(2);

if (cmd === "new") {
  const pk = generatePrivateKey();
  const acct = privateKeyToAccount(pk);
  console.log(`AGENT_PRIVATE_KEY=${pk}`);
  console.log(`address: ${acct.address}`);
  console.log(`fund it with Arc testnet USDC at https://faucet.circle.com then run: bun run wallet status`);
  process.exit(0);
}

const { makeWallet, balances, explorerTx, explorerAddr } = await import("./wallet.js");
const w = makeWallet();
if (cmd === "status" || !cmd) {
  const b = await balances(w);
  console.log(`address  ${b.address}  ${explorerAddr(b.address)}`);
  console.log(`wallet   ${b.walletUsdc} USDC`);
  console.log(`gateway  ${b.gatewayUsdc} USDC (available for nanopayments)`);
} else if (cmd === "deposit") {
  const amt = arg ?? "0.5";
  console.log(`depositing ${amt} USDC into Gateway on Arc...`);
  const d = await w.deposit(amt);
  console.log(`deposit tx ${explorerTx(d.depositTxHash)}`);
  const b = await balances(w);
  console.log(`gateway now ${b.gatewayUsdc} USDC`);
} else {
  console.log("usage: bun run wallet new|status|deposit <usd>");
}
