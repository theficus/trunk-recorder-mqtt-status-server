# Copilot Instructions

## Project Overview

This is a Node.js dashboard that subscribes to MQTT messages from [tr-plugin-mqtt](https://github.com/TrunkRecorder/tr-plugin-mqtt) (trunk-recorder's MQTT status plugin) and serves a live status UI via Socket.IO. No database — all state is held in memory.

### Why this exists

The original [trunk-recorder-status-server](https://github.com/TrunkRecorder/trunk-recorder-status-server) (and its companion `tr-plugin-websocket-server`) relied on Boost.Beast WebSockets compiled into trunk-recorder. Starting with trunk-recorder v4.7+/v5, changes to the Boost dependencies broke that WebSocket interface entirely ([issue #4](https://github.com/TrunkRecorder/tr-plugin-websocket-server/issues/4)). This dashboard replaces that approach — it consumes data from the standalone [tr-plugin-mqtt](https://github.com/TrunkRecorder/tr-plugin-mqtt) plugin (which uses the Paho MQTT library, not Boost) and requires no WebSocket support in trunk-recorder itself.

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
- UI changes should update the demo screenshot (`docs/images/dashboard-demo.png`) and include it with the PR.
- Helper `pushCapped(arr, item, cap)` is used throughout to maintain bounded arrays (prevents memory growth).
- MQTT message type is determined by `msg.type` field or the last segment of the topic path.
- The `/healthz` endpoint returns MQTT connection status and known instance IDs.

## Requirements

- Node.js 18+
- An MQTT broker (Mosquitto, etc.)

## Reference Repositories

- [trunk-recorder](https://github.com/robotastic/trunk-recorder) — The radio recorder this dashboard monitors
- [trunk-recorder-status-server](https://github.com/TrunkRecorder/trunk-recorder-status-server) — The original WebSocket-based status server (**broken** since trunk-recorder v4.7+/v5 due to Boost changes; this MQTT dashboard is the replacement)
- [tr-plugin-mqtt](https://github.com/TrunkRecorder/tr-plugin-mqtt) — The trunk-recorder plugin that publishes status/audio to MQTT (source of all data this dashboard consumes)

## trunk-recorder config.json example

The MQTT plugin is configured inside trunk-recorder's `config.json`. Here is an example showing the plugin section alongside minimal sources/systems config:

```json
{
    "ver": 2,
    "instanceId": "my-scanner",
    "sources": [{
        "center": 855700000,
        "rate": 2048000,
        "error": 0,
        "gain": 42,
        "digitalRecorders": 4,
        "driver": "osmosdr"
    }],
    "systems": [{
        "control_channels": [855462500],
        "type": "p25",
        "shortName": "my-system",
        "modulation": "qpsk"
    }],
    "plugins": [{
        "name": "MQTT Status",
        "library": "libmqtt_status_plugin.so",
        "broker": "tcp://your-broker:1883",
        "topic": "trunk-recorder",
        "unit_topic": "trunk-recorder/units",
        "message_topic": "trunk-recorder/messages",
        "mqtt_audio": false,
        "mqtt_audio_type": "m4a",
        "qos": 0,
        "console_logs": true,
        "username": "",
        "password": ""
    }]
}
```

Key points:
- `instanceId` at the top level maps to the `instance_id` field this dashboard uses to separate multiple recorders.
- The plugin `broker` uses `tcp://` (not `mqtt://`); this dashboard's `MQTT_URL` uses `mqtt://` — both connect to the same broker.
- `topic`, `unit_topic`, and `message_topic` must match the dashboard's `MQTT_TOPIC`, `MQTT_UNIT_TOPIC`, and `MQTT_MESSAGE_TOPIC` env vars.
