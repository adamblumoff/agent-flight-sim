# Flightdeck benchmark

## Reference-policy diagnostic

The deterministic reference policy is a development diagnostic for simulator changes. It calls simulator code directly, so it does not exercise browser tool discovery, model reasoning, WebMCP latency, or recovery behavior and cannot pass the product acceptance gate.

| Policy | Seed | Complete | Score | Real time | Injuries | Route rebuilds | Landing |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| deterministic-reference | 17 | yes | 96 | 270.1 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 42 | yes | 96 | 268.1 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 81 | yes | 96 | 272.5 s | 0 | 0 | safe, one bounce |

These numbers are the September 1, 2026 environment baseline, not an agent result. Rerunning the policy can identify route or physics regressions, but its result must never be reported as an agent-flight result.

Reproduce the diagnostic with `npm run diagnostic:reference-policy`.

## Model matrix protocol

For the submission comparison, run WebMCP-capable models as fresh agents in Judge Mode. Each receives only `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.`; the environment privately selects the scenario and reveals the emergency only through the in-flight WebMCP event. Export the RL trajectory after each run and report completion, final score, rejected calls, tool count, median/p95 call latency, emergency decision latency, passenger injuries, route rebuilds, and touchdown quality.

Do not mix deterministic-reference results into the model leaderboard. A model run is valid only when every flight action appears in the exported WebMCP trajectory and the agent had no other control channel. Follow [EVALUATION.md](./EVALUATION.md).
