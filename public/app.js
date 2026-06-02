const socket = io();
const $ = (id) => document.getElementById(id);

let instances = {};
let currentInstance = null;

const wsPill = $("ws-pill");
const mqttPill = $("mqtt-pill");
const loadAvgEl = $("load-avg");
const instSelect = $("instance-select");

socket.on("connect", () => setPill(wsPill, "ws: connected", true));
socket.on("disconnect", () => setPill(wsPill, "ws: disconnected", false));
socket.on("mqtt-status", (s) =>
  setPill(mqttPill, s.connected ? "mqtt: connected" : "mqtt: disconnected", s.connected)
);

socket.on("snapshot", (data) => {
  instances = data.instances || {};
  setPill(mqttPill, data.mqttConnected ? "mqtt: connected" : "mqtt: disconnected", data.mqttConnected);
  if (data.loadAvg) updateLoadAvg(data.loadAvg);
  refreshInstanceList();
  render();
});

socket.on("load-avg", (avg) => updateLoadAvg(avg));

function updateLoadAvg(avg) {
  loadAvgEl.textContent = `load: ${avg.map((v) => v.toFixed(2)).join(" / ")}`;
}

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

let _renderedCalls = [];
let _renderedRecs = [];
let _overlaySource = null; // { type, key }

function overlayKey(type, obj) {
  if (type === "calls") return obj.freq + "|" + (obj.talkgroup ?? "");
  if (type === "recorders") return String(obj.id);
  if (type === "recent") return (obj.start_time || "") + "|" + (obj.freq || "") + "|" + (obj.talkgroup || "");
  return null;
}

function showOverlay(title, obj, source) {
  _overlaySource = source || null;
  $("overlay-title").textContent = title;
  renderOverlayBody(obj);
  $("detail-overlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function renderOverlayBody(obj) {
  const timeKeys = /time|_ts|start|stop|ctime|date|created|updated|seen/i;
  const rows = Object.entries(obj)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && !k.startsWith("_"))
    .map(([k, v]) => {
      let display;
      if (timeKeys.test(k) && typeof v === "number" && v > 1e9 && v < 2e10) {
        display = new Date(v * 1000).toLocaleString();
      } else if (typeof v === "object") {
        display = JSON.stringify(v);
      } else {
        display = String(v);
      }
      return `<span class="k">${k}</span><span class="v">${display}</span>`;
    })
    .join("");
  $("overlay-body").innerHTML = rows;
}

function refreshOverlay() {
  if (!_overlaySource || $("detail-overlay").classList.contains("hidden")) return;
  const { type, key } = _overlaySource;
  let list;
  if (type === "calls") list = _renderedCalls;
  else if (type === "recorders") list = _renderedRecs;
  else if (type === "recent") {
    const inst = currentInstance ? instances[currentInstance] : null;
    list = inst ? inst.recentCalls : [];
  }
  const obj = (list || []).find((o) => overlayKey(type, o) === key);
  if (obj) {
    renderOverlayBody(obj);
    $("overlay-title").textContent = _overlaySource._title || "Details";
  } else if (type === "calls") {
    $("overlay-title").textContent = "Call Details — Ended";
  }
}

function closeOverlay(e) {
  if (!e || e.target === $("detail-overlay") || e.target.closest(".overlay-close")) {
    $("detail-overlay").classList.add("hidden");
    document.body.style.overflow = "";
    _overlaySource = null;
  }
}

document.addEventListener("click", (e) => {
  const row = e.target.closest("tbody tr");
  if (!row || row.querySelector(".empty")) return;
  const tbody = row.closest("tbody");
  const idx = Array.from(tbody.children).indexOf(row);
  if (tbody.id === "calls-body" && _renderedCalls[idx]) {
    const obj = _renderedCalls[idx];
    showOverlay("Call Details — Active", obj, { type: "calls", key: overlayKey("calls", obj), _title: "Call Details — Active" });
  } else if (tbody.id === "recorders-body" && _renderedRecs[idx]) {
    const obj = _renderedRecs[idx];
    showOverlay("Recorder Details", obj, { type: "recorders", key: overlayKey("recorders", obj), _title: "Recorder Details" });
  } else if (tbody.id === "recent-body") {
    const inst = currentInstance ? instances[currentInstance] : null;
    if (inst && inst.recentCalls[idx]) {
      const obj = inst.recentCalls[idx];
      showOverlay("Recent Call Details", obj, { type: "recent", key: overlayKey("recent", obj), _title: "Recent Call Details" });
    }
  }
});
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
    $("recent-body").innerHTML = "";
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
  _renderedCalls = calls.sort((a, b) => (b.elapsed || 0) - (a.elapsed || 0));
  $("calls-count").textContent = _renderedCalls.length;
  $("calls-body").innerHTML = _renderedCalls.length
    ? _renderedCalls.map((c) => `<tr class="${c.encrypted ? "encrypted" : ""}">
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

  _renderedRecs = Object.values(inst.recorders).sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
  $("recorders-count").textContent = _renderedRecs.length;
  $("recorders-body").innerHTML = _renderedRecs.length
    ? _renderedRecs.map((r) => `<tr class="${r.rec_state === 0 || (r.rec_state_type || '').toLowerCase() === 'monitoring' ? 'monitoring' : ''}">
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
    ? sources.map((s, i) => card(`Src ${i}`, [
        ["Freq", `${fmtFreq(s.center)}`],
        ["Gain", s.gain], ["D/A", `${s.digital_recorders ?? 0}/${s.analog_recorders ?? 0}`],
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

  updateRecorderChart(inst);
  refreshOverlay();
}

// Recorder activity chart
let recorderChart = null;

function initChart() {
  const ctx = $("recorder-chart").getContext("2d");
  recorderChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Recorders"],
      datasets: [
        { label: "Recording", data: [0], backgroundColor: "#22c55e", borderRadius: 4 },
        { label: "Idle", data: [0], backgroundColor: "#f59e0b", borderRadius: 4 },
        { label: "Available", data: [0], backgroundColor: "#8a93a0", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      indexAxis: "y",
      scales: {
        x: { stacked: true, beginAtZero: true, ticks: { color: "#8a93a0", stepSize: 1, font: { size: 10 } }, grid: { color: "rgba(38,43,51,.5)" } },
        y: { stacked: true, ticks: { color: "#e6e6e6", font: { size: 11 } }, grid: { display: false } },
      },
      plugins: { legend: { labels: { color: "#e6e6e6", boxWidth: 12, font: { size: 11 } } } },
    },
  });
}

function updateRecorderChart(inst) {
  if (!inst) return;
  if (!recorderChart) initChart();

  const recs = Object.values(inst.recorders);
  let recording = 0, idle = 0, available = 0;
  for (const r of recs) {
    const st = (r.rec_state_type || "").toLowerCase();
    if (st === "recording" || r.rec_state === 1) recording++;
    else if (st === "idle" || r.rec_state === 4) idle++;
    else available++;
  }

  recorderChart.data.datasets[0].data = [recording];
  recorderChart.data.datasets[1].data = [idle];
  recorderChart.data.datasets[2].data = [available];
  recorderChart.update();
}

render();
