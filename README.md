# Flightdeck

Flightdeck is a browser-native evaluation environment where a human and a browser agent share control of a live emergency-flight simulator through WebMCP. The core question is simple: can an agent observe a changing world, make a defensible plan, operate safely over time, and recover when that plan stops working?

**Live app:** [agent-flight-sim-production.up.railway.app](https://agent-flight-sim-production.up.railway.app/)

The aircraft and autopilot run locally in a deterministic 60 Hz fixed-step loop. Three.js renders a procedural airport from the same state exposed to WebMCP. React receives lower-frequency snapshots for instruments and the copilot UI. No map service, Cesium token, webhook, or backend is required.

## Why it is an RL environment

Every WebMCP call forms a transition:

```text
observation → tool action → simulator transition → reward delta → next observation
```

After a terminal state, the app exports both a clean WebMCP call list and a separate `flightdeck-trajectory-v1` JSON file containing observations, actions, results, per-step score changes, latency, terminal flags, final score, and outcome. Seeds 17, 42, and 81 vary weather, engine health, traffic, and passenger urgency while preserving reproducibility.

Judge Mode is a three-minute real-time evaluation. It uses the same aircraft dynamics, scoring, tools, and landing envelope as the full mission, but runs the fixed-step simulation at 3× and uses one turn checkpoint plus base and final. Full Mission remains a ten-minute 1× run.

## Architecture

```mermaid
flowchart LR
  Agent[Browser agent] -->|WebMCP tools| Adapter[Typed tool adapter]
  Human[Human pilot] -->|Keyboard and cockpit UI| Simulator[60 Hz flight simulator]
  Adapter --> Simulator
  Simulator -->|immutable snapshots| Adapter
  Simulator -->|10 Hz UI snapshots| React[React cockpit]
  Simulator -->|interpolated transforms| Three[Three.js world]
  Adapter --> Trace[Live call trace]
  Trace --> Export[WebMCP log + RL trajectory]
```

The WebMCP adapter is optional. Browsers without `document.modelContext` retain the complete manual cockpit; only agent control is unavailable.

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `start_flight` | Start seed 17, 42, or 81 in `full` or `judge` mode and take copilot control. |
| `get_mission_brief` | Read airports, runways, route choices, deadline, and landing criteria. |
| `get_flight_state` | Read aircraft, navigation, weather, wind, passengers, configuration, score, and route progress. |
| `get_decision_context` | Read all emergency evidence, comfort limits, fuel, decision time, and ranked route options. |
| `inspect_flight_evidence` | Read one or all weather, cockpit, traffic, and passenger reports. |
| `set_route` | File the preflight route or select the emergency route with a reason. |
| `begin_takeoff` | Begin the takeoff roll after route filing. |
| `set_autopilot_targets` | Set persistent heading, altitude, speed, and vertical/lateral modes. |
| `rebuild_active_leg` | Recover a stalled route with a direct intercept, wider pattern, or safe skip. |
| `configure_aircraft` | Set gear and A380-style flap detents; unsafe phase changes are rejected. |
| `request_human_approval` | Pause a consequential decision while the aircraft keeps flying. |
| `wait_for_flight_event` | Wait without polling for checkpoints, emergencies, configuration, landing, or failure. |
| `transfer_control` | Accept a requested handoff or return control to the pilot. |

The live copilot panel displays tool name, reason, completion state, call latency, summary, and reward change. This makes agent behavior judgeable without opening developer tools.

## Reward and termination

Each episode starts at 100 points. Deductions are event-based and individually listed in the terminal debrief: late emergency decisions, overtime, incorrect configuration, excessive G-load, abrupt control input, hard/off-center landings, and crashes. Passenger distress and deterministic injury probability are separate environment state. Episodes terminate on a safe stop, unsafe touchdown, crash, or fuel exhaustion.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL in a WebMCP-capable browser. Choose Judge Mode for a submission demo or Full Mission for the complete operational episode.

Manual controls: `W/S` pitch, `A/D` bank, arrow keys power, `F` flaps, `G` gear, `X` level attitude, and `T` request/cancel/reclaim agent control. Any direct human flight input immediately overrides the agent.

## Verification

```bash
npm run lint
npm run build
npm run test:sim
npm run benchmark
```

`test:sim` covers wind, drag, stall behavior, takeoff, timer semantics, checkpoints, route recovery, passenger comfort, all three full-mission seeds, both emergency destinations, and all three Judge Mode seeds. See [BENCHMARK.md](./BENCHMARK.md) for the baseline and the 3-model × 3-seed protocol.

## Submission evidence

- Public deployment: Railway URL above.
- Source license: [MIT](./LICENSE).
- Reproducible environment: three fixed seeds and terminal JSON exports.
- Challenge-period history: the repository commit log records the WebMCP tool contract, event waits, route recovery, safety scoring, audio, exports, Judge Mode, and submission documentation as separate commits.

Flightdeck is an interactive research prototype, not a certified aviation-training device.
