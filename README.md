# Agent Flight Sim

An in-browser shared cockpit where a human pilot and a streaming AI copilot operate the same aircraft. The embedded copilot and optional WebMCP surface share one flight-tool registry, so every command reaches the same local simulator and produces an attributed receipt.

The simulator runs its flight model and controller locally at 60 Hz. React renders cockpit state at 10 Hz, and Cesium reads the live aircraft position without routing frame updates through React. The AI issues discrete commands such as setting the flight director, configuring the aircraft, or transferring control.

## Run it

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and configure both services:

```text
VITE_CESIUM_ION_TOKEN=your_public_browser_token
OPENAI_API_KEY=your_server_only_openai_key
```

The Cesium token loads Google Photorealistic 3D Tiles in the browser. The OpenAI key stays on the Hono server and powers the streaming conversation at `/api/chat`. When either value is missing, the corresponding world or copilot panel shows an explicit setup error instead of silently degrading.

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

Ask the copilot questions without handing over control. For action, tell it what to change or explicitly hand off the aircraft. Use **My controls** at any time to stop agent control immediately.

## WebMCP tools

The app registers these native `document.modelContext` tools when the browser supports WebMCP:

```text
get_flight_state
get_flight_recorder
set_throttle
configure_aircraft
set_flight_director
transfer_control
trigger_training_scenario
```

WebMCP remains experimental. The simulator continues to work when `document.modelContext` is unavailable.

## Stack

- React 19, TypeScript, Vite, Tailwind 4, and shadcn Base/Nova primitives
- Vercel AI Elements with AI SDK 7, OpenAI, and a Hono streaming server
- CesiumJS with Google Photorealistic 3D Tiles and a GLB aircraft
- Native WebMCP imperative API backed by the shared tool registry
- A renderer-independent TypeScript simulation and flight controller

This is a procedural simulation prototype, not a certified aviation training tool.
