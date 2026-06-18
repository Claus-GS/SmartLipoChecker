const API = "/api";
const params = new URLSearchParams(location.search);
const quadId = parseInt(params.get("id"), 10);
if (!quadId) location.href = "/quads";

const STATUS_LABEL = { active: "Active", down: "Down", retired: "Retired" };
const STATUS_CLASS = { active: "healthy", down: "check", retired: "nodata" };

let quadData = null;

function renderHeader(q) {
  document.getElementById("quad-name").textContent = q.name;
  const bits = [];
  if (q.class) bits.push(q.class);
  if (q.battery_cell_count) bits.push(`${q.battery_cell_count}S packs`);
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
    { label: "Battery", value: q.battery_cell_count ? `${q.battery_cell_count}S` : "—" },
    { label: "Open jobs", value: s.open_maintenance, cls: s.open_maintenance > 0 ? "watch" : "" },
  ];
  document.getElementById("quad-readout").innerHTML = tiles.map((t) => `
    <div class="readout"><div class="label">${t.label}</div>
    <div class="value ${t.cls || ""}">${escapeHtml(String(t.value))}</div></div>
  `).join("");

  const banner = document.getElementById("quad-image-banner");
  if (q.image_url) { banner.src = q.image_url; banner.classList.remove("hidden"); }
  else { banner.classList.add("hidden"); banner.removeAttribute("src"); }
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
  const items = await fetch(`${API}/maintenance?quad_id=${quadId}&status=done`).then((r) => r.json());
  const body = document.getElementById("quad-maint-body");
  const empty = document.getElementById("quad-maint-empty");
  if (items.length === 0) { empty.classList.remove("hidden"); body.innerHTML = ""; return; }
  empty.classList.add("hidden");
  body.innerHTML = items.map((m) => `
    <tr>
      <td>${escapeHtml(fmtDate(m.date))}</td>
      <td>${escapeHtml(m.type || "-")}</td>
      <td>${escapeHtml(m.description || "")}</td>
    </tr>
  `).join("");
}

// ----- edit / delete quad -----
const editPanel = document.getElementById("edit-quad-panel");
const editSheet = window.VoltlogSheet?.setup(editPanel);
document.getElementById("edit-quad-btn").addEventListener("click", () => {
  document.getElementById("e-name").value = quadData.name;
  document.getElementById("e-class").value = quadData.class || "";
  document.getElementById("e-battery").value = quadData.battery_cell_count || "";
  document.getElementById("e-status").value = quadData.status || "active";
  document.getElementById("e-frame").value = quadData.frame || "";
  document.getElementById("e-fc").value = quadData.fc || "";
  document.getElementById("e-vtx").value = quadData.vtx || "";
  document.getElementById("e-motors").value = quadData.motors || "";
  document.getElementById("e-prop").value = quadData.prop || "";
  document.getElementById("e-weight").value = quadData.weight_g || "";
  document.getElementById("e-notes").value = quadData.notes || "";
  qeImage.value = quadData.image_url || "";
  setQeThumb(quadData.image_url || "");
  editSheet ? editSheet.open() : editPanel.classList.remove("hidden");
});
document.getElementById("cancel-edit-quad").addEventListener("click", () => {
  editSheet ? editSheet.close() : editPanel.classList.add("hidden");
});

document.getElementById("edit-quad-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("e-name").value,
    class: document.getElementById("e-class").value || null,
    battery_cell_count: document.getElementById("e-battery").value
      ? parseInt(document.getElementById("e-battery").value, 10) : null,
    status: document.getElementById("e-status").value,
    frame: document.getElementById("e-frame").value || null,
    fc: document.getElementById("e-fc").value || null,
    vtx: document.getElementById("e-vtx").value || null,
    motors: document.getElementById("e-motors").value || null,
    prop: document.getElementById("e-prop").value || null,
    weight_g: document.getElementById("e-weight").value
      ? parseInt(document.getElementById("e-weight").value, 10) : null,
    notes: document.getElementById("e-notes").value || null,
    image_url: document.getElementById("qe-image").value.trim() || null,
  };
  const res = await fetch(`${API}/quads/${quadId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) {
    editSheet ? editSheet.close() : editPanel.classList.add("hidden");
    await loadQuad();
  }
  else { alert("Could not save changes."); }
});

document.getElementById("delete-quad-btn").addEventListener("click", async () => {
  if (!confirm(`Delete "${quadData.name}"? Its flights are kept (unlinked); its maintenance is removed.`)) return;
  const res = await fetch(`${API}/quads/${quadId}`, { method: "DELETE" });
  if (res.ok) location.href = "/quads";
  else alert("Could not delete quad.");
});

// ----- quad photo: upload / paste / drag-and-drop -----
const qeImage = document.getElementById("qe-image");
const qeFile = document.getElementById("qe-file");
const qeUpload = document.getElementById("qe-upload");
const qeThumb = document.getElementById("qe-thumb");
function setQeThumb(src) { qeThumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : ""; }
qeImage.addEventListener("input", () => setQeThumb(qeImage.value.trim()));
qeUpload.addEventListener("click", () => qeFile.click());
qeFile.addEventListener("change", () => uploadQuadImage(qeFile.files[0]));

function imageFileFromEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return null;
  for (const it of dt.items || []) { if (it.kind === "file" && it.type && it.type.startsWith("image/")) return it.getAsFile(); }
  for (const f of dt.files || []) { if (f.type && f.type.startsWith("image/")) return f; }
  return null;
}
async function uploadQuadImage(file) {
  if (!file) return;
  qeUpload.disabled = true;
  const label = qeUpload.textContent;
  qeUpload.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted.png");
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) { const { url } = await res.json(); qeImage.value = url; setQeThumb(url); }
    else alert("Upload failed.");
  } catch { alert("Upload failed."); }
  finally { qeUpload.disabled = false; qeUpload.textContent = label; }
}
document.addEventListener("paste", (e) => {
  if (editPanel.classList.contains("hidden")) return;  // only while editing
  const f = imageFileFromEvent(e);
  if (!f) return;
  e.preventDefault();
  uploadQuadImage(f);
});
qeThumb.addEventListener("dragover", (e) => { e.preventDefault(); qeThumb.classList.add("drag-over"); });
qeThumb.addEventListener("dragleave", () => qeThumb.classList.remove("drag-over"));
qeThumb.addEventListener("drop", (e) => { e.preventDefault(); qeThumb.classList.remove("drag-over"); const f = imageFileFromEvent(e); if (f) uploadQuadImage(f); });

// ----- Shopping list (parts to buy for this quad) -----
const partPanel = document.getElementById("part-panel");
const partSheet = window.VoltlogSheet?.setup(partPanel);
const partForm = document.getElementById("part-form");
const partsList = document.getElementById("parts-list");
const partsEmpty = document.getElementById("parts-empty");
const partsSummary = document.getElementById("parts-summary");
const partUrlInput = document.getElementById("p-url");
const partImageInput = document.getElementById("p-image");
const partThumb = document.getElementById("lp-thumb");
const fetchBtn = document.getElementById("fetch-btn");
const uploadBtn = document.getElementById("upload-btn");
const partFileInput = document.getElementById("p-file");
const lpHint = document.getElementById("lp-hint");
let quadParts = [];
let editingPartId = null;

const CAT_ORDER = ["Frame", "Motors", "Props", "Flight controller", "ESC", "VTX",
  "Camera", "Antenna", "Receiver", "Batteries", "Hardware"];
const OTHER = "Other";
const PART_PLACEHOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function fmtPrice(v) {
  return v == null ? "" : money(v);
}

function groupParts(parts) {
  const groups = new Map();
  for (const p of parts) {
    const key = (p.category && p.category.trim()) || OTHER;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const known = CAT_ORDER.filter((c) => groups.has(c));
  const extra = [...groups.keys()]
    .filter((c) => !CAT_ORDER.includes(c) && c !== OTHER)
    .sort((a, b) => a.localeCompare(b));
  const ordered = [...known, ...extra];
  if (groups.has(OTHER)) ordered.push(OTHER);
  return ordered.map((c) => [c, groups.get(c)]);
}

function sortedParts(parts) {
  // Flatten the category groups into one list so every card sits in a single
  // grid (cards flow side by side), while same-category parts stay together.
  return groupParts(parts).flatMap(([, items]) => items);
}

function partCard(p) {
  // Real <img> (not CSS background) so referrerpolicy can bypass shop hot-link
  // blocking; load failures fall back to the placeholder via the delegated
  // "error" handler on partsList instead of showing a blank box.
  const thumb = p.image_url
    ? `<a class="part-thumb" href="${p.url ? encodeURI(p.url) : "#"}" ${p.url ? 'target="_blank" rel="noopener"' : ""}><img class="part-img" src="${encodeURI(p.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`
    : `<div class="part-thumb ph">${PART_PLACEHOLDER}</div>`;
  const price = p.price != null ? `<div class="part-price">${money(p.price)}</div>` : "";
  const cat = (p.category && p.category.trim()) || OTHER;
  const notes = p.notes ? `<div class="part-sub">${escapeHtml(p.notes)}</div>` : "";
  const buy = p.url
    ? `<a class="buy-link" href="${encodeURI(p.url)}" target="_blank" rel="noopener">View / Buy ↗</a>`
    : `<span class="buy-link disabled">No link</span>`;
  const badge = p.purchased ? `<div class="purchased-badge">✓ Bought</div>` : "";
  const boughtLabel = p.purchased
    ? `Purchased${p.purchased_at ? ` · ${fmtDate(p.purchased_at)}` : ""}`
    : "Mark purchased";
  return `
    <div class="part-card${p.purchased ? " purchased" : ""}">
      ${badge}
      ${thumb}
      <div class="part-body">
        <div class="part-head">
          <div class="part-name">${escapeHtml(p.name)}</div>
          ${price}
        </div>
        <span class="part-cat">${escapeHtml(cat)}</span>
        ${notes}
        <label class="purchase-row">
          <input type="checkbox" data-toggle="${p.id}" ${p.purchased ? "checked" : ""}>
          <span>${escapeHtml(boughtLabel)}</span>
        </label>
        <div class="part-actions">
          ${buy}
          <button class="part-icon-btn" data-edit="${p.id}">Edit</button>
          <button class="part-icon-btn part-del" data-del="${p.id}" style="color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">✕</button>
        </div>
      </div>
    </div>`;
}

function setPartThumb(src) {
  partThumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : "";
}

function openPartSheet() { partSheet ? partSheet.open() : partPanel.classList.remove("hidden"); }
function closePartSheet() { partSheet ? partSheet.close() : partPanel.classList.add("hidden"); }

// Pull the product picture (and name/price if blank) from a pasted link.
async function fetchPartPreview() {
  const url = partUrlInput.value.trim();
  if (!url) { lpHint.textContent = "Paste a product link first."; return; }
  fetchBtn.disabled = true;
  const label = fetchBtn.textContent;
  fetchBtn.textContent = "Fetching…";
  try {
    const res = await fetch(`${API}/link-preview?url=${encodeURIComponent(url)}`);
    const data = res.ok ? await res.json() : {};
    if (data.image) { partImageInput.value = data.image; setPartThumb(data.image); }
    const nameEl = document.getElementById("p-name");
    const priceEl = document.getElementById("p-price");
    if (data.title && !nameEl.value.trim()) nameEl.value = data.title.slice(0, 120);
    if (data.price && !priceEl.value) priceEl.value = data.price;
    lpHint.textContent = data.image
      ? "Got it — image, name & price filled in. Tweak anything, then Save part."
      : data.blocked
        ? "That shop is temporarily blocking automated fetches. Wait a bit and retry, or tap Upload / paste an image URL."
        : "Couldn't read an image from that shop. Tap Upload to add your own photo, or paste an image URL.";
  } catch {
    lpHint.textContent = "Fetch failed — check the link, or use Upload / paste an image URL.";
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = label;
  }
}

async function uploadPartFile(file) {
  if (!file) return;
  uploadBtn.disabled = true;
  const label = uploadBtn.textContent;
  uploadBtn.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted.png");
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) {
      const { url } = await res.json();
      partImageInput.value = url;
      setPartThumb(url);
      lpHint.textContent = "Image uploaded — add the part details and save.";
    } else {
      const err = await res.json().catch(() => ({}));
      lpHint.textContent = `Upload failed: ${err.detail || res.statusText}`;
    }
  } catch {
    lpHint.textContent = "Upload failed — try a different image.";
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = label;
  }
}

fetchBtn.addEventListener("click", fetchPartPreview);
uploadBtn.addEventListener("click", () => partFileInput.click());
partFileInput.addEventListener("change", () => uploadPartFile(partFileInput.files[0]));
partImageInput.addEventListener("input", () => setPartThumb(partImageInput.value.trim()));

// Paste / drag an image straight onto the preview box while the sheet is open.
document.addEventListener("paste", (e) => {
  if (partPanel.classList.contains("hidden")) return;
  const f = imageFileFromEvent(e);
  if (!f) return;
  e.preventDefault();
  uploadPartFile(f);
});
partThumb.addEventListener("dragover", (e) => { e.preventDefault(); partThumb.classList.add("drag-over"); });
partThumb.addEventListener("dragleave", () => partThumb.classList.remove("drag-over"));
partThumb.addEventListener("drop", (e) => {
  e.preventDefault();
  partThumb.classList.remove("drag-over");
  const f = imageFileFromEvent(e);
  if (f) uploadPartFile(f);
});

async function loadParts() {
  const data = await fetch(`${API}/quads/${quadId}/parts`).then((r) => r.json());
  quadParts = data.parts || [];

  if (quadParts.length === 0) {
    partsEmpty.classList.remove("hidden");
    partsList.innerHTML = "";
    partsSummary.textContent = "";
    return;
  }
  partsEmpty.classList.add("hidden");
  partsSummary.textContent = data.remaining_count
    ? `${data.remaining_count} to buy${data.remaining_price ? ` · ${fmtPrice(data.remaining_price)} remaining` : ""}`
    : "All bought 🎉";

  partsList.innerHTML = `<div class="part-grid">${sortedParts(quadParts).map(partCard).join("")}</div>`;
}

function resetPartForm() {
  partForm.reset();
  editingPartId = null;
  setPartThumb("");
  partFileInput.value = "";
  lpHint.textContent = "Paste a link and tap Fetch image, or upload / paste a photo.";
}

document.getElementById("add-part-btn").addEventListener("click", () => {
  resetPartForm();
  document.getElementById("part-panel-title").textContent = "Add part";
  openPartSheet();
});

document.getElementById("cancel-part").addEventListener("click", () => {
  closePartSheet();
  resetPartForm();
});

partForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const priceVal = document.getElementById("p-price").value;
  const body = {
    name: document.getElementById("p-name").value.trim(),
    category: document.getElementById("p-category").value.trim() || null,
    url: partUrlInput.value.trim() || null,
    image_url: partImageInput.value.trim() || null,
    price: priceVal ? parseFloat(priceVal) : null,
    notes: document.getElementById("p-notes").value.trim() || null,
    purchased: document.getElementById("p-purchased").checked,
  };
  const url = editingPartId ? `${API}/quad-parts/${editingPartId}` : `${API}/quads/${quadId}/parts`;
  const res = await fetch(url, {
    method: editingPartId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    closePartSheet();
    resetPartForm();
    await loadParts();
  } else {
    alert("Could not save part.");
  }
});

// Swap a broken product image for the placeholder icon (capture: error doesn't bubble).
partsList.addEventListener("error", (e) => {
  const img = e.target;
  if (!img.classList || !img.classList.contains("part-img")) return;
  const wrap = img.closest(".part-thumb");
  if (wrap) { wrap.classList.add("ph"); wrap.innerHTML = PART_PLACEHOLDER; }
}, true);

// Checkbox toggles (use change so a label click only fires once).
partsList.addEventListener("change", async (e) => {
  const toggle = e.target.closest("input[data-toggle]");
  if (!toggle) return;
  const res = await fetch(`${API}/quad-parts/${toggle.dataset.toggle}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purchased: toggle.checked }),
  });
  if (res.ok) await loadParts();
  else { alert("Could not update part."); toggle.checked = !toggle.checked; }
});

partsList.addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) {
    const p = quadParts.find((x) => x.id === parseInt(edit.dataset.edit, 10));
    if (!p) return;
    editingPartId = p.id;
    document.getElementById("part-panel-title").textContent = "Edit part";
    document.getElementById("p-name").value = p.name || "";
    document.getElementById("p-category").value = p.category || "";
    partUrlInput.value = p.url || "";
    partImageInput.value = p.image_url || "";
    setPartThumb(p.image_url || "");
    document.getElementById("p-price").value = p.price ?? "";
    document.getElementById("p-notes").value = p.notes || "";
    document.getElementById("p-purchased").checked = !!p.purchased;
    lpHint.textContent = "Edit details, fetch a new image, or upload your own.";
    openPartSheet();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Remove this part from the list?")) return;
    const res = await fetch(`${API}/quad-parts/${del.dataset.del}`, { method: "DELETE" });
    if (res.ok) await loadParts();
    else alert("Could not delete part.");
  }
});

async function init() {
  await loadQuad();
  await Promise.all([loadFlights(), loadMaint(), loadParts()]);
}
init();
