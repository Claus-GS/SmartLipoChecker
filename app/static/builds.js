const API = "/api";

const grid = document.getElementById("build-grid");
const emptyState = document.getElementById("empty-state");
const addBtn = document.getElementById("add-build-btn");
const addPanel = document.getElementById("add-build-panel");
const addForm = document.getElementById("add-build-form");
const cancelAdd = document.getElementById("cancel-add-build");
const addSheet = window.VoltlogSheet?.setup(addPanel);

const STATUS_LABEL = { planned: "Planned", building: "Building", active: "Active", retired: "Retired" };
const STATUS_CLASS = { planned: "nodata", building: "watch", active: "healthy", retired: "nodata" };

const COVER_PLACEHOLDER = `<div class="ph">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
  <span>No image yet</span>
</div>`;

function money(n) {
  return n ? `$${Number(n).toFixed(2)}` : "—";
}

addBtn.addEventListener("click", () => addSheet ? addSheet.open() : addPanel.classList.remove("hidden"));
cancelAdd.addEventListener("click", () => {
  addSheet ? addSheet.close() : addPanel.classList.add("hidden");
  addForm.reset();
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("b-name").value,
    status: document.getElementById("b-status").value,
    description: document.getElementById("b-desc").value || null,
    cover_image: document.getElementById("bc-image").value.trim() || null,
  };
  const res = await fetch(`${API}/builds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const { id } = await res.json();
    location.href = `/build?id=${id}`;
  } else {
    alert("Could not add build.");
  }
});

// Cover-image picker for the add-build form
const bcUploadBtn = document.getElementById("bc-upload-btn");
const bcFile = document.getElementById("bc-file");
const bcImage = document.getElementById("bc-image");
const bcThumb = document.getElementById("bc-thumb");

function setBcThumb(src) { bcThumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : ""; }
bcImage.addEventListener("input", () => setBcThumb(bcImage.value.trim()));
bcUploadBtn.addEventListener("click", () => bcFile.click());
bcFile.addEventListener("change", async () => {
  const file = bcFile.files[0];
  if (!file) return;
  bcUploadBtn.disabled = true;
  const label = bcUploadBtn.textContent;
  bcUploadBtn.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) { const { url } = await res.json(); bcImage.value = url; setBcThumb(url); }
    else alert("Upload failed.");
  } catch { alert("Upload failed."); }
  finally { bcUploadBtn.disabled = false; bcUploadBtn.textContent = label; }
});

function render(builds) {
  grid.innerHTML = "";
  if (builds.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  for (const b of builds) {
    const card = document.createElement("a");
    card.href = `/build?id=${b.id}`;
    card.className = "pack-card build-card";
    card.style.cssText = "text-decoration:none;color:inherit;";

    const cover = b.cover_image
      ? `<div class="build-cover" style="background-image:url('${encodeURI(b.cover_image)}')"></div>`
      : `<div class="build-cover">${COVER_PLACEHOLDER}</div>`;

    const parts = `${b.part_count} part${b.part_count === 1 ? "" : "s"}`;
    const remaining = b.remaining_price || 0;
    const buyLine = b.part_count
      ? remaining > 0
        ? `<div class="build-buy-line" style="color:var(--watch);font-family:var(--font-mono);font-size:12px;margin-top:4px;">${money(remaining)} left to buy</div>`
        : `<div class="build-buy-line" style="color:var(--healthy);font-size:12px;margin-top:4px;">✓ all bought</div>`
      : "";

    card.innerHTML = `
      ${cover}
      <div class="build-card-body">
        <div class="row-top">
          <h3>${escapeHtml(b.name)}</h3>
          <span class="pill ${STATUS_CLASS[b.status] || "nodata"}">${STATUS_LABEL[b.status] || b.status}</span>
        </div>
        <div class="row-bottom">
          <span>${parts}</span>
          <span>${money(b.total_price)}</span>
        </div>
        ${buyLine}
      </div>
    `;
    grid.appendChild(card);
  }
}

async function loadBuilds() {
  const res = await fetch(`${API}/builds`);
  render(await res.json());
}

// ---------- Paste / drag-and-drop a cover image ----------

function imageFileFromEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return null;
  for (const it of dt.items || []) {
    if (it.kind === "file" && it.type && it.type.startsWith("image/")) return it.getAsFile();
  }
  for (const f of dt.files || []) { if (f.type && f.type.startsWith("image/")) return f; }
  return null;
}

async function uploadCover(file) {
  if (!file) return;
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted.png");
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) { const { url } = await res.json(); bcImage.value = url; setBcThumb(url); }
    else alert("Upload failed.");
  } catch { alert("Upload failed."); }
}

document.addEventListener("paste", (e) => {
  if (addPanel.classList.contains("hidden")) return;
  const file = imageFileFromEvent(e);
  if (!file) return;
  e.preventDefault();
  uploadCover(file);
});

const bcThumbEl = document.getElementById("bc-thumb");
if (bcThumbEl) {
  bcThumbEl.addEventListener("dragover", (e) => { e.preventDefault(); bcThumbEl.classList.add("drag-over"); });
  bcThumbEl.addEventListener("dragleave", () => bcThumbEl.classList.remove("drag-over"));
  bcThumbEl.addEventListener("drop", (e) => {
    e.preventDefault(); bcThumbEl.classList.remove("drag-over");
    const f = imageFileFromEvent(e);
    if (f) uploadCover(f);
  });
}

loadBuilds();
