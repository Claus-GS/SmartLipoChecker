// Shared helpers for the secondary pages: theme toggle, service worker, and
// small formatters. Theme is applied pre-paint by an inline <head> script; this
// just wires the toggle button and keeps the icon in sync.

(function () {
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    const icons = {
      dark: '<svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z"/></svg>',
      light: '<svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    };
    const sync = () => {
      const isLight = document.documentElement.dataset.theme === "light";
      themeBtn.innerHTML = isLight ? icons.light : icons.dark;
      themeBtn.setAttribute("aria-label", isLight ? "Using light theme" : "Using dark theme");
    };
    themeBtn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("voltlog-theme", next);
      sync();
    });
    sync();
  }

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
})();

window.escapeHtml = function (str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
};

window.fmtTs = function (ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
};

window.fmtDate = function (ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { dateStyle: "medium" });
};

// Seconds -> compact human duration ("1h 05m", "3m 42s", "12s").
window.fmtDuration = function (sec) {
  sec = Math.round(sec || 0);
  if (sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

// Total hours, one decimal ("2.4 h").
window.fmtHours = function (sec) {
  return `${((sec || 0) / 3600).toFixed(1)} h`;
};
