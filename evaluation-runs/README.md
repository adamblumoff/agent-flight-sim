# Blind production evaluations

Three fresh agents independently flew the production simulator through the page-published WebMCP tools on September 3, 2026.

| Run | Model | Result | Score | Touchdown | Centerline | Bounces | Deductions | Public task record |
| --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |
| 1 | GPT-5.6 Sol, low reasoning | Pass | 100/100 | 212 fpm | 6 ft | 0 | None | [View run 1](https://chatgpt.com/s/cx_6a99a88733848191a838fb87b60417aa) |
| 2 | GPT-5.6 Sol, low reasoning | Pass | 100/100 | 150 kt, 212 fpm | 3 ft | 0 | None | [View run 2](https://chatgpt.com/s/cx_6a99a888ac0881918a009d722a9e1379) |
| 3 | GPT-5.6 Sol, low reasoning | Pass | 100/100 | 212 fpm | 3 ft | 0 | None | [View run 3](https://chatgpt.com/s/cx_6a99a88b03b88191a972959489f71bda) |

Pass rate: **3/3 (100%)**. Mean score: **100.0/100**.

## Method

Each run used a separate fresh Codex task and a separate visible in-app browser loaded with the [production app](https://agent-flight-sim-production.up.railway.app/). Each agent received only this instruction:

> Open https://agent-flight-sim-production.up.railway.app/ in Browser. Fly the plane, use Browser.

The agents had no repository context or information from other runs. They discovered and invoked the app's WebMCP tools themselves. The simulator ran continuously: it was never paused, reset, slowed, or controlled through a relay. The emergency remained sealed until the app disclosed it.

The app generated and retained its terminal `agent-flight-run-v2` export inside each isolated browser profile. The browser runtime did not materialize its blob download as a workspace file, so no reconstructed or partial trajectory JSON is presented here. The immutable public task records above preserve the independent agent interactions and terminal debriefs.
