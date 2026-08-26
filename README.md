# Agent Flight Sim

An in-browser shared cockpit where a human pilot and a browser agent operate the same aircraft through WebMCP. The page registers four client-side flight tools. Every browser-agent call runs in the local simulator and leaves a visible receipt.

The flight model and controller run locally at 60 Hz. React renders cockpit state at 10 Hz, and Cesium reads the live aircraft position without routing frame updates through React. A WebMCP-capable browser agent reads the mission, issues phase-level commands, and transfers control. The browser handles continuous aircraft control between calls.

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

The mission is a compact traffic pattern at Chicago Executive Airport. It includes takeoff, climb, crosswind, downwind, base, final, landing, and rollout. Choose chase, cockpit, or free camera modes. The semantic recorder attributes each command to the human, agent, or simulator.

Ask the browser agent to brief the mission, take control, and fly the pattern. The agent discovers the registered tools and calls them directly in the page. Each command returns the resulting mission state and legal next commands, so the agent does not need a separate state read after every write. Use **My controls** at any time to stop agent control immediately.

## WebMCP tools

The app registers these native `document.modelContext` tools:

```text
get_mission_brief
get_flight_state
command_flight
transfer_control
```

`get_mission_brief` describes the runway, named fixes, leg constraints, success rules, and legal first commands. `get_flight_state` reports the aircraft and mission navigation state. `command_flight` accepts bounded commands such as `takeoff`, `proceed_to_fix`, `begin_approach`, `land`, and `go_around`. `transfer_control` moves authority between the pilot and agent.

The WebMCP panel reports registration state and records every external tool invocation, including read-only calls. The browser agent supplies the model and calls the tools. Browsers without `document.modelContext` keep the manual cockpit but do not register agent controls.

## Stack

- React 19, TypeScript, Vite, Tailwind 4, and shadcn Base/Nova components
- CesiumJS with Google Photorealistic 3D Tiles and a GLB aircraft
- Native WebMCP imperative API backed by the shared tool registry
- A renderer-independent TypeScript simulation and flight controller

This is a procedural simulation prototype, not a certified aviation training tool.
