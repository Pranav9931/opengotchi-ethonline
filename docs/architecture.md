# Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant P as OpenGotchi pet (gotchiOS)
    participant A as agent/ (Node)
    participant D as Circle Discovery API
    participant C as Claude
    participant G as Circle Gateway (Arc testnet)
    participant S as services/ (x402 sellers on Arc)

    U->>P: "Jarvis, what's the weather in Berlin?"
    P->>P: WakeNet wake word, cloud STT
    P->>A: MQTT og/d/hash/commands  evt|voice|<text>
    A->>D: GET /v2/x402/discovery/resources?network=eip155:5042002&supportsCircleGateway=true
    A->>S: GET /catalog
    A->>A: voice-fitness filter (price cap, GET, ≤2 inputs, no headers, category)
    A->>C: transcript + catalogue → {serviceId, params, confidence}
    A->>G: getBalances()
    A->>A: policy: balance ≥ price, spentToday+price ≤ budget, price ≤ cap, battery, confidence
    alt Gateway balance low
        A->>G: deposit(USDC)  — onchain tx on Arc
    end
    A->>S: GET /weather?city=Berlin  → 402 Payment Required (accepts: eip155:5042002)
    A->>A: sign EIP-3009 authorisation (gasless)
    A->>S: retry with PAYMENT-SIGNATURE
    S->>G: settle(payload)  — batched on Arc
    S-->>A: 200 {temperatureC, condition, spoken}
    A->>P: say|"Berlin: 18 degrees, partly cloudy"
    A->>P: data … + frag receipt (service, price, tx, balances)
    A->>P: ntf|Paid on Arc|0.002 USDC to Gotchi services
    P->>U: speaks + shows receipt
```

## Decision logic (policy.ts)

| Signal | Source | Rule |
|---|---|---|
| confidence | planner output | < 0.6 → ask again |
| price | seller's live 402 / catalogue | > `MAX_PRICE_USD` → decline |
| spent today | ledger.json | spent + price > `DAILY_BUDGET_USD` → decline |
| Gateway balance | `GatewayClient.getBalances()` | < price → decline; < `MIN_GATEWAY_USD` → deposit first |
| battery | device telemetry | < 15 % → only `PET_CARE` purchases |

A second guard runs inside the payment path (`onBeforePaymentCreation`) so
that no signed authorisation can exceed the per-payment cap even if the planner
or catalogue is wrong.

## Why Gateway nanopayments on Arc

Prices are $0.001–$0.005. A per-call onchain transfer would cost more in gas
than the item. Gateway lets the buyer sign offchain and the seller settle in
batches on Arc, so sub-cent purchases are viable and the buyer needs no gas
after the one deposit.
