# Flightdeck benchmark

## Reference-policy diagnostic

The deterministic reference policy is a simulator diagnostic. It calls simulator code directly, so it does not test browser tool discovery, model reasoning, WebMCP latency, or recovery behavior. It cannot pass the product acceptance gate.

| Policy | Seed | Complete | Score | Real time | Injuries | Route rebuilds | Landing |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| deterministic-reference | 17 | yes | 96 | 270.1 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 42 | yes | 96 | 268.1 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 81 | yes | 96 | 272.5 s | 0 | 0 | safe, one bounce |

These numbers are the September 1, 2026 environment baseline, not agent results. Rerunning the policy can find route or physics regressions. Do not report its result as an agent flight.

Reproduce the diagnostic with `npm run diagnostic:reference-policy`.

## Model matrix protocol

Run WebMCP-capable models as fresh agents against the same root flight. Each agent receives only `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.` The environment privately selects the scenario and reveals the new condition only through its in-flight WebMCP event.

Export the `flightdeck-trajectory-v2` file after each run. Report completion, final score, rejected calls, tool count, median and p95 call latency, event-decision latency, passenger injuries, route rebuilds, and touchdown quality.

Do not mix deterministic-reference results into the model leaderboard. A model run is valid only when every flight action appears in the exported WebMCP trajectory and the agent had no other control channel. Follow [EVALUATION.md](./EVALUATION.md).
