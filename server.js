import express from "express";
import http from "http";
import { Server } from "socket.io";
import mqtt from "mqtt";
import multer from "multer";
import fs from "fs";
import path from "path";
import os from "os";

const PORT = process.env.PORT || 3080;
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const TOPIC = process.env.MQTT_TOPIC || "trunk-recorder";
const UNIT_TOPIC = process.env.MQTT_UNIT_TOPIC || "trunk-recorder/units";
const MESSAGE_TOPIC = process.env.MQTT_MESSAGE_TOPIC || "trunk-recorder/messages";
const AUDIO_ENABLED = (process.env.MQTT_AUDIO_ENABLED || "false").toLowerCase() === "true";
const RECORDINGS_DIR = path.resolve(process.env.RECORDINGS_DIR || "./recordings");
const AUDIO_RETENTION = parseInt(process.env.AUDIO_RETENTION || "100", 10);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });

app.use(express.static("public"));
app.get("/demo", (_req, res) => res.sendFile(path.resolve("public/index.html")));

if (AUDIO_ENABLED) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  app.use("/recordings", express.static(RECORDINGS_DIR, { maxAge: "1h" }));
  console.log(`[audio] recordings dir: ${RECORDINGS_DIR}`);
  console.log(`[audio] retention: ${AUDIO_RETENTION} calls per instance`);
}

const instances = {};

function getInstance(id) {
  const key = id || "default";
  if (!instances[key]) {
    instances[key] = {
      instance_id: key,
      config: null,
      systems: {},
      rates: {},
      recorders: {},
      activeCalls: {},
      recentCalls: [],
      audioCalls: [],
      unitEvents: [],
      messages: [],
      pluginStatus: null,
      lastSeen: null,
      callCounts: {},
      callDurations: {},
      completedCallIds: {},
      completedCallIdOrder: [],
    };
  }
  return instances[key];
}

function pushCapped(arr, item, cap = 100) {
  arr.unshift(item);
  if (arr.length > cap) arr.length = cap;
}

function updateCallCount(inst, call) {
  if (call?.call_num == null) return;

  const callNum = Number(call.call_num);
  if (!Number.isFinite(callNum)) return;

  const key = call.sys_num ?? "_";
  inst.callCounts[key] = Math.max(callNum, inst.callCounts[key] || 0);
}

function completedCallKey(call) {
  return [
    call.id ?? "",
    call.sys_num ?? "",
    call.call_num ?? "",
    call.start_time ?? "",
    call.stop_time ?? "",
    call.freq ?? "",
    call.talkgroup ?? "",
  ].join("|");
}

function updateCapturedDuration(inst, call) {
  const length = Number(call?.length ?? call?.call_length);
  if (!Number.isFinite(length) || length <= 0) return;

  const id = completedCallKey(call);
  if (inst.completedCallIds[id]) return;

  inst.completedCallIds[id] = true;
  inst.completedCallIdOrder.push(id);
  if (inst.completedCallIdOrder.length > 5000) {
    delete inst.completedCallIds[inst.completedCallIdOrder.shift()];
  }

  const key = call.sys_num ?? "_";
  inst.callDurations[key] = (inst.callDurations[key] || 0) + length;
}

function pruneRecordings() {
  const keep = new Set(
    Object.values(instances).flatMap((inst) =>
      inst.audioCalls.flatMap((c) => c.files.map((f) => f.name))
    )
  );
  try {
    for (const f of fs.readdirSync(RECORDINGS_DIR)) {
      if (!keep.has(f)) fs.unlinkSync(path.join(RECORDINGS_DIR, f));
    }
  } catch (e) {
    console.error("[audio] prune failed", e.message);
  }
}

const mqttOpts = {
  reconnectPeriod: 2000,
  clientId: `tr-dashboard-${Math.random().toString(16).slice(2, 10)}`,
};
if (MQTT_USERNAME) mqttOpts.username = MQTT_USERNAME;
if (MQTT_PASSWORD) mqttOpts.password = MQTT_PASSWORD;

const client = mqtt.connect(MQTT_URL, mqttOpts);

app.get("/healthz", (_req, res) =>
  res.json({
    ok: true,
    mqtt: client.connected,
    instances: Object.keys(instances),
    audio_enabled: AUDIO_ENABLED,
  })
);

// POST /api/call-upload — accept audio file + metadata (mirrors MQTT audio flow)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.use(express.json());

app.post("/api/call-upload", upload.single("audio"), (req, res) => {
  if (!AUDIO_ENABLED) {
    return res.status(400).json({ error: "Audio is not enabled on this server" });
  }

  let meta;
  try {
    meta = typeof req.body.metadata === "string" ? JSON.parse(req.body.metadata) : (req.body.metadata || {});
  } catch {
    return res.status(400).json({ error: "Invalid metadata JSON" });
  }

  const instanceId = req.body.instance_id || meta.instance_id || "default";
  const inst = getInstance(instanceId);
  inst.lastSeen = Date.now();

  const stamp = meta.start_time || Math.floor(Date.now() / 1000);
  const safeId = `${meta.short_name || inst.instance_id}-${meta.talkgroup || "tg"}-${stamp}`
    .replace(/[^a-zA-Z0-9_.-]/g, "_");

  const entry = {
    id: safeId,
    metadata: meta,
    files: [],
    _ts: Date.now(),
  };

  if (req.file) {
    const ext = path.extname(req.file.originalname) || mimeToExt(req.file.mimetype);
    const fileName = `${safeId}${ext}`;
    const fullPath = path.join(RECORDINGS_DIR, fileName);
    try {
      fs.writeFileSync(fullPath, req.file.buffer);
      entry.files.push({ url: `/recordings/${fileName}`, mime: req.file.mimetype, name: fileName });
    } catch (e) {
      console.error("[upload] write failed", fileName, e.message);
      return res.status(500).json({ error: "Failed to write audio file" });
    }
  }

  pushCapped(inst.audioCalls, entry, AUDIO_RETENTION);
  if (inst.audioCalls.length >= AUDIO_RETENTION) pruneRecordings();

  io.emit("update", { instance_id: inst.instance_id, type: "audio", instance: inst });
  res.json({ ok: true, id: safeId, files: entry.files });
});

function mimeToExt(mime) {
  const map = { "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/ogg": ".ogg" };
  return map[mime] || ".bin";
}

const SUBS = [`${TOPIC}/#`, `${UNIT_TOPIC}/#`, `${MESSAGE_TOPIC}/#`];

client.on("connect", () => {
  console.log(`[mqtt] connected to ${MQTT_URL}`);
  for (const t of SUBS) {
    client.subscribe(t, (err) => {
      if (err) console.error(`[mqtt] subscribe ${t} failed`, err.message);
      else console.log(`[mqtt] subscribed to ${t}`);
    });
  }
  io.emit("mqtt-status", { connected: true });
});

client.on("reconnect", () => console.log("[mqtt] reconnecting..."));
client.on("error", (err) => console.error("[mqtt] error", err.message));
client.on("close", () => io.emit("mqtt-status", { connected: false }));

client.on("message", (topic, payload) => {
  let msg;
  try { msg = JSON.parse(payload.toString()); } catch { return; }

  const inst = getInstance(msg.instance_id);
  inst.lastSeen = Date.now();
  const type = msg.type || topic.split("/").pop();

  switch (type) {
    case "config":
      inst.config = msg.config;
      break;
    case "systems":
      for (const s of msg.systems || []) inst.systems[s.sys_num] = { ...inst.systems[s.sys_num], ...s };
      break;
    case "system": {
      const s = msg.system;
      if (s) inst.systems[s.sys_num] = { ...inst.systems[s.sys_num], ...s };
      break;
    }
    case "rates":
      for (const r of msg.rates || []) {
        inst.rates[r.sys_num] = { ...r, _ts: Date.now() };
      }
      break;
    case "recorders":
      inst.recorders = {};
      for (const r of msg.recorders || []) inst.recorders[r.id] = { ...r, _ts: Date.now() };
      break;
    case "recorder": {
      const r = msg.recorder;
      if (r) inst.recorders[r.id] = { ...inst.recorders[r.id], ...r, _ts: Date.now() };
      break;
    }
    case "calls_active": {
      const seen = new Set();
      for (const c of msg.calls || []) {
        inst.activeCalls[c.id] = { ...inst.activeCalls[c.id], ...c, _ts: Date.now() };
        seen.add(c.id);
        updateCallCount(inst, c);
      }
      for (const id of Object.keys(inst.activeCalls)) {
        if (!seen.has(id)) delete inst.activeCalls[id];
      }
      break;
    }
    case "call_start": {
      const c = msg.call;
      if (c) {
        inst.activeCalls[c.id] = { ...c, _ts: Date.now() };
        updateCallCount(inst, c);
      }
      break;
    }
    case "call_end": {
      const c = msg.call;
      if (c) {
        delete inst.activeCalls[c.id];
        pushCapped(inst.recentCalls, { ...c, _endedAt: Date.now() });
        updateCallCount(inst, c);
        updateCapturedDuration(inst, c);
      }
      break;
    }
    case "plugin_status":
      inst.pluginStatus = msg;
      break;

    case "audio": {
      if (!AUDIO_ENABLED) break;
      const call = msg.call || {};
      const meta = call.metadata || {};
      const stamp = meta.start_time || Math.floor(Date.now() / 1000);
      const safeId = `${meta.short_name || inst.instance_id}-${meta.talkgroup || "tg"}-${stamp}`
        .replace(/[^a-zA-Z0-9_.-]/g, "_");
      const entry = {
        id: safeId,
        metadata: meta,
        files: [],
        _ts: Date.now(),
      };

      const writes = [];
      if (call.audio_wav_base64) {
        const file = `${safeId}.wav`;
        writes.push([file, "audio/wav", call.audio_wav_base64]);
      }
      if (call.audio_m4a_base64) {
        const file = `${safeId}.m4a`;
        writes.push([file, "audio/mp4", call.audio_m4a_base64]);
      }

      for (const [file, mime, b64] of writes) {
        const full = path.join(RECORDINGS_DIR, file);
        try {
          fs.writeFileSync(full, Buffer.from(b64, "base64"));
          entry.files.push({ url: `/recordings/${file}`, mime, name: file });
        } catch (e) {
          console.error("[audio] write failed", file, e.message);
        }
      }

      pushCapped(inst.audioCalls, entry, AUDIO_RETENTION);
      if (inst.audioCalls.length >= AUDIO_RETENTION) pruneRecordings();
      break;
    }
    case "call": case "end": case "on": case "off":
    case "ackresp": case "join": case "data": case "ans_req": case "location":
      pushCapped(inst.unitEvents, { type, ...msg, _ts: Date.now() }, 200);
      break;
    case "message": case "messages":
      pushCapped(inst.messages, { ...msg, _ts: Date.now() }, 200);
      break;
    case "console":
      pushCapped(inst.messages, { type: "console", ...msg, _ts: Date.now() }, 200);
      break;
    default:
      pushCapped(inst.messages, { type, topic, ...msg, _ts: Date.now() }, 200);
  }

  io.emit("update", { instance_id: inst.instance_id, type, instance: inst });
});

io.on("connection", (socket) => {
  console.log(`[ws] client connected (${io.engine.clientsCount})`);
  socket.emit("snapshot", { instances, mqttConnected: client.connected, loadAvg: os.loadavg() });
  socket.on("disconnect", () =>
    console.log(`[ws] client disconnected (${io.engine.clientsCount})`)
  );
});

setInterval(() => {
  io.emit("load-avg", os.loadavg());
}, 5000);

server.listen(PORT, () => {
  console.log(`[http] dashboard on http://localhost:${PORT}`);
  console.log(`[mqtt] topic prefixes: ${SUBS.join(", ")}`);
});
