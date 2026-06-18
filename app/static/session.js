const API = "/api";

const summaryEl = document.getElementById("session-summary");
const form = document.getElementById("session-form");
const quadSel = document.getElementById("s-quad");
const locationEl = document.getElementById("s-location");
const locateBtn = document.getElementById("s-locate");
const mapEl = document.getElementById("s-map");
const coordsEl = document.getElementById("s-coords");
const weatherStatusEl = document.getElementById("weather-status");
const weatherWindEl = document.getElementById("weather-wind");
const weatherGustEl = document.getElementById("weather-gust");
const weatherPrecipEl = document.getElementById("weather-precip");
const weatherTempEl = document.getElementById("weather-temp");
const weatherRefreshBtn = document.getElementById("weather-refresh");
const durationEl = document.getElementById("s-duration");
const noteEl = document.getElementById("s-note");
const damageEl = document.getElementById("s-damage");
const damageWrap = document.getElementById("damage-note-wrap");
const damageNoteEl = document.getElementById("s-damage-note");
const readyOnlyEl = document.getElementById("s-ready-only");
const packGrid = document.getElementById("session-pack-grid");
const emptyEl = document.getElementById("session-empty");
const packCountEl = document.getElementById("session-pack-count");
const toastEl = document.getElementById("session-toast");

// "Fill in values" sheet — edits the blank discharge cycle a logged flight left
// behind, without leaving the session tab.
const fillPanel = document.getElementById("fill-values-panel");
const fillForm = document.getElementById("fill-values-form");
const fillPackLabel = document.getElementById("fv-pack-label");
const fillVoltageEl = document.getElementById("fv-voltage");
const fillCellInputs = document.getElementById("fv-cell-inputs");
const fillNotesEl = document.getElementById("fv-notes");
const cancelFillBtn = document.getElementById("cancel-fill-values");
const fillSheet = window.VoltlogSheet?.setup(fillPanel);
let fillCycleId = null;

let quads = [];
let packs = [];

// Map-picked location. pickedLat/pickedLng are sent with each flight; the text
// field holds a human label (reverse-geocoded or hand-typed). Map is optional —
// if tiles/geocoding fail in the field, typing a label by hand still works.
let map = null;
let marker = null;
let pickedLat = null;
let pickedLng = null;
let weatherSnapshot = null;
let weatherPointKey = null;
let weatherTimer = null;
let weatherLoading = false;

// An active session is persisted, so it survives navigating away / reloading;
// it ends only when you tap "End session" — not when you click out.
const SESSION_KEY = "voltlog-active-session";
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
  catch { return null; }
}
function saveSession() {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
let session = loadSession();
let sessionFlights = session ? session.flights : [];

let toastTimer = null;

function selectedQuad() {
  const id = parseInt(quadSel.value || "0", 10);
  return quads.find((q) => q.id === id) || null;
}

function selectedBatteryCellCount() {
  const quad = selectedQuad();
  return quad && quad.battery_cell_count ? parseInt(quad.battery_cell_count, 10) : null;
}

function durationSec() {
  return parseInt(durationEl.value || "0", 10);
}

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

function latestSpread(metrics) {
  if (metrics.latest_spread === null || metrics.latest_spread === undefined) {
    return { text: "--", cls: "dim" };
  }
  return {
    text: `${metrics.latest_spread.toFixed(3)} V spread`,
    cls: statusClass(metrics.status),
  };
}

function packSpec(pack) {
  const bits = [`${pack.cell_count}S`];
  if (pack.capacity_mah) bits.push(`${pack.capacity_mah}mAh`);
  bits.push(pack.chemistry);
  return bits.join(" / ");
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

// ----- Weather snapshot (Open-Meteo current conditions) -----
function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function fmtWind(v) {
  return v == null ? "--" : `${Math.round(Number(v))} mph`;
}

function fmtTemp(v) {
  return v == null ? "--" : `${Math.round(Number(v))} F`;
}

function fmtPrecip(v) {
  if (v == null) return "--";
  const n = Number(v);
  return `${n >= 0.1 ? n.toFixed(2) : n.toFixed(3)} in`;
}

function weatherPayload(w) {
  if (!w) return {};
  return {
    weather_fetched_at: w.fetched_at || null,
    weather_temp_f: w.temp_f ?? null,
    weather_wind_mph: w.wind_mph ?? null,
    weather_gust_mph: w.gust_mph ?? null,
    weather_precip_in: w.precip_in ?? null,
    weather_code: w.code ?? null,
    weather_source: w.source || "Open-Meteo",
  };
}

function renderWeather() {
  const hasPoint = pickedLat != null && pickedLng != null;
  if (weatherRefreshBtn) weatherRefreshBtn.disabled = !hasPoint || weatherLoading;
  if (!hasPoint) {
    weatherStatusEl.textContent = "Set a map pin to fetch wind.";
    weatherWindEl.textContent = weatherGustEl.textContent = weatherPrecipEl.textContent = weatherTempEl.textContent = "--";
    return;
  }
  if (weatherLoading) {
    weatherStatusEl.textContent = "Fetching field conditions...";
    return;
  }
  if (!weatherSnapshot) {
    weatherStatusEl.textContent = "Weather not loaded yet.";
    weatherWindEl.textContent = weatherGustEl.textContent = weatherPrecipEl.textContent = weatherTempEl.textContent = "--";
    return;
  }
  weatherStatusEl.textContent = `Saved from ${weatherSnapshot.source}`;
  weatherWindEl.textContent = fmtWind(weatherSnapshot.wind_mph);
  weatherGustEl.textContent = fmtWind(weatherSnapshot.gust_mph);
  weatherPrecipEl.textContent = fmtPrecip(weatherSnapshot.precip_in);
  weatherTempEl.textContent = fmtTemp(weatherSnapshot.temp_f);
}

function currentPointKey() {
  return pickedLat == null || pickedLng == null
    ? null
    : `${pickedLat.toFixed(4)},${pickedLng.toFixed(4)}`;
}

async function fetchWeather({ force = false, quiet = false } = {}) {
  const key = currentPointKey();
  if (!key) { renderWeather(); return null; }
  if (!force && weatherSnapshot && weatherPointKey === key) return weatherSnapshot;
  weatherLoading = true;
  renderWeather();
  try {
    const params = new URLSearchParams({
      latitude: String(pickedLat),
      longitude: String(pickedLng),
      current: "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
      timezone: "auto",
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) throw new Error("weather");
    const data = await res.json();
    const c = data.current || {};
    weatherSnapshot = {
      fetched_at: new Date().toISOString(),
      temp_f: c.temperature_2m == null ? null : round1(c.temperature_2m),
      wind_mph: c.wind_speed_10m == null ? null : round1(c.wind_speed_10m),
      gust_mph: c.wind_gusts_10m == null ? null : round1(c.wind_gusts_10m),
      precip_in: c.precipitation == null ? null : Math.round(Number(c.precipitation) * 1000) / 1000,
      code: c.weather_code ?? null,
      source: "Open-Meteo",
    };
    weatherPointKey = key;
    return weatherSnapshot;
  } catch (_) {
    weatherSnapshot = null;
    weatherPointKey = null;
    if (!quiet) showToast("Weather unavailable right now.");
    return null;
  } finally {
    weatherLoading = false;
    renderWeather();
    renderSummary();
    persistSettings();   // save the fresh snapshot for the Home "Today" panel
  }
}

function scheduleWeatherFetch() {
  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(() => fetchWeather({ quiet: true }), 500);
}

// ----- Map location picker (Leaflet + OpenStreetMap) -----
const PIN_ICON = (typeof L !== "undefined") && L.divIcon({
  className: "loc-pin",
  html: '<div class="loc-pin-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function setCoordsReadout() {
  if (!coordsEl) return;
  coordsEl.textContent = (pickedLat == null || pickedLng == null)
    ? "No pin set — tap the map, search, or use “My location”."
    : `📍 ${pickedLat.toFixed(5)}, ${pickedLng.toFixed(5)} · drag the pin to fine-tune`;
}

// Place / move the pin and remember the point. `label` true means refresh the
// text field from a reverse-geocode lookup; false leaves the typed label alone.
function setPin(lat, lng, { pan = false, zoom = null, label = false } = {}) {
  pickedLat = lat;
  pickedLng = lng;
  weatherSnapshot = null;
  weatherPointKey = null;
  if (map) {
    if (!marker) {
      marker = L.marker([lat, lng], { icon: PIN_ICON, draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        setPin(p.lat, p.lng, { label: true });
      });
    } else {
      marker.setLatLng([lat, lng]);
    }
    if (pan) map.setView([lat, lng], zoom || map.getZoom());
  }
  setCoordsReadout();
  renderWeather();
  scheduleWeatherFetch();
  if (label) reverseGeocode(lat, lng);
  persistSettings();
}

// Build a short, human label from a Nominatim address payload.
function shortPlaceName(data) {
  if (!data) return null;
  const a = data.address || {};
  const primary = data.name || a.leisure || a.amenity || a.neighbourhood
    || a.hamlet || a.village || a.suburb || a.town || a.city || a.county;
  const region = a.town || a.city || a.county || a.state;
  const parts = [primary, region && region !== primary ? region : null].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return (data.display_name || "").split(",").slice(0, 2).join(",").trim() || null;
}

async function reverseGeocode(lat, lng) {
  // Always leave a usable label even if the network/geocoder is unavailable.
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=16`
      + `&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { "Accept-Language": navigator.language || "en" } });
    if (!res.ok) throw new Error("reverse");
    const name = shortPlaceName(await res.json());
    locationEl.value = name || fallback;
  } catch (_) {
    if (!locationEl.value.trim()) locationEl.value = fallback;
  }
  persistSettings();
}

async function searchPlace(query) {
  const q = query.trim();
  if (!q) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1`
      + `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "Accept-Language": navigator.language || "en" } });
    if (!res.ok) throw new Error("search");
    const hits = await res.json();
    if (!hits.length) { showToast(`No map match for “${q}”`); return; }
    const hit = hits[0];
    setPin(parseFloat(hit.lat), parseFloat(hit.lon), { pan: true, zoom: 15 });
    locationEl.value = shortPlaceName(hit) || q;
    persistSettings();
  } catch (_) {
    showToast("Map search unavailable — keeping typed label.");
  }
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast("Geolocation isn't available here."); return; }
  if (locateBtn) locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (locateBtn) locateBtn.disabled = false;
      setPin(pos.coords.latitude, pos.coords.longitude, { pan: true, zoom: 16, label: true });
    },
    () => {
      if (locateBtn) locateBtn.disabled = false;
      showToast("Couldn't get your location — check permissions.");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

function initMap() {
  if (!mapEl || typeof L === "undefined") return;   // map is a progressive enhancement
  const start = (pickedLat != null && pickedLng != null) ? [pickedLat, pickedLng] : [30, 0];
  const startZoom = (pickedLat != null) ? 15 : 2;
  map = L.map(mapEl, { zoomControl: true, attributionControl: true })
    .setView(start, startZoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng, { label: true }));
  if (pickedLat != null && pickedLng != null) setPin(pickedLat, pickedLng);
  // Container is laid out by now, but invalidate once to be safe.
  setTimeout(() => map.invalidateSize(), 0);
  setCoordsReadout();
}

// ----- Session lifecycle: explicit start / end, persisted across navigation -----
function renderStatusBar() {
  const bar = document.getElementById("session-status-bar");
  if (!bar) return;
  if (session) {
    const n = sessionFlights.length;
    const secs = sessionFlights.reduce((s, f) => s + (f.duration_sec || 0), 0);
    const started = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    bar.className = "session-status-bar active";
    bar.innerHTML = `
      <div class="ssb-info"><span class="ssb-dot"></span>Session active — started ${escapeHtml(started)} · ${n} flight${n === 1 ? "" : "s"} · ${escapeHtml(fmtDuration(secs))}</div>
      <button type="button" class="action-btn" id="session-toggle"><span>End session</span></button>`;
  } else {
    bar.className = "session-status-bar";
    bar.innerHTML = `
      <div class="ssb-info">No active session — start one to log this field trip.</div>
      <button type="button" class="primary action-btn" id="session-toggle"><span>Start session</span></button>`;
  }
}

function startSession() {
  session = { startedAt: new Date().toISOString(), flights: [] };
  sessionFlights = session.flights;
  saveSession();
  renderStatusBar();
  renderSummary();
  showToast("Session started");
}

function endSession() {
  const n = sessionFlights.length;
  const secs = sessionFlights.reduce((s, f) => s + (f.duration_sec || 0), 0);
  session = null;
  sessionFlights = [];
  saveSession();
  renderStatusBar();
  renderSummary();
  // Flights were already saved to the server as they were logged, so they live
  // on in the Flight log — ending a session just closes the live tally.
  showToast(n ? `Session ended — ${n} flight${n === 1 ? "" : "s"}, ${fmtDuration(secs)} airtime in the flight log` : "Session ended");
}

document.getElementById("session-status-bar").addEventListener("click", (e) => {
  if (!e.target.closest("#session-toggle")) return;
  if (session) endSession(); else startSession();
});

function renderSummary() {
  if (!summaryEl) return;
  const totalFlights = sessionFlights.length;
  const totalSec = sessionFlights.reduce((sum, f) => sum + (f.duration_sec || 0), 0);
  const packsUsed = new Set(sessionFlights.map((f) => f.pack_id).filter(Boolean)).size;
  const quad = selectedQuad();
  const tiles = [
    { label: "Session flights", value: totalFlights },
    { label: "Airtime", value: fmtHours(totalSec) },
    { label: "Packs used", value: packsUsed },
    { label: "Active quad", value: quad ? quad.name : "Pick one", cls: quad ? "" : "dim" },
    { label: "Weather", value: weatherSnapshot ? `Wind ${fmtWind(weatherSnapshot.wind_mph)}` : "Set pin", cls: weatherSnapshot ? "" : "dim" },
  ];
  summaryEl.innerHTML = tiles.map((t) => `
    <div class="readout">
      <div class="label">${escapeHtml(t.label)}</div>
      <div class="value ${t.cls || ""}">${escapeHtml(t.value)}</div>
    </div>
  `).join("");
}

function chargeStateInfo(metrics) {
  switch (metrics.charge_state) {
    case "charged": return { label: "Charged", cls: "charged" };
    case "storage": return { label: "Storage", cls: "storage" };
    case "spent":   return { label: "Discharged", cls: "spent" };
    default:        return { label: "No reading", cls: "nodata" };
  }
}

// One pack card. `mode` decides the bottom action:
//   "ready"        -> charged, flight-ready: "Log flight"
//   "needs-values" -> just flown, voltages blank: "Fill in values" (-> pack page)
//   "other"        -> storage / no reading: still loggable, but de-emphasised
function packCard(pack, mode) {
  const metrics = pack.metrics || {};
  const readout = latestSpread(metrics);
  const charge = chargeStateInfo(metrics);
  const card = document.createElement("div");
  card.className = `pack-card session-pack-card${mode === "other" ? " muted" : ""}`;

  const flags = [`<span class="charge-badge ${charge.cls}">${charge.label}</span>`];
  if (pack.sticker) flags.push(`<span class="sticker-badge">${escapeHtml(pack.sticker)}</span>`);
  if (metrics.storage_warning) flags.push(`<span class="warn-badge">Storage due</span>`);
  if (metrics.retirement_warning === "exceeded") flags.push(`<span class="warn-badge critical">Cycle limit</span>`);
  const last = metrics.last_flown ? `last flown ${escapeHtml(fmtDate(metrics.last_flown))}` : "never flown";

  let action;
  if (mode === "needs-values") {
    action = `
      <button type="button" class="action-btn session-fill-btn" data-fill-pack-id="${pack.id}">
        <svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        <span>Fill in values</span>
      </button>`;
  } else {
    action = `
      <button type="button" class="primary action-btn session-log-btn" data-pack-id="${pack.id}">
        <svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        <span>Log flight</span>
      </button>`;
  }

  const readoutBlock = mode === "needs-values"
    ? `<div class="readout"><div class="label">Resting voltages</div><div class="value check">Not entered yet</div></div>`
    : `<div class="readout"><div class="label">Latest cell spread</div><div class="value ${readout.cls}">${escapeHtml(readout.text)}</div></div>`;

  card.innerHTML = `
    <div class="row-top">
      <div>
        <h3>${escapeHtml(pack.name)}</h3>
        <div class="spec">${escapeHtml(packSpec(pack))}</div>
        <div class="session-flags">${flags.join("")}</div>
      </div>
      <span class="pill ${statusClass(metrics.status)}">${statusLabel(metrics.status)}</span>
    </div>
    ${readoutBlock}
    <div class="row-bottom">
      <span>${metrics.flight_count || 0} flights</span>
      <span>${last}</span>
    </div>
    ${action}
  `;
  return card;
}

function appendGroup(title, hint, group) {
  if (group.length === 0) return;
  const head = document.createElement("div");
  head.className = "session-group-head";
  head.innerHTML = `<h3>${escapeHtml(title)} <span class="count">${group.length}</span></h3>${hint ? `<span class="hint">${escapeHtml(hint)}</span>` : ""}`;
  packGrid.appendChild(head);
  for (const pack of group) packGrid.appendChild(packCard(pack, group.mode));
}

function renderPacks() {
  const quad = selectedQuad();
  const requiredCells = selectedBatteryCellCount();
  const visible = packs.filter((p) => {
    if (readyOnlyEl.checked && p.brand === "Retired") return false;
    if (requiredCells && p.cell_count !== requiredCells) return false;
    return true;
  });

  // Charged -> flight-ready pool. Needs-values -> flown this session, awaiting
  // resting voltages. Everything else (storage / no reading) is still loggable
  // but pushed down so the charged batteries lead.
  const ready = visible.filter((p) => (p.metrics || {}).charge_state === "charged");
  const needsValues = visible.filter((p) => (p.metrics || {}).needs_values);
  const other = visible.filter((p) => !ready.includes(p) && !needsValues.includes(p));
  ready.mode = "ready"; needsValues.mode = "needs-values"; other.mode = "other";

  packGrid.innerHTML = "";
  const scope = requiredCells ? `${requiredCells}S for ${quad.name}` : "all packs";
  packCountEl.textContent = `${ready.length} charged · ${needsValues.length} need values · ${scope}`;

  if (visible.length === 0) {
    emptyEl.textContent = requiredCells
      ? `No ${requiredCells}S packs available for ${quad.name}.`
      : "No packs available for this session.";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  appendGroup("Charged — ready to fly", "Log a flight to use one", ready);
  appendGroup("Discharged — needs values", "Fill in resting voltages after the session", needsValues);
  appendGroup("Not charged", "Charge before flying", other);
}

function persistSettings() {
  localStorage.setItem("voltlog-session-settings", JSON.stringify({
    quad_id: quadSel.value,
    location: locationEl.value,
    lat: pickedLat,
    lng: pickedLng,
    duration_sec: durationEl.value,
    note: noteEl.value,
    ready_only: readyOnlyEl.checked,
    // Persist the live weather so the Home "Today" panel can show it before any
    // flight is logged. Cleared by setPin when the pin moves (snapshot stale).
    weather: weatherSnapshot,
  }));
}

function restoreSettings() {
  const raw = localStorage.getItem("voltlog-session-settings");
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.location) locationEl.value = saved.location;
    if (typeof saved.lat === "number" && typeof saved.lng === "number") {
      pickedLat = saved.lat;
      pickedLng = saved.lng;
    }
    if (saved.duration_sec !== undefined) {
      durationEl.value = saved.duration_sec;
    } else if (saved.min !== undefined || saved.sec !== undefined) {
      const min = parseInt(saved.min || "0", 10);
      const sec = parseInt(saved.sec || "0", 10);
      const total = min * 60 + sec;
      if ([...durationEl.options].some((opt) => parseInt(opt.value, 10) === total)) {
        durationEl.value = String(total);
      }
    }
    if (saved.note) noteEl.value = saved.note;
    if (saved.ready_only !== undefined) readyOnlyEl.checked = !!saved.ready_only;
    if (saved.quad_id) quadSel.value = saved.quad_id;
  } catch (_) {
    localStorage.removeItem("voltlog-session-settings");
  }
}

async function loadData() {
  [quads, packs] = await Promise.all([
    fetch(`${API}/quads`).then((r) => r.json()),
    fetch(`${API}/packs`).then((r) => r.json()),
  ]);
  quadSel.innerHTML = quads.length
    ? quads.map((q) => `<option value="${q.id}">${escapeHtml(q.name)}${q.status === "down" ? " (down)" : ""}</option>`).join("")
    : `<option value="">Add a quad first</option>`;
  restoreSettings();
  renderSummary();
  renderPacks();
}

async function addMaintenanceEntry(flightId, pack, quad) {
  const description = damageNoteEl.value.trim()
    || `Maintenance after flying ${pack.name}`;
  const res = await fetch(`${API}/maintenance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quad_id: quad.id,
      flight_id: flightId,
      date: new Date().toISOString(),
      type: "Maintenance",
      description,
      status: "done",
    }),
  });
  if (!res.ok) throw new Error("maintenance");
  return res.json();
}

async function logFlight(packId) {
  const quad = selectedQuad();
  if (!quad) {
    alert("Pick a quad before starting the session.");
    return;
  }
  const pack = packs.find((p) => p.id === packId);
  const dur = durationSec();
  if (!pack) return;
  const requiredCells = selectedBatteryCellCount();
  if (requiredCells && pack.cell_count !== requiredCells) {
    alert(`${quad.name} is configured for ${requiredCells}S packs.`);
    await loadData();
    return;
  }
  if (dur <= 0) {
    alert("Enter a flight time greater than zero.");
    return;
  }

  const notes = [];
  if (noteEl.value.trim()) notes.push(noteEl.value.trim());
  if (damageEl.checked && damageNoteEl.value.trim()) notes.push(`Maintenance: ${damageNoteEl.value.trim()}`);

  const timestamp = new Date().toISOString();
  const btn = document.querySelector(`.session-log-btn[data-pack-id="${packId}"]`);
  if (btn) btn.disabled = true;
  try {
    const weather = (pickedLat != null && pickedLng != null)
      ? await fetchWeather({ quiet: true })
      : null;
    const res = await fetch(`${API}/flights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quad_id: quad.id,
        pack_id: pack.id,
        timestamp,
        duration_sec: dur,
        location: locationEl.value.trim() || null,
        lat: pickedLat,
        lng: pickedLng,
        ...weatherPayload(weather),
        notes: notes.length ? notes.join(" | ") : null,
      }),
    });
    if (!res.ok) throw new Error("flight");
    const created = await res.json();
    let job = null;
    let jobFailed = false;
    if (damageEl.checked) {
      try {
        job = await addMaintenanceEntry(created.id, pack, quad);
      } catch (_) {
        jobFailed = true;
      }
    }

    if (!session) { session = { startedAt: timestamp, flights: sessionFlights }; }
    sessionFlights.unshift({
      id: created.id,
      maintenance_id: job ? job.id : null,
      timestamp,
      quad_id: quad.id,
      quad_name: quad.name,
      pack_id: pack.id,
      pack_name: pack.name,
      duration_sec: dur,
      damage: damageEl.checked && !jobFailed,
      weather,
    });
    saveSession();
    persistSettings();
    renderStatusBar();
    renderSummary();
    showToast(jobFailed
      ? `Logged ${pack.name}; maintenance entry failed`
      : `Logged ${pack.name} — now discharged, fill in its values later`);
    await loadData();
  } catch (err) {
    alert("Could not log that flight.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

form.addEventListener("change", persistSettings);
form.addEventListener("input", persistSettings);
quadSel.addEventListener("change", () => {
  persistSettings();
  renderSummary();
  renderPacks();
});
readyOnlyEl.addEventListener("change", () => {
  persistSettings();
  renderPacks();
});
damageEl.addEventListener("change", () => {
  damageWrap.classList.toggle("hidden", !damageEl.checked);
});

if (locateBtn) locateBtn.addEventListener("click", useMyLocation);
if (weatherRefreshBtn) weatherRefreshBtn.addEventListener("click", () => fetchWeather({ force: true }));
// Enter in the location box searches the map instead of submitting the form.
locationEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  searchPlace(locationEl.value);
});

// ----- Fill in values: edit the blank discharge cycle from a logged flight -----
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
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return;
  // Find the most recent blank discharge cycle — the one the flight log left to
  // be filled in. (metrics.needs_values guarantees one exists.)
  let cycles;
  try {
    cycles = await fetch(`${API}/packs/${packId}/cycles`).then((r) => r.json());
  } catch (_) {
    showToast("Couldn't load that pack's cycles.");
    return;
  }
  const blank = [...cycles].reverse().find((c) =>
    c.cycle_type === "discharge"
    && (c.pack_voltage === null || c.pack_voltage === undefined)
    && (!c.cell_voltages || c.cell_voltages.length === 0));
  if (!blank) {
    showToast("Nothing to fill in for that pack.");
    await loadData();
    return;
  }

  fillCycleId = blank.id;
  fillPackLabel.textContent = `${pack.name} · ${packSpec(pack)}`;
  fillVoltageEl.value = "";
  fillNotesEl.value = "";
  buildFillCellInputs(pack.cell_count);
  fillSheet ? fillSheet.open() : fillPanel.classList.remove("hidden");
}

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

  const body = {
    pack_voltage: packV,
    cell_voltages: cvVals.length ? cvVals : null,
  };
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
    showToast("Values saved");
    await loadData();
  } catch (_) {
    alert("Could not save those values.");
  }
});

cancelFillBtn.addEventListener("click", () => {
  fillSheet ? fillSheet.close() : fillPanel.classList.add("hidden");
  fillForm.reset();
  fillCycleId = null;
});

packGrid.addEventListener("click", (e) => {
  const fillBtn = e.target.closest(".session-fill-btn");
  if (fillBtn) {
    openFillValues(parseInt(fillBtn.dataset.fillPackId, 10));
    return;
  }
  const btn = e.target.closest(".session-log-btn");
  if (!btn) return;
  logFlight(parseInt(btn.dataset.packId, 10));
});

async function init() {
  await loadData();   // restoreSettings() runs here, recovering any saved pin
  initMap();
  renderWeather();
  if (pickedLat != null && pickedLng != null) scheduleWeatherFetch();
  renderStatusBar();
}

init();
