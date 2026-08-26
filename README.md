# Agent Flight Sim

An in-browser shared cockpit where a human pilot and a browser agent operate the same aircraft through WebMCP. The page registers seven client-side flight tools. Every browser-agent call runs in the local simulator and leaves a visible receipt.

The flight model and controller run locally at 60 Hz. React renders cockpit state at 10 Hz, and Cesium reads the live aircraft position without routing frame updates through React. A WebMCP-capable browser agent can inspect the flight, configure the aircraft, set the flight director, and transfer control.

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

The current route runs from Chicago Executive Airport to Chicago Midway. Choose chase, cockpit, or free camera modes. The cockpit includes an engine-instability scenario and a semantic recorder that attributes each command to the human, agent, or simulator.

Ask the browser agent to brief the aircraft or give it a flight command. The agent discovers the registered tools and calls them directly in the page. Use **My controls** at any time to stop agent control immediately.

## WebMCP tools

The app registers these native `document.modelContext` tools:

```text
get_flight_state
get_flight_recorder
set_throttle
configure_aircraft
set_flight_director
transfer_control
trigger_training_scenario
```

The WebMCP panel reports registration state and records every external tool invocation, including read-only calls. The browser agent supplies the model and calls the tools.

## Stack

- React 19, TypeScript, Vite, Tailwind 4, and shadcn Base/Nova components
- CesiumJS with Google Photorealistic 3D Tiles and a GLB aircraft
- Native WebMCP imperative API backed by the shared tool registry
- A renderer-independent TypeScript simulation and flight controller

This is a procedural simulation prototype, not a certified aviation training tool.
