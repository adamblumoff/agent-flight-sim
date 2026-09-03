# Can an Agent Fly a Plane?

Can an Agent Fly a Plane? is a real-time browser flight simulator that tests whether an agent can take off, respond to a sealed mid-flight emergency, and land safely through WebMCP. The aircraft keeps flying while the agent reasons.

**Live app:** [agent-flight-sim-production.up.railway.app](https://agent-flight-sim-production.up.railway.app/)

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `read_pilot_manual` | Read the aircraft limits and the exact command contract without revealing the sealed scenario. |
| `start_flight` | Start a fresh agent flight and return the mission brief. |
| `program_flight_plan` | Author ordered flight commands for pitch or altitude, lateral guidance, speed or throttle, gear, and flaps. |
| `request_diversion` | Ask simulated ATC for one of the routes available after the emergency. |
| `accept_clearance` | Read back and accept the issued diversion clearance. |
| `wait_for_flight_event` | Wait for a material flight event without pausing the aircraft. |

## How it works

The simulator and Three.js scene run continuously at 60 Hz outside React render state. WebMCP is the agent's control channel. The initial mission brief assigns the route and publishes its checkpoints, but it does not prescribe how to fly them.

The agent reads the aircraft manual, then submits a program of exact commands and activation conditions. The simulator applies the active command while the agent thinks or waits. When the emergency occurs, the agent receives the newly unsealed evidence, requests a route from simulated ATC, accepts the clearance, and replaces its command program. Route progress survives that replacement.

The app exports an `agent-flight-run-v2` trajectory with the agent's observations, tool calls, results, latency, score changes, and terminal outcome. WebMCP remains optional, so a person can fly manually in a browser without `document.modelContext`.

## Run locally

```bash
npm install
npm run dev
```

Choose manual or agent mode on the start screen. Manual controls are `W/S` pitch, `A/D` bank, arrow keys power, `F` flaps, `G` gear, and `X` level attitude.

## Testing instructions

No account or credentials are required.

1. Open the [live app](https://agent-flight-sim-production.up.railway.app/) in ChatGPT's in-app browser.
2. Give the agent one instruction: `Fly the plane.`
3. Let the run continue without pausing or refreshing the page. A complete evaluation takes about six minutes.
4. The agent should discover the page-published tools, read the pilot manual, start the flight, program the assigned Midway departure, respond to the sealed emergency, accept an ATC clearance, replace its command program, and land.
5. After the run, check the score and download the WebMCP trajectory from the debrief.

## Verify

```bash
npm run lint
npm run build
npm run diagnostic:sim
npm run diagnostic:radio
```

A product evaluation uses a fresh visible app and a fresh agent given only the mission objective. The agent must use the page-published WebMCP tools. A run passes when the aircraft lands and the exported trajectory contains the complete interaction. Release readiness requires three consecutive passing blind runs.

See the [three blind production evaluations](evaluation-runs/README.md): all three passed with a mean score of 100/100.

This is an interactive research prototype, not a certified aviation-training device.
