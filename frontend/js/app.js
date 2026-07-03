// app.js — linea LED Warranty Claim Hub
// Talks to the Render backend defined in config.js (API_BASE_URL).

let adminToken = null; // kept in memory only — admin must log in again after a page refresh
let selectedPhotos = [];

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
}

// Handle deep-link from a scanned QR code, e.g.
// index.html?module=register&branchName=Sector%2062&branchCode=NOI-062
(function handleDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const mod = params.get("module");
  if (mod) showModule(mod);
  if (params.get("branchName")) document.getElementById("branchName").value = params.get("branchName");
  if (params.get("branchCode")) document.getElementById("branchCode").value = params.get("branchCode");
})();

// ================= MODULE 01: QR GENERATOR =================
let qrCodeInstance = null;

document.getElementById("generateQrBtn").addEventListener("click", () => {
  const name = document.getElementById("qrBranchName").value.trim();
  const code = document.getElementById("qrBranchCode").value.trim();
  if (!name) return toast("Enter a branch/client name first.", "error");

  const link =
    window.location.origin + window.location.pathname +
    `?module=register&branchName=${encodeURIComponent(name)}&branchCode=${encodeURIComponent(code)}`;

  const wrap = document.getElementById("qrCanvasWrap");
  wrap.innerHTML = "";
  qrCodeInstance = new QRCode(wrap, {
    text: link,
    width: 220,
    height: 220,
    colorDark: "#313234",
    colorLight: "#ffffff"
  });

  document.getElementById("qrActions").style.display = "block";
  document.getElementById("qrLinkPreview").textContent = link;
  toast("QR code generated.", "success");
});

document.getElementById("downloadQrBtn").addEventListener("click", () => {
  const img = document.querySelector("#qrCanvasWrap img") || document.querySelector("#qrCanvasWrap canvas");
  if (!img) return;
  const link = document.createElement("a");
  link.download = `linea-led-qr-${document.getElementById("qrBranchCode").value || "branch"}.png`;
  link.href = img.tagName === "CANVAS" ? img.toDataURL("image/png") : img.src;
  link.click();
});

// ================= MODULE 02: REGISTER COMPLAINT =================
document.getElementById("photoDrop").addEventListener("click", () => {
  document.getElementById("photoInput").click();
});

document.getElementById("photoInput").addEventListener("change", (e) => {
  const files = Array.from(e.target.files).slice(0, 3);
  selectedPhotos = files;
  const preview = document.getElementById("photoPreviews");
  preview.innerHTML = "";
  files.forEach((file) => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    preview.appendChild(img);
  });
});

document.getElementById("captureGpsBtn").addEventListener("click", () => {
  const result = document.getElementById("gpsResult");
  if (!navigator.geolocation) {
    result.textContent = "Geolocation is not supported on this device.";
    return;
  }
  result.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      document.getElementById("captureGpsBtn").dataset.lat = latitude;
      document.getElementById("captureGpsBtn").dataset.lng = longitude;
      result.textContent = `Captured: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    },
    () => { result.textContent = "Could not get location — please allow location access."; }
  );
});

document.getElementById("complaintForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const whatsapp = document.getElementById("whatsappNumber").value.trim();
  if (!/^[0-9]{10}$/.test(whatsapp)) {
    return toast("WhatsApp number must be exactly 10 digits.", "error");
  }

  const btn = document.getElementById("submitComplaintBtn");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  const fd = new FormData();
  fd.append("branchName", document.getElementById("branchName").value);
  fd.append("branchCode", document.getElementById("branchCode").value);
  fd.append("siteAddress", document.getElementById("siteAddress").value);
  fd.append("warrantySerial", document.getElementById("warrantySerial").value);
  fd.append("contactName", document.getElementById("contactName").value);
  fd.append("whatsappNumber", whatsapp);
  fd.append("email", document.getElementById("email").value);
  fd.append("faultType", document.getElementById("faultType").value);
  fd.append("notes", document.getElementById("notes").value);
  const gpsBtn = document.getElementById("captureGpsBtn");
  if (gpsBtn.dataset.lat) {
    fd.append("latitude", gpsBtn.dataset.lat);
    fd.append("longitude", gpsBtn.dataset.lng);
  }
  selectedPhotos.forEach((file) => fd.append("photos", file));

  try {
    const data = await api("/api/complaints", { method: "POST", body: fd });
    toast(`Claim registered! ID: ${data.complaint.id} — Warranty: ${data.complaint.warrantyStatus}`, "success");
    document.getElementById("complaintForm").reset();
    document.getElementById("photoPreviews").innerHTML = "";
    document.getElementById("gpsResult").textContent = "";
    selectedPhotos = [];
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Claim";
  }
});

// ================= MODULE 03: LIVE DASHBOARD =================
async function loadDashboard() {
  const q = document.getElementById("dashSearch").value.trim();
  const status = document.getElementById("dashStatusFilter").value;
  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "All") params.set("status", status);
    const data = await api("/api/complaints?" + params.toString());
    renderDashboard(data.complaints, data.stats);
  } catch (err) {
    toast(err.message, "error");
  }
}

function renderDashboard(complaints, stats) {
  document.getElementById("statTotal").textContent = stats.total;
  document.getElementById("statPending").textContent = stats.pending;
  document.getElementById("statProgress").textContent = stats.inProgress;
  document.getElementById("statResolved").textContent = stats.resolved;

  const body = document.getElementById("dashTableBody");
  const empty = document.getElementById("dashEmpty");
  body.innerHTML = "";

  if (complaints.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  complaints.forEach((c) => {
    const tr = document.createElement("tr");
    const badgeClass = c.status.replace(" ", "-");
    const warrantyStatus = c.warrantyStatus || "Not Found";
    const warrantyBadgeClass = warrantyStatus.replace(/ /g, "-");
    if (warrantyStatus === "In Warranty") tr.classList.add("in-warranty-row");
    tr.innerHTML = `
      <td class="mono">${c.id}</td>
      <td>${c.branchName}<br><span class="hint">${c.siteAddress}</span></td>
      <td>${c.faultType}</td>
      <td><span class="badge ${warrantyBadgeClass}">${warrantyStatus}</span></td>
      <td>${c.contactName}<br><span class="hint">${c.whatsappNumber}</span></td>
      <td><span class="badge ${badgeClass}">${c.status}</span></td>
      <td>${formatDate(c.createdAt)}</td>
      <td></td>
    `;
    const actionCell = tr.querySelector("td:last-child");
    if (adminToken) {
      const select = document.createElement("select");
      ["Pending", "In Progress", "Resolved"].forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s; opt.textContent = s;
        if (s === c.status) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", async () => {
        try {
          await api(`/api/complaints/${c.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status: select.value })
          });
          toast(`${c.id} marked ${select.value}.`, "success");
          loadDashboard();
        } catch (err) {
          toast(err.message, "error");
        }
      });
      actionCell.appendChild(select);
    } else {
      actionCell.innerHTML = '<span class="hint">Admin login to update</span>';
    }
    body.appendChild(tr);
  });
}

document.getElementById("refreshDashBtn").addEventListener("click", loadDashboard);
document.getElementById("dashSearch").addEventListener("input", debounce(loadDashboard, 350));
document.getElementById("dashStatusFilter").addEventListener("change", loadDashboard);

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
      <td></td>
    `;
    const actionCell = tr.querySelector("td:last-child");
    const viewBtn = document.createElement("button");
    viewBtn.className = "btn btn-ghost btn-sm";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => openWarrantyModal(w));
    actionCell.appendChild(viewBtn);

    if (adminToken) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-danger btn-sm";
      delBtn.style.marginLeft = "6px";
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
  body.innerHTML = "";
  WARRANTY_FIELD_ORDER.forEach((field, i) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    row.innerHTML = `<span class="k">${WARRANTY_HEADERS[i]}</span><span class="v">${w[field] || "—"}</span>`;
    body.appendChild(row);
  });
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
    document.getElementById("waTokenCurrent").textContent = data.whatsapp.token
      ? `Saved token: ${data.whatsapp.token}` : "No token saved yet.";

    document.getElementById("emEnabled").checked = !!data.email.enabled;
    document.getElementById("emGmailUser").value = data.email.gmailUser || "";
    document.getElementById("emPasswordCurrent").textContent = data.email.gmailAppPassword
      ? `Saved password: ${data.email.gmailAppPassword}` : "No app password saved yet.";
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
          token: document.getElementById("waToken").value || undefined
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
          gmailUser: document.getElementById("emGmailUser").value,
          gmailAppPassword: document.getElementById("emAppPassword").value || undefined
        }
      })
    });
    document.getElementById("emAppPassword").value = "";
    toast("Email settings saved.", "success");
    loadNotificationSettings();
  } catch (err) {
    toast(err.message, "error");
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

// Load public config on first paint (company name in footer etc. — optional enhancement)
loadAdminConfig();
