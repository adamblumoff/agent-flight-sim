# Deterministic radio voice pack

The active fictional flight-radio clips were generated locally from the canonical
phrases in `src/audio/radioVoicePack.ts`. They are not recordings of real air
traffic controllers or real flights.

- Voice: Microsoft Zira Desktop
- Shipped playback: `ms_zira` for ATC. Copilot and onboard callouts remain text-only.

Some unused generated clips remain in this folder as source artifacts, but
`src/audio/radioVoicePack.ts` exposes only authoritative ATC transmissions.

The application ships the generated MP3 files only. It does not download or
execute the voice model in a player's browser or on Railway.
