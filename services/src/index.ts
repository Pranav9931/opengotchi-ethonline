/**
 * Gotchi x402 services — a tiny marketplace of voice-friendly paid APIs that
 * settle in USDC on Arc testnet through Circle Gateway nanopayments.
 *
 * Every route is protected by `gateway.require("$price")`: an unpaid call
 * receives HTTP 402 with the payment requirements, a signed call is settled
 * through the Gateway facilitator and then served. The seller never touches
 * gas; Gateway batches settlement on Arc.
 */
import "dotenv/config";
import express from "express";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { catalog, openapi, wellKnownX402 } from "./catalog.js";
import { weather } from "./providers/weather.js";
import { cryptoPrice } from "./providers/crypto.js";
import { headline } from "./providers/headline.js";
import { snack } from "./providers/snack.js";
import { fortune } from "./providers/fortune.js";

const PORT = Number(process.env.SERVICES_PORT ?? 4020);
const SELLER = process.env.SELLER_ADDRESS;
const NETWORK = process.env.X402_NETWORK ?? "eip155:5042002"; // Arc testnet
const FACILITATOR = process.env.GATEWAY_FACILITATOR_URL ?? "https://gateway-api-testnet.circle.com";
const PUBLIC_URL = process.env.SERVICES_PUBLIC_URL ?? `http://localhost:${PORT}`;

if (!SELLER) {
  console.error("SELLER_ADDRESS is required (the wallet that receives USDC on Arc)");
  process.exit(1);
}

const app = express();
app.use(express.json());

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER,
  facilitatorUrl: FACILITATOR,
  networks: NETWORK,
});

// Discovery surface (free): x402scan-style OpenAPI + .well-known/x402 so the
// agent (and any registry) can enumerate what is for sale here.
app.get("/openapi.json", (_req, res) => res.json(openapi(PUBLIC_URL)));
app.get("/.well-known/x402", (_req, res) => res.json(wellKnownX402(PUBLIC_URL)));
app.get("/catalog", (_req, res) => res.json(catalog(PUBLIC_URL, NETWORK, SELLER)));
app.get("/health", (_req, res) => res.json({ ok: true, network: NETWORK, seller: SELLER }));

const paid = (price: string) => gateway.require(price);

app.get("/weather", paid("$0.002"), async (req, res) => {
  try {
    res.json(await weather(String(req.query.city ?? "Berlin")));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.get("/crypto/price", paid("$0.001"), async (req, res) => {
  try {
    res.json(await cryptoPrice(String(req.query.symbol ?? "ETH")));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.get("/news/headline", paid("$0.003"), async (_req, res) => {
  try {
    res.json(await headline());
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

app.get("/pet/snack", paid("$0.005"), (req, res) => {
  res.json(snack(String(req.query.mood ?? "hungry"), (req as unknown as { payment?: { payer?: string } }).payment?.payer));
});

app.get("/fortune", paid("$0.001"), (_req, res) => {
  res.json(fortune());
});

app.listen(PORT, () => {
  console.log(`gotchi x402 services on ${PUBLIC_URL}`);
  console.log(`  seller ${SELLER} · network ${NETWORK} · facilitator ${FACILITATOR}`);
  for (const s of catalog(PUBLIC_URL, NETWORK, SELLER)) console.log(`  ${s.price.padEnd(7)} ${s.resource}  ${s.description}`);
});
