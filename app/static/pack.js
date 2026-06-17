const API = "/api";
const params = new URLSearchParams(location.search);
const packId = parseInt(params.get("id"), 10);

if (!packId) location.href = "/";

const packName = document.getElementById("pack-name");
const packSpec = document.getElementById("pack-spec");
const packPill = document.getElementById("pack-pill");
const readoutRow = document.getElementById("readout-row");
const aiSummaryWrap = document.getElementById("ai-summary-wrap");
const cellVoltageInputs = document.getElementById("cell-voltage-inputs");
const deletePackBtn = document.getElementById("delete-pack-btn");
const editPackBtn = document.getElementById("edit-pack-btn");
const editPackPanel = document.getElementById("edit-pack-panel");
const editPackForm = document.getElementById("edit-pack-form");
const cancelEditPack = document.getElementById("cancel-edit-pack");
const editCyclePanel = document.getElementById("edit-cycle-panel");
const editCycleForm = document.getElementById("edit-cycle-form");
const cancelEditCycle = document.getElementById("cancel-edit-cycle");
const ecCellVoltageInputs = document.getElementById("ec-cell-voltage-inputs");
const cycleForm = document.getElementById("cycle-form");
const historyBody = document.getElementById("history-body");
const historyEmpty = document.getElementById("history-empty");
const voltageChart = document.getElementById("voltage-chart");
const chartEmpty = document.getElementById("chart-empty");
const chartToggle = document.getElementById("chart-toggle");

let packData = null;
let chartInstance = null;
let lastCycles = [];
let voltageType = "discharge";

function statusLabel(status) {
  switch (status) {
    case "healthy": return "Healthy";
    case "watch": return "Watch";
    case "check": return "Check soon";
    default: return "No data";
  }
}

function statusClass(status) {
  return ["healthy", "watch", "check"].includes(status) ? status : "nodata";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function renderPackHeader(data) {
  packName.textContent = data.name;
  const specBits = [`${data.cell_count}S`];
  if (data.capacity_mah) specBits.push(`${data.capacity_mah}mAh`);
  specBits.push(data.chemistry);
  packSpec.textContent = specBits.join(" · ");

  const existing = document.getElementById("pack-badges");
  if (existing) existing.remove();

  const gradeHtml = data.brand
    ? `<span class="grade-badge grade-${escapeHtml(data.brand)}">${escapeHtml(data.brand)}</span>`
    : "";
  const stickerHtml = data.sticker
    ? `<span class="sticker-badge">${escapeHtml(data.sticker)}</span>`
    : "";

  if (gradeHtml || stickerHtml) {
    const row = document.createElement("div");
    row.id = "pack-badges";
    row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;";
    row.innerHTML = gradeHtml + stickerHtml;
    packSpec.insertAdjacentElement("afterend", row);
  }
}

function buildCellInputs(count, container, step, placeholder) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label>C${i + 1}</label>
      <input type="number" step="${step}" placeholder="${placeholder}" data-cell="${i}">
    `;
    container.appendChild(field);
  }
}

async function loadPack() {
  const res = await fetch(`${API}/packs/${packId}`);
  if (!res.ok) { location.href = "/"; return; }
  packData = await res.json();

  renderPackHeader(packData);

  const now = new Date();
  document.getElementById("cy-time").value = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);

  buildCellInputs(packData.cell_count, cellVoltageInputs, "0.001", "e.g. 4.16");

  // The quick batch logger only makes sense for 1S packs (cell V == pack V).
  document.getElementById("batch-log-panel").classList.toggle("hidden", packData.cell_count !== 1);
}

async function loadHealth() {
  const res = await fetch(`${API}/packs/${packId}/health`);
  if (!res.ok) return;
  const { metrics, ai_summary } = await res.json();

  const cls = statusClass(metrics.status);
  packPill.className = `pill ${cls}`;
  packPill.textContent = statusLabel(metrics.status);

  // Remove previous inline warnings
  ["storage-warn", "retire-warn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  if (metrics.storage_warning) {
    const warn = document.createElement("span");
    warn.id = "storage-warn";
    warn.className = "warn-badge";
    warn.textContent = metrics.storage_days != null
      ? `Sitting charged ${metrics.storage_days}d — discharge to storage`
      : "Sitting above storage voltage";
    packPill.insertAdjacentElement("afterend", warn);
  }

  if (metrics.retirement_warning) {
    const warn = document.createElement("span");
    warn.id = "retire-warn";
    warn.className = metrics.retirement_warning === "exceeded" ? "warn-badge critical" : "warn-badge";
    warn.textContent = metrics.retirement_warning === "exceeded"
      ? `Cycle limit exceeded (${metrics.cycle_count} / ${packData?.max_cycles ?? "?"})`
      : `Approaching cycle limit (${metrics.cycle_count} / ${packData?.max_cycles ?? "?"})`;
    packPill.insertAdjacentElement("afterend", warn);
  }

  readoutRow.innerHTML = "";

  const lastUsedText = metrics.last_used_days !== null && metrics.last_used_days !== undefined
    ? `${metrics.last_used_days}d ago`
    : "Never";
  const lastUsedCls = metrics.last_used_days !== null && metrics.last_used_days > 30 ? "watch" : "";

  const tiles = [
    { label: "Latest spread",    value: metrics.latest_spread !== null ? `${metrics.latest_spread.toFixed(3)} V` : "—", cls },
    { label: "Discharge cycles", value: metrics.cycle_count,          cls: "" },
    { label: "Charge cycles",    value: metrics.charge_count ?? "—",  cls: "" },
    { label: "Total logged",     value: metrics.total_logged,         cls: "" },
    { label: "Spread trend",     value: metrics.spread_trend ?? "—",  cls: "" },
    { label: "Last used",        value: lastUsedText,                 cls: lastUsedCls },
    { label: "Pack age",         value: metrics.pack_age_label ?? "—", cls: "" },
    { label: "Flight time",      value: fmtDuration(metrics.total_flight_sec), cls: "" },
    { label: "Flights",          value: metrics.flight_count ?? 0,    cls: "" },
  ];

  for (const t of tiles) {
    const tile = document.createElement("div");
    tile.className = "readout";
    tile.innerHTML = `
      <div class="label">${escapeHtml(t.label)}</div>
      <div class="value ${t.cls}">${escapeHtml(String(t.value))}</div>
    `;
    readoutRow.appendChild(tile);
  }

  if (ai_summary) {
    aiSummaryWrap.innerHTML = `<div class="ai-summary">${escapeHtml(ai_summary)}</div>`;
  }
}

function formatTs(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function renderChart(cycles) {
  const typeFiltered = voltageType === "all"
    ? cycles
    : cycles.filter(c => c.cycle_type === voltageType);
  const withCV = typeFiltered.filter(c => c.cell_voltages && c.cell_voltages.length > 1);
  if (withCV.length === 0) {
    voltageChart.classList.add("hidden");
    chartEmpty.classList.remove("hidden");
    chartEmpty.textContent = voltageType === "all"
      ? "No per-cell voltage data logged yet — the chart will appear once a cycle includes cell voltages."
      : `No ${voltageType} cycles with per-cell voltages yet.`;
    return;
  }
  voltageChart.classList.remove("hidden");
  chartEmpty.classList.add("hidden");

  const labels = withCV.map(c => formatTs(c.timestamp));
  const cellCount = withCV[0].cell_voltages.length;
  const colors = ["#54c7a2", "#5aa8e0", "#e0a64a", "#e0635a", "#a78bfa", "#f472b6", "#fb923c", "#34d399"];

  const datasets = Array.from({ length: cellCount }, (_, i) => ({
    label: `C${i + 1}`,
    data: withCV.map(c => c.cell_voltages[i]),
    borderColor: colors[i % colors.length],
    backgroundColor: "transparent",
    tension: 0.3,
    pointRadius: 3,
  }));

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(voltageChart, {
    type: "line",
    data: { labels, datasets },
    options: {
      animation: false,
      plugins: { legend: { labels: { color: "#8a93a3", boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: "#586271", maxRotation: 45 }, grid: { color: "#2c333d" } },
        y: { ticks: { color: "#586271" }, grid: { color: "#2c333d" } },
      },
    },
  });
}

chartToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".ct-btn");
  if (!btn) return;
  voltageType = btn.dataset.type;
  chartToggle.querySelectorAll(".ct-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderChart(lastCycles);
});

async function loadCycles() {
  const res = await fetch(`${API}/packs/${packId}/cycles`);
  if (!res.ok) return;
  const cycles = await res.json();
  lastCycles = cycles;

  renderChart(cycles);

  if (cycles.length === 0) {
    historyEmpty.classList.remove("hidden");
    return;
  }
  historyEmpty.classList.add("hidden");
  historyBody.innerHTML = "";

  for (const c of [...cycles].reverse()) {
    const spread = c.cell_voltages && c.cell_voltages.length > 1
      ? (Math.max(...c.cell_voltages) - Math.min(...c.cell_voltages)).toFixed(3)
      : "—";
    const avgCell = c.cell_voltages && c.cell_voltages.length > 0
      ? (c.cell_voltages.reduce((a, b) => a + b, 0) / c.cell_voltages.length).toFixed(3)
      : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(formatTs(c.timestamp))}</td>
      <td><span class="tag ${c.cycle_type}">${escapeHtml(c.cycle_type)}</span></td>
      <td class="mono">${c.pack_voltage !== null && c.pack_voltage !== undefined ? c.pack_voltage.toFixed(2) : "—"}</td>
      <td class="mono">${avgCell}</td>
      <td class="mono">${spread}</td>
      <td><span class="tag">${escapeHtml(c.source)}</span></td>
      <td>${c.notes ? escapeHtml(c.notes) : ""}</td>
      <td><button class="edit-cycle-btn" data-id="${c.id}" style="padding:4px 10px;font-size:12px;">Edit</button></td>
      <td><button class="delete-cycle-btn" data-id="${c.id}" style="padding:4px 10px;font-size:12px;color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">Delete</button></td>
    `;
    historyBody.appendChild(tr);
  }
}

deletePackBtn.addEventListener("click", async () => {
  if (!confirm(`Delete "${packData.name}" and all its cycles? This cannot be undone.`)) return;
  const res = await fetch(`${API}/packs/${packId}`, { method: "DELETE" });
  if (res.ok) {
    location.href = "/";
  } else {
    alert("Could not delete pack.");
  }
});

editPackBtn.addEventListener("click", () => {
  document.getElementById("ep-name").value = packData.name;
  document.getElementById("ep-cells").value = packData.cell_count;
  document.getElementById("ep-capacity").value = packData.capacity_mah ?? "";
  document.getElementById("ep-chem").value = packData.chemistry;
  document.getElementById("ep-sticker").value = packData.sticker ?? "";
  document.getElementById("ep-max-cycles").value = packData.max_cycles ?? "";
  document.getElementById("ep-notes").value = packData.notes ?? "";
  editPackPanel.classList.toggle("hidden");
});

cancelEditPack.addEventListener("click", () => {
  editPackPanel.classList.add("hidden");
  editPackForm.reset();
});

editPackForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("ep-name").value,
    cell_count: parseInt(document.getElementById("ep-cells").value, 10),
    capacity_mah: document.getElementById("ep-capacity").value
      ? parseInt(document.getElementById("ep-capacity").value, 10) : null,
    chemistry: document.getElementById("ep-chem").value,
    sticker: document.getElementById("ep-sticker").value || null,
    max_cycles: document.getElementById("ep-max-cycles").value
      ? parseInt(document.getElementById("ep-max-cycles").value, 10) : null,
    notes: document.getElementById("ep-notes").value || null,
  };

  const res = await fetch(`${API}/packs/${packId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    packData = await res.json();
    editPackPanel.classList.add("hidden");
    editPackForm.reset();
    renderPackHeader(packData);
    buildCellInputs(packData.cell_count, cellVoltageInputs, "0.001", "e.g. 4.16");
  } else {
    alert("Could not save changes.");
  }
});

let editingCycleId = null;

historyBody.addEventListener("click", async (e) => {
  const delBtn = e.target.closest(".delete-cycle-btn");
  if (delBtn) {
    if (!confirm("Delete this cycle? This cannot be undone.")) return;
    const res = await fetch(`${API}/cycles/${delBtn.dataset.id}`, { method: "DELETE" });
    if (res.ok) { await loadCycles(); await loadHealth(); }
    else alert("Could not delete cycle.");
    return;
  }

  const editBtn = e.target.closest(".edit-cycle-btn");
  if (!editBtn) return;

  const cycleId = parseInt(editBtn.dataset.id, 10);
  const res = await fetch(`${API}/cycles/${cycleId}`);
  if (!res.ok) return;
  const c = await res.json();

  editingCycleId = cycleId;

  document.getElementById("ec-type").value = c.cycle_type;
  document.getElementById("ec-voltage").value = c.pack_voltage ?? "";
  document.getElementById("ec-notes").value = c.notes ?? "";

  const ts = c.timestamp ? new Date(c.timestamp) : new Date();
  document.getElementById("ec-time").value = new Date(
    ts.getTime() - ts.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);

  buildCellInputs(packData.cell_count, ecCellVoltageInputs, "0.001", "e.g. 4.16");

  if (c.cell_voltages) {
    ecCellVoltageInputs.querySelectorAll("input").forEach((inp, i) => {
      if (c.cell_voltages[i] !== undefined) inp.value = c.cell_voltages[i];
    });
  }

  editCyclePanel.classList.remove("hidden");
  editCyclePanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

cancelEditCycle.addEventListener("click", () => {
  editCyclePanel.classList.add("hidden");
  editCycleForm.reset();
  editingCycleId = null;
});

editCycleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editingCycleId) return;

  const cvVals = [...ecCellVoltageInputs.querySelectorAll("input")]
    .map(i => i.value ? parseFloat(i.value) : null)
    .filter(v => v !== null);
  const timeVal = document.getElementById("ec-time").value;

  const body = {
    cycle_type: document.getElementById("ec-type").value,
    pack_voltage: document.getElementById("ec-voltage").value
      ? parseFloat(document.getElementById("ec-voltage").value) : null,
    cell_voltages: cvVals.length > 0 ? cvVals : null,
    timestamp: timeVal ? new Date(timeVal).toISOString() : null,
    notes: document.getElementById("ec-notes").value || null,
  };

  const res = await fetch(`${API}/cycles/${editingCycleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    editCyclePanel.classList.add("hidden");
    editCycleForm.reset();
    editingCycleId = null;
    await loadCycles();
    await loadHealth();
  } else {
    alert("Could not save cycle.");
  }
});

cycleForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const cvVals = [...cellVoltageInputs.querySelectorAll("input")]
    .map(i => i.value ? parseFloat(i.value) : null)
    .filter(v => v !== null);

  const timeVal = document.getElementById("cy-time").value;

  const body = {
    pack_id: packId,
    cycle_type: document.getElementById("cy-type").value,
    pack_voltage: document.getElementById("cy-voltage").value
      ? parseFloat(document.getElementById("cy-voltage").value) : null,
    cell_voltages: cvVals.length > 0 ? cvVals : null,
    timestamp: timeVal ? new Date(timeVal).toISOString() : null,
    notes: document.getElementById("cy-notes").value || null,
  };

  const res = await fetch(`${API}/cycles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    cycleForm.reset();
    const now = new Date();
    document.getElementById("cy-time").value = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    ).toISOString().slice(0, 16);
    await loadCycles();
    await loadHealth();
  } else {
    alert("Could not log cycle.");
  }
});

// ---------- Quick batch log (1S packs) ----------

const BATCH_VOLTAGE = { charge: 4.35, storage: 3.85 };
const batchCountInput = document.getElementById("batch-count");
const batchChargedBtn = document.getElementById("batch-charged-btn");
const batchStorageBtn = document.getElementById("batch-storage-btn");

async function logBatch(cycleType) {
  const count = parseInt(batchCountInput.value, 10);
  if (!count || count < 1) {
    alert("Enter how many 1S packs were used.");
    return;
  }

  const voltage = BATCH_VOLTAGE[cycleType];
  const label = cycleType === "charge" ? "charged" : "storage";
  const timestamp = new Date().toISOString();

  batchChargedBtn.disabled = true;
  batchStorageBtn.disabled = true;
  try {
    // One cycle per pack so the count reflects real wear on the batch.
    for (let i = 0; i < count; i++) {
      const res = await fetch(`${API}/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_id: packId,
          cycle_type: cycleType,
          pack_voltage: voltage,
          cell_voltages: [voltage],
          source: "batch",
          notes: `Batch ${label} (${i + 1} of ${count})`,
          timestamp,
        }),
      });
      if (!res.ok) throw new Error(`cycle ${i + 1} failed`);
    }
    await loadCycles();
    await loadHealth();
  } catch (err) {
    alert("Could not log all packs — some may not have been recorded.");
  } finally {
    batchChargedBtn.disabled = false;
    batchStorageBtn.disabled = false;
  }
}

batchChargedBtn.addEventListener("click", () => logBatch("charge"));
batchStorageBtn.addEventListener("click", () => logBatch("storage"));

// ---------- Theme toggle ----------

const themeBtn = document.getElementById("theme-btn");

function syncThemeBtn() {
  themeBtn.textContent = document.documentElement.dataset.theme === "light" ? "☀️" : "🌙";
}

themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("voltlog-theme", next);
  syncThemeBtn();
});
syncThemeBtn();

// ---------- Service worker ----------

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

async function init() {
  await loadPack();
  await Promise.all([loadHealth(), loadCycles()]);
}

init();
