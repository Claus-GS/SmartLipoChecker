const API = "/api";
const params = new URLSearchParams(location.search);
const quadId = parseInt(params.get("id"), 10);
if (!quadId) location.href = "/quads";

const STATUS_LABEL = { active: "Active", down: "Down", retired: "Retired" };
const STATUS_CLASS = { active: "healthy", down: "check", retired: "nodata" };

let quadData = null;

function todayInput() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function renderHeader(q) {
  document.getElementById("quad-name").textContent = q.name;
  const bits = [];
  if (q.class) bits.push(q.class);
  if (q.frame) bits.push(q.frame);
  if (q.fc) bits.push(q.fc);
  if (q.vtx) bits.push(q.vtx);
  if (q.motors) bits.push(q.motors);
  if (q.prop) bits.push(q.prop);
  if (q.weight_g) bits.push(`${q.weight_g}g AUW`);
  document.getElementById("quad-spec").textContent = bits.join(" · ");

  const pill = document.getElementById("quad-pill");
  pill.className = `pill ${STATUS_CLASS[q.status] || "nodata"}`;
  pill.textContent = STATUS_LABEL[q.status] || q.status;

  const s = q.stats;
  const tiles = [
    { label: "Flights", value: s.flight_count },
    { label: "Total airtime", value: fmtDuration(s.total_flight_sec) },
    { label: "Last flown", value: s.last_flown ? fmtDate(s.last_flown) : "—" },
    { label: "Open jobs", value: s.open_maintenance, cls: s.open_maintenance > 0 ? "watch" : "" },
  ];
  document.getElementById("quad-readout").innerHTML = tiles.map((t) => `
    <div class="readout"><div class="label">${t.label}</div>
    <div class="value ${t.cls || ""}">${escapeHtml(String(t.value))}</div></div>
  `).join("");
}

async function loadQuad() {
  const res = await fetch(`${API}/quads/${quadId}`);
  if (!res.ok) { location.href = "/quads"; return; }
  quadData = await res.json();
  renderHeader(quadData);
}

async function loadFlights() {
  const flights = await fetch(`${API}/flights?quad_id=${quadId}`).then((r) => r.json());
  const body = document.getElementById("quad-flights-body");
  const empty = document.getElementById("quad-flights-empty");
  if (flights.length === 0) { empty.classList.remove("hidden"); body.innerHTML = ""; return; }
  empty.classList.add("hidden");
  body.innerHTML = flights.map((f) => `
    <tr>
      <td>${escapeHtml(fmtTs(f.timestamp))}</td>
      <td>${f.pack_name ? escapeHtml(f.pack_name) : '<span class="tag">—</span>'}</td>
      <td class="mono">${fmtDuration(f.duration_sec)}</td>
      <td>${escapeHtml(f.location || "")}</td>
      <td>${escapeHtml(f.notes || "")}</td>
    </tr>
  `).join("");
}

async function loadMaint() {
  const items = await fetch(`${API}/maintenance?quad_id=${quadId}`).then((r) => r.json());
  const body = document.getElementById("quad-maint-body");
  const empty = document.getElementById("quad-maint-empty");
  if (items.length === 0) { empty.classList.remove("hidden"); body.innerHTML = ""; return; }
  empty.classList.add("hidden");
  body.innerHTML = items.map((m) => {
    const cls = m.status === "done" ? "healthy" : "watch";
    const toggle = m.status === "done" ? "Reopen" : "Mark done";
    return `<tr>
      <td>${escapeHtml(fmtDate(m.date))}</td>
      <td>${escapeHtml(m.type || "—")}</td>
      <td>${escapeHtml(m.description || "")}</td>
      <td><span class="pill ${cls}">${m.status === "done" ? "Done" : "Open"}</span></td>
      <td><button class="toggle-m" data-id="${m.id}" data-status="${m.status}" style="padding:4px 10px;font-size:12px;">${toggle}</button></td>
      <td><button class="del-m" data-id="${m.id}" style="padding:4px 10px;font-size:12px;color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">Delete</button></td>
    </tr>`;
  }).join("");
}

// ----- maintenance add + row actions -----
document.getElementById("qm-date").value = todayInput();
document.getElementById("quad-maint-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dateVal = document.getElementById("qm-date").value;
  const body = {
    quad_id: quadId,
    type: document.getElementById("qm-type").value || null,
    description: document.getElementById("qm-desc").value || null,
    date: dateVal ? new Date(dateVal).toISOString() : null,
  };
  const res = await fetch(`${API}/maintenance`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) {
    e.target.reset();
    document.getElementById("qm-date").value = todayInput();
    await loadMaint(); await loadQuad();
  } else { alert("Could not add job."); }
});

document.getElementById("quad-maint-body").addEventListener("click", async (e) => {
  const t = e.target.closest(".toggle-m");
  if (t) {
    const next = t.dataset.status === "done" ? "open" : "done";
    await fetch(`${API}/maintenance/${t.dataset.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    await loadMaint(); await loadQuad();
    return;
  }
  const d = e.target.closest(".del-m");
  if (d) {
    if (!confirm("Delete this job?")) return;
    await fetch(`${API}/maintenance/${d.dataset.id}`, { method: "DELETE" });
    await loadMaint(); await loadQuad();
  }
});

// ----- edit / delete quad -----
const editPanel = document.getElementById("edit-quad-panel");
document.getElementById("edit-quad-btn").addEventListener("click", () => {
  document.getElementById("e-name").value = quadData.name;
  document.getElementById("e-class").value = quadData.class || "";
  document.getElementById("e-status").value = quadData.status || "active";
  document.getElementById("e-frame").value = quadData.frame || "";
  document.getElementById("e-fc").value = quadData.fc || "";
  document.getElementById("e-vtx").value = quadData.vtx || "";
  document.getElementById("e-motors").value = quadData.motors || "";
  document.getElementById("e-prop").value = quadData.prop || "";
  document.getElementById("e-weight").value = quadData.weight_g || "";
  document.getElementById("e-notes").value = quadData.notes || "";
  editPanel.classList.toggle("hidden");
});
document.getElementById("cancel-edit-quad").addEventListener("click", () => editPanel.classList.add("hidden"));

document.getElementById("edit-quad-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("e-name").value,
    class: document.getElementById("e-class").value || null,
    status: document.getElementById("e-status").value,
    frame: document.getElementById("e-frame").value || null,
    fc: document.getElementById("e-fc").value || null,
    vtx: document.getElementById("e-vtx").value || null,
    motors: document.getElementById("e-motors").value || null,
    prop: document.getElementById("e-prop").value || null,
    weight_g: document.getElementById("e-weight").value
      ? parseInt(document.getElementById("e-weight").value, 10) : null,
    notes: document.getElementById("e-notes").value || null,
  };
  const res = await fetch(`${API}/quads/${quadId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) { editPanel.classList.add("hidden"); await loadQuad(); }
  else { alert("Could not save changes."); }
});

document.getElementById("delete-quad-btn").addEventListener("click", async () => {
  if (!confirm(`Delete "${quadData.name}"? Its flights are kept (unlinked); its maintenance is removed.`)) return;
  const res = await fetch(`${API}/quads/${quadId}`, { method: "DELETE" });
  if (res.ok) location.href = "/quads";
  else alert("Could not delete quad.");
});

async function init() {
  await loadQuad();
  await Promise.all([loadFlights(), loadMaint()]);
}
init();
