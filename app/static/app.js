const API = "/api";

const grid = document.getElementById("pack-grid");
const emptyState = document.getElementById("empty-state");
const todayDashboard = document.getElementById("today-dashboard");
const addPackBtn = document.getElementById("add-pack-btn");
const addPackPanel = document.getElementById("add-pack-panel");
const cancelAddPack = document.getElementById("cancel-add-pack");
const addPackForm = document.getElementById("add-pack-form");
const addPackSheet = window.VoltlogSheet?.setup(addPackPanel);

let allPacks = [];
let chargeFilter = "";   // "" | charged | storage | spent | unknown — driven by the charge chips
const SESSION_KEY = "voltlog-active-session";

addPackBtn.addEventListener("click", () => {
  addPackSheet ? addPackSheet.open() : addPackPanel.classList.remove("hidden");
});

cancelAddPack.addEventListener("click", () => {
  addPackSheet ? addPackSheet.close() : addPackPanel.classList.add("hidden");
  addPackForm.reset();
});

addPackForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const body = {
    name: document.getElementById("pk-name").value,
    brand: document.getElementById("pk-brand").value || null,
    cell_count: parseInt(document.getElementById("pk-cells").value, 10),
    capacity_mah: document.getElementById("pk-capacity").value
      ? parseInt(document.getElementById("pk-capacity").value, 10)
      : null,
    chemistry: document.getElementById("pk-chem").value,
    sticker: document.getElementById("pk-sticker").value || null,
    max_cycles: document.getElementById("pk-max-cycles").value
      ? parseInt(document.getElementById("pk-max-cycles").value, 10)
      : null,
    notes: document.getElementById("pk-notes").value || null,
  };

  const res = await fetch(`${API}/packs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    addPackForm.reset();
    addPackSheet ? addPackSheet.close() : addPackPanel.classList.add("hidden");
    await loadPacks();
    await Promise.all([loadStats(), loadTodayDashboard()]);
  } else {
    alert("Could not add pack.");
  }
});

function statusLabel(status) {
  switch (status) {
    case "healthy": return "Healthy";
    case "watch":   return "Watch";
    case "check":   return "Check soon";
    default:        return "No data";
  }
}

function statusClass(status) {
  return ["healthy", "watch", "check"].includes(status) ? status : "nodata";
}

function readoutValue(metrics) {
  if (metrics.latest_spread === null || metrics.latest_spread === undefined) {
    return { text: "—", cls: "dim" };
  }
  return {
    text: `${metrics.latest_spread.toFixed(3)} V spread`,
    cls: statusClass(metrics.status),
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderPacks(packs) {
  grid.innerHTML = "";

  if (packs.length === 0) {
    emptyState.classList.remove("hidden");
    emptyState.textContent = allPacks.length > 0
      ? "No packs match the current filters."
      : "No packs yet. Add your first one to start logging cycles.";
    return;
  }
  emptyState.classList.add("hidden");

  for (const pack of packs) {
    const card = document.createElement("a");
    card.href = `/pack?id=${pack.id}`;
    card.className = "pack-card";
    card.style.textDecoration = "none";
    card.style.color = "inherit";

    const m = pack.metrics;
    const cls = statusClass(m.status);
    const readout = readoutValue(m);
    const cycleCount = m.cycle_count;
    const chargeCount = m.charge_count ?? 0;

    const specBits = [`${pack.cell_count}S`];
    if (pack.capacity_mah) specBits.push(`${pack.capacity_mah}mAh`);
    specBits.push(pack.chemistry);

    const gradeHtml = pack.brand
      ? `<span class="grade-badge grade-${escapeHtml(pack.brand)}">${escapeHtml(pack.brand)}</span>`
      : "";
    const stickerHtml = pack.sticker
      ? `<span class="sticker-badge">🏷 ${escapeHtml(pack.sticker)}</span>`
      : "";
    const storageHtml = m.storage_warning
      ? `<span class="warn-badge">${m.storage_days != null ? `Charged ${m.storage_days}d` : "Sitting charged"}</span>`
      : "";
    const retireHtml = m.retirement_warning === "exceeded"
      ? `<span class="warn-badge critical">Cycle limit exceeded</span>`
      : m.retirement_warning === "approaching"
      ? `<span class="warn-badge">Approaching cycle limit</span>`
      : "";
    const CHARGE_BADGE = { charged: "⚡ Charged", storage: "Storage", spent: "Spent" };
    const chargeHtml = CHARGE_BADGE[m.charge_state]
      ? `<span class="charge-badge ${m.charge_state}">${CHARGE_BADGE[m.charge_state]}</span>`
      : "";
    // Flagged when a flight discharged the pack but its resting voltages were
    // never entered — mirrors the "Needs values" prompt on the session page.
    const needsValuesHtml = m.needs_values
      ? `<span class="warn-badge">Values not entered yet</span>`
      : "";

    const badgeRow = (chargeHtml || needsValuesHtml || gradeHtml || stickerHtml || storageHtml || retireHtml)
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;">${chargeHtml}${needsValuesHtml}${gradeHtml}${stickerHtml}${storageHtml}${retireHtml}</div>`
      : "";

    const lastUsedText = m.last_used_days !== null && m.last_used_days !== undefined
      ? `${m.last_used_days}d ago`
      : "Never used";
    const lastUsedStyle = m.last_used_days !== null && m.last_used_days > 30
      ? ' style="color:var(--watch);"'
      : "";

    const fillBtnHtml = m.needs_values
      ? `<button type="button" class="action-btn pack-fill-btn" data-fill-pack-id="${pack.id}">
           <svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
           <span>Fill in values</span>
         </button>`
      : "";

    card.innerHTML = `
      <div class="row-top">
        <div>
          <h3>${escapeHtml(pack.name)}</h3>
          <div class="spec">${escapeHtml(specBits.join(" · "))}</div>
          ${badgeRow}
        </div>
        <span class="pill ${cls}">${statusLabel(m.status)}</span>
      </div>
      <div class="readout">
        <div class="label">Latest cell spread</div>
        <div class="value ${readout.cls}">${readout.text}</div>
      </div>
      <div class="row-bottom">
        <span>${cycleCount} discharge / ${chargeCount} charge</span>
        <span${lastUsedStyle}>${lastUsedText}</span>
      </div>
      ${fillBtnHtml}
    `;
    grid.appendChild(card);
  }
}

const GRADE_ORDER  = { A: 0, B: 1, C: 2, Retired: 3 };
const HEALTH_ORDER = { healthy: 0, watch: 1, check: 2, "no data": 3 };

const filterToggle = document.getElementById("filter-toggle");
const filterPanel  = document.getElementById("filter-panel");
const filterBadge  = document.getElementById("filter-badge");
const filterCount  = document.getElementById("filter-count");
const clearBtn     = document.getElementById("clear-filters");
const filterGrade  = document.getElementById("filter-grade");
const filterChem   = document.getElementById("filter-chem");
const filterHealth = document.getElementById("filter-health");
const sortToggle   = document.getElementById("sort-toggle");
const sortPanel    = document.getElementById("sort-panel");
const sortEl       = document.getElementById("sort-by");
const sortOrder    = document.getElementById("sort-order");

function clearFilters() {
  filterGrade.value = filterChem.value = filterHealth.value = "";
  chargeFilter = "";
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const grade  = filterGrade.value;
  const chem   = filterChem.value;
  const health = filterHealth.value;

  let filtered = allPacks.filter(p => {
    if (grade  && p.brand          !== grade)  return false;
    if (chem   && p.chemistry      !== chem)   return false;
    if (health && p.metrics.status !== health) return false;
    if (chargeFilter && p.metrics.charge_state !== chargeFilter) return false;
    return true;
  });

  const sortBy = sortEl.value;
  const sortDir = sortOrder.value === "desc" ? -1 : 1;
  filtered.sort((a, b) => {
    let r = 0;
    if (sortBy === "name")
      r = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    else if (sortBy === "last_used")
      r = (a.metrics.last_used_days ?? Infinity) - (b.metrics.last_used_days ?? Infinity);
    else if (sortBy === "grade")
      r = (GRADE_ORDER[a.brand] ?? 4) - (GRADE_ORDER[b.brand] ?? 4);
    else if (sortBy === "health")
      r = (HEALTH_ORDER[a.metrics.status] ?? 3) - (HEALTH_ORDER[b.metrics.status] ?? 3);
    return r * sortDir;
  });

  // Active-filter feedback: button badge + panel footer
  const activeCount = [grade, chem, health, chargeFilter].filter(Boolean).length;
  filterBadge.textContent = activeCount;
  filterBadge.classList.toggle("hidden", activeCount === 0);
  filterToggle.classList.toggle("has-filters", activeCount > 0);

  if (activeCount > 0) {
    filterCount.textContent = `${filtered.length} of ${allPacks.length}`;
    clearBtn.classList.remove("disabled");
  } else {
    filterCount.textContent = `${allPacks.length} pack${allPacks.length === 1 ? "" : "s"}`;
    clearBtn.classList.add("disabled");
  }

  renderPacks(filtered);
  syncHealthChipButtons();
  syncChargeChips();
}

// --- Popover open/close (shared by filter + sort menus) ---
function togglePopover(panel, toggle) {
  const willOpen = panel.classList.contains("hidden");
  closePopovers();
  panel.classList.toggle("hidden", !willOpen);
  toggle.classList.toggle("open", willOpen);
}

function closePopovers() {
  filterPanel.classList.add("hidden");
  filterToggle.classList.remove("open");
  sortPanel.classList.add("hidden");
  sortToggle.classList.remove("open");
}

filterToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePopover(filterPanel, filterToggle);
});

sortToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePopover(sortPanel, sortToggle);
});

document.addEventListener("click", (e) => {
  if (filterToggle.contains(e.target) || filterPanel.contains(e.target)) return;
  if (sortToggle.contains(e.target) || sortPanel.contains(e.target)) return;
  closePopovers();
});

[filterGrade, filterChem, filterHealth, sortEl, sortOrder].forEach(el =>
  el.addEventListener("change", applyFiltersAndRender)
);

clearBtn.addEventListener("click", clearFilters);

async function loadPacks() {
  const res = await fetch(`${API}/packs`);
  allPacks = await res.json();
  applyFiltersAndRender();
}

// ---------- Fill in resting voltages (spent packs needing values) ----------
// Lets you clear out the post-session backlog of spent batteries from the pack
// list without opening each pack page. Edits the blank discharge cycle a flight
// left behind (same flow as the session tab).
const fillPanel = document.getElementById("fill-values-panel");
const fillForm = document.getElementById("fill-values-form");
const fillPackLabel = document.getElementById("fv-pack-label");
const fillVoltageEl = document.getElementById("fv-voltage");
const fillCellInputs = document.getElementById("fv-cell-inputs");
const fillNotesEl = document.getElementById("fv-notes");
const cancelFillBtn = document.getElementById("cancel-fill-values");
const fillSheet = window.VoltlogSheet?.setup(fillPanel);
const packToast = document.getElementById("pack-toast");
let fillCycleId = null;
let packToastTimer = null;

function showPackToast(text) {
  if (!packToast) return;
  packToast.textContent = text;
  packToast.classList.remove("hidden");
  clearTimeout(packToastTimer);
  packToastTimer = setTimeout(() => packToast.classList.add("hidden"), 2600);
}

function buildFillCellInputs(count) {
  fillCellInputs.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `<label>C${i + 1}</label>`
      + `<input type="number" step="0.001" placeholder="e.g. 3.85" data-cell="${i}">`;
    fillCellInputs.appendChild(field);
  }
}

async function openFillValues(packId) {
  const pack = allPacks.find((p) => p.id === packId);
  if (!pack) return;
  let cycles;
  try {
    cycles = await fetch(`${API}/packs/${packId}/cycles`).then((r) => r.json());
  } catch (_) {
    showPackToast("Couldn't load that pack's cycles.");
    return;
  }
  const blank = [...cycles].reverse().find((c) =>
    c.cycle_type === "discharge"
    && (c.pack_voltage === null || c.pack_voltage === undefined)
    && (!c.cell_voltages || c.cell_voltages.length === 0));
  if (!blank) {
    showPackToast("Nothing to fill in for that pack.");
    await loadPacks();
    return;
  }

  fillCycleId = blank.id;
  const specBits = [`${pack.cell_count}S`];
  if (pack.capacity_mah) specBits.push(`${pack.capacity_mah}mAh`);
  specBits.push(pack.chemistry);
  fillPackLabel.textContent = `${pack.name} · ${specBits.join(" · ")}`;
  fillVoltageEl.value = "";
  fillNotesEl.value = "";
  buildFillCellInputs(pack.cell_count);
  fillSheet ? fillSheet.open() : fillPanel.classList.remove("hidden");
}

grid.addEventListener("click", (e) => {
  const fillBtn = e.target.closest(".pack-fill-btn");
  if (!fillBtn) return;
  // The card is a link — keep the click from navigating to the pack page.
  e.preventDefault();
  e.stopPropagation();
  openFillValues(parseInt(fillBtn.dataset.fillPackId, 10));
});

fillForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!fillCycleId) return;
  const cvVals = [...fillCellInputs.querySelectorAll("input")]
    .map((i) => (i.value ? parseFloat(i.value) : null))
    .filter((v) => v !== null);
  const packV = fillVoltageEl.value ? parseFloat(fillVoltageEl.value) : null;
  if (packV === null && cvVals.length === 0) {
    alert("Enter the pack voltage or at least one cell voltage.");
    return;
  }

  const body = { pack_voltage: packV, cell_voltages: cvVals.length ? cvVals : null };
  if (fillNotesEl.value.trim()) body.notes = fillNotesEl.value.trim();

  try {
    const res = await fetch(`${API}/cycles/${fillCycleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("fill");
    fillSheet ? fillSheet.close() : fillPanel.classList.add("hidden");
    fillForm.reset();
    fillCycleId = null;
    showPackToast("Values saved");
    await loadPacks();
    await Promise.all([loadStats(), loadTodayDashboard()]);
  } catch (_) {
    alert("Could not save those values.");
  }
});

cancelFillBtn.addEventListener("click", () => {
  fillSheet ? fillSheet.close() : fillPanel.classList.add("hidden");
  fillForm.reset();
  fillCycleId = null;
});

// ---------- Today dashboard ----------

function loadActiveSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.startedAt) return null;
    if (!Array.isArray(session.flights)) session.flights = [];
    return session;
  } catch (_) {
    return null;
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return false;
  const start = startOfToday();
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return d >= start && d < end;
}

function formatClock(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatTodayDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function durationBrief(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (window.fmtDuration) return window.fmtDuration(total);
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function compactCount(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

function hasWeatherValue(v) {
  return v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
}

function normalizeWeather(item) {
  if (!item) return null;
  const w = item.weather || {};
  const wind = w.wind_mph ?? item.weather_wind_mph;
  const gust = w.gust_mph ?? item.weather_gust_mph;
  const temp = w.temp_f ?? item.weather_temp_f;
  const precip = w.precip_in ?? item.weather_precip_in;
  const hasAny = [wind, gust, temp, precip].some(hasWeatherValue);
  if (!hasAny) return null;
  return {
    wind: hasWeatherValue(wind) ? Number(wind) : null,
    gust: hasWeatherValue(gust) ? Number(gust) : null,
    temp: hasWeatherValue(temp) ? Number(temp) : null,
    precip: hasWeatherValue(precip) ? Number(precip) : null,
    source: w.source || item.weather_source || "Open-Meteo",
  };
}

function weatherMetrics(todayFlights, sessionFlights) {
  const sessionItems = [...sessionFlights].reverse();
  const source = [...todayFlights, ...sessionItems].find((item) => normalizeWeather(item));
  const weather = normalizeWeather(source);
  if (!weather) {
    return {
      wind: {
        value: "No wind",
        detail: todayFlights.length ? "Set a session pin next time" : "Add weather from Session",
      },
      temp: {
        value: "--",
        detail: "No temperature saved",
      },
      precip: {
        value: "--",
        detail: "No precipitation saved",
      },
      source: "",
    };
  }

  return {
    wind: {
      value: weather.wind == null ? "Wind saved" : `${Math.round(weather.wind)} mph`,
      detail: weather.gust == null ? weather.source : `Gust ${Math.round(weather.gust)} mph`,
    },
    temp: {
      value: weather.temp == null ? "--" : `${Math.round(weather.temp)} F`,
      detail: weather.temp == null ? "No temperature saved" : weather.source,
    },
    precip: {
      value: weather.precip == null ? "--" : `${weather.precip.toFixed(weather.precip >= 0.1 ? 2 : 3)} in`,
      detail: weather.precip && weather.precip > 0 ? "Precipitation logged" : "No rain logged",
    },
    source: weather.source,
  };
}

function todayMetric(label, value, detail, tone = "", extraClass = "") {
  const toneClass = tone ? ` ${tone}` : "";
  return `
    <div class="today-metric readout${extraClass}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value${toneClass}">${escapeHtml(value)}</span>
      <span class="today-detail">${escapeHtml(detail)}</span>
    </div>
  `;
}

function todayMetricLink(label, value, detail, href, tone = "") {
  const toneClass = tone ? ` ${tone}` : "";
  return `
    <a class="today-metric readout clickable" href="${href}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value${toneClass}">${escapeHtml(value)}</span>
      <span class="today-detail">${escapeHtml(detail)}</span>
    </a>
  `;
}

function latestFlightLine(flight) {
  if (!flight) return "No flights logged today yet.";
  const when = formatClock(flight.timestamp);
  const quad = flight.quad_name || "Unknown quad";
  const pack = flight.pack_name || "no pack";
  return `Latest ${when ? `${when} / ` : ""}${quad} / ${pack}`;
}

async function loadTodayDashboard() {
  if (!todayDashboard) return;
  const session = loadActiveSession();
  const sessionFlights = session?.flights || [];

  try {
    const flightsRes = await fetch(`${API}/flights?limit=250`);
    const flights = flightsRes.ok ? await flightsRes.json() : [];
    const todayFlights = flights.filter((flight) => isToday(flight.timestamp));
    const totalSec = todayFlights.reduce((sum, flight) => sum + (Number(flight.duration_sec) || 0), 0);
    const packsUsed = new Set(todayFlights.map((flight) => flight.pack_id).filter(Boolean)).size;
    const quadsUsed = new Set(todayFlights.map((flight) => flight.quad_id).filter(Boolean)).size;
    const sessionSec = sessionFlights.reduce((sum, flight) => sum + (Number(flight.duration_sec) || 0), 0);
    const weather = weatherMetrics(todayFlights, sessionFlights);
    const latest = todayFlights[0] || null;
    const sessionCopy = session
      ? `Started ${formatClock(session.startedAt)} / ${compactCount(sessionFlights.length, "flight")} / ${durationBrief(sessionSec)} session airtime`
      : `${formatTodayDate()} / no active session`;
    const flags = [];
    if (weather.source) flags.push(`Weather from ${weather.source}`);
    else flags.push("Set a session pin for weather");
    if (!todayFlights.length && !session) flags.push("No flights logged today");

    todayDashboard.classList.remove("hidden");
    todayDashboard.innerHTML = `
      <div class="today-head">
        <div>
          <div class="today-kicker">${session ? '<span class="today-dot"></span>Session active' : "Today"}</div>
          <h2>${session ? "Current flight session" : "Today dashboard"}</h2>
          <p>${escapeHtml(sessionCopy)}</p>
        </div>
        <div class="today-actions">
          <a class="icon-btn primary" href="/session">${session ? "Open session" : "Start session"}</a>
          <a class="icon-btn" href="/flights">Flight log</a>
        </div>
      </div>
      <div class="today-grid">
        ${todayMetricLink("Flights today", String(todayFlights.length), latestFlightLine(latest), "/flights")}
        ${todayMetric("Airtime", durationBrief(totalSec), session ? `${durationBrief(sessionSec)} in active session` : "Logged flight time")}
        ${todayMetric("Packs used", String(packsUsed), `${compactCount(quadsUsed, "quad")} flown`)}
        ${todayMetricLink("Wind", weather.wind.value, weather.wind.detail, "/session")}
        ${todayMetricLink("Temp", weather.temp.value, weather.temp.detail, "/session")}
        ${todayMetricLink("Precip", weather.precip.value, weather.precip.detail, "/session")}
      </div>
      <div class="today-flags" aria-label="Today flags">
        ${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}
      </div>
    `;
  } catch (_) {
    todayDashboard.classList.remove("hidden");
    todayDashboard.innerHTML = `
      <div class="today-head">
        <div>
          <div class="today-kicker">Today</div>
          <h2>Today dashboard</h2>
          <p>Could not load today data right now.</p>
        </div>
        <div class="today-actions">
          <a class="icon-btn primary" href="/session">Open session</a>
        </div>
      </div>
    `;
  }
}

// ---------- Fleet summary ----------

const summaryBar = document.getElementById("summary-bar");

const HEALTH_META = {
  healthy: { label: "Healthy", hint: "Cells balanced", tone: "healthy" },
  watch: { label: "Watch", hint: "Monitor soon", tone: "watch" },
  check: { label: "Check soon", hint: "Needs attention", tone: "check" },
  "no data": { label: "No data", hint: "Needs first reading", tone: "nodata" },
};

// Charge state is a separate axis from health: a pack can be perfectly healthy
// but sitting at storage voltage (not ready to fly). This is the field view.
const CHARGE_META = {
  charged: { label: "Charged", hint: "Ready to fly", tone: "healthy" },
  storage: { label: "Storage", hint: "Charge before flying", tone: "info" },
  spent: { label: "Spent", hint: "Flown — recharge", tone: "watch" },
  unknown: { label: "No data", hint: "Log a charge or storage", tone: "nodata" },
};

function syncHealthChipButtons() {
  summaryBar?.querySelectorAll("[data-health-filter]").forEach((btn) => {
    btn.classList.toggle("active", filterHealth.value === btn.dataset.healthFilter);
  });
}

function syncChargeChips() {
  summaryBar?.querySelectorAll("[data-charge-filter]").forEach((btn) => {
    btn.classList.toggle("active", chargeFilter === btn.dataset.chargeFilter);
  });
}

function pct(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function renderHealthPanel(s) {
  const order = ["healthy", "watch", "check", "no data"];
  const health = s.health || {};
  const total = s.total_packs || order.reduce((sum, key) => sum + (health[key] || 0), 0);
  const ready = health.healthy || 0;
  const attention = (health.watch || 0) + (health.check || 0);
  const noData = health["no data"] || 0;
  const healthAttention = attention;
  const headline = `${ready} healthy / ${total} total`;
  const subline = attention > 0
    ? `${attention} pack${attention === 1 ? "" : "s"} need a look`
    : noData > 0
    ? `${noData} pack${noData === 1 ? "" : "s"} need first data`
    : "Fleet is fully logged";
  const scoreTone = healthAttention > 0 ? "watch" : "healthy";

  const cells = order
    .flatMap((key) => {
      const meta = HEALTH_META[key];
      const count = health[key] || 0;
      return Array.from({ length: count }, () => `<span class="health-cell ${meta.tone}" title="${meta.label}"></span>`);
    })
    .join("");

  const chips = order.map((key) => {
    const meta = HEALTH_META[key];
    const count = health[key] || 0;
    const active = filterHealth.value === key ? " active" : "";
    return `
      <button type="button" class="health-chip ${meta.tone}${active}" data-health-filter="${key}">
        <span class="health-chip-count">${count}</span>
        <span class="health-chip-copy">
          <strong>${meta.label}</strong>
          <em>${pct(count, total)}% - ${meta.hint}</em>
        </span>
      </button>
    `;
  }).join("");

  // ----- Charge state (field readiness) — a separate axis from health -----
  const charge = s.charge || {};
  const chargeOrder = ["charged", "storage", "spent", "unknown"];
  const chargedCount = charge.charged || 0;
  const chargeCells = chargeOrder
    .flatMap((key) => {
      const meta = CHARGE_META[key];
      const count = charge[key] || 0;
      return Array.from({ length: count }, () => `<span class="health-cell ${meta.tone}" title="${meta.label}"></span>`);
    })
    .join("");
  const chargeChips = chargeOrder
    .filter((key) => (charge[key] || 0) > 0)
    .map((key) => {
      const meta = CHARGE_META[key];
      const count = charge[key] || 0;
      const active = chargeFilter === key ? " active" : "";
      return `
        <button type="button" class="health-chip ${meta.tone}${active}" data-charge-filter="${key}">
          <span class="health-chip-count">${count}</span>
          <span class="health-chip-copy">
            <strong>${meta.label}</strong>
            <em>${meta.hint}</em>
          </span>
        </button>
      `;
    }).join("");

  return `
    <section class="summary-health" aria-label="Pack health distribution">
      <div class="summary-health-head">
        <div>
          <div class="label">Pack health</div>
          <div class="summary-health-title">${headline}</div>
          <div class="summary-health-subtitle">${subline}</div>
        </div>
        <div class="summary-health-score ${scoreTone}">
          <span>${healthAttention}</span>
          <small>attention</small>
        </div>
      </div>
      <div class="health-cells" aria-hidden="true">${cells}</div>
      <div class="health-grid">${chips}</div>
      <div class="charge-state">
        <div class="charge-state-head">
          <div class="label">Charge state</div>
          <div class="charge-state-title"><span class="charged-num">${chargedCount}</span> ready to fly</div>
        </div>
        <div class="health-battery" aria-hidden="true">
          <div class="health-battery-body">${chargeCells}</div>
          <div class="health-battery-cap"></div>
        </div>
        <div class="health-grid">${chargeChips}</div>
      </div>
    </section>
  `;
}

async function loadStats() {
  const res = await fetch(`${API}/stats`);
  if (!res.ok) return;
  const s = await res.json();

  if (s.total_packs === 0) {
    summaryBar.classList.add("hidden");
    return;
  }
  summaryBar.classList.remove("hidden");

  // The Pack-health panel is the only dashboard summary now — the old stat
  // tiles (packs/capacity/cycles/quads/flights/jobs) were removed as redundant.
  summaryBar.innerHTML = renderHealthPanel(s);

  summaryBar.querySelectorAll("[data-health-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.healthFilter;
      filterHealth.value = filterHealth.value === next ? "" : next;
      applyFiltersAndRender();
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  summaryBar.querySelectorAll("[data-charge-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.chargeFilter;
      chargeFilter = chargeFilter === next ? "" : next;
      applyFiltersAndRender();
      grid.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  syncHealthChipButtons();
  syncChargeChips();
}

// ---------- CSV export / import ----------

document.getElementById("export-btn").addEventListener("click", () => {
  location.href = `${API}/export.csv`;
});

// Blank import template — header matches /api/export.csv plus one example row.
const TEMPLATE_CSV = [
  "pack_name,brand,cell_count,capacity_mah,chemistry,sticker,max_cycles,timestamp,cycle_type,pack_voltage,cell_voltages,source,notes",
  "Tattu 1300 #1,A,4,1300,LiPo,red dot,200,2026-06-16T14:30:00+00:00,discharge,14.80,3.70;3.71;3.69;3.70,manual,example row -- edit or delete",
].join("\r\n") + "\r\n";

document.getElementById("template-btn").addEventListener("click", () => {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "voltlog-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
});

const importFile = document.getElementById("import-file");
document.getElementById("import-btn").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API}/import`, { method: "POST", body: form });
  importFile.value = "";

  if (res.ok) {
    const r = await res.json();
    alert(`Imported: ${r.packs_created} new pack(s), ${r.cycles_added} cycle(s)` +
      (r.skipped ? `, ${r.skipped} row(s) skipped.` : "."));
    await loadPacks();
    await Promise.all([loadStats(), loadTodayDashboard()]);
  } else {
    const err = await res.json().catch(() => ({}));
    alert(`Import failed: ${err.detail || res.statusText}`);
  }
});

// ---------- Storage-hazard notifications ----------
// Browser push while the app is closed needs a push server (VAPID); that's out
// of scope here. Instead we surface hazards as a local notification when the
// dashboard is open, gated behind an explicit user gesture (the bell button).

function hazardCount() {
  return allPacks.filter((p) => p.metrics.storage_warning).length;
}

function notifyHazards() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const n = hazardCount();
  if (n === 0) return;
  navigator.serviceWorker?.ready.then((reg) => {
    reg.showNotification("Voltlog — storage hazard", {
      body: `${n} pack(s) sitting charged — discharge to storage.`,
      icon: "/static/icon.svg",
      badge: "/static/icon.svg",
      tag: "voltlog-hazard",
    });
  });
}

document.getElementById("bell-btn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    alert("This browser doesn't support notifications.");
    return;
  }
  let perm = Notification.permission;
  if (perm !== "granted") perm = await Notification.requestPermission();
  if (perm === "granted") {
    const n = hazardCount();
    alert(n > 0
      ? `Alerts enabled. ${n} pack(s) currently need discharging.`
      : "Alerts enabled. No packs are sitting charged right now.");
    notifyHazards();
  } else {
    alert("Notifications were not allowed.");
  }
});

async function init() {
  await loadPacks();
  await Promise.all([loadStats(), loadTodayDashboard()]);
  notifyHazards();
}

init();
