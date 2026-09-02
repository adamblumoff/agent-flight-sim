# Can an Agent Be a Pilot?

Can an Agent Be a Pilot? is a real-time browser flight simulator that tests whether an agent can fly over time, respond to a sealed mid-flight emergency, and land safely through WebMCP. Manual and agent pilots use the same simulator and command layer, selected at the start of each run.

**Live app:** [agent-flight-sim-production.up.railway.app](https://agent-flight-sim-production.up.railway.app/)

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `start_flight` | Start a fresh agent flight and return the mission brief. |
| `program_flight_plan` | Set ordered flight commands and their activation conditions. |
| `request_diversion` | Request one of the routes available in the current situation. |
| `accept_clearance` | Accept the issued diversion clearance. |
| `wait_for_flight_event` | Let the flight continue and return when the state materially changes. |

The simulator runs at 60 Hz while the agent reasons. It reveals the emergency only when it occurs and exports an `agent-flight-run-v2` trajectory containing observations, actions, results, latency, score changes, and the terminal outcome.

## Run locally

```bash
npm install
npm run dev
```

Choose manual or agent mode on the start screen. Manual controls are `W/S` pitch, `A/D` bank, arrow keys power, `F` flaps, `G` gear, and `X` level attitude. WebMCP is optional, so manual mode remains usable in browsers without `document.modelContext`.

## Verify

```bash
npm run lint
npm run build
npm run diagnostic:sim
npm run diagnostic:radio
```

A product evaluation uses a fresh visible app and a fresh agent given only: `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.` The agent must use only the page-published WebMCP tools. A run passes when the aircraft lands and the exported trajectory contains the complete interaction; release readiness requires three consecutive passing blind runs.

This is an interactive research prototype, not a certified aviation-training device.
