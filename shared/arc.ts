/**
 * Arc testnet primitives shared by the pet agent (client/evaluator) and the
 * worker agent (provider): USDC, the ERC-8183 AgenticCommerce reference
 * contract, and the ERC-8004 identity / reputation / validation registries.
 * Addresses from docs.arc.io (Arc testnet, chain id 5042002).
 */
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, keccak256, toHex, decodeEventLog, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const AGENTIC_COMMERCE: Address = "0x0747EEf0706327138c69792bF28Cd525089e4583";
export const IDENTITY_REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY: Address = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
export const VALIDATION_REGISTRY: Address = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
export const EXPLORER = process.env.EXPLORER_URL ?? "https://testnet.arcscan.app";
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

export const JOB_STATUS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const;

export const agenticCommerceAbi = [
  { type: "function", name: "createJob", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { type: "function", name: "setBudget", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "function", name: "fund", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "function", name: "submit", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "function", name: "complete", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { type: "function", name: "getJob", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }] }] },
  { type: "event", name: "JobCreated", anonymous: false, inputs: [{ indexed: true, name: "jobId", type: "uint256" }, { indexed: true, name: "client", type: "address" }, { indexed: true, name: "provider", type: "address" }, { indexed: false, name: "evaluator", type: "address" }, { indexed: false, name: "expiredAt", type: "uint256" }, { indexed: false, name: "hook", type: "address" }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export const identityAbi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }] },
  { type: "event", name: "Transfer", anonymous: false, inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: true, name: "tokenId", type: "uint256" }] },
] as const;

export const reputationAbi = [
  { type: "function", name: "giveFeedback", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "score", type: "int128" }, { name: "feedbackType", type: "uint8" }, { name: "tag", type: "string" }, { name: "metadataURI", type: "string" }, { name: "evidenceURI", type: "string" }, { name: "comment", type: "string" }, { name: "feedbackHash", type: "bytes32" }], outputs: [] },
] as const;

export const validationAbi = [
  { type: "function", name: "validationRequest", stateMutability: "nonpayable", inputs: [{ name: "validator", type: "address" }, { name: "agentId", type: "uint256" }, { name: "requestURI", type: "string" }, { name: "requestHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "validationResponse", stateMutability: "nonpayable", inputs: [{ name: "requestHash", type: "bytes32" }, { name: "response", type: "uint8" }, { name: "responseURI", type: "string" }, { name: "responseHash", type: "bytes32" }, { name: "tag", type: "string" }], outputs: [] },
  { type: "function", name: "getValidationStatus", stateMutability: "view", inputs: [{ name: "requestHash", type: "bytes32" }], outputs: [{ name: "validatorAddress", type: "address" }, { name: "agentId", type: "uint256" }, { name: "response", type: "uint8" }, { name: "responseHash", type: "bytes32" }, { name: "tag", type: "string" }, { name: "lastUpdate", type: "uint256" }] },
] as const;

export function arcClients(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const transport = http(process.env.ARC_RPC_URL);
  const pub = createPublicClient({ chain: arcTestnet, transport });
  const wallet = createWalletClient({ chain: arcTestnet, transport, account });
  return { account, pub, wallet };
}
export type ArcClients = ReturnType<typeof arcClients>;

export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const usd = (atomic: bigint) => Number(formatUnits(atomic, 6));
export const toAtomic = (usdStr: string | number) => parseUnits(String(usdStr), 6);
export const hashOf = (s: string) => keccak256(toHex(s));

export async function usdcBalance(c: ArcClients, addr: Address = c.account.address) {
  return usd(await c.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr] }));
}

export async function wait(c: ArcClients, hash: Hex) {
  const r = await c.pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
  return r;
}

export async function getJob(c: ArcClients, jobId: bigint) {
  const j = await c.pub.readContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "getJob", args: [jobId] });
  return { ...j, statusName: JOB_STATUS[Number(j.status)] ?? String(j.status), budgetUsd: usd(j.budget) };
}

/* ---- client side (the pet) ---- */
export async function createJob(c: ArcClients, provider: Address, description: string, ttlSec = 3600) {
  const block = await c.pub.getBlock();
  const hash = await c.wallet.writeContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "createJob", args: [provider, c.account.address, block.timestamp + BigInt(ttlSec), description, ZERO] });
  const receipt = await wait(c, hash);
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: agenticCommerceAbi, data: log.data, topics: log.topics });
      if (d.eventName === "JobCreated") return { jobId: d.args.jobId, hash };
    } catch { /* other log */ }
  }
  throw new Error("JobCreated event not found");
}

export async function fundJob(c: ArcClients, jobId: bigint, budget: bigint) {
  const allowance = await c.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [c.account.address, AGENTIC_COMMERCE] });
  let approveHash: Hex | undefined;
  if (allowance < budget) {
    approveHash = await c.wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [AGENTIC_COMMERCE, budget] });
    await wait(c, approveHash);
  }
  const hash = await c.wallet.writeContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "fund", args: [jobId, "0x"] });
  await wait(c, hash);
  return { approveHash, hash };
}

export async function completeJob(c: ArcClients, jobId: bigint, reason: string) {
  const hash = await c.wallet.writeContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "complete", args: [jobId, hashOf(reason), "0x"] });
  await wait(c, hash);
  return hash;
}

export async function giveFeedback(c: ArcClients, agentId: bigint, score: number, tag: string, comment: string, evidence: string) {
  const hash = await c.wallet.writeContract({ address: REPUTATION_REGISTRY, abi: reputationAbi, functionName: "giveFeedback", args: [agentId, BigInt(score), 0, tag, "", evidence, comment, hashOf(comment)] });
  await wait(c, hash);
  return hash;
}

/* ---- provider side (the worker) ---- */
export async function setBudget(c: ArcClients, jobId: bigint, budget: bigint) {
  const hash = await c.wallet.writeContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "setBudget", args: [jobId, budget, "0x"] });
  await wait(c, hash);
  return hash;
}

export async function submitDeliverable(c: ArcClients, jobId: bigint, deliverableHash: Hex) {
  const hash = await c.wallet.writeContract({ address: AGENTIC_COMMERCE, abi: agenticCommerceAbi, functionName: "submit", args: [jobId, deliverableHash, "0x"] });
  await wait(c, hash);
  return hash;
}

export async function registerIdentity(c: ArcClients, metadataURI: string) {
  const hash = await c.wallet.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: "register", args: [metadataURI] });
  const receipt = await wait(c, hash);
  for (const log of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: identityAbi, data: log.data, topics: log.topics });
      if (d.eventName === "Transfer" && d.args.to.toLowerCase() === c.account.address.toLowerCase()) return { agentId: d.args.tokenId, hash };
    } catch { /* other log */ }
  }
  throw new Error("Transfer event not found");
}
