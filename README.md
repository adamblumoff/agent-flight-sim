# Flightdeck

Flightdeck is a browser-native shared-cockpit experiment. A human pilot and a browser agent operate the same lightweight emergency-flight simulation through WebMCP, with one explicit control owner at a time.

The aircraft model and autopilot run locally at 60 Hz. Three.js renders a compact procedural airport directly from the live simulator state, while React receives lower-frequency snapshots for instruments and the copilot interface. No map service, Cesium token, webhook, or backend is required.

## Run locally

```bash
npm install
npm run dev
```

Open the app in a browser that supports WebMCP. Browsers without `document.modelContext` retain the complete manual cockpit; only agent control is unavailable.

## Fly manually

| Input | Action |
| --- | --- |
| `W` / `S` | Pitch up or down |
| `A` / `D` | Bank left or right |
| `Up` / `Down` | Increase or decrease power |
| `F` | Cycle flaps |
| `G` | Toggle landing gear |
| `T` | Request, cancel, or reclaim agent control |

The on-screen gear, flaps, and power controls do the same work. Any direct pilot input immediately returns control to the human and disconnects the autopilot.

## Fly through WebMCP

The page registers these tools:

```text
start_flight
get_mission_brief
get_flight_state
get_decision_context
inspect_flight_evidence
set_route
begin_takeoff
set_autopilot_targets
rebuild_active_leg
configure_aircraft
request_human_approval
wait_for_flight_event
transfer_control
```

A normal agent flight is procedural and event-driven:

1. Call `start_flight` with seed 17, 42, or 81.
2. Before takeoff, call `set_route` with `continue_klak` and explain the preflight plan to Lakeside Municipal runway 22. Filing the route leaves the aircraft stopped.
3. Call `begin_takeoff` when the route is filed and the aircraft is ready to roll.
4. Respond to `configuration_required` and `checkpoint_reached` events while flying the normal route.
5. Wait for `emergency_detected`, then call `get_decision_context` once. It returns all evidence, fuel, passenger limits, and ranked KPWK/KLAK options. The 60-second agent decision clock starts when the event or context is delivered.
6. Choose `return_kpwk` or `continue_klak` and explain the tradeoff. The flight director holds a safe heading and altitude while the agent decides.
7. Follow each live checkpoint and configuration transition through base, final, and landing. If `route_progress_stalled` arrives, call `rebuild_active_leg` instead of allowing another orbit.

The intent-level tools make route and configuration decisions; the deterministic flight director supplies the continuous control loop. It holds runway heading through 400 feet AGL, limits commanded bank and roll rate, tracks fly-through gates, and uses an outbound intercept when the airplane reaches final pointed the wrong way. Explicit heading commands remain active until the agent resumes route mode. Event waits return after at most 15 seconds and can be resumed from the returned monotonic revision.

The minimap draws only the current aircraft-to-checkpoint leg and advances it when the aircraft crosses that fix's fly-through gate. The original destination is about 12.5 nautical miles away, so the emergency replaces a real preflight route rather than revealing a route that was hidden from the start.

The three seeds vary weather, engine health, traffic, and passenger urgency. Engine power and visibility affect the running simulation and world. Sustained G-load and abrupt changes accumulate passenger distress and deterministic injury risk, which are exposed in the live state and through `passenger_safety_update` events.

Run `npm run test:sim` for the deterministic route, timer, checkpoint, passenger-motion, and full-landing smoke test.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS, and Base UI
- Three.js procedural airport and aircraft rendering
- Renderer-independent TypeScript flight model and deterministic autopilot
- Native WebMCP imperative API backed by the same simulator used by the manual UI

This is an interactive product prototype, not a certified aviation-training device.
