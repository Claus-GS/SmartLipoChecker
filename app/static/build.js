const API = "/api";
const params = new URLSearchParams(location.search);
const buildId = parseInt(params.get("id"), 10);
if (!buildId) location.href = "/builds";

const STATUS_LABEL = { planned: "Planned", building: "Building", active: "Active", retired: "Retired" };
const STATUS_CLASS = { planned: "nodata", building: "watch", active: "healthy", retired: "nodata" };

// Preferred display order for part categories; anything else is appended A–Z,
// with "Other" (uncategorised) always last.
const CAT_ORDER = ["Frame", "Motors", "FC / Stack", "ESC", "VTX", "Camera",
  "Antenna", "Props", "Receiver", "GPS", "Battery", "Hardware"];
const OTHER = "Other";

const PART_PLACEHOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;

let buildData = null;
let editingPartId = null;
let activeTab = "all";  // all | tobuy | purchased

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// ---------- Build header + readout ----------

function renderHeader(b) {
  document.getElementById("build-name").textContent = b.name;
  document.getElementById("build-spec").textContent = b.description || "";

  const pill = document.getElementById("build-pill");
  pill.className = `pill ${STATUS_CLASS[b.status] || "nodata"}`;
  pill.textContent = STATUS_LABEL[b.status] || b.status;

  const remaining = b.remaining_price || 0;
  const tiles = [
    { label: "Parts", value: b.part_count ? `${b.purchased_count || 0}/${b.part_count} bought` : 0 },
    { label: "Total cost", value: b.total_price ? money(b.total_price) : "—" },
    {
      label: "Left to buy",
      value: !b.part_count ? "—" : remaining > 0 ? money(remaining) : "All bought",
      cls: !b.part_count ? "" : remaining > 0 ? "watch" : "healthy",
    },
    { label: "Status", value: STATUS_LABEL[b.status] || b.status },
    { label: "Added", value: b.date_added ? fmtDate(b.date_added) : "—" },
  ];
  document.getElementById("build-readout").innerHTML = tiles.map((t) => `
    <div class="readout"><div class="label">${t.label}</div>
    <div class="value ${t.cls || ""}">${escapeHtml(String(t.value))}</div></div>
  `).join("");

  const banner = document.getElementById("build-cover-banner");
  if (b.cover_image) { banner.src = b.cover_image; banner.classList.remove("hidden"); }
  else { banner.classList.add("hidden"); banner.removeAttribute("src"); }
}

// ---------- Parts (grouped by category) ----------

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

function partCard(p) {
  // Real <img> with no-referrer so shop hot-link blocking doesn't blank it;
  // failures fall back to the placeholder via the delegated "error" handler.
  const thumb = p.image_url
    ? `<a class="part-thumb" href="${p.url ? encodeURI(p.url) : "#"}" ${p.url ? 'target="_blank" rel="noopener"' : ""}><img class="part-img" src="${encodeURI(p.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`
    : `<div class="part-thumb ph">${PART_PLACEHOLDER}</div>`;
  const price = p.price ? `<div class="part-price">${money(p.price)}</div>` : "";
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
          <input type="checkbox" class="purchase-toggle" data-id="${p.id}" ${p.purchased ? "checked" : ""}>
          <span>${escapeHtml(boughtLabel)}</span>
        </label>
        <div class="part-actions">
          ${buy}
          <button class="part-icon-btn edit-part" data-id="${p.id}">Edit</button>
          <button class="part-icon-btn del-part" data-id="${p.id}" style="color:var(--check);border-color:color-mix(in srgb,var(--check) 35%,var(--border));">✕</button>
        </div>
      </div>
    </div>`;
}

function partsForTab(parts) {
  if (activeTab === "tobuy") return parts.filter((p) => !p.purchased);
  if (activeTab === "purchased") return parts.filter((p) => p.purchased);
  return parts;
}

function renderParts(parts) {
  const container = document.getElementById("parts-container");
  const empty = document.getElementById("parts-empty");

  const total = parts.reduce((s, p) => s + (p.price || 0), 0);
  const purchased = parts.filter((p) => p.purchased);
  const toBuy = parts.filter((p) => !p.purchased);
  const boughtTotal = purchased.reduce((s, p) => s + (p.price || 0), 0);

  document.getElementById("parts-count").textContent = `${parts.length} part${parts.length === 1 ? "" : "s"}`;
  document.getElementById("parts-total").textContent = money(total);
  document.getElementById("parts-bought").textContent = money(boughtTotal);
  document.getElementById("parts-tobuy").textContent = money(total - boughtTotal);
  document.getElementById("tab-n-all").textContent = parts.length;
  document.getElementById("tab-n-tobuy").textContent = toBuy.length;
  document.getElementById("tab-n-purchased").textContent = purchased.length;

  const view = partsForTab(parts);
  if (!view.length) {
    container.innerHTML = "";
    empty.textContent = !parts.length
      ? "No parts yet — add the first one above."
      : activeTab === "purchased"
        ? "Nothing marked purchased yet — tick a part's checkbox to move it here."
        : activeTab === "tobuy"
          ? "Everything's purchased — nice. 🎉"
          : "No parts yet — add the first one above.";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  // One flowing grid (cards side by side) instead of stacked category sections,
  // ordered by category so related parts still cluster together.
  const ordered = groupParts(view).flatMap(([, items]) => items);
  container.innerHTML = `<div class="part-grid">${ordered.map(partCard).join("")}</div>`;
}

// Tab switching — re-render the already-loaded parts under the chosen filter.
document.getElementById("parts-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".ptab");
  if (!tab) return;
  activeTab = tab.dataset.tab;
  document.querySelectorAll("#parts-tabs .ptab").forEach((t) => t.classList.toggle("active", t === tab));
  renderParts(buildData ? buildData.parts || [] : []);
});

async function loadBuild() {
  const res = await fetch(`${API}/builds/${buildId}`);
  if (!res.ok) { location.href = "/builds"; return; }
  buildData = await res.json();
  renderHeader(buildData);
  renderParts(buildData.parts || []);
}

// ---------- Link preview + image upload ----------

const urlInput = document.getElementById("p-url");
const imageInput = document.getElementById("p-image");
const nameInput = document.getElementById("p-name");
const priceInput = document.getElementById("p-price");
const thumb = document.getElementById("lp-thumb");
const fetchBtn = document.getElementById("fetch-btn");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("p-file");
const lpHint = document.getElementById("lp-hint");

function setThumb(src) {
  thumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : "";
}

async function fetchPreview() {
  const url = urlInput.value.trim();
  if (!url) { lpHint.textContent = "Paste a product link first."; return; }
  fetchBtn.disabled = true;
  const label = fetchBtn.textContent;
  fetchBtn.textContent = "Fetching…";
  try {
    const res = await fetch(`${API}/link-preview?url=${encodeURIComponent(url)}`);
    const data = res.ok ? await res.json() : {};
    if (data.image) { imageInput.value = data.image; setThumb(data.image); }
    if (data.title && !nameInput.value.trim()) nameInput.value = data.title.slice(0, 120);
    if (data.price && !priceInput.value) priceInput.value = data.price;
    lpHint.textContent = data.image
      ? "Got it — image, name & price filled in. Tweak anything, then Add part."
      : data.blocked
        ? "That shop (e.g. AliExpress) is temporarily blocking automated fetches from this server. Wait a few minutes and retry, or just tap Upload / paste an image URL."
        : "Couldn't read an image from that shop (it may block bots). Tap Upload to add your own photo, or paste an image URL below.";
  } catch {
    lpHint.textContent = "Fetch failed — check the link, or use Upload / paste an image URL.";
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.textContent = label;
  }
}

async function uploadFile(file) {
  if (!file) return;
  uploadBtn.disabled = true;
  const label = uploadBtn.textContent;
  uploadBtn.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) {
      const { url } = await res.json();
      imageInput.value = url;
      setThumb(url);
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

fetchBtn.addEventListener("click", fetchPreview);
uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => uploadFile(fileInput.files[0]));
imageInput.addEventListener("input", () => setThumb(imageInput.value.trim()));

// ---------- Add / edit part ----------

const partForm = document.getElementById("part-form");
const partCancel = document.getElementById("part-cancel");
const partPanel = document.getElementById("part-form-panel");
const addPartBtn = document.getElementById("add-part-btn");
const partSheet = window.VoltlogSheet?.setup(partPanel);

function openPartSheet() {
  partSheet ? partSheet.open() : partPanel.classList.remove("hidden");
}

function closePartSheet() {
  partSheet ? partSheet.close() : partPanel.classList.add("hidden");
}

function resetPartForm() {
  partForm.reset();
  editingPartId = null;
  setThumb("");
  fileInput.value = "";
  document.getElementById("part-form-title").textContent = "Add a part";
  document.getElementById("part-submit").textContent = "Add part";
  partCancel.classList.add("hidden");
}

addPartBtn.addEventListener("click", () => {
  resetPartForm();
  lpHint.textContent = "Paste a link and tap Fetch image, or upload/paste a photo.";
  openPartSheet();
});

partForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: nameInput.value.trim(),
    category: document.getElementById("p-category").value.trim() || null,
    url: urlInput.value.trim() || null,
    image_url: imageInput.value.trim() || null,
    price: priceInput.value ? parseFloat(priceInput.value) : null,
    notes: document.getElementById("p-notes").value.trim() || null,
  };

  const res = editingPartId
    ? await fetch(`${API}/parts/${editingPartId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
    : await fetch(`${API}/parts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ build_id: buildId, ...body }),
      });

  if (res.ok) {
    resetPartForm();
    lpHint.textContent = "Saved.";
    closePartSheet();
    await loadBuild();
  } else {
    alert("Could not save part.");
  }
});

partCancel.addEventListener("click", () => {
  resetPartForm();
  closePartSheet();
});

// Swap a broken product image for the placeholder (capture: error doesn't bubble).
document.getElementById("parts-container").addEventListener("error", (e) => {
  const img = e.target;
  if (!img.classList || !img.classList.contains("part-img")) return;
  const wrap = img.closest(".part-thumb");
  if (wrap) { wrap.classList.add("ph"); wrap.innerHTML = PART_PLACEHOLDER; }
}, true);

document.getElementById("parts-container").addEventListener("click", async (e) => {
  const del = e.target.closest(".del-part");
  if (del) {
    if (!confirm("Remove this part?")) return;
    const res = await fetch(`${API}/parts/${del.dataset.id}`, { method: "DELETE" });
    if (res.ok) await loadBuild();
    else alert("Could not delete part.");
    return;
  }
  const edit = e.target.closest(".edit-part");
  if (!edit) return;
  const part = (buildData.parts || []).find((p) => p.id === parseInt(edit.dataset.id, 10));
  if (!part) return;
  editingPartId = part.id;
  nameInput.value = part.name || "";
  document.getElementById("p-category").value = part.category || "";
  urlInput.value = part.url || "";
  imageInput.value = part.image_url || "";
  priceInput.value = part.price ?? "";
  document.getElementById("p-notes").value = part.notes || "";
  setThumb(part.image_url || "");
  document.getElementById("part-form-title").textContent = "Edit part";
  document.getElementById("part-submit").textContent = "Save part";
  partCancel.classList.remove("hidden");
  openPartSheet();
});

// Tick / untick "purchased" — persists, then reloads so totals & tabs stay in sync.
document.getElementById("parts-container").addEventListener("change", async (e) => {
  const cb = e.target.closest(".purchase-toggle");
  if (!cb) return;
  const id = parseInt(cb.dataset.id, 10);
  const purchased = cb.checked;
  cb.disabled = true;
  try {
    const res = await fetch(`${API}/parts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchased }),
    });
    if (res.ok) {
      await loadBuild();  // refresh header readout, totals, tab counts, and the view
    } else {
      cb.checked = !purchased;
      cb.disabled = false;
      alert("Could not update purchase status.");
    }
  } catch {
    cb.checked = !purchased;
    cb.disabled = false;
    alert("Could not update purchase status.");
  }
});

// ---------- Copy links ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API is blocked outside secure contexts (e.g. LAN over http)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

document.getElementById("copy-links-btn").addEventListener("click", async (e) => {
  const links = partsForTab(buildData.parts || []).filter((p) => p.url).map((p) => `${p.name} — ${p.url}`);
  const btn = e.currentTarget;
  if (!links.length) { btn.textContent = "No links"; setTimeout(() => (btn.textContent = "Copy links"), 1200); return; }
  const ok = await copyText(links.join("\n"));
  btn.textContent = ok ? "Copied ✓" : "Copy failed";
  setTimeout(() => (btn.textContent = "Copy links"), 1400);
});

// ---------- Cover image (edit-build form) ----------

const ebcUploadBtn = document.getElementById("ebc-upload-btn");
const ebcFile = document.getElementById("ebc-file");
const ebcImage = document.getElementById("ebc-image");
const ebcThumb = document.getElementById("ebc-thumb");
function setEbcThumb(src) { ebcThumb.style.backgroundImage = src ? `url('${encodeURI(src)}')` : ""; }
ebcImage.addEventListener("input", () => setEbcThumb(ebcImage.value.trim()));
ebcUploadBtn.addEventListener("click", () => ebcFile.click());
ebcFile.addEventListener("change", async () => {
  const file = ebcFile.files[0];
  if (!file) return;
  ebcUploadBtn.disabled = true;
  const label = ebcUploadBtn.textContent;
  ebcUploadBtn.textContent = "Uploading…";
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) { const { url } = await res.json(); ebcImage.value = url; setEbcThumb(url); }
    else alert("Upload failed.");
  } catch { alert("Upload failed."); }
  finally { ebcUploadBtn.disabled = false; ebcUploadBtn.textContent = label; }
});

// ---------- Edit / delete build ----------

const editPanel = document.getElementById("edit-build-panel");
const editSheet = window.VoltlogSheet?.setup(editPanel);
document.getElementById("edit-build-btn").addEventListener("click", () => {
  document.getElementById("eb-name").value = buildData.name;
  document.getElementById("eb-status").value = buildData.status || "planned";
  document.getElementById("eb-desc").value = buildData.description || "";
  ebcImage.value = buildData.own_cover || "";
  setEbcThumb(buildData.own_cover || "");
  editSheet ? editSheet.open() : editPanel.classList.remove("hidden");
});
document.getElementById("cancel-edit-build").addEventListener("click", () => {
  editSheet ? editSheet.close() : editPanel.classList.add("hidden");
});

document.getElementById("edit-build-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    name: document.getElementById("eb-name").value,
    status: document.getElementById("eb-status").value,
    description: document.getElementById("eb-desc").value || null,
    cover_image: document.getElementById("ebc-image").value.trim() || null,
  };
  const res = await fetch(`${API}/builds/${buildId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.ok) {
    editSheet ? editSheet.close() : editPanel.classList.add("hidden");
    await loadBuild();
  }
  else alert("Could not save build.");
});

document.getElementById("delete-build-btn").addEventListener("click", async () => {
  if (!confirm(`Delete "${buildData.name}" and all its parts? This cannot be undone.`)) return;
  const res = await fetch(`${API}/builds/${buildId}`, { method: "DELETE" });
  if (res.ok) location.href = "/builds";
  else alert("Could not delete build.");
});

// ---------- Paste / drag-and-drop an image ----------

function imageFileFromEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return null;
  for (const it of dt.items || []) {
    if (it.kind === "file" && it.type && it.type.startsWith("image/")) return it.getAsFile();
  }
  for (const f of dt.files || []) { if (f.type && f.type.startsWith("image/")) return f; }
  return null;
}

async function uploadImageTo(file, imgInput, thumbFn, hintEl) {
  if (!file) return;
  if (hintEl) hintEl.textContent = "Uploading image…";
  try {
    const form = new FormData();
    form.append("file", file, file.name || "pasted.png");
    const res = await fetch(`${API}/upload-image`, { method: "POST", body: form });
    if (res.ok) {
      const { url } = await res.json();
      imgInput.value = url;
      thumbFn(url);
      if (hintEl) hintEl.textContent = "Image added — fill in the details and save.";
    } else if (hintEl) {
      hintEl.textContent = "Upload failed (unsupported image type?).";
    }
  } catch { if (hintEl) hintEl.textContent = "Upload failed."; }
}

// Paste anywhere on the page: goes to the cover when the edit-build panel is
// open, otherwise to the part image.
document.addEventListener("paste", (e) => {
  const file = imageFileFromEvent(e);
  if (!file) return;
  const coverOpen = !document.getElementById("edit-build-panel").classList.contains("hidden");
  const partOpen = !partPanel.classList.contains("hidden");
  if (!coverOpen && !partOpen) return;
  e.preventDefault();
  if (coverOpen) uploadImageTo(file, ebcImage, setEbcThumb, null);
  else uploadImageTo(file, imageInput, setThumb, lpHint);
});

function enableDrop(el, imgInput, thumbFn, hintEl) {
  if (!el) return;
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drag-over");
    const f = imageFileFromEvent(e);
    if (f) uploadImageTo(f, imgInput, thumbFn, hintEl);
  });
}
enableDrop(document.getElementById("lp-thumb"), imageInput, setThumb, lpHint);
enableDrop(document.getElementById("ebc-thumb"), ebcImage, setEbcThumb, null);

loadBuild();
