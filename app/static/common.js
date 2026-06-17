// Shared helpers for the secondary pages: theme toggle, service worker, and
// small formatters. Theme is applied pre-paint by an inline <head> script; this
// just wires the toggle button and keeps the glyph in sync. Emoji use \u escapes
// so the file stays pure ASCII (encoding-safe).

(function () {
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    const sync = () => {
      themeBtn.textContent =
        document.documentElement.dataset.theme === "light" ? "☀️" : "\u{1F319}";
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
