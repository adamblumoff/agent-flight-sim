# Agent Flight Sim

An in-browser flight simulator where a human pilot and an AI copilot operate the same aircraft through WebMCP.

The agent does not drive the physics loop. It observes structured flight state and issues high-level commands—configure the aircraft, run a checklist, hold a heading, or take control—while a deterministic local controller flies the aircraft in real time.

## Initial scope

- One light aircraft
- One polished A-to-B flight
- Browser-rendered terrain and cockpit instruments
- Explicit human/agent control handoffs
- A small set of high-value WebMCP tools
- A semantic flight recorder for replay and post-flight review

## Architecture

```text
Human pilot ───────────────┐
                           v
                    Flight simulation <─── Local controller @ 60 Hz
                           ^
                           │
AI copilot ── WebMCP tools ┘
```

The WebMCP surface should expose intent rather than frame-level controls. Likely tools include:

```text
get_flight_state
get_checklist_state
configure_aircraft
set_flight_director
transfer_control
trigger_training_scenario
```

## First demo

1. The human hand-flies takeoff while the agent handles the checklist and aircraft configuration.
2. The human transfers control for cruise.
3. The agent responds to an abnormal event with visible, logged actions.
4. The agent returns control and talks the human through the approach and landing.
5. A post-flight timeline shows what each participant did and why.

## Non-goals

- FAA-certified training
- Airliner-level systems fidelity
- An LLM directly controlling pitch and roll every frame
- A general-purpose world simulator in the first release

The project is currently in the design and prototyping stage.
