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

Keyboard, cockpit controls, and WebMCP all reach the same flight-command layer. Each run starts in either manual or agent mode, and that choice stays fixed until reset. A human supplies direct inputs; an agent declares exact, ordered heading or bank, pitch or altitude, throttle or airspeed, gear, and flap commands with activation triggers. The simulator executes those commands at 60 Hz and applies the same actuator limits, aircraft physics, checkpoints, collision rules, and score deductions in both modes.

WebMCP reports every value that can change a cockpit decision: position, attitude, speed, vertical motion, wind, configuration, route geometry, active checkpoint, aircraft limits, passenger condition, hazards, score, event revision, and terminal state. It does not reveal the sealed event before the simulator triggers it. It also does not prescribe the next tool call or silently turn a dangerous input into a safe maneuver.

The WebMCP adapter is optional. Browsers without `document.modelContext` retain the complete manual cockpit.

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `start_flight` | Select agent mode for a fresh flight and receive the mission brief and initial state. |
| `program_flight_plan` | Declare 2–16 exact control commands and the flight conditions that activate them. |
| `request_diversion` | Ask ATC for one of the routes in the current decision context. |
| `accept_clearance` | Read back and accept the issued diversion clearance. |
| `wait_for_flight_event` | Wait without polling while the program keeps flying; every response includes current state, and the emergency event includes its newly unsealed decision context. |

The live copilot panel shows the tool, reason, result, latency, summary, and reward change. Guidance reports the current objective, procedures, hazards, mechanical limits, available actions, and event revision. It does not include filled answers or a preferred tool sequence.

WebMCP calls are request/response rather than a transport-level telemetry stream. The agent makes the piloting decisions up front as exact commands; the simulator continues flying those commands at 60 Hz during every wait and during the agent's reasoning time. New events return the current aircraft state so the agent can replace the program when conditions change.

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

Open the root local URL and choose manual or agent flight. Manual controls are `W/S` pitch, `A/D` bank, arrow keys power, `F` flaps, `G` gear, and `X` level attitude. The selected pilot keeps control until the flight is reset. Browsers without WebMCP can still run the complete manual flight.

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
