const API = "/api";

const grid = document.getElementById("quad-grid");
const emptyState = document.getElementById("empty-state");
const addBtn = document.getElementById("add-quad-btn");
const addPanel = document.getElementById("add-quad-panel");
const addForm = document.getElementById("add-quad-form");
const cancelAdd = document.getElementById("cancel-add-quad");
const addSheet = window.VoltlogSheet?.setup(addPanel);

addBtn.addEventListener("click", () => addSheet ? addSheet.open() : addPanel.classList.remove("hidden"));
cancelAdd.addEventListener("click", () => {
  addSheet ? addSheet.close() : addPanel.classList.add("hidden");
  addForm.reset();
});

const STATUS_LABEL = { active: "Active", down: "Down", retired: "Retired" };
const STATUS_CLASS = { active: "healthy", down: "check", retired: "nodata" };

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("q-name").value,
    class: document.getElementById("q-class").value || null,
    battery_cell_count: document.getElementById("q-battery").value
      ? parseInt(document.getElementById("q-battery").value, 10) : null,
    status: document.getElementById("q-status").value,
    frame: document.getElementById("q-frame").value || null,
    fc: document.getElementById("q-fc").value || null,
    vtx: document.getElementById("q-vtx").value || null,
    motors: document.getElementById("q-motors").value || null,
    prop: document.getElementById("q-prop").value || null,
    weight_g: document.getElementById("q-weight").value
      ? parseInt(document.getElementById("q-weight").value, 10) : null,
    notes: document.getElementById("q-notes").value || null,
    image_url: document.getElementById("q-image").value.trim() || null,
  };
  const res = await fetch(`${API}/quads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    addForm.reset();
    addSheet ? addSheet.close() : addPanel.classList.add("hidden");
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
    card.className = "pack-card quad-card";
    card.style.cssText = "text-decoration:none;color:inherit;";

    const specBits = [];
    if (q.class) specBits.push(escapeHtml(q.class));
    if (q.battery_cell_count) specBits.push(`${q.battery_cell_count}S packs`);
    if (q.fc) specBits.push(escapeHtml(q.fc));
    if (q.weight_g) specBits.push(`${q.weight_g}g`);

    const maintBadge = s.open_maintenance > 0
      ? `<span class="warn-badge">${s.open_maintenance} open job${s.open_maintenance === 1 ? "" : "s"}</span>`
      : "";

    const cover = q.image_url
      ? `<div class="quad-cover" style="background-image:url('${encodeURI(q.image_url)}')"></div>`
      : "";
    card.innerHTML = `
      ${cover}
      <div class="quad-card-body">
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
      </div>
    `;
    grid.appendChild(card);
  }
}

async function loadQuads() {
  const res = await fetch(`${API}/quads`);
  render(await res.json());
}

// ---------- Quad photo: upload / paste / drag-and-drop ----------
const qImage = document.getElementById("q-image");
const qImageFile = document.getElementById("q-image-file");
const qImageUpload = document.getElementById("q-image-upload");
const qImageThumb = document.getElementById("q-image-thumb");

function setQThumb(src) { qImageThumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : ""; }
qImage.addEventListener("input", () => setQThumb(qImage.value.trim()));
qImageUpload.addEventListener("click", () => qImageFile.click());
qImageFile.addEventListener("change", () => uploadQuadImage(qImageFile.files[0]));
addForm.addEventListener("reset", () => setQThumb(""));

function imageFileFromEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return null;
  for (const it of dt.items || []) { if (it.kind === "file" && it.type && it.type.startsWith("image/")) return it.getAsFile(); }
  for (const f of dt.files || []) { if (f.type && f.type.startsWith("image/")) return f; }
  return null;
}
async function uploadQuadImage(file) {
  if (!file) return;
  qImageUpload.disabled = true;
  const label = qImageUpload.textContent;
  qImageUpload.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted.png");
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) { const { url } = await res.json(); qImage.value = url; setQThumb(url); }
    else alert("Upload failed.");
  } catch { alert("Upload failed."); }
  finally { qImageUpload.disabled = false; qImageUpload.textContent = label; }
}
document.addEventListener("paste", (e) => {
  if (addPanel.classList.contains("hidden")) return;  // only while adding a quad
  const f = imageFileFromEvent(e);
  if (!f) return;
  e.preventDefault();
  uploadQuadImage(f);
});
qImageThumb.addEventListener("dragover", (e) => { e.preventDefault(); qImageThumb.classList.add("drag-over"); });
qImageThumb.addEventListener("dragleave", () => qImageThumb.classList.remove("drag-over"));
qImageThumb.addEventListener("drop", (e) => { e.preventDefault(); qImageThumb.classList.remove("drag-over"); const f = imageFileFromEvent(e); if (f) uploadQuadImage(f); });

loadQuads();
