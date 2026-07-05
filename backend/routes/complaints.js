const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { readDb, writeDb } = require("../db");
const { requireAdmin } = require("./admin");
const { matchWarranty } = require("../services/warrantyMatch");
const mailer = require("../services/mailer");
const whatsapp = require("../services/whatsapp");
const cloudinaryUpload = require("../services/cloudinaryUpload");

const router = express.Router();

// ---- Photo upload setup ----
// Files are held in memory only, then either uploaded to Cloudinary (if
// configured in Admin Console → Photo Storage — recommended, permanent) or
// as a fallback written to Render's local disk (works, but gets wiped on
// every restart/redeploy — only used until Cloudinary is set up).
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per photo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

// Uploads one file (from multer's memory buffer) to Cloudinary if configured,
// otherwise falls back to writing it to local disk. Returns a URL usable
// directly in <img> tags either way (Cloudinary URLs are absolute; local
// ones are relative paths served by this same server under /uploads).
async function persistPhoto(db, file) {
  const result = await cloudinaryUpload.uploadPhoto(db, file.buffer, file.originalname);
  if (result.uploaded) return result.url;

  // Fallback: local disk (ephemeral — only used before Cloudinary is set up)
  const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const filename = unique + path.extname(file.originalname || ".jpg");
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return `/uploads/${filename}`;
}

// Sends all "new claim" notifications in the background. This is deliberately
// NOT awaited by the route handler — the customer's form should submit
// instantly once the claim is saved, not wait on email/WhatsApp network calls
// (which can be slow or occasionally hang depending on the provider).
async function sendNewClaimNotifications(db, complaint) {
  try {
    if (complaint.email) {
      await mailer.sendEmail(db, {
        to: complaint.email,
        subject: `Claim Registered — ${complaint.id}`,
        html: mailer.complaintRegisteredCustomerEmail(db, complaint)
      });
    }
    if (db.admin.supportEmail) {
      await mailer.sendEmail(db, {
        to: db.admin.supportEmail,
        subject: `New Claim Filed — ${complaint.id}`,
        html: mailer.complaintRegisteredAdminEmail(db, complaint)
      });
    }
    await whatsapp.sendWhatsApp(db, {
      toNumber: complaint.whatsappNumber,
      message: whatsapp.complaintRegisteredMessage(db, complaint)
    });
    const adminNumber = db.admin.notifications.whatsapp.adminNumber;
    if (adminNumber) {
      await whatsapp.sendWhatsApp(db, {
        toNumber: adminNumber,
        message: whatsapp.adminNewClaimMessage(db, complaint)
      });
    }
  } catch (err) {
    console.error("Notification error (non-fatal):", err.message);
  }
}

async function sendStatusUpdateNotifications(db, complaint) {
  try {
    if (complaint.email) {
      await mailer.sendEmail(db, {
        to: complaint.email,
        subject: `Claim ${complaint.id} — Status: ${complaint.status}`,
        html: mailer.statusUpdateCustomerEmail(db, complaint)
      });
    }
    await whatsapp.sendWhatsApp(db, {
      toNumber: complaint.whatsappNumber,
      message: whatsapp.statusUpdateMessage(db, complaint)
    });
  } catch (err) {
    console.error("Notification error (non-fatal):", err.message);
  }
}

// POST /api/complaints - register a new warranty claim (public - field techs use this)
router.post("/", upload.array("photos", 3), async (req, res) => {
  const {
    branchCode,
    branchName,
    siteAddress,
    warrantySerial,
    contactName,
    whatsappNumber,
    email,
    faultType,
    notes,
    latitude,
    longitude
  } = req.body;

  if (!branchName || !siteAddress || !contactName || !whatsappNumber || !faultType) {
    return res.status(400).json({
      error: "branchName, siteAddress, contactName, whatsappNumber and faultType are required."
    });
  }
  if (!/^[0-9]{10}$/.test(whatsappNumber)) {
    return res.status(400).json({ error: "whatsappNumber must be a 10-digit mobile number." });
  }

  const db = await readDb();
  const photos = [];
  for (const f of req.files || []) {
    photos.push(await persistPhoto(db, f));
  }

  const { status: warrantyStatus, record: matchedWarranty } = matchWarranty(db, warrantySerial || "");

  // Increment the counter directly on this already-fetched db object (rather
  // than calling nextId(), which does its own separate read/write cycle) —
  // otherwise this route's later writeDb(db) would overwrite the whole
  // document with a stale counter and silently undo the increment.
  db.counters.complaint += 1;
  const complaintId = `LC-${String(db.counters.complaint).padStart(5, "0")}`;

  const complaint = {
    id: complaintId,
    branchCode: branchCode || "N/A",
    branchName,
    siteAddress,
    warrantySerial: warrantySerial || "N/A",
    warrantyStatus, // "In Warranty" | "Out of Warranty" | "Unknown Dates" | "Not Found"
    matchedWarranty: matchedWarranty
      ? {
          warrantyId: matchedWarranty.warrantyId,
          customerName: matchedWarranty.customerName,
          productName: matchedWarranty.productName,
          warrantyEndDate: matchedWarranty.warrantyEndDate
        }
      : null,
    contactName,
    whatsappNumber,
    email: email || "",
    faultType,
    notes: notes || "",
    photos,
    location:
      latitude && longitude
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null,
    status: "Pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    statusHistory: [{ status: "Pending", at: new Date().toISOString() }]
  };

  db.complaints.unshift(complaint);
  await writeDb(db);

  // Respond to the customer immediately — the claim is already saved.
  res.status(201).json({ message: "Complaint registered successfully.", complaint });

  // Notifications happen after the response is sent, so a slow/hung email or
  // WhatsApp call never delays the "Submitted!" screen.
  sendNewClaimNotifications(db, complaint);
});

// GET /api/complaints - list all complaints, optional ?status=&branch=&q=
router.get("/", async (req, res) => {
  const { status, branch, q } = req.query;
  const db = await readDb();
  let results = db.complaints;

  if (status && status !== "All") {
    results = results.filter((c) => c.status === status);
  }
  if (branch) {
    results = results.filter((c) =>
      c.branchName.toLowerCase().includes(branch.toLowerCase())
    );
  }
  if (q) {
    const query = q.toLowerCase();
    results = results.filter(
      (c) =>
        c.id.toLowerCase().includes(query) ||
        c.warrantySerial.toLowerCase().includes(query) ||
        c.contactName.toLowerCase().includes(query)
    );
  }

  const stats = {
    total: db.complaints.length,
    pending: db.complaints.filter((c) => c.status === "Pending").length,
    inProgress: db.complaints.filter((c) => c.status === "In Progress").length,
    resolved: db.complaints.filter((c) => c.status === "Resolved").length
  };

  res.json({ complaints: results, stats });
});

// GET /api/complaints/track?id=LC-00001&whatsapp=9876543210
// Public endpoint for customer self-service status lookup. Requires BOTH the
// Claim ID and the WhatsApp number used at registration to match — this is
// deliberate so someone can't guess/enumerate other customers' claim details
// just by trying sequential Claim IDs.
router.get("/track/lookup", async (req, res) => {
  const { id, whatsapp } = req.query;
  if (!id || !whatsapp) {
    return res.status(400).json({ error: "Both Claim ID and WhatsApp number are required." });
  }
  const db = await readDb();
  const complaint = db.complaints.find(
    (c) => c.id.toLowerCase() === id.trim().toLowerCase() && c.whatsappNumber === whatsapp.trim()
  );
  if (!complaint) {
    return res.status(404).json({ error: "No claim found with that Claim ID and WhatsApp number combination." });
  }
  // Only return what a customer needs to see — not internal notes, GPS, etc.
  res.json({
    complaint: {
      id: complaint.id,
      branchName: complaint.branchName,
      siteAddress: complaint.siteAddress,
      faultType: complaint.faultType,
      warrantyStatus: complaint.warrantyStatus,
      status: complaint.status,
      createdAt: complaint.createdAt,
      updatedAt: complaint.updatedAt,
      statusHistory: complaint.statusHistory,
      photos: complaint.photos,
      resolutionPhoto: complaint.resolutionPhoto || null
    }
  });
});

// GET /api/complaints/:id - single complaint detail
router.get("/:id", async (req, res) => {
  const db = await readDb();
  const complaint = db.complaints.find((c) => c.id === req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found." });
  res.json({ complaint });
});

// PATCH /api/complaints/:id/status - update status (admin only)
// Accepts multipart/form-data so an optional resolution photo can be attached
// (field name "resolutionPhoto") when marking a claim Resolved.
router.patch("/:id/status", requireAdmin, upload.single("resolutionPhoto"), async (req, res) => {
  const { status } = req.body;
  const allowed = ["Pending", "In Progress", "Resolved"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }
  const db = await readDb();
  const complaint = db.complaints.find((c) => c.id === req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found." });

  complaint.status = status;
  complaint.updatedAt = new Date().toISOString();
  complaint.statusHistory.push({ status, at: complaint.updatedAt });
  if (req.file) {
    complaint.resolutionPhoto = await persistPhoto(db, req.file);
  }
  await writeDb(db);

  res.json({ message: "Status updated.", complaint });

  sendStatusUpdateNotifications(db, complaint);
});

module.exports = router;
