# Project instructions

- Build the intended product directly. Do not create disposable HTML-only or CSS-only prototypes.
- Keep automated testing targeted and lightweight. Adam will test the application manually and ruthlessly. Prioritize type-checking, production builds, and physical browser QA. Add tests only for deterministic logic that is difficult to verify manually or for a specific regression.
- Keep the 60 Hz simulation and Cesium updates outside React render state.
- Treat WebMCP as an optional browser capability. The simulator must remain usable when `document.modelContext` is unavailable.

