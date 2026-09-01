# Flightdeck benchmark

## Model matrix protocol

Run WebMCP-capable models as fresh agents against the same root flight. Each agent receives only `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.` The environment privately selects the scenario and reveals the new condition only through its in-flight WebMCP event.

Export the `flightdeck-trajectory-v2` file after each run. Report completion, final score, rejected calls, tool count, median and p95 call latency, event-decision latency, passenger injuries, route rebuilds, and touchdown quality.

Do not mix deterministic-reference results into the model leaderboard. A model run is valid only when every flight action appears in the exported WebMCP trajectory and the agent had no other control channel. Follow [EVALUATION.md](./EVALUATION.md).
