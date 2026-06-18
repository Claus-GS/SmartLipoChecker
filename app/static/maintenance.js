const API = "/api";

const form = document.getElementById("maint-form");
const addMaintBtn = document.getElementById("add-maint-btn");
const addMaintPanel = document.getElementById("add-maint-panel");
const cancelAddMaint = document.getElementById("cancel-add-maint");
const quadSel = document.getElementById("m-quad");
const filterQuad = document.getElementById("filter-quad");
const filterStatus = document.getElementById("filter-status");
const body = document.getElementById("maint-body");
const emptyEl = document.getElementById("maint-empty");
const addMaintSheet = window.VoltlogSheet?.setup(addMaintPanel);

function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function loadQuads() {
  const quads = await fetch(`${API}/quads`).then((r) => r.json());
  const opts = quads.map((q) => `<option value="${q.id}">${escapeHtml(q.name)}</option>`).join("");
  quadSel.innerHTML = quads.length
    ? opts
    : `<option value="">— add a quad first —</option>`;
  filterQuad.innerHTML = `<option value="">All quads</option>` + opts;
}

addMaintBtn.addEventListener("click", () => {
  document.getElementById("m-date").value = todayInput();
  addMaintSheet ? addMaintSheet.open() : addMaintPanel.classList.remove("hidden");
});

cancelAddMaint.addEventListener("click", () => {
  form.reset();
  document.getElementById("m-date").value = todayInput();
  document.getElementById("m-status").value = "open";
  addMaintSheet ? addMaintSheet.close() : addMaintPanel.classList.add("hidden");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!quadSel.value) { alert("Add a quad first, then log maintenance against it."); return; }
  const dateVal = document.getElementById("m-date").value;
  const body = {
    quad_id: parseInt(quadSel.value, 10),
    type: document.getElementById("m-type").value || null,
    description: document.getElementById("m-desc").value || null,
    status: document.getElementById("m-status").value,
    date: dateVal ? new Date(dateVal).toISOString() : null,
  };
  const res = await fetch(`${API}/maintenance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    form.reset();
    document.getElementById("m-date").value = todayInput();
    document.getElementById("m-status").value = "open";
    addMaintSheet ? addMaintSheet.close() : addMaintPanel.classList.add("hidden");
    load();
  } else {
    alert("Could not add job.");
  }
});

function statusPill(status) {
  const cls = status === "done" ? "healthy" : "watch";
  return `<span class="pill ${cls}">${status === "done" ? "Done" : "Open"}</span>`;
}

function renderTable(items) {
  if (items.length === 0) {
    emptyEl.classList.remove("hidden");
    body.innerHTML = "";
    return;
  }
  emptyEl.classList.add("hidden");
  body.innerHTML = "";
  for (const m of items) {
    const tr = document.createElement("tr");
    const toggleLabel = m.status === "done" ? "Reopen" : "Mark done";
    tr.innerHTML = `
      <td>${escapeHtml(fmtDate(m.date))}</td>
      <td>${m.quad_name ? escapeHtml(m.quad_name) : '<span class="tag">—</span>'}</td>
      <td>${escapeHtml(m.type || "—")}</td>
      <td>${escapeHtml(m.description || "")}</td>
      <td>${statusPill(m.status)}</td>
      <td><button class="toggle-maint" data-id="${m.id}" data-status="${m.status}" style="padding:4px 10px;font-size:12px;">${toggleLabel}</button></td>
      <td><button class="del-maint" data-id="${m.id}" style="padding:4px 10px;font-size:12px;color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">Delete</button></td>
    `;
    body.appendChild(tr);
  }
}

async function load() {
  const params = new URLSearchParams();
  if (filterQuad.value) params.set("quad_id", filterQuad.value);
  if (filterStatus.value) params.set("status", filterStatus.value);
  const items = await fetch(`${API}/maintenance?${params}`).then((r) => r.json());
  renderTable(items);
}

body.addEventListener("click", async (e) => {
  const toggle = e.target.closest(".toggle-maint");
  if (toggle) {
    const next = toggle.dataset.status === "done" ? "open" : "done";
    await fetch(`${API}/maintenance/${toggle.dataset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    load();
    return;
  }
  const del = e.target.closest(".del-maint");
  if (del) {
    if (!confirm("Delete this job?")) return;
    await fetch(`${API}/maintenance/${del.dataset.id}`, { method: "DELETE" });
    load();
  }
});

[filterQuad, filterStatus].forEach((el) => el.addEventListener("change", load));

async function init() {
  await loadQuads();
  document.getElementById("m-date").value = todayInput();
  document.getElementById("m-status").value = "open";
  await load();
}

init();
