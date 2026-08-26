# Agent Flight Sim

An in-browser flight simulator where a human pilot and an AI copilot operate the same aircraft through WebMCP.

The simulator runs its flight model and controller locally at 60 Hz. React renders cockpit state at 10 Hz, and Cesium reads the live aircraft position without routing frame updates through React. The AI issues discrete commands such as setting the flight director, configuring the aircraft, or transferring control.

## Run it

```bash
npm install
npm run dev
```

The app works without external configuration by using Cesium's packaged Natural Earth imagery. To enable Cesium World Terrain and Google Photorealistic 3D Tiles, copy `.env.example` to `.env.local` and add a restricted Cesium ion token:

```text
VITE_CESIUM_ION_TOKEN=your_public_browser_token
```

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Pitch up or down |
| `A` / `D` | Bank left or right |
| `↑` / `↓` | Increase or decrease throttle |
| `F` | Cycle flaps |
| `G` | Toggle landing gear |
| `T` | Transfer flight control |

The current route runs from Chicago Executive Airport to Chicago Midway. The cockpit includes an engine-instability scenario and a semantic recorder that attributes each command to the human, agent, or simulator.

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

- React 19, TypeScript, and Vite
- CesiumJS with the official static-asset configuration
- Native WebMCP imperative API with `webmcp-types`
- A renderer-independent TypeScript simulation and flight controller

This is a procedural simulation prototype, not a certified aviation training tool.
