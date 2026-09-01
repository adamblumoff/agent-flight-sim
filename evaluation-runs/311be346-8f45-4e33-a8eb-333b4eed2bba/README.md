# Judge Mode post-run evidence

Run ID: `311be346-8f45-4e33-a8eb-333b4eed2bba`

Pilot: `gpt-5.6-terra` at low reasoning effort. Prompt: `Use [@Browser](plugin://browser@openai-bundled) to land the plane safely.`

This run was a blind Judge Mode flight operated through the page-published WebMCP tools. The simulator did not produce a terminal debrief or expose its in-page export links before the browser session was torn down, so a complete app-exported WebMCP call log / trajectory payload was not recoverable after the run. The accompanying files preserve the observed tool sequence and final available telemetry without fabricating an export.

Terminal metadata: mode `judge`; elapsed simulation time `219.45 s`; score `88`; outcome remained `in_progress`; debrief status `in_progress`; selected diversion `return_kstl`; destination runway `KSTL 30L`; gear down; final guidance active; 1.439 NM to KSTL final and 0.830 NM to threshold at the last observation. The Judge 180-second window had already deducted 12 points while the aircraft had not reached `KSTL_FINAL`.
