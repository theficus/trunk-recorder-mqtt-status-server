# Copilot Instructions

## Project Overview

This is a Node.js dashboard that subscribes to MQTT messages from [tr-plugin-mqtt](https://github.com/TrunkRecorder/tr-plugin-mqtt) (trunk-recorder's MQTT status plugin) and serves a live status UI via Socket.IO. No database — all state is held in memory.

## Architecture

- **`server.js`** — Single-file Express server. Connects to MQTT, maintains per-`instance_id` state objects, and broadcasts updates to browsers via Socket.IO.
- **`public/`** — Vanilla HTML/CSS/JS frontend (no build step, no framework). `app.js` renders the dashboard by manipulating the DOM directly on each Socket.IO `update` event.
- **`setup.sh`** — Interactive installer that writes `.env` (chmod 600), installs deps, and optionally starts the server.
- **`run.sh`** — Sources `.env` then runs `node server.js`.

### Data flow

```
trunk-recorder → MQTT broker → server.js (state in memory) → Socket.IO → public/app.js
```

### State model

`server.js` stores a `instances` map keyed by `instance_id`. Each instance holds: `config`, `systems`, `rates`, `recorders`, `activeCalls`, `recentCalls`, `audioCalls`, `unitEvents`, `messages`, `pluginStatus`.

## Commands

```bash
npm start          # Start the server (requires .env or env vars)
./setup.sh         # Interactive setup (writes .env, installs deps)
./run.sh           # Sources .env and starts server
```

No test suite, linter, or build step exists.

## Conventions

- ES modules (`"type": "module"` in package.json) — use `import`, not `require`.
- All configuration is via environment variables (see `.env.example`).
- The frontend is plain vanilla JS with no bundler — just edit files in `public/` directly.
- Helper `pushCapped(arr, item, cap)` is used throughout to maintain bounded arrays (prevents memory growth).
- MQTT message type is determined by `msg.type` field or the last segment of the topic path.
- The `/healthz` endpoint returns MQTT connection status and known instance IDs.

## Requirements

- Node.js 18+
- An MQTT broker (Mosquitto, etc.)

## Reference Repositories

- [trunk-recorder](https://github.com/robotastic/trunk-recorder) — The radio recorder this dashboard monitors
- [trunk-recorder-status-server](https://github.com/TrunkRecorder/trunk-recorder-status-server) — The original WebSocket-based status server (this project is an MQTT-driven alternative)
- [tr-plugin-mqtt](https://github.com/TrunkRecorder/tr-plugin-mqtt) — The trunk-recorder plugin that publishes status/audio to MQTT (source of all data this dashboard consumes)
