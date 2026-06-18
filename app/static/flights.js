const API = "/api";

const summaryRow = document.getElementById("summary-row");
const form = document.getElementById("flight-form");
const addFlightBtn = document.getElementById("add-flight-btn");
const formPanel = document.getElementById("flight-form-panel");
const quadSel = document.getElementById("f-quad");
const packSel = document.getElementById("f-pack");
const submitBtn = document.getElementById("flight-submit");
const cancelBtn = document.getElementById("flight-cancel");
const body = document.getElementById("flights-body");
const emptyEl = document.getElementById("flights-empty");
const flightSheet = window.VoltlogSheet?.setup(formPanel);

let editingId = null;

function nowLocalInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function loadSelects() {
  const [quads, packs] = await Promise.all([
    fetch(`${API}/quads`).then((r) => r.json()),
    fetch(`${API}/packs`).then((r) => r.json()),
  ]);
  quadSel.innerHTML = `<option value="">— pick a quad —</option>` +
    quads.map((q) => `<option value="${q.id}">${escapeHtml(q.name)}</option>`).join("");
  packSel.innerHTML = `<option value="">— none —</option>` +
    packs.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
}

function durationToInputs(sec) {
  document.getElementById("f-min").value = Math.floor((sec || 0) / 60) || "";
  document.getElementById("f-sec").value = (sec || 0) % 60 || "";
}

function inputsToDuration() {
  const min = parseInt(document.getElementById("f-min").value || "0", 10);
  const sec = parseInt(document.getElementById("f-sec").value || "0", 10);
  return min * 60 + sec;
}

function fmtFlightWeather(f) {
  if (f.weather_wind_mph == null && f.weather_gust_mph == null && f.weather_precip_in == null) {
    return '<span class="tag">--</span>';
  }
  const parts = [];
  if (f.weather_wind_mph != null) parts.push(`Wind ${Math.round(Number(f.weather_wind_mph))} mph`);
  if (f.weather_gust_mph != null) parts.push(`gust ${Math.round(Number(f.weather_gust_mph))}`);
  if (f.weather_precip_in != null && Number(f.weather_precip_in) > 0) {
    const p = Number(f.weather_precip_in);
    parts.push(`precip ${p >= 0.1 ? p.toFixed(2) : p.toFixed(3)} in`);
  }
  return escapeHtml(parts.join(" / "));
}

function renderSummary(flights) {
  const now = new Date();
  const ym = now.getFullYear() * 12 + now.getMonth();
  let monthCount = 0, totalSec = 0;
  for (const f of flights) {
    totalSec += f.duration_sec || 0;
    const d = new Date(f.timestamp);
    if (d.getFullYear() * 12 + d.getMonth() === ym) monthCount++;
  }
  const tiles = [
    { label: "Total flights", value: flights.length },
    { label: "This month", value: monthCount },
    { label: "Total airtime", value: fmtHours(totalSec) },
  ];
  summaryRow.innerHTML = tiles.map((t) => `
    <div class="readout"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>
  `).join("");
}

function renderTable(flights) {
  if (flights.length === 0) {
    emptyEl.classList.remove("hidden");
    body.innerHTML = "";
    return;
  }
  emptyEl.classList.add("hidden");
  body.innerHTML = "";
  for (const f of flights) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(fmtTs(f.timestamp))}</td>
      <td>${f.quad_name ? escapeHtml(f.quad_name) : '<span class="tag">—</span>'}</td>
      <td>${f.pack_name ? escapeHtml(f.pack_name) : '<span class="tag">—</span>'}</td>
      <td class="mono">${fmtDuration(f.duration_sec)}</td>
      <td>${escapeHtml(f.location || "")}</td>
      <td>${fmtFlightWeather(f)}</td>
      <td>${escapeHtml(f.notes || "")}</td>
      <td><button class="edit-flight" data-id="${f.id}" style="padding:4px 10px;font-size:12px;">Edit</button></td>
      <td><button class="del-flight" data-id="${f.id}" style="padding:4px 10px;font-size:12px;color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">Delete</button></td>
    `;
    body.appendChild(tr);
  }
}

async function load() {
  const flights = await fetch(`${API}/flights`).then((r) => r.json());
  renderSummary(flights);
  renderTable(flights);
}

function resetForm() {
  editingId = null;
  form.reset();
  document.getElementById("f-time").value = nowLocalInput();
  submitBtn.textContent = "Log flight";
  cancelBtn.classList.add("hidden");
}

function openFlightSheet() {
  flightSheet ? flightSheet.open() : formPanel.classList.remove("hidden");
}

function closeFlightSheet() {
  flightSheet ? flightSheet.close() : formPanel.classList.add("hidden");
}

addFlightBtn.addEventListener("click", () => {
  resetForm();
  openFlightSheet();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const dur = inputsToDuration();
  if (dur <= 0) { alert("Enter a flight time greater than zero."); return; }
  const timeVal = document.getElementById("f-time").value;
  const body = {
    quad_id: quadSel.value ? parseInt(quadSel.value, 10) : null,
    pack_id: packSel.value ? parseInt(packSel.value, 10) : null,
    timestamp: timeVal ? new Date(timeVal).toISOString() : null,
    duration_sec: dur,
    location: document.getElementById("f-location").value || null,
    notes: document.getElementById("f-notes").value || null,
  };
  const url = editingId ? `${API}/flights/${editingId}` : `${API}/flights`;
  const res = await fetch(url, {
    method: editingId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    resetForm();
    closeFlightSheet();
    load();
  } else {
    alert("Could not save flight.");
  }
});

cancelBtn.addEventListener("click", () => {
  resetForm();
  closeFlightSheet();
});

body.addEventListener("click", async (e) => {
  const del = e.target.closest(".del-flight");
  if (del) {
    if (!confirm("Delete this flight?")) return;
    await fetch(`${API}/flights/${del.dataset.id}`, { method: "DELETE" });
    load();
    return;
  }
  const edit = e.target.closest(".edit-flight");
  if (!edit) return;
  const f = await fetch(`${API}/flights/${edit.dataset.id}`).then((r) => r.json());
  editingId = f.id;
  quadSel.value = f.quad_id ?? "";
  packSel.value = f.pack_id ?? "";
  const ts = f.timestamp ? new Date(f.timestamp) : new Date();
  document.getElementById("f-time").value =
    new Date(ts.getTime() - ts.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  durationToInputs(f.duration_sec);
  document.getElementById("f-location").value = f.location || "";
  document.getElementById("f-notes").value = f.notes || "";
  submitBtn.textContent = "Save changes";
  cancelBtn.classList.remove("hidden");
  openFlightSheet();
});

async function init() {
  await loadSelects();
  document.getElementById("f-time").value = nowLocalInput();
  await load();
}

init();
