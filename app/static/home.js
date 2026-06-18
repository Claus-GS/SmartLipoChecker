const API = "/api";
const SESSION_KEY = "voltlog-active-session";

const todayEl = document.getElementById("today-dashboard");
const packListEl = document.getElementById("home-pack-list");
const alertListEl = document.getElementById("home-alert-list");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function loadActiveSession() {
  const session = readJson(SESSION_KEY, null);
  if (!session || !session.startedAt) return null;
  if (!Array.isArray(session.flights)) session.flights = [];
  return session;
}

function isToday(timestamp) {
  if (!timestamp) return false;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
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

function durationBrief(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (window.fmtDuration) return window.fmtDuration(total);
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function statusLabel(status) {
  switch (status) {
    case "healthy": return "Healthy";
    case "watch": return "Watch";
    case "check": return "Check soon";
    default: return "No data";
  }
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

function weatherMetrics(flights, sessionFlights) {
  // The live weather picked on the Session page (before any flight is logged)
  // is saved here; show it first so a freshly-set pin reflects on Home too.
  const settings = readJson("voltlog-session-settings", {});
  const liveWeather = settings?.weather ? { weather: settings.weather } : null;
  const candidates = [liveWeather, ...flights, ...[...sessionFlights].reverse()];
  const source = candidates.find((item) => normalizeWeather(item));
  const weather = normalizeWeather(source);
  if (!weather) {
    return {
      wind: { value: "No wind", detail: "Set a pin in Session" },
      temp: { value: "--", detail: "No temperature saved" },
      precip: { value: "--", detail: "No precipitation saved" },
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
      detail: weather.source,
    },
    precip: {
      value: weather.precip == null ? "--" : `${weather.precip.toFixed(weather.precip >= 0.1 ? 2 : 3)} in`,
      detail: weather.precip && weather.precip > 0 ? "Precipitation logged" : "No rain logged",
    },
    source: weather.source,
  };
}

function homeMetric(label, value, detail, href = null, tone = "") {
  const tag = href ? "a" : "div";
  const link = href ? ` href="${href}"` : "";
  const clickable = href ? " clickable" : "";
  const toneClass = tone ? ` ${tone}` : "";
  return `
    <${tag} class="today-metric readout${clickable}"${link}>
      <span class="label">${escapeHtml(label)}</span>
      <span class="value${toneClass}">${escapeHtml(value)}</span>
      <span class="today-detail">${escapeHtml(detail)}</span>
    </${tag}>
  `;
}

function selectedQuad(quads) {
  const settings = readJson("voltlog-session-settings", {});
  const id = parseInt(settings?.quad_id || "0", 10);
  return quads.find((q) => q.id === id) || quads.find((q) => q.status === "active") || quads[0] || null;
}

function packIsReady(pack, quad) {
  if (pack.brand === "Retired") return false;
  if (pack.metrics?.status === "check") return false;
  if (quad?.battery_cell_count && pack.cell_count !== quad.battery_cell_count) return false;
  return true;
}

function scorePack(pack) {
  const statusScore = pack.metrics?.status === "healthy" ? 0 : pack.metrics?.status === "watch" ? 1 : 2;
  const storagePenalty = pack.metrics?.storage_warning ? -2 : 0;
  const recency = pack.metrics?.last_used_days ?? 999;
  return storagePenalty + statusScore * 10 + recency / 100;
}

function renderToday({ packs, quads, flights, openJobs, session }) {
  const sessionFlights = session?.flights || [];
  const todayFlights = flights.filter((flight) => isToday(flight.timestamp));
  const totalSec = todayFlights.reduce((sum, flight) => sum + (Number(flight.duration_sec) || 0), 0);
  const packsUsed = new Set(todayFlights.map((flight) => flight.pack_id).filter(Boolean)).size;
  const quadsUsed = new Set(todayFlights.map((flight) => flight.quad_id).filter(Boolean)).size;
  const sessionSec = sessionFlights.reduce((sum, flight) => sum + (Number(flight.duration_sec) || 0), 0);
  const weather = weatherMetrics(todayFlights, sessionFlights);
  const latest = todayFlights[0] || null;
  const settings = readJson("voltlog-session-settings", {});
  const locationName = (settings?.location || latest?.location || "").trim();

  // Readiness verdict — merged in from the former standalone "Ready" hero so the
  // home screen shows a single status block instead of two near-identical ones.
  const quad = selectedQuad(quads);
  const readyPacks = packs.filter((p) => packIsReady(p, quad));
  const downQuads = quads.filter((q) => q.status === "down").length;
  const healthFlags = packs.filter((p) => ["watch", "check"].includes(p.metrics?.status)).length;
  const storageFlags = packs.filter((p) => p.metrics?.storage_warning).length;
  let state = "Ready";
  let tone = "healthy";
  let readyCopy = quad
    ? `${readyPacks.length} pack${readyPacks.length === 1 ? "" : "s"} fit ${quad.name}`
    : `${readyPacks.length} pack${readyPacks.length === 1 ? "" : "s"} ready to fly`;
  if (readyPacks.length === 0) {
    state = "Not ready";
    tone = "check";
    readyCopy = quad ? `No ready ${quad.battery_cell_count || ""}S packs for ${quad.name}` : "No ready packs found";
  } else if (openJobs.length || healthFlags || storageFlags || downQuads) {
    state = "Caution";
    tone = "watch";
  }

  todayEl.classList.remove("hidden");
  todayEl.innerHTML = `
    <div class="today-head">
      <div>
        <div class="today-kicker">${session ? '<span class="today-dot"></span>Session active' : "Today"}</div>
        <h2>${session ? "Current flight session" : "Today"}</h2>
        <p>${escapeHtml(readyCopy)}${locationName ? ` · 📍 ${escapeHtml(locationName)}` : ""}</p>
      </div>
      <div class="today-actions">
        <span class="pill ${tone}">${escapeHtml(state)}</span>
        <a class="icon-btn primary" href="/session">${session ? "Open session" : "Start session"}</a>
        <a class="icon-btn" href="/flights">Flight log</a>
      </div>
    </div>
    <div class="today-grid">
      ${homeMetric("Flights today", String(todayFlights.length), latest ? `Latest ${formatClock(latest.timestamp)} / ${latest.quad_name || "Unknown quad"}` : "No flights logged today", "/flights")}
      ${homeMetric("Airtime", durationBrief(totalSec), session ? `${durationBrief(sessionSec)} in active session` : "Logged flight time")}
      ${homeMetric("Packs used", String(packsUsed), `${quadsUsed} quad${quadsUsed === 1 ? "" : "s"} flown`)}
      ${homeMetric("Wind", weather.wind.value, weather.wind.detail, "/session")}
      ${homeMetric("Temp", weather.temp.value, weather.temp.detail, "/session")}
      ${homeMetric("Precip", weather.precip.value, weather.precip.detail, "/session")}
    </div>
  `;
}

function renderBestPacks(packs, quads) {
  const quad = selectedQuad(quads);
  const ready = packs
    .filter((p) => packIsReady(p, quad))
    .sort((a, b) => scorePack(a) - scorePack(b))
    .slice(0, 5);

  if (!ready.length) {
    packListEl.innerHTML = `<div class="home-empty">No ready packs${quad ? ` for ${escapeHtml(quad.name)}` : ""}.</div>`;
    return;
  }

  packListEl.innerHTML = ready.map((pack) => {
    const m = pack.metrics || {};
    const spec = `${pack.cell_count}S${pack.capacity_mah ? ` / ${pack.capacity_mah}mAh` : ""}`;
    const flag = m.storage_warning ? "Storage flag" : statusLabel(m.status);
    const tone = m.storage_warning ? "watch" : m.status === "healthy" ? "healthy" : "watch";
    return `
      <a class="home-list-row" href="/pack?id=${pack.id}">
        <span>
          <strong>${escapeHtml(pack.name)}</strong>
          <em>${escapeHtml(spec)}</em>
        </span>
        <span class="pill ${tone}">${escapeHtml(flag)}</span>
      </a>
    `;
  }).join("");
}

function renderAlerts({ packs, quads, openJobs }) {
  const alerts = [];
  const storage = packs.filter((p) => p.metrics?.storage_warning);
  const check = packs.filter((p) => p.metrics?.status === "check");
  const down = quads.filter((q) => q.status === "down");
  if (openJobs.length) alerts.push({ label: "Open maintenance", detail: `${openJobs.length} job${openJobs.length === 1 ? "" : "s"} waiting`, href: "/maintenance", tone: "watch" });
  if (storage.length) alerts.push({ label: "Storage packs", detail: `${storage.length} pack${storage.length === 1 ? "" : "s"} sitting charged`, href: "/packs", tone: "watch" });
  if (check.length) alerts.push({ label: "Battery checks", detail: `${check.length} pack${check.length === 1 ? "" : "s"} need attention`, href: "/packs", tone: "check" });
  if (down.length) alerts.push({ label: "Quads down", detail: down.map((q) => q.name).slice(0, 2).join(", "), href: "/quads", tone: "check" });

  if (!alerts.length) {
    alertListEl.innerHTML = `<div class="home-empty">No fleet alerts right now.</div>`;
    return;
  }

  alertListEl.innerHTML = alerts.slice(0, 5).map((alert) => `
    <a class="home-list-row" href="${alert.href}">
      <span>
        <strong>${escapeHtml(alert.label)}</strong>
        <em>${escapeHtml(alert.detail)}</em>
      </span>
      <span class="pill ${alert.tone}">${alert.tone === "check" ? "Check" : "Watch"}</span>
    </a>
  `).join("");
}

async function init() {
  const session = loadActiveSession();
  const [packs, quads, flights, openJobs] = await Promise.all([
    fetch(`${API}/packs`).then((r) => r.json()),
    fetch(`${API}/quads`).then((r) => r.json()),
    fetch(`${API}/flights?limit=50`).then((r) => r.json()),
    fetch(`${API}/maintenance?status=open`).then((r) => r.json()),
  ]);

  const state = { packs, quads, flights, openJobs, session };
  renderToday(state);
  renderBestPacks(packs, quads);
  renderAlerts(state);
}

init().catch(() => {
  todayEl.classList.remove("hidden");
  todayEl.innerHTML = `
    <div class="today-head">
      <div>
        <div class="today-kicker">Today</div>
        <h2>Could not load</h2>
        <p>Refresh when the app server is reachable.</p>
      </div>
    </div>
  `;
});
