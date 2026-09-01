# Flightdeck

Flightdeck is a browser-native emergency-flight simulator built to test whether an agent can observe a changing world, fly over time, and recover when its original plan stops working. A human and a browser agent operate the same Boeing 787-9 Dreamliner through one command path. WebMCP gives the agent the same decision-relevant cockpit information shown to the human, except for rendered scene pixels.

**Live app:** [agent-flight-sim-production.up.railway.app](https://agent-flight-sim-production.up.railway.app/)

The simulator runs locally in a deterministic 60 Hz fixed-step loop. Three.js renders a procedural airport from the authoritative state. React receives lower-frequency snapshots for the instruments and copilot panel. No map service, Cesium token, webhook, or backend is required.

## The flight

The root URL starts one short, real-time 787-9 flight. The assigned preflight plan departs St. Louis Lambert for Chicago Midway. A sealed in-flight event may force the pilot to reconsider that plan and coordinate a return to Lambert. Every run uses the same aircraft profile, route builder, world clock, checkpoint rule, and scoring model.

The model represents a 787-9 at a 190,000 kg short-sector dispatch mass, below its design landing-weight limit. It uses a 62.8 m fuselage, 60.1 m span, twin 74,100 lbf-class engines, 377 m² lifting area, conventional high-lift devices, and a calculated sea-level lift model. For the modeled dry KSTL departure with light headwind, the representative card calls V1 at 145 kt, VR at 155 kt, and V2 at 165 kt with flaps 10°. Arrival guidance sequences flaps 10° on base, gear down/flaps 20° on final, and flaps 30° near a 145 kt approach target.

Dimensions, masses, engine families, and airport-planning performance come from Boeing's [787 technical specifications](https://www.boeing.com/commercial/787), [787 Airplane Characteristics for Airport Planning](https://www.boeing.com/commercial/airports/plan-manuals), and [787-9 three-view drawing](https://www.boeing.com/commercial/airports/3-view). Certified limits are cross-checked against [EASA type-certificate data sheet IM.A.115](https://www.easa.europa.eu/en/document-library/type-certificates/aircraft-cs-25-cs-22-cs-23-cs-vla-cs-lsa/easaima115-boeing-787). Exact V-speeds are load-, runway-, weather-, and configuration-dependent and would be calculated from approved operator data; the simulator's card is a representative value set for its declared dispatch condition, not dispatch data.

## One control contract

```mermaid
flowchart LR
  Human[Keyboard and cockpit UI] --> Commands[Shared flight commands]
  Agent[Browser agent] -->|WebMCP| Commands
  Commands --> Simulator[60 Hz flight simulator]
  Simulator --> Observation[Current cockpit observation]
  Observation --> Human
  Observation --> Agent
  Simulator --> Three[Three.js world]
  Agent --> Trace[WebMCP trajectory]
```

Keyboard, cockpit controls, and WebMCP all dispatch the same flight commands: throttle, pitch intent, bank intent, gear, and aircraft configuration. The simulator applies the same actuator limits, aircraft physics, checkpoints, collision rules, and score deductions regardless of who sent them. Caller identity exists for handoff and audit history, not for physics. Agents can use finite control windows that sample the continuously running simulation and neutralize the stick afterward; this changes command timing, not the aircraft model.

WebMCP reports every value that can change a cockpit decision: position, attitude, speed, vertical motion, wind, configuration, route geometry, active checkpoint, aircraft limits, passenger condition, hazards, score, event revision, and terminal state. It does not reveal the sealed event before the simulator triggers it. It also does not prescribe the next tool call or silently turn a dangerous input into a safe maneuver.

The WebMCP adapter is optional. Browsers without `document.modelContext` retain the complete manual cockpit.

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `start_flight` | Start a fresh flight with a privately selected scenario and take agent control. |
| `get_mission_brief` | Read the assigned preflight plan, procedures, aircraft limits, deadline, and landing criteria. |
| `get_flight_state` | Read the current cockpit observation and event revision. |
| `get_decision_context` | After the in-flight event, read the new evidence, hazards, fuel, decision time, and route options. |
| `inspect_flight_evidence` | Read current weather, cockpit, traffic, and passenger reports. |
| `set_route` | File the assigned preflight route with a reason. |
| `request_diversion` | Ask ATC for one of the routes in the current decision context. |
| `accept_clearance` | Read back and accept the issued diversion clearance. |
| `set_flight_controls` | Set persistent throttle, pitch, bank, gear, and configuration inputs. |
| `fly_control_window` | Apply a finite stick movement and receive sampled telemetry before the axes neutralize. |
| `rebuild_active_leg` | Request a direct intercept, wider pattern, or safe skip when route progress stalls. |
| `request_human_approval` | Ask the human about a consequential decision while the aircraft keeps flying. |
| `wait_for_flight_event` | Wait without polling for checkpoints, hazards, configuration changes, landing, or failure. |
| `transfer_control` | Accept a requested handoff or return control to the human pilot. |

The live copilot panel shows the tool, reason, result, latency, summary, and reward change. Guidance reports the current objective, procedures, hazards, mechanical limits, available actions, and event revision. It does not include filled answers or a preferred tool sequence.

WebMCP calls are request/response rather than a transport-level telemetry stream. `fly_control_window` makes that boundary useful for real-time control: the simulator continues at 60 Hz, captures observations during a 250–3000 ms maneuver, returns early for important events, and includes the sampled trajectory in its response. An agent can chain short windows into an observe–act loop without leaving pitch or bank latched while it reasons.

## Trajectories, reward, and termination

Each WebMCP call forms a transition:

```text
observation -> tool action -> simulator transition -> reward delta -> next observation
```

After a terminal state, the app exports a clean WebMCP call list and a `flightdeck-trajectory-v2` JSON file. The trajectory contains observations, actions, results, per-step score changes, latency, terminal flags, final score, and outcome. Seeds 17, 42, and 81 vary weather, engine health, traffic, and passenger urgency while keeping runs reproducible.

Each flight starts at 100 points. The debrief lists each deduction, including late decisions, overtime, incorrect configuration, excessive G-load, abrupt input, hard or off-center landings, and crashes. Passenger distress and deterministic injury probability remain separate environment state. A flight ends after a safe stop, unsafe touchdown, crash, or fuel exhaustion.

## Run locally

```bash
npm install
npm run dev
```

Open the root local URL in a WebMCP-capable browser. Manual controls are `W/S` pitch, `A/D` bank, arrow keys power, `F` flaps, `G` gear, `X` level attitude, and `T` request, cancel, or reclaim agent control. Direct human input immediately reclaims the shared controls.

## Development diagnostics

```bash
npm run lint
npm run build
npm run diagnostic:sim
npm run diagnostic:radio
```

These commands can catch type, build, and deterministic component regressions. They are not product tests because they do not exercise browser discovery, tool selection, reasoning latency, event handling, or recovery through WebMCP.

## Acceptance testing

A product test is a real flight by a fresh agent in the visible root app. The agent receives only `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.` and acts only through the page-published WebMCP tools. The scenario stays private until the in-flight event. The agent receives no seed, route answer, direct simulator access, keyboard input, DOM control, screenshot control channel, or scripted policy.

A run passes only when the aircraft reaches the terminal `landed` outcome and the exported `flightdeck-trajectory-v2` records every observation, WebMCP action, result, and terminal transition. Release readiness requires three consecutive passing blind flights on fresh runs. See [EVALUATION.md](./EVALUATION.md) for the protocol and [BENCHMARK.md](./BENCHMARK.md) for the reporting matrix.

Flightdeck is an interactive research prototype, not a certified aviation-training device.
