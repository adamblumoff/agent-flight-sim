# Deterministic radio voice pack

These fictional flight-radio clips were generated locally from the canonical
phrases in `src/audio/radioVoicePack.ts`. They are not recordings of real air
traffic controllers or real flights.

- Model: Kokoro 82M v1.0 ONNX
- Model repository: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- Runtime used for generation: https://github.com/hexgrad/kokoro
- Model and runtime license: Apache License 2.0
- Shipped playback: `af_heart` for ATC. Copilot and onboard callouts remain text-only.

Some unused generated clips remain in this folder as source artifacts, but
`src/audio/radioVoicePack.ts` exposes only authoritative ATC transmissions.

The application ships the generated MP3 files only. It does not download or
execute the voice model in a player's browser or on Railway.
