# trunk-recorder-dashboard

A small Node.js web server that subscribes to events from the
[`tr-plugin-mqtt`](https://github.com/TrunkRecorder/tr-plugin-mqtt) trunk-recorder
plugin and serves a live status dashboard in your browser. Inspired by
[`tr-plugin-websocket-server`](https://github.com/TrunkRecorder/tr-plugin-websocket-server),
but driven entirely off MQTT — no extra plugin needed inside trunk-recorder
besides the MQTT status plugin you already have.

![dashboard](docs/screenshot.png)

## Features

- Live decode rates per system
- Active calls table (talkgroup, tag, unit, length, flags)
- Recorders table (id, type, src/rec num, duration, state)
- Systems cards (sys_num, type, sysid, wacn, nac, rfss, site)
- Sources cards (driver, device, gain, ranges) from the retained `config` message
- **Audio playback** of completed calls (when `mqtt_audio: true`)
- Recent unit activity log
- Recently ended calls
- Multi-instance support via `instance_id`
- MQTT + WebSocket connection indicators

## Quick start

```bash
git clone https://github.com/YOUR_USER/trunk-recorder-dashboard.git
cd trunk-recorder-dashboard
./setup.sh
```

The script prompts for your broker URL, credentials, topic prefixes, and HTTP
port, installs dependencies, writes a `.env`, and starts the server.

Non-interactive:

```bash
MQTT_URL=mqtt://broker.local:1883 \
MQTT_USERNAME=user MQTT_PASSWORD=pass \
MQTT_TOPIC=trunk-recorder \
MQTT_UNIT_TOPIC=trunk-recorder/units \
./setup.sh --no-prompt
```

Install only (no auto-start):

```bash
./setup.sh --no-start
```

After install:

```bash
./run.sh                  # loads .env and starts the server
npm start                 # same thing, without .env auto-load
```

Then open [http://localhost:3000](http://localhost:3000).

## Configuration

`setup.sh` writes a `.env` (chmod 600) that `run.sh` sources at start.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MQTT_URL` | `mqtt://localhost:1883` | Broker URL (`mqtt://`, `mqtts://`, `ws://`, `wss://`) |
| `MQTT_USERNAME` | – | Optional |
| `MQTT_PASSWORD` | – | Optional |
| `MQTT_TOPIC` | `trunk-recorder` | Match `topic` in your plugin config |
| `MQTT_UNIT_TOPIC` | `trunk-recorder/units` | Match `unit_topic` |
| `MQTT_MESSAGE_TOPIC` | `trunk-recorder/messages` | Match `message_topic` (if set) |
| `MQTT_AUDIO_ENABLED` | `false` | Enable subscription to `<topic>/audio` and on-disk caching |
| `RECORDINGS_DIR` | `./recordings` | Where audio files are written (served at `/recordings/`) |
| `AUDIO_RETENTION` | `100` | Max recent audio entries to keep (older files are pruned) |

## Audio playback

Set `mqtt_audio: true` in the trunk-recorder plugin config and
`MQTT_AUDIO_ENABLED=true` in the dashboard. The dashboard subscribes to
`<MQTT_TOPIC>/audio`, decodes `audio_wav_base64` / `audio_m4a_base64` to files
under `RECORDINGS_DIR`, and serves them with an `<audio>` player in the
"Recent Audio" section.

> ⚠️ Audio messages are large (a 30s WAV is ~700 KB base64). Make sure your
> broker's `message_size_limit` is high enough. Mosquitto: set
> `message_size_limit 10485760` (or larger) in `mosquitto.conf`.

## trunk-recorder plugin config

Add this to your `trunk-recorder` `config.json` (`broker` URL uses `tcp://`,
the dashboard uses `mqtt://`; both go to the same broker):

```json
{
  "plugins": [
    {
      "name": "MQTT Status",
      "library": "libmqtt_status_plugin.so",
      "broker": "tcp://your-broker:1883",
      "topic": "trunk-recorder",
      "unit_topic": "trunk-recorder/units",
      "username": "",
      "password": "",
      "console_logs": true,
      "mqtt_audio": false,
      "mqtt_qos": 0
    }
  ]
}
```

## Topics handled

Status (`MQTT_TOPIC/...`): `rates`, `config`, `systems`, `system`,
`calls_active`, `recorders`, `recorder`, `call_start`, `call_end`,
`plugin_status`, `console`.

Unit (`MQTT_UNIT_TOPIC/...`): `call`, `end`, `on`, `off`, `ackresp`, `join`,
`data`, `ans_req`, `location`.

Trunking (`MQTT_MESSAGE_TOPIC/...`): `messages`.

See the [official example messages](https://github.com/TrunkRecorder/tr-plugin-mqtt/blob/main/example_messages.md)
for full payload schemas.

## How it works

1. `server.js` connects to MQTT and subscribes to the three topic prefixes.
2. Each message is parsed and merged into an in-memory per-`instance_id` state.
3. State is broadcast to browsers over Socket.IO.
4. `public/app.js` re-renders on every update.

No database, no audio handling — just status.

## Requirements

- Node.js 18 or newer
- An MQTT broker reachable from wherever you run the dashboard
- A trunk-recorder instance with `libmqtt_status_plugin.so` enabled

## License

MIT — see [LICENSE](LICENSE).
