const API = "/api";

const grid = document.getElementById("pack-grid");
const emptyState = document.getElementById("empty-state");
const addPackBtn = document.getElementById("add-pack-btn");
const addPackPanel = document.getElementById("add-pack-panel");
const cancelAddPack = document.getElementById("cancel-add-pack");
const addPackForm = document.getElementById("add-pack-form");

let allPacks = [];

addPackBtn.addEventListener("click", () => {
  addPackPanel.classList.toggle("hidden");
});

cancelAddPack.addEventListener("click", () => {
  addPackPanel.classList.add("hidden");
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
    addPackPanel.classList.add("hidden");
    loadPacks();
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

    const badgeRow = (gradeHtml || stickerHtml || storageHtml || retireHtml)
      ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;">${gradeHtml}${stickerHtml}${storageHtml}${retireHtml}</div>`
      : "";

    const lastUsedText = m.last_used_days !== null && m.last_used_days !== undefined
      ? `${m.last_used_days}d ago`
      : "Never used";
    const lastUsedStyle = m.last_used_days !== null && m.last_used_days > 30
      ? ' style="color:var(--watch);"'
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
  const activeCount = [grade, chem, health].filter(Boolean).length;
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

// ---------- Fleet summary ----------

const summaryBar = document.getElementById("summary-bar");
let donutChart = null;

const HEALTH_COLORS = {
  healthy: "#54c7a2",
  watch: "#e0a64a",
  check: "#e0635a",
  "no data": "#586271",
};

async function loadStats() {
  const res = await fetch(`${API}/stats`);
  if (!res.ok) return;
  const s = await res.json();

  if (s.total_packs === 0) {
    summaryBar.classList.add("hidden");
    return;
  }
  summaryBar.classList.remove("hidden");

  const attnCls = s.needs_attention > 0 ? "watch" : "healthy";
  const capacityAh = (s.total_capacity_mah / 1000).toFixed(1);

  summaryBar.innerHTML = `
    <div class="readout">
      <div class="label">Total packs</div>
      <div class="value">${s.total_packs}</div>
    </div>
    <div class="readout">
      <div class="label">Capacity</div>
      <div class="value">${capacityAh} Ah</div>
    </div>
    <div class="readout">
      <div class="label">Cycles (30d)</div>
      <div class="value">${s.cycles_30d}</div>
    </div>
    <div class="readout clickable" id="attn-tile" title="Show packs needing attention">
      <div class="label">Needs attention</div>
      <div class="value ${attnCls}">${s.needs_attention}</div>
    </div>
    <div class="readout">
      <div class="label">Quads</div>
      <div class="value">${s.quad_count ?? 0}</div>
    </div>
    <div class="readout">
      <div class="label">Flights (30d)</div>
      <div class="value">${s.flights_30d ?? 0}</div>
    </div>
    <div class="readout">
      <div class="label">Open jobs</div>
      <div class="value ${(s.open_maintenance ?? 0) > 0 ? "watch" : ""}">${s.open_maintenance ?? 0}</div>
    </div>
    <div class="summary-donut">
      <canvas id="health-donut" width="120" height="120"></canvas>
      <div class="donut-legend" id="donut-legend"></div>
    </div>
  `;

  // Clicking the attention tile jumps to the grid (filtering by "check" status).
  document.getElementById("attn-tile").addEventListener("click", () => {
    filterHealth.value = filterHealth.value === "check" ? "" : "check";
    applyFiltersAndRender();
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const order = ["healthy", "watch", "check", "no data"];
  const present = order.filter((k) => (s.health[k] || 0) > 0);
  const legend = document.getElementById("donut-legend");
  legend.innerHTML = present
    .map((k) => `<span><span class="dot" style="background:${HEALTH_COLORS[k]}"></span>${k} ${s.health[k]}</span>`)
    .join("");

  const ctx = document.getElementById("health-donut");
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: present,
      datasets: [{
        data: present.map((k) => s.health[k]),
        backgroundColor: present.map((k) => HEALTH_COLORS[k]),
        borderWidth: 0,
      }],
    },
    options: {
      animation: false,
      cutout: "70%",
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  });
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
    await loadStats();
  } else {
    const err = await res.json().catch(() => ({}));
    alert(`Import failed: ${err.detail || res.statusText}`);
  }
});

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
  await loadPacks();
  await loadStats();
  notifyHazards();
}

init();
