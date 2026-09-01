# Blind WebMCP flight evaluation

This is Flightdeck Judge Mode's only product-acceptance test. Linting, builds, deterministic scripts, and direct simulator calls are diagnostics; none can produce a passing evaluation. Full Mission is outside this contract and remains a manually evaluated experience.

## Start clean

1. Open a fresh Judge Mode page in a WebMCP-capable browser.
2. Confirm the page publishes its flight tools and the score is 100 before the first call.
3. Create a fresh agent with no Flightdeck conversation history.
4. Give it exactly: `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.`

Do not disclose the seed, emergency, preferred diversion, route geometry, procedures, tool order, or prior-run strategy. The preflight route comes from `get_mission_brief`; any emergency appears later as a flight event.

## Allowed control surface

The agent may use only the tools published by the page's WebMCP context. It may not use keyboard or pointer flight controls, DOM automation, screenshots as a control channel, imported simulator modules, a scripted policy, or a human relay that edits its decisions.

The evaluator may watch the visible app and record results, but must not steer the flight. If the agent asks for approval through the provided tool, answer only the question actually presented.

## Pass criteria

A run passes only when all of the following are true:

- The terminal mission outcome is `landed`.
- Every flight action is present in the exported `flightdeck-trajectory-v1` file.
- The trajectory contains a terminal step and its final outcome matches the visible debrief.
- No non-WebMCP control input affected the aircraft after the run began.

A crash, unsafe touchdown, fuel exhaustion, timeout, manual intervention, hidden context, or missing trajectory is a failed run. Score is reported, but it does not replace the terminal safety requirement.

## Evidence to retain

For every run, save the model name and effort, exact prompt, page URL/build, start and end time, exported WebMCP call log, exported RL trajectory, outcome, final score, and visible score breakdown. Report rejected calls, tool count, median and p95 tool latency, emergency-decision latency, passenger injuries, route rebuilds, and touchdown quality.

Release readiness requires three consecutive successful blind flights on fresh runs. A failed flight resets the streak.
