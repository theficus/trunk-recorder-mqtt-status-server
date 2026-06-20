const $ = (id) => document.getElementById(id);
const demoMode = window.location.pathname === "/demo" || new URLSearchParams(window.location.search).has("demo");
const socket = demoMode ? null : io();

let instances = {};
let currentInstance = null;

const wsPill = $("ws-pill");
const mqttPill = $("mqtt-pill");
const loadAvgEl = $("load-avg");
const instSelect = $("instance-select");

if (socket) {
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

  socket.on("update", ({ instance_id, instance }) => {
    instances[instance_id] = instance;
    refreshInstanceList();
    render();
  });
}

function updateLoadAvg(avg) {
  loadAvgEl.textContent = `load: ${avg.map((v) => v.toFixed(2)).join(" / ")}`;
}

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
    instSelect.innerHTML = ids.map((id) => `<option value="${cell(id)}">${cell(id)}</option>`).join("");
    if (currentInstance) instSelect.value = currentInstance;
  }
}

function fmtFreq(hz) {
  if (hz == null) return "";
  const mhz = Number(hz) / 1_000_000;
  return Number.isFinite(mhz) ? mhz.toFixed(5) : "";
}
function fmtTime(ts) { return ts ? new Date(ts).toLocaleTimeString() : ""; }
function fmtDuration(totalSeconds) {
  const seconds = Math.floor(Number(totalSeconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
function recStateLabel(s, t) {
  if ((t || "").toLowerCase() === "idle") return "ASSIGNED";
  if (t) return t;
  const m = { 0: "MONITORING", 1: "RECORDING", 2: "INACTIVE", 3: "ACTIVE", 4: "ASSIGNED" };
  return m[s] ?? String(s ?? "");
}
function sourceLabel(srcNum, source) {
  const base = srcNum === "__unknown" ? "Unknown SDR" : `Src ${srcNum}`;
  const device = source?.device || source?.dev || source?.args || source?.driver;
  return device ? `${base}: ${device}` : base;
}
function recorderStateInfo(r) {
  const st = (r.rec_state_type || "").toLowerCase();
  if (st === "recording" || r.rec_state === 1) return { key: "recording", label: "Recording", color: "#22c55e" };
  if (st === "idle" || r.rec_state === 4) return { key: "assigned", label: "Assigned", color: "#f59e0b" };
  if (st === "available" || r.rec_state === 7) return { key: "available", label: "Available", color: "#8a93a0" };
  return { key: "available", label: "Available", color: "#8a93a0" };
}
function isNoRecorderCall(c) {
  return c.mon_state === 4 || (c.mon_state_type || "").toLowerCase() === "no_recorder";
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}
function cell(value) {
  return escapeHtml(value ?? "");
}
function sourceBounds(source) {
  const min = Number(source.min_hz);
  const max = Number(source.max_hz);
  if (Number.isFinite(min) && Number.isFinite(max)) return { min, max };

  const center = Number(source.center);
  const rate = Number(source.rate);
  if (Number.isFinite(center) && Number.isFinite(rate)) {
    return { min: center - rate / 2, max: center + rate / 2 };
  }

  return null;
}
function sourceForCall(inst, call) {
  const sources = inst.config?.sources ?? [];
  const srcNum = Number(call.src_num);
  if (Number.isFinite(srcNum) && srcNum >= 0) {
    const source = sources.find((s, i) => Number(s.source_num ?? i) === srcNum);
    return { srcNum, source, inferred: false };
  }

  const freq = Number(call.freq);
  if (Number.isFinite(freq)) {
    for (const [i, source] of sources.entries()) {
      const bounds = sourceBounds(source);
      if (bounds && freq >= bounds.min && freq <= bounds.max) {
        return { srcNum: source.source_num ?? i, source, inferred: true };
      }
    }
  }

  return null;
}
function sourceCell(inst, call) {
  const match = sourceForCall(inst, call);
  if (!match) return "";

  const label = escapeHtml(sourceLabel(match.srcNum, match.source));
  return match.inferred ? `${label} <span class="muted">(freq match)</span>` : label;
}
function recorderPressure(inst) {
  const sources = inst.config?.sources ?? [];
  const groups = new Map();
  for (const r of Object.values(inst.recorders)) {
    const srcNum = r.src_num ?? "__unknown";
    const key = String(srcNum);
    if (!groups.has(key)) {
      groups.set(key, {
        label: sourceLabel(srcNum, sources[Number(srcNum)]),
        total: 0,
        available: 0,
      });
    }
    const group = groups.get(key);
    group.total++;
    if ((r.rec_state_type || "").toLowerCase() === "available" || r.rec_state === 7) group.available++;
  }
  return Array.from(groups.values()).filter((group) => group.total > 0 && group.available === 0);
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
let _renderedMissed = [];
let _overlaySource = null; // { type, key }

function overlayKey(type, obj) {
  if (type === "calls") return obj.id || (obj.freq + "|" + (obj.talkgroup ?? ""));
  if (type === "recorders") return String(obj.id);
  if (type === "recent") return obj.id || ((obj.start_time || "") + "|" + (obj.freq || "") + "|" + (obj.talkgroup || ""));
  if (type === "missed") return obj._missedKey;
  return null;
}

function showOverlay(title, obj, source) {
  _overlaySource = source ? { ...source, instanceId: currentInstance } : null;
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
      return `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(display)}</span>`;
    })
    .join("");
  $("overlay-body").innerHTML = rows;
}

function refreshOverlay() {
  if (!_overlaySource || $("detail-overlay").classList.contains("hidden")) return;
  if (_overlaySource.instanceId !== currentInstance) {
    closeOverlay();
    return;
  }

  const { type, key } = _overlaySource;
  let list;
  if (type === "calls") list = _renderedCalls;
  else if (type === "recorders") list = _renderedRecs;
  else if (type === "missed") list = _renderedMissed;
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
  } else if (tbody.id === "missed-body" && _renderedMissed[idx]) {
    const obj = _renderedMissed[idx];
    showOverlay("Missed Call Details", obj, { type: "missed", key: overlayKey("missed", obj), _title: "Missed Call Details" });
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
    .map(([k, v]) => `<div><span class="k">${cell(k)}</span><span class="v">${cell(v)}</span></div>`)
    .join("");
  return `<div class="card"><h3>${title}</h3>${inner}</div>`;
}

function render() {
  const inst = currentInstance ? instances[currentInstance] : null;
  if (!inst) {
    $("rates").innerHTML = "<p class='empty'>No data yet. Waiting for MQTT messages…</p>";
    $("systems").innerHTML = ""; $("sources").innerHTML = "";
    $("calls-body").innerHTML = ""; $("recorders-body").innerHTML = "";
    $("missed-body").innerHTML = ""; $("missed-count").textContent = "0";
    $("recorder-alert").classList.add("hidden");
    $("recorder-alert").innerHTML = "";
    $("recent-body").innerHTML = "";
    $("audio-list").innerHTML = ""; $("audio-count").textContent = "0";
    return;
  }

  const rates = Object.values(inst.rates);
  $("rates").innerHTML = rates.length
    ? rates.map((r) => card(`${cell(r.sys_name)} (sys ${cell(r.sys_num)})`, [
        ["Decode rate", `${Number(r.decoderate).toFixed(2)}/s`],
        ["Interval", `${r.decoderate_interval}s`],
        ["Control ch", fmtFreq(r.control_channel) + " MHz"],
        ["Total calls", inst.callCounts[r.sys_num] || ""],
        ["Captured time", fmtDuration(inst.callDurations?.[r.sys_num])],
        ["Updated", fmtTime(r._ts)],
      ])).join("")
    : "<p class='empty'>No rate reports yet.</p>";

  const calls = Object.values(inst.activeCalls);
  _renderedCalls = calls.sort((a, b) => (b.elapsed || 0) - (a.elapsed || 0));
  $("calls-count").textContent = _renderedCalls.length;
  $("calls-body").innerHTML = _renderedCalls.length
    ? _renderedCalls.map((c) => `<tr class="${[c.encrypted ? "encrypted" : "", isNoRecorderCall(c) ? "no-recorder" : ""].filter(Boolean).join(" ")}">
        <td>${cell(c.sys_name)} <span class="muted">(${cell(c.sys_num)})</span></td>
        <td>${sourceCell(inst, c)}</td>
        <td>${fmtFreq(c.freq)}</td>
        <td>${cell(c.talkgroup)}</td>
        <td>${cell(c.talkgroup_alpha_tag)}</td>
        <td>${cell(c.unit)}${c.unit_alpha_tag ? ` <span class="muted">${cell(c.unit_alpha_tag)}</span>` : ""}</td>
        <td>${Math.floor(Number(c.length) || 0)}</td>
        <td>${cell(c.call_state_type ?? recStateLabel(c.call_state))}</td>
        <td><span class="flags">${flags(c)}</span></td>
      </tr>`).join("")
    : `<tr><td colspan="9" class="empty">No active calls.</td></tr>`;
  renderMissedCalls(inst);

  _renderedRecs = Object.values(inst.recorders).sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  );
  $("recorders-count").textContent = _renderedRecs.length;
  $("recorders-body").innerHTML = _renderedRecs.length
    ? _renderedRecs.map((r) => `<tr class="${r.rec_state === 0 || (r.rec_state_type || '').toLowerCase() === 'monitoring' ? 'monitoring' : ''}">
        <td>${cell(r.id)}</td><td>${cell(r.type)}</td><td>${cell(r.src_num)}</td><td>${cell(r.rec_num)}</td>
        <td>${cell(r.count)}</td><td>${Math.floor(Number(r.duration) || 0)}</td>
        <td>${fmtFreq(r.freq)}</td>
        <td class="state-${recorderStateInfo(r).key}">${cell(recStateLabel(r.rec_state, r.rec_state_type))}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No recorders reported.</td></tr>`;
  updateRecorderAlert(inst);

  const systems = Object.values(inst.systems);
  $("systems").innerHTML = systems.length
    ? systems.map((s) => card(`${cell(s.sys_name)} <span class="muted">sys ${cell(s.sys_num)}</span>`, [
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
          (f) => `<audio controls preload="none" src="${cell(f.url)}"></audio>
                   <a href="${cell(f.url)}" download class="dl">${cell(f.name.split(".").pop())}</a>`
        ).join("");
        return `<div class="audio-row">
          <div class="audio-meta">
            <b>${cell(m.talkgroup_tag || m.talkgroup)}</b>
            <span class="muted">tg ${cell(m.talkgroup)} · ${cell(m.short_name)}</span>
            <span class="muted">${cell(m.call_length)}s · ${fmtTime(a._ts)}</span>
            ${m.srcList?.length ? `<span class="muted">units: ${cell(m.srcList.map(s => s.src).join(", "))}</span>` : ""}
          </div>
          <div class="audio-players">${players || "<span class='muted'>no audio</span>"}</div>
        </div>`;
      }).join("")
    : "<p class='empty'>No audio received. Enable <code>mqtt_audio: true</code> in the plugin config.</p>";

  $("recent-body").innerHTML = inst.recentCalls.length
    ? inst.recentCalls.slice(0, 25).map((c) => `<tr>
        <td>${fmtTime(c._endedAt)}</td>
        <td>${cell(c.sys_name)}</td>
        <td>${cell(c.talkgroup)}</td>
        <td>${cell(c.talkgroup_alpha_tag)}</td>
        <td>${cell(c.unit)}</td>
        <td>${Math.floor(Number(c.length) || 0)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No recent calls.</td></tr>`;

  updateRecorderChart(inst);
  updateDecodeRateChart(inst);
  refreshOverlay();
}

function missedCallKey(c, status, index) {
  return [
    status,
    c.id ?? "",
    c.start_time ?? "",
    c.stop_time ?? "",
    c.freq ?? "",
    c.talkgroup ?? "",
    index,
  ].join("|");
}

function renderMissedCalls(inst) {
  const activeMisses = Object.values(inst.activeCalls)
    .filter(isNoRecorderCall)
    .map((c, i) => ({ ...c, _missedStatus: "Active", _missedAt: c._ts, _missedKey: missedCallKey(c, "active", i) }));
  const recentMisses = (inst.recentCalls || [])
    .filter(isNoRecorderCall)
    .slice(0, 25)
    .map((c, i) => ({ ...c, _missedStatus: "Recent", _missedAt: c._endedAt || c._ts, _missedKey: missedCallKey(c, "recent", i) }));

  _renderedMissed = [...activeMisses, ...recentMisses].slice(0, 25);
  $("missed-count").textContent = _renderedMissed.length;
  $("missed-body").innerHTML = _renderedMissed.length
    ? _renderedMissed.map((c) => `<tr class="${c._missedStatus === "Active" ? "no-recorder" : ""}">
        <td>${fmtTime(c._missedAt)}</td>
        <td>${cell(c._missedStatus)}</td>
        <td>${cell(c.sys_name)}</td>
        <td>${sourceCell(inst, c)}</td>
        <td>${fmtFreq(c.freq)}</td>
        <td>${cell(c.talkgroup)}</td>
        <td>${cell(c.talkgroup_alpha_tag)}</td>
        <td>${cell((c.mon_state_type || "NO_RECORDER").replaceAll("_", " "))}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">No missed calls due to recorder exhaustion.</td></tr>`;
}

function updateRecorderAlert(inst) {
  const alert = $("recorder-alert");
  const noRecorderCalls = Object.values(inst.activeCalls).filter(isNoRecorderCall);
  const saturated = recorderPressure(inst);

  if (!noRecorderCalls.length && !saturated.length) {
    alert.className = "alert hidden";
    alert.innerHTML = "";
    return;
  }

  const parts = [];
  if (noRecorderCalls.length) {
    parts.push(`<b>NO RECORDER AVAILABLE:</b> ${noRecorderCalls.length} active call${noRecorderCalls.length === 1 ? "" : "s"} could not get a recorder.`);
  }
  if (saturated.length) {
    parts.push(`<b>All recorders assigned:</b> ${saturated.map((group) => escapeHtml(group.label)).join(", ")}.`);
  }

  alert.className = `alert ${noRecorderCalls.length ? "danger" : "warn"}`;
  alert.innerHTML = parts.join(" ");
}

// Recorder activity chart
let recorderChart = null;
const RECORDER_BLOCK_WIDTH = 0.9;
const RECORDER_BLOCK_GAP = 0.1;
const RECORDER_CHART_STATES = [
  { label: "Recording", color: "#22c55e" },
  { label: "Assigned", color: "#f59e0b" },
  { label: "Available", color: "#8a93a0" },
];

function initChart() {
  const ctx = $("recorder-chart").getContext("2d");
  recorderChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: [],
      datasets: [],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: "y",
      scales: {
        x: { stacked: true, beginAtZero: true, display: false },
        y: { stacked: true, ticks: { color: "#e6e6e6", font: { size: 11 }, autoSkip: false }, grid: { display: false } },
      },
      plugins: {
        legend: {
          onClick: null,
          labels: {
            color: "#e6e6e6",
            boxWidth: 12,
            font: { size: 11 },
            generateLabels: () => RECORDER_CHART_STATES.map((state) => ({
              text: state.label,
              fillStyle: state.color,
              strokeStyle: state.color,
              fontColor: "#e6e6e6",
              lineWidth: 0,
            })),
          },
        },
        tooltip: {
          backgroundColor: "#1c2129",
          titleColor: "#e6e6e6",
          bodyColor: "#e6e6e6",
          borderColor: "#262b33",
          borderWidth: 1,
          filter: (item) => !item.dataset.isSpacer,
          callbacks: {
            label: (item) => item.dataset.tooltipLabel || item.dataset.label,
          },
        },
      },
    },
  });
}

function updateRecorderChart(inst) {
  if (!inst) return;
  if (!recorderChart) initChart();

  const recs = Object.values(inst.recorders);
  const sources = inst.config?.sources ?? [];
  const groups = new Map();

  for (const r of recs) {
    const srcNum = r.src_num ?? "__unknown";
    const key = String(srcNum);
    if (!groups.has(key)) {
      groups.set(key, {
        srcNum,
        label: sourceLabel(srcNum, sources[Number(srcNum)]),
        recorders: [],
      });
    }

    groups.get(key).recorders.push(r);
  }

  const rows = Array.from(groups.values()).sort((a, b) => {
    if (a.srcNum === "__unknown") return 1;
    if (b.srcNum === "__unknown") return -1;
    return String(a.srcNum).localeCompare(String(b.srcNum), undefined, { numeric: true });
  });

  rows.forEach((row) => row.recorders.sort((a, b) =>
    String(a.rec_num ?? a.id).localeCompare(String(b.rec_num ?? b.id), undefined, { numeric: true })
  ));

  recorderChart.data.labels = rows.map((row) => row.label);
  recorderChart.data.datasets = [];
  rows.forEach((row, rowIndex) => {
    row.recorders.forEach((rec, recIndex) => {
      const state = recorderStateInfo(rec);
      const data = rows.map((_, i) => i === rowIndex ? RECORDER_BLOCK_WIDTH : 0);
      recorderChart.data.datasets.push({
        label: state.label,
        tooltipLabel: `Recorder ${rec.rec_num ?? rec.id}: ${state.label}`,
        data,
        backgroundColor: state.color,
        borderRadius: 3,
        barPercentage: 0.75,
        categoryPercentage: 0.9,
      });
      if (recIndex < row.recorders.length - 1) {
        recorderChart.data.datasets.push({
          isSpacer: true,
          label: "",
          data: rows.map((_, i) => i === rowIndex ? RECORDER_BLOCK_GAP : 0),
          backgroundColor: "rgba(0,0,0,0)",
          hoverBackgroundColor: "rgba(0,0,0,0)",
          borderWidth: 0,
          barPercentage: 0.75,
          categoryPercentage: 0.9,
        });
      }
    });
  });
  $("recorder-chart").parentElement.style.height = `${Math.max(160, rows.length * 44 + 72)}px`;
  recorderChart.update();
}

// Decode rate history chart
let decodeRateChart = null;
const decodeRateState = {}; // keyed by instance_id, each has history/stats keyed by sys_num
const DECODE_RATE_MAX_POINTS = demoMode ? 20 : 10;

function getDecodeRateState(inst) {
  const key = inst.instance_id || currentInstance || "default";
  if (!decodeRateState[key]) decodeRateState[key] = { history: {}, stats: {} };
  return decodeRateState[key];
}

function seedDecodeRateHistory(instanceId, series, endTimes) {
  const state = { history: {}, stats: {} };
  Object.entries(series).forEach(([sysNum, values]) => {
    const endTime = endTimes[sysNum] ?? Date.now();
    state.history[sysNum] = values.map((v, i) => ({ t: endTime - (values.length - i - 1) * 3000, v }));
    state.stats[sysNum] = {
      high: Math.max(...values),
      low: Math.min(...values),
    };
  });
  decodeRateState[instanceId] = state;
}

function initDecodeRateChart() {
  const ctx = $("decode-rate-chart").getContext("2d");
  decodeRateChart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { ticks: { color: "#8a93a0", font: { size: 9 }, maxRotation: 0 }, grid: { color: "rgba(38,43,51,.3)" } },
        y: { beginAtZero: true, ticks: { color: "#8a93a0", font: { size: 10 } }, grid: { color: "rgba(38,43,51,.5)" } },
      },
      plugins: {
        legend: { labels: { color: "#e6e6e6", boxWidth: 12, font: { size: 11 } } },
        tooltip: { enabled: true },
      },
      elements: { point: { radius: 3, hoverRadius: 5 }, line: { tension: 0.3, borderWidth: 2 } },
    },
  });
}

function updateDecodeRateChart(inst) {
  if (!inst) return;
  if (!decodeRateChart) initDecodeRateChart();

  const rates = Object.values(inst.rates);
  const state = getDecodeRateState(inst);
  for (const r of rates) {
    const key = r.sys_num;
    if (!state.history[key]) state.history[key] = [];
    if (!state.stats[key]) state.stats[key] = { high: -Infinity, low: Infinity };
    const hist = state.history[key];
    const val = Number(r.decoderate) || 0;
    if (!hist.length || hist[hist.length - 1].t !== r._ts) {
      hist.push({ t: r._ts, v: val });
      if (hist.length > DECODE_RATE_MAX_POINTS) hist.shift();
      state.stats[key].high = Math.max(state.stats[key].high, val);
      state.stats[key].low = Math.min(state.stats[key].low, val);
    }
  }

  // Use timestamps from first system as labels
  const firstKey = Object.keys(state.history)[0];
  const labels = firstKey ? state.history[firstKey].map((p) => new Date(p.t).toLocaleTimeString()) : [];
  decodeRateChart.data.labels = labels;

  const colors = ["#4ea1ff", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa"];
  const entries = Object.entries(state.history);

  while (decodeRateChart.data.datasets.length > entries.length) decodeRateChart.data.datasets.pop();
  entries.forEach(([sysNum, hist], i) => {
    const stats = state.stats[sysNum];
    const lbl = (rates.find((r) => String(r.sys_num) === sysNum)?.sys_name || `sys ${sysNum}`)
      + ` (H:${stats.high.toFixed(2)} L:${stats.low.toFixed(2)})`;
    const data = hist.map((p) => p.v);
    if (decodeRateChart.data.datasets[i]) {
      decodeRateChart.data.datasets[i].data = data;
      decodeRateChart.data.datasets[i].label = lbl;
    } else {
      decodeRateChart.data.datasets.push({
        label: lbl,
        data,
        borderColor: colors[i % colors.length],
        fill: false,
      });
    }
  });
  decodeRateChart.update("none");
}

function enableDemoMode() {
  const demo = window.createDemoDashboard();
  const inst = demo.instance;
  seedDecodeRateHistory(inst.instance_id, demo.decodeRateSeries, Object.fromEntries(
    Object.entries(inst.rates).map(([sysNum, rate]) => [sysNum, rate._ts])
  ));
  instances = { "demo-yard": inst };
  currentInstance = "demo-yard";
  setPill(wsPill, "demo: offline", true);
  setPill(mqttPill, "mqtt: demo data", true);
  updateLoadAvg([0.42, 0.37, 0.31]);
  refreshInstanceList();
}

if (demoMode) enableDemoMode();
render();
