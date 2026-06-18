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

(function () {
  let backdrop = null;
  let activePanel = null;
  let lastFocus = null;
  let closeTimer = null;

  function ensureBackdrop() {
    if (backdrop) return backdrop;
    backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.addEventListener("click", () => close());
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function setup(panelOrSelector) {
    const panel = typeof panelOrSelector === "string"
      ? document.querySelector(panelOrSelector)
      : panelOrSelector;
    if (!panel) return null;

    panel.classList.add("sheet-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    if (!panel.querySelector(".sheet-close")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sheet-close";
      btn.setAttribute("aria-label", "Close");
      btn.innerHTML = "&times;";
      btn.addEventListener("click", () => close(panel));
      panel.insertAdjacentElement("afterbegin", btn);
    }

    return {
      panel,
      open: () => open(panel),
      close: () => close(panel),
    };
  }

  function open(panel) {
    if (!panel) return;
    clearTimeout(closeTimer);
    if (activePanel && activePanel !== panel) close(activePanel, { immediate: true });
    const shade = ensureBackdrop();
    lastFocus = document.activeElement;
    activePanel = panel;
    panel.classList.add("sheet-panel");
    panel.classList.remove("hidden");
    document.body.classList.add("sheet-open");
    requestAnimationFrame(() => {
      shade.classList.add("open");
      panel.classList.add("open");
      const firstField = panel.querySelector("input, select, textarea, button:not(.sheet-close)");
      if (firstField && window.matchMedia("(min-width: 760px)").matches) firstField.focus();
    });
  }

  function close(panel = activePanel, opts = {}) {
    if (!panel) return;
    const shade = backdrop;
    panel.classList.remove("open");
    if (shade) shade.classList.remove("open");
    document.body.classList.remove("sheet-open");
    if (opts.immediate) {
      panel.classList.add("hidden");
    } else {
      closeTimer = setTimeout(() => panel.classList.add("hidden"), 180);
    }
    if (activePanel === panel) activePanel = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activePanel) close(activePanel);
  });

  window.VoltlogSheet = { setup, open, close };
})();

(function () {
  const NAV_ITEMS = [
    {
      label: "Home",
      href: "/",
      match: (path) => path === "/",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    },
    {
      label: "Packs",
      href: "/packs",
      match: (path) => path === "/packs" || path === "/pack",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/><path d="M10 3h4M10 21h4M3 10v4M21 10v4"/></svg>',
    },
    {
      label: "Session",
      href: "/session",
      match: (path) => path === "/session" || path === "/flights",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    },
    {
      label: "Quads",
      href: "/quads",
      match: (path) => path === "/quads" || path === "/quad" || path === "/builds" || path === "/build",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z"/><path d="M9 12h6M12 9v6"/></svg>',
    },
    {
      label: "Jobs",
      href: "/maintenance",
      match: (path) => path === "/maintenance",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>',
    },
  ];

  const QUICK_ACTIONS = [
    {
      key: "log-flight",
      label: "Log flight",
      sub: "Manual missed flight",
      href: "/flights",
      target: "#add-flight-btn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    },
    {
      key: "add-pack",
      label: "Add pack",
      sub: "Battery inventory",
      href: "/packs",
      target: "#add-pack-btn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/><path d="M12 10v4M10 12h4"/></svg>',
    },
    {
      key: "add-quad",
      label: "Add quad",
      sub: "Aircraft setup",
      href: "/quads",
      target: "#add-quad-btn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z"/><path d="M12 9v6M9 12h6"/></svg>',
    },
    {
      key: "add-maint",
      label: "Add maintenance",
      sub: "Repair or inspection",
      href: "/maintenance",
      target: "#add-maint-btn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>',
    },
    {
      key: "add-build",
      label: "Add build",
      sub: "Parts list",
      href: "/builds",
      target: "#add-build-btn",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l3 3-7 7H7v-3z"/><path d="M16 5l3 3M12 20h7"/></svg>',
    },
  ];

  const PENDING_KEY = "voltlog-pending-action";

  function currentPath() {
    return location.pathname.replace(/\/$/, "") || "/";
  }

  function renderMobileNav() {
    if (document.querySelector(".app-bottom-nav")) return;
    const path = currentPath();
    const nav = document.createElement("nav");
    nav.className = "app-bottom-nav";
    nav.setAttribute("aria-label", "Primary");
    nav.innerHTML = NAV_ITEMS.map((item) => {
      const active = item.match(path) ? " active" : "";
      return `<a class="app-bottom-tab${active}" href="${item.href}" aria-label="${item.label}">${item.icon}<span>${item.label}</span></a>`;
    }).join("");
    document.body.appendChild(nav);
  }

  function renderQuickActions() {
    if (document.querySelector(".quick-fab")) return;
    const sheet = document.createElement("div");
    sheet.id = "quick-action-sheet";
    sheet.className = "panel hidden quick-action-sheet";
    sheet.innerHTML = `
      <h2>Quick add</h2>
      <div class="quick-action-list">
        ${QUICK_ACTIONS.map((action) => `
          <button type="button" class="quick-action" data-quick-action="${action.key}">
            <span class="quick-action-icon">${action.icon}</span>
            <span class="quick-action-copy"><strong>${action.label}</strong><em>${action.sub}</em></span>
          </button>
        `).join("")}
      </div>
    `;
    document.body.appendChild(sheet);
    const sheetApi = window.VoltlogSheet?.setup(sheet);

    const fab = document.createElement("button");
    fab.type = "button";
    fab.className = "quick-fab";
    fab.setAttribute("aria-label", "Quick add");
    fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    fab.addEventListener("click", () => sheetApi ? sheetApi.open() : sheet.classList.remove("hidden"));
    document.body.appendChild(fab);

    sheet.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-quick-action]");
      if (!btn) return;
      const action = QUICK_ACTIONS.find((a) => a.key === btn.dataset.quickAction);
      if (!action) return;
      sheetApi?.close();
      runQuickAction(action);
    });
  }

  function runQuickAction(action) {
    const target = document.querySelector(action.target);
    if (target) {
      target.click();
      return;
    }
    sessionStorage.setItem(PENDING_KEY, action.key);
    location.href = action.href;
  }

  function runPendingAction() {
    const key = sessionStorage.getItem(PENDING_KEY);
    if (!key) return;
    const action = QUICK_ACTIONS.find((a) => a.key === key);
    if (!action) {
      sessionStorage.removeItem(PENDING_KEY);
      return;
    }
    const target = document.querySelector(action.target);
    if (!target) return;
    sessionStorage.removeItem(PENDING_KEY);
    target.click();
  }

  renderMobileNav();
  renderQuickActions();
  window.addEventListener("load", () => setTimeout(runPendingAction, 0));
})();

(function () {
  const DISMISS_KEY = "voltlog-ios-install-dismissed";

  function isIos() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.navigator.standalone === true
      || window.matchMedia("(display-mode: standalone)").matches;
  }

  function isSafari() {
    const ua = navigator.userAgent || "";
    return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  }

  function renderInstallHelper() {
    if (!isIos() || isStandalone() || localStorage.getItem(DISMISS_KEY) === "1") return;
    if (document.querySelector(".ios-install-helper")) return;

    const helper = document.createElement("div");
    helper.className = "ios-install-helper";
    helper.setAttribute("role", "region");
    helper.setAttribute("aria-label", "Add Voltlog to Home Screen");
    const copy = isSafari()
      ? "Tap Share in Safari, then Add to Home Screen."
      : "Open this page in Safari, then tap Share and Add to Home Screen.";
    helper.innerHTML = `
      <img src="/static/apple-touch-icon.png" alt="" class="ios-install-icon">
      <div class="ios-install-copy">
        <strong>Add Voltlog to Home Screen</strong>
        <span>${copy}</span>
      </div>
      <button type="button" class="ios-install-dismiss">Got it</button>
    `;
    helper.querySelector(".ios-install-dismiss").addEventListener("click", () => {
      localStorage.setItem(DISMISS_KEY, "1");
      helper.remove();
    });
    document.body.appendChild(helper);
  }

  window.addEventListener("load", () => setTimeout(renderInstallHelper, 700));
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
