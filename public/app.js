const socket = io();
const $ = (id) => document.getElementById(id);

let instances = {};
let currentInstance = null;

const wsPill = $("ws-pill");
const mqttPill = $("mqtt-pill");
const instSelect = $("instance-select");

socket.on("connect", () => setPill(wsPill, "ws: connected", true));
socket.on("disconnect", () => setPill(wsPill, "ws: disconnected", false));
socket.on("mqtt-status", (s) =>
  setPill(mqttPill, s.connected ? "mqtt: connected" : "mqtt: disconnected", s.connected)
);

socket.on("snapshot", (data) => {
  instances = data.instances || {};
  setPill(mqttPill, data.mqttConnected ? "mqtt: connected" : "mqtt: disconnected", data.mqttConnected);
  refreshInstanceList();
  render();
});

socket.on("update", ({ instance_id, instance }) => {
  instances[instance_id] = instance;
  refreshInstanceList();
  render();
});

instSelect.addEventListener("change", () => {
  currentInstance = instSelect.value;
  render();
});

function setPill(el, text, good) {
  el.textContent = text;
  el.classList.toggle("good", !!good);
  el.classList.toggle("bad", !good);
}

function refreshInstanceList() {
  const ids = Object.keys(instances);
  if (!currentInstance || !instances[currentInstance]) currentInstance = ids[0] || null;
  const existing = Array.from(instSelect.options).map((o) => o.value);
  if (existing.join("|") !== ids.join("|")) {
    instSelect.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join("");
    if (currentInstance) instSelect.value = currentInstance;
  }
}

function fmtFreq(hz) {
  if (hz == null) return "";
  const mhz = Number(hz) / 1_000_000;
  return Number.isFinite(mhz) ? mhz.toFixed(5) : "";
}
function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString() : ""; }
function recStateLabel(s, t) {
  if (t) return t;
  const m = { 0: "MONITORING", 1: "RECORDING", 2: "INACTIVE", 3: "ACTIVE", 4: "IDLE" };
  return m[s] ?? String(s ?? "");
}
function flags(c) {
  const out = [];
  if (c.encrypted) out.push("ENC");
  if (c.emergency) out.push("EMERG");
  if (c.phase2 || c.phase2_tdma) out.push("P2");
  if (c.conventional) out.push("CONV");
  if (c.analog) out.push("ANALOG");
  return out.join(" ");
}
function card(title, rows) {
  const inner = rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join("");
  return `<div class="card"><h3>${title}</h3>${inner}</div>`;
}

function render() {
  const inst = currentInstance ? instances[currentInstance] : null;
  if (!inst) {
    $("rates").innerHTML = "<p class='empty'>No data yet. Waiting for MQTT messages…</p>";
    $("systems").innerHTML = ""; $("sources").innerHTML = "";
    $("calls-body").innerHTML = ""; $("recorders-body").innerHTML = "";
    $("unit-events").innerHTML = ""; $("recent-body").innerHTML = "";
    $("audio-list").innerHTML = ""; $("audio-count").textContent = "0";
    return;
  }

  const rates = Object.values(inst.rates);
  $("rates").innerHTML = rates.length
    ? rates.map((r) => card(`${r.sys_name} (sys ${r.sys_num})`, [
        ["Decode rate", `${Number(r.decoderate).toFixed(2)}/s`],
        ["Interval", `${r.decoderate_interval}s`],
        ["Control ch", fmtFreq(r.control_channel) + " MHz"],
        ["Updated", fmtTime(r._ts)],
      ])).join("")
    : "<p class='empty'>No rate reports yet.</p>";

  const calls = Object.values(inst.activeCalls);
  $("calls-count").textContent = calls.length;
  $("calls-body").innerHTML = calls.length
    ? calls.sort((a, b) => (b.elapsed || 0) - (a.elapsed || 0)).map((c) => `<tr>
        <td>${c.sys_name ?? ""} <span class="muted">(${c.sys_num ?? ""})</span></td>
        <td>${fmtFreq(c.freq)}</td>
        <td>${c.talkgroup ?? ""}</td>
        <td>${c.talkgroup_alpha_tag ?? ""}</td>
        <td>${c.unit ?? ""}${c.unit_alpha_tag ? ` <span class="muted">${c.unit_alpha_tag}</span>` : ""}</td>
        <td>${Math.floor(Number(c.length) || 0)}</td>
        <td>${c.call_state_type ?? recStateLabel(c.call_state)}</td>
        <td><span class="flags">${flags(c)}</span></td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No active calls.</td></tr>`;

  const recs = Object.values(inst.recorders).sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
  $("recorders-count").textContent = recs.length;
  $("recorders-body").innerHTML = recs.length
    ? recs.map((r) => `<tr>
        <td>${r.id}</td><td>${r.type ?? ""}</td><td>${r.src_num ?? ""}</td><td>${r.rec_num ?? ""}</td>
        <td>${r.count ?? ""}</td><td>${Math.floor(Number(r.duration) || 0)}</td>
        <td>${fmtFreq(r.freq)}</td>
        <td class="state-${(r.rec_state_type || "").toLowerCase()}">${recStateLabel(r.rec_state, r.rec_state_type)}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No recorders reported.</td></tr>`;

  const systems = Object.values(inst.systems);
  $("systems").innerHTML = systems.length
    ? systems.map((s) => card(`${s.sys_name} <span class="muted">sys ${s.sys_num}</span>`, [
        ["Type", s.type || s.system_type], ["SysID", s.sysid], ["WACN", s.wacn],
        ["NAC", s.nac], ["RFSS", s.rfss], ["Site", s.site_id],
      ])).join("")
    : "<p class='empty'>No systems reported.</p>";

  const sources = inst.config?.sources ?? [];
  $("sources").innerHTML = sources.length
    ? sources.map((s, i) => card(`Source ${i} <span class="muted">${s.driver ?? ""}</span>`, [
        ["Center", `${fmtFreq(s.center)} MHz`],
        ["Rate", s.rate], ["Gain", s.gain],
        ["Digital recs", s.digital_recorders], ["Analog recs", s.analog_recorders],
      ])).join("")
    : "<p class='empty'>No source config retained.</p>";

  const audio = inst.audioCalls || [];
  $("audio-count").textContent = audio.length;
  $("audio-list").innerHTML = audio.length
    ? audio.slice(0, 25).map((a) => {
        const m = a.metadata || {};
        const players = (a.files || []).map(
          (f) => `<audio controls preload="none" src="${f.url}"></audio>
                   <a href="${f.url}" download class="dl">${f.name.split(".").pop()}</a>`
        ).join("");
        return `<div class="audio-row">
          <div class="audio-meta">
            <b>${m.talkgroup_tag || m.talkgroup || ""}</b>
            <span class="muted">tg ${m.talkgroup ?? ""} · ${m.short_name ?? ""}</span>
            <span class="muted">${m.call_length ?? ""}s · ${fmtTime(a._ts)}</span>
            ${m.srcList?.length ? `<span class="muted">units: ${m.srcList.map(s => s.src).join(", ")}</span>` : ""}
          </div>
          <div class="audio-players">${players || "<span class='muted'>no audio</span>"}</div>
        </div>`;
      }).join("")
    : "<p class='empty'>No audio received. Enable <code>mqtt_audio: true</code> in the plugin config.</p>";

  $("unit-events").innerHTML = inst.unitEvents.slice(0, 50).map((e) =>
    `<li><time>${fmtTime(e._ts)}</time> <b>${e.type}</b>
     ${e.sys_name ? `<span class="muted">${e.sys_name}</span>` : ""}
     ${e.unit ? `unit <code>${e.unit}</code>` : ""}
     ${e.talkgroup ? `tg <code>${e.talkgroup}</code>` : ""}
     ${e.talkgroup_alpha_tag ? `<span class="muted">${e.talkgroup_alpha_tag}</span>` : ""}
    </li>`).join("");

  $("recent-body").innerHTML = inst.recentCalls.length
    ? inst.recentCalls.slice(0, 25).map((c) => `<tr>
        <td>${fmtTime(c._endedAt)}</td>
        <td>${c.sys_name ?? ""}</td>
        <td>${c.talkgroup ?? ""}</td>
        <td>${c.talkgroup_alpha_tag ?? ""}</td>
        <td>${c.unit ?? ""}</td>
        <td>${Math.floor(Number(c.length) || 0)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No recent calls.</td></tr>`;
}

render();
