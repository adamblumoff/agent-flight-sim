# Project instructions

- Build the intended product directly. Do not create disposable HTML-only or CSS-only prototypes.
- Treat linting, type-checking, builds, and deterministic simulator scripts as development diagnostics only. They may catch broken code, but they never count as a passed product test.
- Judge Mode acceptance requires a fresh, blind agent flight in the visible app using only the page-published WebMCP tools. Give the agent only the mission objective, keep the scenario sealed until its event, and preserve the exported WebMCP trajectory as evidence. Do not claim Judge Mode works from a scripted policy or direct simulator calls. Full Mission remains a manually evaluated experience and is outside this automated acceptance contract.
- For Judge Mode release readiness, require three consecutive successful blind WebMCP flights on fresh runs. A failure resets the streak.
- Keep the 60 Hz simulation and Three.js transforms outside React render state.
- Treat WebMCP as an optional browser capability. The simulator must remain usable when `document.modelContext` is unavailable.
