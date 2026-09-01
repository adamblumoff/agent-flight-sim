# Blind WebMCP flight evaluation

This is Flightdeck's product acceptance test. Linting, builds, deterministic scripts, and direct simulator calls are diagnostics. None can produce a passing evaluation.

## Start clean

1. Open a fresh root page in a WebMCP-capable browser.
2. Confirm the page publishes its flight tools and the score is 100 before the first call.
3. Create a fresh agent with no Flightdeck conversation history.
4. Give it exactly: `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.`

Do not disclose the seed, sealed event, preferred route change, route geometry, procedures, tool order, or prior-run strategy. The agent must read its assigned preflight plan from `get_mission_brief`. The simulator reveals new conditions only after their in-flight event.

## Allowed control path

The agent may use only tools published by the page's WebMCP context. It may not use keyboard or pointer flight controls, DOM automation, screenshots as a control channel, imported simulator modules, a scripted policy, or a human relay that edits its decisions.

The evaluator may watch the visible app and record results but must not steer the flight. If the agent calls `request_human_approval`, answer only the question it presents.

The agent receives the same decision-relevant cockpit state as the human pilot, except rendered scene pixels. Human and WebMCP commands must pass through the same simulator command path. Control ownership must not alter physics, checkpoint capture, collision handling, score deductions, or route acceptance.

## Pass criteria

A run passes only when all of these statements are true:

- The terminal mission outcome is `landed`.
- Every flight action is present in the exported `flightdeck-trajectory-v2` file.
- The trajectory contains a terminal step and its final outcome matches the visible debrief.
- No non-WebMCP input affected the aircraft after the run began.
- The agent received no future condition before its event revision.

A crash, unsafe touchdown, fuel exhaustion, timeout, manual intervention, hidden context, or missing trajectory fails the run. Score is reported, but it does not replace the terminal safety requirement.

## Evidence to retain

For every run, save the model and effort, exact prompt, page URL and build, start and end time, exported WebMCP call log, exported RL trajectory, outcome, final score, and visible score breakdown. Report rejected calls, tool count, median and p95 tool latency, event-decision latency, passenger injuries, route rebuilds, and touchdown quality.

Release readiness requires three consecutive successful blind flights on fresh runs. A failed flight resets the streak.
