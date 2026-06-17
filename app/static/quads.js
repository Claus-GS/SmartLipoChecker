const API = "/api";

const grid = document.getElementById("quad-grid");
const emptyState = document.getElementById("empty-state");
const addBtn = document.getElementById("add-quad-btn");
const addPanel = document.getElementById("add-quad-panel");
const addForm = document.getElementById("add-quad-form");
const cancelAdd = document.getElementById("cancel-add-quad");

addBtn.addEventListener("click", () => addPanel.classList.toggle("hidden"));
cancelAdd.addEventListener("click", () => {
  addPanel.classList.add("hidden");
  addForm.reset();
});

const STATUS_LABEL = { active: "Active", down: "Down", retired: "Retired" };
const STATUS_CLASS = { active: "healthy", down: "check", retired: "nodata" };

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("q-name").value,
    class: document.getElementById("q-class").value || null,
    status: document.getElementById("q-status").value,
    frame: document.getElementById("q-frame").value || null,
    fc: document.getElementById("q-fc").value || null,
    vtx: document.getElementById("q-vtx").value || null,
    motors: document.getElementById("q-motors").value || null,
    prop: document.getElementById("q-prop").value || null,
    weight_g: document.getElementById("q-weight").value
      ? parseInt(document.getElementById("q-weight").value, 10) : null,
    notes: document.getElementById("q-notes").value || null,
  };
  const res = await fetch(`${API}/quads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    addForm.reset();
    addPanel.classList.add("hidden");
    loadQuads();
  } else {
    alert("Could not add quad.");
  }
});

function render(quads) {
  grid.innerHTML = "";
  if (quads.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  for (const q of quads) {
    const s = q.stats;
    const card = document.createElement("a");
    card.href = `/quad?id=${q.id}`;
    card.className = "pack-card";
    card.style.cssText = "text-decoration:none;color:inherit;";

    const specBits = [];
    if (q.class) specBits.push(escapeHtml(q.class));
    if (q.fc) specBits.push(escapeHtml(q.fc));
    if (q.weight_g) specBits.push(`${q.weight_g}g`);

    const maintBadge = s.open_maintenance > 0
      ? `<span class="warn-badge">${s.open_maintenance} open job${s.open_maintenance === 1 ? "" : "s"}</span>`
      : "";

    card.innerHTML = `
      <div class="row-top">
        <div>
          <h3>${escapeHtml(q.name)}</h3>
          <div class="spec">${specBits.join(" · ") || "—"}</div>
          ${maintBadge ? `<div style="margin-top:5px;">${maintBadge}</div>` : ""}
        </div>
        <span class="pill ${STATUS_CLASS[q.status] || "nodata"}">${STATUS_LABEL[q.status] || q.status}</span>
      </div>
      <div class="readout">
        <div class="label">Flight time</div>
        <div class="value">${fmtDuration(s.total_flight_sec)}</div>
      </div>
      <div class="row-bottom">
        <span>${s.flight_count} flight${s.flight_count === 1 ? "" : "s"}</span>
        <span>${s.last_flown ? `flown ${fmtDate(s.last_flown)}` : "never flown"}</span>
      </div>
    `;
    grid.appendChild(card);
  }
}

async function loadQuads() {
  const res = await fetch(`${API}/quads`);
  render(await res.json());
}

loadQuads();
