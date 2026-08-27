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
inspect_flight_evidence
set_route
set_autopilot_targets
configure_aircraft
request_human_approval
wait_for_flight_event
transfer_control
```

A normal agent flight is intentionally short but procedural:

1. Call `start_flight` with seed 17, 42, or 81.
2. Fly the normal departure, responding to `configuration_required` events for gear and flap cleanup.
3. Wait for `emergency_detected`; the scenario and evidence change only after that event.
4. Inspect the new weather, cockpit, traffic, and passenger evidence, then call `set_route` with `return_kpwk` and explain the choice.
5. Follow each configuration checkpoint through base, final, and landing, then wait for touchdown and mission completion instead of polling.

The intent-level tools make route and configuration decisions; the deterministic autopilot supplies the continuous control loop. The aircraft therefore keeps flying while a model is thinking or waiting for a human decision. Event waits return after at most 15 seconds and can be resumed from the returned monotonic revision.

The three seeds vary weather, engine health, traffic, and passenger urgency. These are decision evidence, while engine power and visibility also affect the running simulation and world. The current vertical slice deliberately models only the return to Chicago Executive runway 16; it does not pretend to simulate an unrendered diversion airport.

## Architecture

- React 19, TypeScript, Vite, Tailwind CSS, and Base UI
- Three.js procedural airport and aircraft rendering
- Renderer-independent TypeScript flight model and deterministic autopilot
- Native WebMCP imperative API backed by the same simulator used by the manual UI

This is an interactive product prototype, not a certified aviation-training device.
