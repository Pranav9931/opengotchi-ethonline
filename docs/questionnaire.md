# Demo questionnaire — what to say to the pet

Say **"Jarvis"** (or tap the pet), wait for the chirp, then one of these. Every line below was run
on hardware on 13 Sept 2026. "Job" rows settle an ERC-8183 job on Arc (7 transactions);
"Buy" rows execute a Circle App Kit swap on Arc; "Held" rows are declined by the pet's policy and
shown on screen, which is a feature.

## Jobs (worker agent, ERC-8004 #894780)

| Say | Skill | Pet answers with | Cost |
|---|---|---|---|
| "What's the weather in Berlin?" | weather | "Berlin: 18 degrees, overcast, wind 11 km/h." | 0.020 USDC |
| "Is it raining in Tokyo?" | weather | live Open-Meteo conditions for Tokyo | 0.020 |
| "How much is bitcoin worth?" | crypto_price | "BTC is 76,771 dollars, down 0.8 percent today." | 0.010 |
| "What's the price of ethereum?" | crypto_price | live CoinGecko quote | 0.010 |
| "What's the top headline?" / "What's up?" | headline | the current #1 Hacker News story and its score | 0.015 |
| **"What are the odds of a Fed rate cut?"** | polymarket | "Polymarket says: Will there be no change in Fed interest rates after the September 2026 meeting? Yes 22 percent, No 79 percent." | 0.020 |
| "What's the chance bitcoin is above 80k?" | polymarket | the highest-volume matching Polymarket market with Yes/No prices | 0.020 |
| "Buy me a snack" / "I'm hungry" | snack | "Yum, one rice ball coming up." (mood-matched) | 0.030 |
| "Tell me my fortune" | fortune | a one-line fortune | 0.005 |

## Buy (pet's own wallet, App Kit swap USDC → token on Arc testnet)

| Say | Result |
|---|---|
| **"Buy one dollar of bitcoin"** | swaps 1 USDC → cirBTC; spoken "Bought 0.00000271 bitcoin as cirBTC for 1.00 USDC on Arc."; receipt shows the swap tx |
| "Buy two dollars worth of euros" | swaps 2 USDC → EURC (≈ 1.6 EURC) |
| "Buy one dollar of ethereum" | **held**: "On Arc I can only buy bitcoin or euros right now, not ethereum." (ETH does not exist on Arc) |
| "Buy five dollars of bitcoin" | **held**: "I only buy up to 2 dollars at a time." (`MAX_SWAP_USD`) |

## Policy demonstrations (say these to show the decision logic)

| Say | Why it is held |
|---|---|
| "Buy me a snack" as the very first job with a new worker | first job with an unknown worker must be ≤ half the price cap |
| anything after the daily budget (0.50 USDC) is spent | "I already spent 0.500 USDC today, my budget is 0.5." |
| anything when the pet's battery is below 15 % | "Battery is low, I will only buy snacks right now." |
| mumbling | confidence below 0.6 → "I am not sure what you want. Say it again?" |

## Suggested 90-second video order

1. "Jarvis, what's the weather in Berlin?" — watch the six ring nodes light up, hear the answer.
2. "Jarvis, what are the odds of a Fed rate cut?" — a prediction-market job.
3. "Jarvis, buy one dollar of bitcoin." — a real swap on Arc, receipt with tx.
4. "Jarvis, buy one dollar of ethereum." — an honest decline.
5. Show `curl localhost:4010/ledger` and the worker address on testnet.arcscan.app.
