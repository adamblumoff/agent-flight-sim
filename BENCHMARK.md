# Flightdeck benchmark

## Verified environment baseline

The deterministic reference policy was run through Judge Mode on all three condition seeds. This validates that the environment is solvable and that weather/engine variants do not introduce an impossible route. It is not presented as a model benchmark.

| Policy | Seed | Complete | Score | Real time | Injuries | Route rebuilds | Landing |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| deterministic-reference | 17 | yes | 96 | 179.2 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 42 | yes | 96 | 180.3 s | 0 | 0 | safe, one bounce |
| deterministic-reference | 81 | yes | 96 | 180.2 s | 0 | 0 | safe, one bounce |

Aggregate: 100% completion, 96 mean score, 179.9 seconds mean wall time, zero injuries, and zero route rebuilds.

Reproduce with `npm run benchmark`.

## Model matrix protocol

For the submission comparison, run three WebMCP-capable models against seeds 17, 42, and 81 in Judge Mode. Export the RL trajectory after each run and report completion, final score, rejected calls, tool count, median/p95 call latency, emergency decision latency, passenger injuries, route rebuilds, and touchdown quality.

Do not mix deterministic-reference results into the model leaderboard. A model run is valid only when every flight action appears in the exported WebMCP call log.
