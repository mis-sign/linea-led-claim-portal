// app.js — linea LED Warranty Claim Hub
// Talks to the Render backend defined in config.js (API_BASE_URL).

let adminToken = null; // kept in memory only — admin must log in again after a page refresh

// Photos may be an absolute Cloudinary URL (new uploads) or a relative
// /uploads/... path (older records saved before Cloudinary was configured).
function photoUrl(p) {
  if (!p) return "";
  return p.startsWith("http") ? p : API_BASE_URL + p;
}

// ---------------- Utility ----------------
function toast(message, type = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast show" + (type ? " " + type : "");
  setTimeout(() => el.classList.remove("show"), 3500);
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (adminToken) headers["Authorization"] = "Bearer " + adminToken;
  if (!(options.body instanceof FormData) && options.body) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(API_BASE_URL + path, { ...options, headers });
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------- Navigation ----------------
document.getElementById("moduleNav").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-module]");
  if (!btn) return;
  showModule(btn.dataset.module);
});

function showModule(name) {
  document.querySelectorAll(".module-nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.module === name)
  );
  document.querySelectorAll(".module").forEach((m) =>
    m.classList.toggle("active", m.id === "module-" + name)
  );
  if (name === "dashboard") loadDashboard();
  if (name === "warranty") loadWarranty();
  if (name === "register") autoCaptureGps();
  if (name === "qr") loadQrList();
}

// Handle deep-link from a scanned QR code, e.g. index.html?warrantyId=TA4G5TJZ
// Short links (auto-generated from Module 04) only carry the Warranty ID —
// we fetch the branch name/address from the database. Manual QR cards may
// also carry branchName/siteAddress directly if the record isn't saved yet.
let kioskPrefill = { warrantyId: "", branchName: "", siteAddress: "" };

(async function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mod = params.get("module");
  const warrantyId = params.get("warrantyId");
  let branchName = params.get("branchName");
  let siteAddress = params.get("siteAddress");

  if (warrantyId && !branchName && !siteAddress) {
    try {
      const data = await api(`/api/warranty/${encodeURIComponent(warrantyId)}`);
      branchName = data.warranty.customerName;
      siteAddress = data.warranty.siteAddress;
    } catch (err) {
      // Warranty ID not found in database — leave blank, staff can fill manually
    }
  }

  kioskPrefill = { warrantyId: warrantyId || "", branchName: branchName || "", siteAddress: siteAddress || "" };
  applyKioskPrefill();

  if (warrantyId || branchName || mod === "register") {
    document.body.classList.add("kiosk-mode");
    showModule("register");
  } else if (mod === "track") {
    const claimId = params.get("claimId");
    const trackWhatsapp = params.get("whatsapp");
    document.body.classList.add("kiosk-mode");
    showModule("track");
    if (claimId) document.getElementById("trackClaimId").value = claimId;
    if (trackWhatsapp) document.getElementById("trackWhatsapp").value = trackWhatsapp;
    if (claimId && trackWhatsapp) {
      document.getElementById("trackForm").dispatchEvent(new Event("submit", { cancelable: true }));
    }
  } else if (mod) {
    showModule(mod);
  }
})();

function applyKioskPrefill() {
  if (kioskPrefill.warrantyId) {
    const el = document.getElementById("warrantySerial");
    el.value = kioskPrefill.warrantyId; el.readOnly = true; el.classList.add("locked-field");
  }
  if (kioskPrefill.branchName) {
    const el = document.getElementById("branchName");
    el.value = kioskPrefill.branchName; el.readOnly = true; el.classList.add("locked-field");
  }
  if (kioskPrefill.siteAddress) {
    const el = document.getElementById("siteAddress");
    el.value = kioskPrefill.siteAddress; el.readOnly = true; el.classList.add("locked-field");
  }
}

// Auto-capture GPS the moment the register form is relevant (kiosk load, or
// switching to Module 02 manually) — matches the "GPS Location Locked" flow.
let gpsCaptured = false;
function autoCaptureGps() {
  if (gpsCaptured) return;
  const box = document.getElementById("gpsBox");
  const result = document.getElementById("gpsResult");
  if (!navigator.geolocation) {
    box.classList.remove("pending");
    result.textContent = "Geolocation not supported on this device.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      box.dataset.lat = latitude;
      box.dataset.lng = longitude;
      box.classList.remove("pending");
      result.textContent = `LAT: ${latitude.toFixed(5)} | LNG: ${longitude.toFixed(5)}`;
      gpsCaptured = true;
    },
    () => {
      result.textContent = "Location access denied — enable it and reload.";
    }
  );
}
if (document.body.classList.contains("kiosk-mode")) autoCaptureGps();

// ================= MODULE 01: QR GENERATOR =================
function buildQrLink(warrantyId, branchName, siteAddress) {
  let url = window.location.origin + window.location.pathname +
    `?warrantyId=${encodeURIComponent(warrantyId || "")}`;
  // Branch/address only added for one-off manual cards not yet in the database.
  // Auto-generated QRs (from Module 04) skip these — keeps them short & reliable.
  if (branchName) url += `&branchName=${encodeURIComponent(branchName)}`;
  if (siteAddress) url += `&siteAddress=${encodeURIComponent(siteAddress)}`;
  return url;
}

document.getElementById("generateQrBtn").addEventListener("click", async () => {
  const warrantyId = document.getElementById("qrWarrantyId").value.trim();
  const branchName = document.getElementById("qrBranchName").value.trim();
  const address = document.getElementById("qrAddress").value.trim();
  if (!warrantyId || !branchName || !address) {
    return toast("Warranty Serial ID, Branch/Client Name and Address are all required.", "error");
  }

  const btn = document.getElementById("generateQrBtn");
  btn.disabled = true;
  btn.textContent = "Creating…";

  // Save it into the Warranty Database too — otherwise this QR would only
  // ever exist in this browser tab and could never be found again by search.
  try {
    await api("/api/warranty", {
      method: "POST",
      body: JSON.stringify({ warrantyId, customerName: branchName, siteAddress: address })
    });
    toast("QR created and saved to the Warranty Database.", "success");
    loadQrList();
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("already exists")) {
      toast("This Warranty ID already exists in the database — QR generated using the existing record.", "success");
    } else if (err.message && err.message.toLowerCase().includes("login")) {
      toast("Log in as admin (Module 05) to save this permanently to the database — QR generated for now, but won't show up in search yet.", "error");
    } else {
      toast(err.message, "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📇 Create Custom QR Card";
  }

  // Short link (Warranty ID only) — same format as the auto-generated QRs,
  // so it stays small, clean, and reliably scannable.
  const link = buildQrLink(warrantyId);
  const wrap = document.getElementById("qrCanvasWrap");
  wrap.innerHTML = "";
  new QRCode(wrap, { text: link, width: 220, height: 220, colorDark: "#313234", colorLight: "#ffffff" });

  document.getElementById("qrActions").style.display = "block";
  document.getElementById("qrLinkPreview").textContent = link;

  // Clear the fields so the form is ready for the next QR immediately.
  document.getElementById("qrWarrantyId").value = "";
  document.getElementById("qrBranchName").value = "";
  document.getElementById("qrAddress").value = "";
});

document.getElementById("downloadQrBtn").addEventListener("click", () => {
  downloadQrFromWrap("qrCanvasWrap", document.getElementById("qrWarrantyId").value || "branch");
});

function downloadQrFromWrap(wrapId, filenameHint) {
  const wrap = document.getElementById(wrapId);
  const img = wrap.querySelector("img") || wrap.querySelector("canvas");
  if (!img) return;
  const link = document.createElement("a");
  link.download = `linea-led-qr-${filenameHint}.png`;
  link.href = img.tagName === "CANVAS" ? img.toDataURL("image/png") : img.src;
  link.click();
}

// ---- Auto-generated QR list, sourced live from the Warranty Database ----
let qrListCache = [];

async function loadQrList() {
  try {
    const data = await api("/api/warranty");
    qrListCache = data.warranties;
    renderQrList("");
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderQrList(query) {
  const container = document.getElementById("qrListResults");
  const empty = document.getElementById("qrListEmpty");
  const countEl = document.getElementById("qrListCount");
  container.innerHTML = "";

  if (!query) {
    empty.style.display = "block";
    countEl.textContent = `${qrListCache.length} record${qrListCache.length === 1 ? "" : "s"} available to search`;
    return;
  }

  const q = query.toLowerCase();
  const matches = qrListCache.filter(
    (w) =>
      (w.warrantyId || "").toLowerCase().includes(q) ||
      (w.customerName || "").toLowerCase().includes(q) ||
      (w.siteAddress || "").toLowerCase().includes(q)
  ).slice(0, 30);

  countEl.textContent = `${matches.length} match${matches.length === 1 ? "" : "es"}`;

  if (matches.length === 0) {
    empty.style.display = "block";
    empty.innerHTML = '<div class="icon">🔎</div>No matching warranty record found.';
    return;
  }
  empty.style.display = "none";

  matches.forEach((w) => {
    const row = document.createElement("div");
    row.className = "qr-list-item";
    row.innerHTML = `
      <div class="info">
        <div class="id">${w.warrantyId}</div>
        <div class="name">${w.customerName || "—"}</div>
        <div class="addr">${w.siteAddress || "—"}</div>
      </div>
      <button class="btn btn-primary btn-sm">Get QR</button>
    `;
    row.querySelector("button").addEventListener("click", () => openQrListModal(w));
    container.appendChild(row);
  });
}

document.getElementById("qrSearch").addEventListener("input", debounce((e) => {
  renderQrList(e.target.value.trim());
}, 250));

function openQrListModal(w) {
  const link = buildQrLink(w.warrantyId);
  const wrap = document.getElementById("qrListModalCanvas");
  wrap.innerHTML = "";
  new QRCode(wrap, { text: link, width: 200, height: 200, colorDark: "#313234", colorLight: "#ffffff" });
  document.getElementById("qrListModalName").textContent = `${w.warrantyId} — ${w.customerName || ""}`;
  document.getElementById("qrListModalOverlay").style.display = "flex";
  document.getElementById("qrListModalDownload").onclick = () => downloadQrFromWrap("qrListModalCanvas", w.warrantyId);
}
document.getElementById("qrListModalClose").addEventListener("click", () => {
  document.getElementById("qrListModalOverlay").style.display = "none";
});
document.getElementById("qrListModalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "qrListModalOverlay") e.currentTarget.style.display = "none";
});

// ================= MODULE 02: REGISTER COMPLAINT =================
const photoFiles = { photo1: null, photo2: null, photo3: null };

[1, 2, 3].forEach((n) => {
  const input = document.getElementById(`photo${n}`);
  const slot = document.getElementById(`slot${n}`);
  const status = document.getElementById(`slot${n}Status`);
  input.addEventListener("change", () => {
    const file = input.files[0];
    photoFiles[`photo${n}`] = file || null;
    if (file) {
      slot.classList.add("filled");
      status.textContent = file.name.length > 24 ? file.name.slice(0, 21) + "…" : file.name;
    } else {
      slot.classList.remove("filled");
      status.textContent = "Choose file — No file chosen";
    }
  });
});

// Fault diagnosis checkboxes — visually highlight the selected option
document.getElementById("faultGrid").addEventListener("change", (e) => {
  const label = e.target.closest(".fault-option");
  if (label) label.classList.toggle("checked", e.target.checked);
});
document.getElementById("otherFaultCheck").addEventListener("change", (e) => {
  document.getElementById("otherFaultLabel").classList.toggle("checked", e.target.checked);
});

function collectFaultDiagnosis() {
  const checked = Array.from(document.querySelectorAll("#faultGrid input:checked")).map((el) => el.value);
  const otherChecked = document.getElementById("otherFaultCheck").checked;
  const notes = document.getElementById("notes").value.trim();
  if (otherChecked && notes) checked.push(notes);
  return checked.join(", ");
}

document.getElementById("complaintForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const whatsapp = document.getElementById("whatsappNumber").value.trim();
  if (!/^[0-9]{10}$/.test(whatsapp)) {
    return toast("WhatsApp number must be exactly 10 digits.", "error");
  }
  const faultType = collectFaultDiagnosis();
  if (!faultType) {
    return toast("Select at least one fault diagnosis option.", "error");
  }
  if (!photoFiles.photo1) {
    return toast("Photo 1 is mandatory.", "error");
  }

  const btn = document.getElementById("submitComplaintBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  const fd = new FormData();
  fd.append("branchName", document.getElementById("branchName").value);
  fd.append("siteAddress", document.getElementById("siteAddress").value);
  fd.append("warrantySerial", document.getElementById("warrantySerial").value);
  fd.append("contactName", document.getElementById("contactName").value);
  fd.append("whatsappNumber", whatsapp);
  fd.append("email", document.getElementById("email").value);
  fd.append("faultType", faultType);
  fd.append("notes", document.getElementById("notes").value);

  const gpsBox = document.getElementById("gpsBox");
  if (gpsBox.dataset.lat) {
    fd.append("latitude", gpsBox.dataset.lat);
    fd.append("longitude", gpsBox.dataset.lng);
  }
  [1, 2, 3].forEach((n) => {
    if (photoFiles[`photo${n}`]) fd.append("photos", photoFiles[`photo${n}`]);
  });

  try {
    const data = await api("/api/complaints", { method: "POST", body: fd });
    document.getElementById("successClaimId").textContent = data.complaint.id;
    document.getElementById("successWarrantyStatus").textContent = data.complaint.warrantyStatus;
    document.getElementById("complaintForm").style.display = "none";
    document.getElementById("submitSuccessScreen").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
    resetComplaintFormState();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit";
  }
});

function resetComplaintFormState() {
  document.getElementById("complaintForm").reset();
  applyKioskPrefill();
  [1, 2, 3].forEach((n) => {
    photoFiles[`photo${n}`] = null;
    document.getElementById(`slot${n}`).classList.remove("filled");
    document.getElementById(`slot${n}Status`).textContent = "Choose file — No file chosen";
  });
  document.querySelectorAll(".fault-option.checked").forEach((el) => el.classList.remove("checked"));
}

document.getElementById("submitAnotherBtn").addEventListener("click", () => {
  document.getElementById("submitSuccessScreen").style.display = "none";
  document.getElementById("complaintForm").style.display = "block";
  gpsCaptured = false;
  document.getElementById("gpsBox").classList.add("pending");
  document.getElementById("gpsResult").textContent = "Locating device...";
  autoCaptureGps();
});

// ================= MODULE 03: LIVE DASHBOARD =================
let lastLoadedComplaints = [];
const OVERDUE_HOURS = 48;

function isOverdue(c) {
  if (c.status === "Resolved") return false;
  const ageHours = (Date.now() - new Date(c.createdAt).getTime()) / 3600000;
  return ageHours > OVERDUE_HOURS;
}

async function loadDashboard() {
  const q = document.getElementById("dashSearch").value.trim();
  const status = document.getElementById("dashStatusFilter").value;
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "All") params.set("status", status);
    const data = await api("/api/complaints?" + params.toString());
    lastLoadedComplaints = data.complaints;
    renderDashboard(data.complaints, data.stats);
    loadAnalytics();
  } catch (err) {
    toast(err.message, "error");
  }
}

let faultChartInstance = null;
let branchChartInstance = null;

async function loadAnalytics() {
  try {
    // Analytics always reflect ALL claims, regardless of the search/status
    // filter currently applied to the table above.
    const data = await api("/api/complaints");
    const all = data.complaints;

    const overdueCount = all.filter(isOverdue).length;
    document.getElementById("statOverdueCount").textContent = overdueCount;

    const now = new Date();
    const thisMonthCount = all.filter((c) => {
      const d = new Date(c.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    document.getElementById("statThisMonth").textContent = thisMonthCount;

    const resolved = all.filter((c) => c.status === "Resolved");
    if (resolved.length > 0) {
      const avgMs = resolved.reduce((sum, c) => sum + (new Date(c.updatedAt) - new Date(c.createdAt)), 0) / resolved.length;
      const avgHours = avgMs / 3600000;
      document.getElementById("statAvgResolution").textContent =
        avgHours < 24 ? `${avgHours.toFixed(1)} hrs` : `${(avgHours / 24).toFixed(1)} days`;
    } else {
      document.getElementById("statAvgResolution").textContent = "—";
    }

    // Fault type breakdown
    const faultCounts = {};
    all.forEach((c) => {
      (c.faultType || "Unspecified").split(",").forEach((f) => {
        const key = f.trim();
        if (!key) return;
        faultCounts[key] = (faultCounts[key] || 0) + 1;
      });
    });
    renderBarChart("faultChart", "faultChartInstance", Object.keys(faultCounts), Object.values(faultCounts), "#f2790a");

    // Top branches
    const branchCounts = {};
    all.forEach((c) => { branchCounts[c.branchName] = (branchCounts[c.branchName] || 0) + 1; });
    const topBranches = Object.entries(branchCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    renderBarChart("branchChart", "branchChartInstance", topBranches.map((b) => b[0]), topBranches.map((b) => b[1]), "#1d6fb8");
  } catch (err) {
    // Analytics failing shouldn't disrupt the rest of the dashboard
    console.error("Analytics load failed:", err.message);
  }
}

function renderBarChart(canvasId, instanceVarName, labels, values, color) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (typeof Chart === "undefined") {
    // Chart.js didn't load (e.g. blocked network/ad-blocker) — show a plain
    // text fallback instead of leaving a confusing blank space.
    ctx.replaceWith(Object.assign(document.createElement("div"), {
      className: "hint",
      style: "padding:30px 0; text-align:center;",
      textContent: "Chart library failed to load — check your internet connection and refresh."
    }));
    return;
  }
  const existing = canvasId === "faultChart" ? faultChartInstance : branchChartInstance;
  if (existing) existing.destroy();

  const chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No data"],
      datasets: [{ data: values.length ? values : [0], backgroundColor: color, borderRadius: 6 }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { font: { size: 10.5 } } } }
    }
  });
  if (canvasId === "faultChart") faultChartInstance = chart;
  else branchChartInstance = chart;
}

function renderDashboard(complaints, stats) {
  document.getElementById("statTotal").textContent = stats.total;
  document.getElementById("statPending").textContent = stats.pending;
  document.getElementById("statProgress").textContent = stats.inProgress;
  document.getElementById("statResolved").textContent = stats.resolved;

  const overdueOnly = document.getElementById("dashOverdueOnly").checked;
  const visible = overdueOnly ? complaints.filter(isOverdue) : complaints;

  const body = document.getElementById("dashTableBody");
  const empty = document.getElementById("dashEmpty");
  body.innerHTML = "";

  if (visible.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  visible.forEach((c) => {
    const tr = document.createElement("tr");
    const badgeClass = c.status.replace(" ", "-");
    const warrantyStatus = c.warrantyStatus || "Not Found";
    const warrantyBadgeClass = warrantyStatus.replace(/ /g, "-");
    if (warrantyStatus === "In Warranty") tr.classList.add("in-warranty-row");
    const overdueTag = isOverdue(c) ? '<span class="badge Pending" style="margin-left:6px;">⏱ Overdue</span>' : "";
    tr.innerHTML = `
      <td class="mono">${c.id}</td>
      <td>${c.branchName}<br><span class="hint">${c.siteAddress}</span></td>
      <td>${c.faultType}</td>
      <td><span class="badge ${warrantyBadgeClass}">${warrantyStatus}</span></td>
      <td>${c.contactName}<br><span class="hint">${c.whatsappNumber}</span></td>
      <td><span class="badge ${badgeClass}">${c.status}</span>${overdueTag}</td>
      <td>${formatDate(c.createdAt)}</td>
      <td><div class="row-actions"></div></td>
    `;
    const actionCell = tr.querySelector(".row-actions");

    const viewBtn = document.createElement("button");
    viewBtn.className = "btn btn-ghost btn-sm";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => openComplaintModal(c));
    actionCell.appendChild(viewBtn);

    if (adminToken) {
      const select = document.createElement("select");
      ["Pending", "In Progress", "Resolved"].forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        if (s === c.status) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => {
        if (select.value === "Resolved") {
          openResolutionModal(c.id, select.value);
        } else {
          updateComplaintStatus(c.id, select.value);
        }
      });
      actionCell.appendChild(select);
    }
    body.appendChild(tr);
  });
}

async function updateComplaintStatus(id, status, resolutionPhotoFile) {
  try {
    const fd = new FormData();
    fd.append("status", status);
    if (resolutionPhotoFile) fd.append("resolutionPhoto", resolutionPhotoFile);
    await api(`/api/complaints/${id}/status`, { method: "PATCH", body: fd });
    toast(`${id} marked ${status}.`, "success");
    loadDashboard();
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---- Complaint detail modal (shows fault photos + resolution photo) ----
const FIELD_ICON_JS = {
  "Claim ID": "🆔", "Branch / Site": "🏢", "Site Address": "📍", "Warranty ID": "🛡️",
  "Warranty Status": "🛡️", "Fault": "⚡", "Notes": "📝", "Contact": "👤",
  "WhatsApp": "📱", "Email": "✉️", "Status": "📌", "Filed": "📅", "GPS": "🧭"
};
function detailRowHtml(label, value) {
  if (value === undefined || value === null || value === "") value = "—";
  const icon = FIELD_ICON_JS[label] || "•";
  return `<div class="detail-row"><span class="k">${icon} ${label}</span><span class="v">${value}</span></div>`;
}
function statusPillColorClass(status) {
  if (status === "Resolved" || status === "In Warranty") return "resolved";
  if (status === "In Progress") return "progress";
  return "pending";
}

function openComplaintModal(c) {
  const body = document.getElementById("complaintModalBody");
  const warrantyStatus = c.warrantyStatus || "Not Found";
  const photosHtml = (c.photos || [])
    .map((p) => `<a href="${photoUrl(p)}" target="_blank"><img src="${photoUrl(p)}" style="width:72px;height:72px;" /></a>`)
    .join("");
  const resolutionHtml = c.resolutionPhoto
    ? `<div class="detail-photos"><div class="hint">Resolution Photo</div>
       <a href="${photoUrl(c.resolutionPhoto)}" target="_blank"><img src="${photoUrl(c.resolutionPhoto)}" style="width:100px;height:100px;border:2px solid var(--success);" /></a></div>`
    : "";
  const pillClass = statusPillColorClass(c.status);
  const pillBg = pillClass === "resolved" ? "var(--gradient-success)" : pillClass === "progress" ? "linear-gradient(135deg,#22b3c4,#0e7c86)" : "var(--gradient-accent)";
  body.innerHTML = `
    <div class="detail-status-pill"><span style="background:${pillBg};">${c.status}</span></div>
    <div class="detail-card">
      ${detailRowHtml("Claim ID", c.id)}
      ${detailRowHtml("Branch / Site", c.branchName)}
      ${detailRowHtml("Site Address", c.siteAddress)}
      ${detailRowHtml("Warranty ID", c.warrantySerial)}
      ${detailRowHtml("Warranty Status", warrantyStatus)}
      ${detailRowHtml("Fault", c.faultType)}
      ${detailRowHtml("Notes", c.notes)}
      ${detailRowHtml("Contact", c.contactName)}
      ${detailRowHtml("WhatsApp", c.whatsappNumber)}
      ${detailRowHtml("Email", c.email)}
      ${detailRowHtml("Filed", formatDate(c.createdAt))}
      ${c.location ? detailRowHtml("GPS", `${c.location.latitude.toFixed(5)}, ${c.location.longitude.toFixed(5)}`) : ""}
    </div>
    <div class="detail-photos">
      <div class="hint">Fault Photos</div>
      ${photosHtml || '<span class="hint">No photos uploaded.</span>'}
    </div>
    ${resolutionHtml}
  `;
  document.getElementById("complaintModalOverlay").style.display = "flex";
}
document.getElementById("complaintModalClose").addEventListener("click", () => {
  document.getElementById("complaintModalOverlay").style.display = "none";
});
document.getElementById("complaintModalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "complaintModalOverlay") e.currentTarget.style.display = "none";
});

// ---- Resolution photo prompt ----
let pendingResolutionId = null;
let pendingResolutionFile = null;

function openResolutionModal(id) {
  pendingResolutionId = id;
  pendingResolutionFile = null;
  document.getElementById("resolutionSlotStatus").textContent = "Choose file — No file chosen";
  document.getElementById("resolutionSlot").classList.remove("filled");
  document.getElementById("resolutionModalOverlay").style.display = "flex";
}
document.getElementById("resolutionPhotoInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  pendingResolutionFile = file || null;
  document.getElementById("resolutionSlotStatus").textContent = file ? file.name : "Choose file — No file chosen";
  document.getElementById("resolutionSlot").classList.toggle("filled", !!file);
});
document.getElementById("resolutionConfirmBtn").addEventListener("click", () => {
  document.getElementById("resolutionModalOverlay").style.display = "none";
  updateComplaintStatus(pendingResolutionId, "Resolved", pendingResolutionFile);
});
document.getElementById("resolutionModalClose").addEventListener("click", () => {
  // "Skip" — still mark Resolved, just without a photo
  document.getElementById("resolutionModalOverlay").style.display = "none";
  updateComplaintStatus(pendingResolutionId, "Resolved", null);
});

// ---- Export current dashboard view to CSV ----
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (lastLoadedComplaints.length === 0) return toast("Nothing to export.", "error");
  const headers = ["Claim ID", "Branch", "Site Address", "Warranty ID", "Warranty Status", "Fault", "Contact Name", "WhatsApp", "Email", "Status", "Filed"];
  const rows = lastLoadedComplaints.map((c) => [
    c.id, c.branchName, c.siteAddress, c.warrantySerial, c.warrantyStatus, c.faultType,
    c.contactName, c.whatsappNumber, c.email, c.status, formatDate(c.createdAt)
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${(v || "").toString().replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `claims-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  toast("CSV exported.", "success");
});

document.getElementById("refreshDashBtn").addEventListener("click", loadDashboard);
document.getElementById("dashSearch").addEventListener("input", debounce(loadDashboard, 350));
document.getElementById("dashStatusFilter").addEventListener("change", loadDashboard);
document.getElementById("dashOverdueOnly").addEventListener("change", () => renderDashboard(lastLoadedComplaints, {
  total: lastLoadedComplaints.length,
  pending: lastLoadedComplaints.filter((c) => c.status === "Pending").length,
  inProgress: lastLoadedComplaints.filter((c) => c.status === "In Progress").length,
  resolved: lastLoadedComplaints.filter((c) => c.status === "Resolved").length
}));

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// ================= MODULE 04: WARRANTY DATABASE =================
const WARRANTY_HEADERS = [
  "Warranty ID", "Customer Name", "Registration Status", "Total Warranty",
  "Warranty Start Date", "Warranty End Date", "Registration Date", "SKU ID",
  "SKU Name", "Brand", "Email", "Project Name", "Converter Name",
  "Contact Person Number", "Contact Person Name", "Site Address",
  "City Name", "Pin Code", "Product Name", "Product Type"
];
const WARRANTY_FIELD_ORDER = [
  "warrantyId", "customerName", "registrationStatus", "totalWarranty",
  "warrantyStartDate", "warrantyEndDate", "registrationDate", "skuId",
  "skuName", "brand", "email", "projectName", "converterName",
  "contactPersonNumber", "contactPersonName", "siteAddress",
  "cityName", "pinCode", "productName", "productType"
];

async function loadWarranty() {
  const q = document.getElementById("warrantySearch").value.trim();
  document.getElementById("warrantyAddPanel").style.opacity = adminToken ? "1" : "0.55";
  document.getElementById("addWarrantyBtn").disabled = !adminToken;
  document.getElementById("warrantyUploadPanel").style.opacity = adminToken ? "1" : "0.55";
  document.getElementById("csvUploadBtn").disabled = !adminToken || !selectedCsvFile;
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const data = await api("/api/warranty?" + params.toString());
    renderWarranty(data.warranties);
    document.getElementById("warrantyCount").textContent = `${data.total} record${data.total === 1 ? "" : "s"} total`;
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderWarranty(records) {
  const body = document.getElementById("warrantyTableBody");
  const empty = document.getElementById("warrantyEmpty");
  body.innerHTML = "";
  if (records.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  records.forEach((w) => {
    const tr = document.createElement("tr");
    const status = w.registrationStatus || "—";
    const statusClass = status === "Approved" ? "Resolved" : status === "Rejected" ? "Pending" : "In-Progress";
    tr.innerHTML = `
      <td class="mono">${w.warrantyId || "—"}</td>
      <td>${w.customerName || "—"}<br><span class="hint">${w.cityName || ""}</span></td>
      <td>${w.productName || w.skuName || "—"}</td>
      <td>${w.cityName || "—"}</td>
      <td><span class="badge ${statusClass}">${status}</span></td>
      <td>${w.warrantyStartDate || "—"}</td>
      <td>${w.warrantyEndDate || "—"}</td>
      <td><div class="row-actions"></div></td>
    `;
    const actionCell = tr.querySelector(".row-actions");
    const viewBtn = document.createElement("button");
    viewBtn.className = "btn btn-ghost btn-sm";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => openWarrantyModal(w));
    actionCell.appendChild(viewBtn);

    if (adminToken) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Delete warranty record ${w.warrantyId}?`)) return;
        try {
          await api(`/api/warranty/${encodeURIComponent(w.warrantyId)}`, { method: "DELETE" });
          toast("Record deleted.", "success");
          loadWarranty();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      actionCell.appendChild(delBtn);
    }
    body.appendChild(tr);
  });
}

function openWarrantyModal(w) {
  const body = document.getElementById("warrantyModalBody");
  const rows = WARRANTY_FIELD_ORDER.map((field, i) =>
    `<div class="detail-row"><span class="k">${WARRANTY_HEADERS[i]}</span><span class="v">${w[field] || "—"}</span></div>`
  ).join("");
  body.innerHTML = `<div class="detail-card">${rows}</div>`;
  document.getElementById("warrantyModalOverlay").style.display = "flex";
}
document.getElementById("warrantyModalClose").addEventListener("click", () => {
  document.getElementById("warrantyModalOverlay").style.display = "none";
});
document.getElementById("warrantyModalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "warrantyModalOverlay") e.currentTarget.style.display = "none";
});

document.getElementById("warrantyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!adminToken) return toast("Admin login required to add warranty records.", "error");

  const payload = {
    warrantyId: document.getElementById("wWarrantyId").value.trim(),
    customerName: document.getElementById("wCustomerName").value,
    registrationStatus: document.getElementById("wRegistrationStatus").value,
    totalWarranty: document.getElementById("wTotalWarranty").value,
    warrantyStartDate: document.getElementById("wWarrantyStartDate").value,
    warrantyEndDate: document.getElementById("wWarrantyEndDate").value,
    registrationDate: document.getElementById("wRegistrationDate").value,
    skuId: document.getElementById("wSkuId").value,
    skuName: document.getElementById("wSkuName").value,
    brand: document.getElementById("wBrand").value,
    email: document.getElementById("wEmail").value,
    projectName: document.getElementById("wProjectName").value,
    converterName: document.getElementById("wConverterName").value,
    contactPersonNumber: document.getElementById("wContactPersonNumber").value,
    contactPersonName: document.getElementById("wContactPersonName").value,
    siteAddress: document.getElementById("wSiteAddress").value,
    cityName: document.getElementById("wCityName").value,
    pinCode: document.getElementById("wPinCode").value,
    productName: document.getElementById("wProductName").value,
    productType: document.getElementById("wProductType").value
  };
  try {
    await api("/api/warranty", { method: "POST", body: JSON.stringify(payload) });
    toast("Warranty record added.", "success");
    document.getElementById("warrantyForm").reset();
    document.getElementById("wBrand").value = "Linea LED";
    loadWarranty();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("refreshWarrantyBtn").addEventListener("click", loadWarranty);
document.getElementById("warrantySearch").addEventListener("input", debounce(loadWarranty, 350));

// ---- CSV upload ----
let selectedCsvFile = null;

document.getElementById("csvSelectBtn").addEventListener("click", () => {
  document.getElementById("csvInput").click();
});
document.getElementById("csvInput").addEventListener("change", (e) => {
  selectedCsvFile = e.target.files[0] || null;
  document.getElementById("csvFileName").textContent = selectedCsvFile ? selectedCsvFile.name : "No file selected";
  document.getElementById("csvUploadBtn").disabled = !adminToken || !selectedCsvFile;
});

document.getElementById("csvUploadBtn").addEventListener("click", async () => {
  if (!adminToken) return toast("Admin login required to upload a CSV.", "error");
  if (!selectedCsvFile) return toast("Choose a CSV file first.", "error");

  const btn = document.getElementById("csvUploadBtn");
  btn.disabled = true;
  btn.textContent = "Uploading…";
  const resultBox = document.getElementById("csvImportResult");
  resultBox.innerHTML = "";

  const fd = new FormData();
  fd.append("file", selectedCsvFile);

  try {
    const data = await api("/api/warranty/import", { method: "POST", body: fd });
    const hasErrors = data.errors && data.errors.length > 0;
    resultBox.innerHTML = `
      <div class="import-summary ${hasErrors ? "has-errors" : ""}">
        ${data.message}
      </div>
      ${hasErrors ? `<div class="import-errors">${data.errors.join("<br>")}</div>` : ""}
    `;
    toast(data.message, "success");
    selectedCsvFile = null;
    document.getElementById("csvInput").value = "";
    document.getElementById("csvFileName").textContent = "No file selected";
    loadWarranty();
  } catch (err) {
    toast(err.message, "error");
    resultBox.innerHTML = `<div class="import-summary has-errors">${err.message}</div>`;
  } finally {
    btn.disabled = !adminToken;
    btn.textContent = "Upload & Import";
  }
});

document.getElementById("csvTemplateBtn").addEventListener("click", () => {
  const sampleRow = [
    "TA4G5TJZ", "Sample Customer Pvt Ltd", "Approved", "5 years",
    "05/21/2026", "05/20/2031", "05/22/2026", "Linea LED- 5 Years",
    "Linea LED", "Linea LED", "someone@example.com", "Sample Project",
    "Sample Converter Pvt Ltd", "9999999999", "Contact Person",
    "Shop 1, Sample Complex, Sample City", "Sample City", "110001",
    "Linea 11 HO 1.2w 8000k", "Modules"
  ];
  const csv = WARRANTY_HEADERS.join(",") + "\n" + sampleRow.map((v) => `"${v}"`).join(",");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "warranty-upload-template.csv";
  link.click();
});

// ================= MODULE 05: ADMIN CONSOLE =================
document.getElementById("adminLoginBtn").addEventListener("click", async () => {
  const password = document.getElementById("adminPassword").value;
  const errEl = document.getElementById("adminLoginError");
  errEl.textContent = "";
  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    adminToken = data.token;
    document.getElementById("adminLoggedOut").style.display = "none";
    document.getElementById("adminLoggedIn").style.display = "block";
    document.getElementById("adminBadge").textContent = "ADMIN";
    document.getElementById("adminPassword").value = "";
    await loadAdminConfig();
    await loadNotificationSettings();
    await loadPhotoStorageSettings();
    toast("Welcome back, admin.", "success");
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("adminLogoutBtn").addEventListener("click", () => {
  adminToken = null;
  document.getElementById("adminLoggedOut").style.display = "block";
  document.getElementById("adminLoggedIn").style.display = "none";
  document.getElementById("adminBadge").textContent = "";
  toast("Logged out.");
});

async function loadAdminConfig() {
  try {
    const data = await api("/api/admin/config");
    document.getElementById("cfgCompanyName").value = data.companyName || "";
    document.getElementById("cfgSupportEmail").value = data.supportEmail || "";
    document.getElementById("cfgSupportPhone").value = data.supportPhone || "";
  } catch (err) { /* silent */ }
}

async function loadNotificationSettings() {
  if (!adminToken) return;
  try {
    const data = await api("/api/admin/notifications");
    document.getElementById("waEnabled").checked = !!data.whatsapp.enabled;
    document.getElementById("waProductId").value = data.whatsapp.productId || "";
    document.getElementById("waPhoneId").value = data.whatsapp.phoneId || "";
    document.getElementById("waAdminNumber").value = data.whatsapp.adminNumber || "";
    document.getElementById("waTokenCurrent").textContent = data.whatsapp.token
      ? `Saved token: ${data.whatsapp.token}` : "No token saved yet.";

    document.getElementById("emEnabled").checked = !!data.email.enabled;
    document.getElementById("emFromEmail").value = data.email.fromEmail || "";
    document.getElementById("emKeyCurrent").textContent = data.email.resendApiKey
      ? `Saved key: ${data.email.resendApiKey}` : "No API key saved yet.";
  } catch (err) {
    toast(err.message, "error");
  }
}

document.getElementById("whatsappForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({
        whatsapp: {
          enabled: document.getElementById("waEnabled").checked,
          productId: document.getElementById("waProductId").value,
          phoneId: document.getElementById("waPhoneId").value,
          token: document.getElementById("waToken").value || undefined,
          adminNumber: document.getElementById("waAdminNumber").value
        }
      })
    });
    document.getElementById("waToken").value = "";
    toast("WhatsApp settings saved.", "success");
    loadNotificationSettings();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("waTestBtn").addEventListener("click", async () => {
  const number = prompt("Enter a 10-digit WhatsApp number to send a test message to:");
  if (!number) return;
  try {
    await api("/api/admin/notifications/test-whatsapp", {
      method: "POST",
      body: JSON.stringify({ toNumber: number })
    });
    toast("Test message sent — check WhatsApp.", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("emailForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/notifications", {
      method: "PUT",
      body: JSON.stringify({
        email: {
          enabled: document.getElementById("emEnabled").checked,
          resendApiKey: document.getElementById("emResendApiKey").value || undefined,
          fromEmail: document.getElementById("emFromEmail").value
        }
      })
    });
    document.getElementById("emResendApiKey").value = "";
    toast("Email settings saved.", "success");
    loadNotificationSettings();
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("emTestBtn").addEventListener("click", async () => {
  const email = prompt("Enter an email address to send a test email to:");
  if (!email) return;
  const btn = document.getElementById("emTestBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    await api("/api/admin/notifications/test-email", {
      method: "POST",
      body: JSON.stringify({ toEmail: email })
    });
    toast("Test email sent — check the inbox (and spam folder).", "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Send Test Email";
  }
});

document.getElementById("companyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/config", {
      method: "PUT",
      body: JSON.stringify({
        companyName: document.getElementById("cfgCompanyName").value,
        supportEmail: document.getElementById("cfgSupportEmail").value,
        supportPhone: document.getElementById("cfgSupportPhone").value
      })
    });
    toast("Settings saved.", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("checkExpiryBtn").addEventListener("click", async () => {
  const btn = document.getElementById("checkExpiryBtn");
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const data = await api("/api/admin/check-expiring-warranties", { method: "POST" });
    toast(data.message, "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "⏰ Check Expiring Warranties Now";
  }
});

// ---- Photo Storage (Cloudinary) settings ----
async function loadPhotoStorageSettings() {
  try {
    const data = await api("/api/admin/photo-storage");
    document.getElementById("cloudName").value = data.cloudName || "";
    document.getElementById("uploadPreset").value = data.uploadPreset || "";
  } catch (err) {
    // silent - non-critical
  }
}

document.getElementById("photoStorageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/photo-storage", {
      method: "PUT",
      body: JSON.stringify({
        cloudName: document.getElementById("cloudName").value.trim(),
        uploadPreset: document.getElementById("uploadPreset").value.trim()
      })
    });
    toast("Photo storage settings saved.", "success");
  } catch (err) {
    toast(err.message, "error");
  }
});

document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/admin/password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: document.getElementById("pwCurrent").value,
        newPassword: document.getElementById("pwNew").value
      })
    });
    toast("Password updated.", "success");
    document.getElementById("passwordForm").reset();
  } catch (err) {
    toast(err.message, "error");
  }
});

// ================= MODULE 06: TRACK MY CLAIM (public) =================
document.getElementById("trackForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("trackClaimId").value.trim();
  const whatsapp = document.getElementById("trackWhatsapp").value.trim();
  const btn = document.getElementById("trackSubmitBtn");
  const panel = document.getElementById("trackResultPanel");

  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    const data = await api(`/api/complaints/track/lookup?id=${encodeURIComponent(id)}&whatsapp=${encodeURIComponent(whatsapp)}`);
    renderTrackResult(data.complaint);
  } catch (err) {
    panel.style.display = "block";
    panel.innerHTML = `<div class="empty-state"><div class="icon">🔎</div>${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Check Status";
  }
});

function renderTrackResult(c) {
  const panel = document.getElementById("trackResultPanel");
  const pillClass = statusPillColorClass(c.status);
  const pillBg = pillClass === "resolved" ? "var(--gradient-success)" : pillClass === "progress" ? "linear-gradient(135deg,#22b3c4,#0e7c86)" : "var(--gradient-accent)";

  const timeline = (c.statusHistory || [])
    .map((h) => `<div class="detail-row"><span class="k">📅 ${formatDate(h.at)}</span><span class="v">${h.status}</span></div>`)
    .join("");

  const photosHtml = (c.photos || [])
    .map((p) => `<img src="${photoUrl(p)}" style="width:60px;height:60px;" />`)
    .join("");

  panel.style.display = "block";
  panel.innerHTML = `
    <div class="detail-status-pill"><span style="background:${pillBg};">${c.status}</span></div>
    <div class="detail-card">
      ${detailRowHtml("Claim ID", c.id)}
      ${detailRowHtml("Branch / Site", c.branchName)}
      ${detailRowHtml("Fault", c.faultType)}
      ${detailRowHtml("Warranty Status", c.warrantyStatus || "Not Found")}
      ${detailRowHtml("Filed", formatDate(c.createdAt))}
    </div>
    ${photosHtml ? `<div class="detail-photos"><div class="hint">Photos</div>${photosHtml}</div>` : ""}
    ${c.resolutionPhoto ? `<div class="detail-photos"><div class="hint">Resolution Photo</div><img src="${photoUrl(c.resolutionPhoto)}" style="width:90px;height:90px;border:2px solid var(--success);" /></div>` : ""}
    <div style="margin-top:18px;">
      <div class="hint" style="margin-bottom:8px; font-weight:600;">Status Timeline</div>
      <div class="detail-card">${timeline}</div>
    </div>
  `;
}

// Load public config on first paint (company name in footer etc. — optional enhancement)
loadAdminConfig();
if (!document.body.classList.contains("kiosk-mode")) loadQrList();
