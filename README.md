# Agent Flight Sim

An in-browser AI checkride where a human pilot and a browser agent operate the same aircraft through WebMCP. Every browser-agent call runs in the local simulator and leaves a visible receipt.

The flight model and controller run locally at 60 Hz. React renders cockpit state at 10 Hz, and Cesium reads the live aircraft position without routing frame updates through React. A seeded scenario director introduces weather, traffic, fuel, aircraft, and passenger problems. The browser agent inspects separate evidence sources, makes a scored decision, and waits for the next meaningful event without polling.

## Run it

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add a Cesium ion browser token:

```text
VITE_CESIUM_ION_TOKEN=your_public_browser_token
```

The token loads Google Photorealistic 3D Tiles. Restrict production tokens by asset and URL in Cesium ion.

Open the app in ChatGPT's in-app browser, which supports WebMCP, or enable `chrome://flags/#enable-webmcp-testing` in Chrome. Browsers without WebMCP can still use every manual flight control.

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Pitch up or down |
| `A` / `D` | Bank left or right |
| `↑` / `↓` | Increase or decrease throttle |
| `F` | Cycle flaps |
| `G` | Toggle landing gear |
| `T` | Transfer flight control |

The mission is a short deteriorating arrival at Chicago Executive Airport. Seeds 17, 42, and 81 preserve the same objective but change the safest response. Choose chase, cockpit, or free camera modes. The semantic recorder attributes each command to the human, agent, or simulator.

Ask the browser agent to start a seed, brief the mission, take control, and fly. When the scenario changes, the agent can inspect weather, cockpit, traffic, and passenger reports before choosing a response. Seed 42 requires a human to approve or deny the risky priority approach. Use **My controls** at any time to stop agent control immediately.

## WebMCP tools

The app registers these native `document.modelContext` tools:

```text
start_checkride
get_mission_brief
get_flight_state
inspect_flight_evidence
wait_for_flight_event
command_flight
decide_checkride
transfer_control
```

`start_checkride` resets a reproducible seed. `get_mission_brief` describes the objective, runway, constraints, evidence sources, and legal first command. `inspect_flight_evidence` reads one source after an alert. `command_flight` accepts bounded commands such as `takeoff`, `proceed_to_fix`, `begin_approach`, `land`, and `go_around`. `decide_checkride` records the agent's risk decision. `transfer_control` moves authority between the pilot and agent.

`wait_for_flight_event` is a bounded asynchronous request. Its Promise resolves when the local simulator emits a matching revision such as `system_alert`, `command_required`, `touchdown`, or `mission_complete`. Waits default to 12 seconds and never exceed 15 seconds, which keeps them inside the browser call deadline. `command_flight` also accepts `wait_until_decision: true`. The simulator does not need a webhook because the page already owns these events.

The WebMCP panel reports registration state and records every external tool invocation, including read-only calls. The browser agent supplies the model and calls the tools. Browsers without `document.modelContext` keep the manual cockpit but do not register agent controls.

## Stack

- React 19, TypeScript, Vite, Tailwind 4, and shadcn Base/Nova components
- CesiumJS with Google Photorealistic 3D Tiles and a GLB aircraft
- Native WebMCP imperative API backed by the shared tool registry
- A renderer-independent TypeScript simulation and flight controller

This is a procedural simulation prototype, not a certified aviation training tool.
