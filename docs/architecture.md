# Architecture

```mermaid
sequenceDiagram
    participant U as User
    participant P as OpenGotchi pet (gotchiOS)
    participant A as pet agent (agent/)
    participant C as Claude
    participant J as ERC-8183 AgenticCommerce (Arc)
    participant W as worker agent (worker/)
    participant R as ERC-8004 registries (Arc)

    W->>R: register(metadataURI) once → agentId
    U->>P: "Jarvis, what's the weather in Berlin?"
    P->>P: WakeNet wake word, cloud STT
    P->>A: MQTT evt|voice|<text>
    A->>W: GET /skills (catalogue + prices)
    A->>C: transcript + catalogue → {skillId, params, confidence}
    A->>A: policy: balance − reserve, daily budget, price cap, worker identity + history, battery, confidence
    A->>J: createJob(provider=W, evaluator=A)
    A->>W: POST /jobs/:id/accept
    W->>J: setBudget(jobId, price)
    A->>J: approve(USDC) + fund(jobId)  — escrow
    A->>W: POST /jobs/:id/run {skill, params}
    W->>W: do the work (public data)
    W->>J: submit(jobId, keccak(result))
    W-->>A: result + payload + deliverableHash
    A->>A: keccak(payload) == onchain deliverable?
    A->>J: complete(jobId, reason)  — USDC settles to W
    A->>R: giveFeedback(agentId, 100, tag, evidence=tx)
    A->>P: say|"Berlin: 18 degrees, partly cloudy"
    A->>P: data … + frag receipt (job #, tx, balance, today)
    A->>P: ntf|Job settled on Arc|#12 weather · 0.02 USDC
    P->>U: speaks + shows receipt
```

## Decision logic (agent/src/policy.ts)

| Signal | Source | Rule |
|---|---|---|
| confidence | planner output | < 0.6 → ask again |
| worker identity | worker `/skills` → ERC-8004 agentId | missing → refuse to pay |
| price | worker catalogue, re-checked against onchain `setBudget` | > `MAX_PRICE_USD` → decline; onchain quote above catalogue → abort |
| spent today | ledger.json | spent + price > `DAILY_BUDGET_USD` → decline |
| USDC balance | `balanceOf` on Arc | balance − price < `MIN_RESERVE_USD` → decline |
| worker history | ledger (completed jobs with this provider) | 0 jobs → only jobs ≤ half the cap |
| battery | device telemetry | < 15 % → only `snack` |
| deliverable | `getJob().status` + hash compare | mismatch → never `complete()` |

## Why ERC-8183 jobs rather than direct transfers

A transfer moves money; a job moves money *conditionally*. Escrow means the
worker knows it will be paid, the hash-on-submit means the pet can prove what
it paid for, and `complete()` is the pet's evaluation. That is the shape Arc
documents for agent-to-agent work, and it gives the policy engine real onchain
state to reason about.
