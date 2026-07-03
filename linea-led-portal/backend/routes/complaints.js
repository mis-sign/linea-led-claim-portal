const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { readDb, writeDb, nextId } = require("../db");
const { requireAdmin } = require("./admin");
const { matchWarranty } = require("../services/warrantyMatch");
const mailer = require("../services/mailer");
const whatsapp = require("../services/whatsapp");

const router = express.Router();

// ---- Photo upload setup ----
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per photo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  }
});

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

  const photos = (req.files || []).map((f) => `/uploads/${f.filename}`);

  const db = readDb();
  const { status: warrantyStatus, record: matchedWarranty } = matchWarranty(db, warrantySerial || "");

  const complaint = {
    id: nextId("LC"),
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
  writeDb(db);

  // Fire off notifications — never let these block or fail the actual claim registration.
  const notified = { customerEmail: false, adminEmail: false, whatsapp: false };
  try {
    if (complaint.email) {
      const r = await mailer.sendEmail(db, {
        to: complaint.email,
        subject: `Claim Registered — ${complaint.id}`,
        html: mailer.complaintRegisteredCustomerEmail(db, complaint)
      });
      notified.customerEmail = r.sent;
    }
    if (db.admin.supportEmail) {
      const r = await mailer.sendEmail(db, {
        to: db.admin.supportEmail,
        subject: `New Claim Filed — ${complaint.id}`,
        html: mailer.complaintRegisteredAdminEmail(db, complaint)
      });
      notified.adminEmail = r.sent;
    }
    const r = await whatsapp.sendWhatsApp(db, {
      toNumber: complaint.whatsappNumber,
      message: whatsapp.complaintRegisteredMessage(db, complaint)
    });
    notified.whatsapp = r.sent;
  } catch (err) {
    console.error("Notification error (non-fatal):", err.message);
  }

  res.status(201).json({ message: "Complaint registered successfully.", complaint, notified });
});

// GET /api/complaints - list all complaints, optional ?status=&branch=&q=
router.get("/", (req, res) => {
  const { status, branch, q } = req.query;
  const db = readDb();
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

// GET /api/complaints/:id - single complaint detail
router.get("/:id", (req, res) => {
  const db = readDb();
  const complaint = db.complaints.find((c) => c.id === req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found." });
  res.json({ complaint });
});

// PATCH /api/complaints/:id/status - update status (admin only)
router.patch("/:id/status", requireAdmin, async (req, res) => {
  const { status } = req.body;
  const allowed = ["Pending", "In Progress", "Resolved"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }
  const db = readDb();
  const complaint = db.complaints.find((c) => c.id === req.params.id);
  if (!complaint) return res.status(404).json({ error: "Complaint not found." });

  complaint.status = status;
  complaint.updatedAt = new Date().toISOString();
  complaint.statusHistory.push({ status, at: complaint.updatedAt });
  writeDb(db);

  const notified = { customerEmail: false, whatsapp: false };
  try {
    if (complaint.email) {
      const r = await mailer.sendEmail(db, {
        to: complaint.email,
        subject: `Claim ${complaint.id} — Status: ${status}`,
        html: mailer.statusUpdateCustomerEmail(db, complaint)
      });
      notified.customerEmail = r.sent;
    }
    const r = await whatsapp.sendWhatsApp(db, {
      toNumber: complaint.whatsappNumber,
      message: whatsapp.statusUpdateMessage(db, complaint)
    });
    notified.whatsapp = r.sent;
  } catch (err) {
    console.error("Notification error (non-fatal):", err.message);
  }

  res.json({ message: "Status updated.", complaint, notified });
});

module.exports = router;
