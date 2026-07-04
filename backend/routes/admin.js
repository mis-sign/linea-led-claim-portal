const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { readDb, writeDb } = require("../db");
const whatsapp = require("../services/whatsapp");
const mailer = require("../services/mailer");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";

// Middleware: protects any route that only the admin should reach
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Admin login required." });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

// POST /api/admin/login
router.post("/login", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password is required." });

  const db = await readDb();
  const ok = bcrypt.compareSync(password, db.admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  db.admin.lastLogin = new Date().toISOString();
  await writeDb(db);

  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, companyName: db.admin.companyName });
});

// GET /api/admin/config - public bits used to brand the site (no auth needed)
router.get("/config", async (req, res) => {
  const db = await readDb();
  res.json({
    companyName: db.admin.companyName,
    supportEmail: db.admin.supportEmail,
    supportPhone: db.admin.supportPhone
  });
});

// PUT /api/admin/config - update company info (admin only)
router.put("/config", requireAdmin, async (req, res) => {
  const { companyName, supportEmail, supportPhone } = req.body;
  const db = await readDb();
  if (companyName) db.admin.companyName = companyName;
  if (supportEmail) db.admin.supportEmail = supportEmail;
  if (supportPhone) db.admin.supportPhone = supportPhone;
  await writeDb(db);
  res.json({ message: "Config updated.", config: db.admin });
});

// PUT /api/admin/password - change admin password (admin only)
router.put("/password", requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const db = await readDb();
  const ok = bcrypt.compareSync(currentPassword, db.admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect." });

  db.admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  await writeDb(db);
  res.json({ message: "Password changed successfully." });
});

// ---- Notification settings (WhatsApp via Maytapi + Email via Resend) ----
// These hold real secrets, so unlike /config this is never exposed publicly.

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "•".repeat(value.length - 4) + value.slice(-4);
}

// GET /api/admin/notifications - current settings, secrets masked (admin only)
router.get("/notifications", requireAdmin, async (req, res) => {
  const db = await readDb();
  const n = db.admin.notifications;
  res.json({
    whatsapp: {
      enabled: n.whatsapp.enabled,
      productId: n.whatsapp.productId,
      phoneId: n.whatsapp.phoneId,
      token: maskSecret(n.whatsapp.token),
      adminNumber: n.whatsapp.adminNumber || ""
    },
    email: {
      enabled: n.email.enabled,
      resendApiKey: maskSecret(n.email.resendApiKey),
      fromEmail: n.email.fromEmail || ""
    }
  });
});

// PUT /api/admin/notifications - update settings (admin only)
// Send only the fields you want to change. To keep a secret unchanged, just
// omit it (leaving the masked value in a text box and re-submitting it would
// overwrite the real secret with dots, so the frontend never resends masked values).
router.put("/notifications", requireAdmin, async (req, res) => {
  const db = await readDb();
  const { whatsapp, email } = req.body;

  if (whatsapp) {
    if (whatsapp.enabled !== undefined) db.admin.notifications.whatsapp.enabled = !!whatsapp.enabled;
    if (whatsapp.productId !== undefined) db.admin.notifications.whatsapp.productId = whatsapp.productId;
    if (whatsapp.phoneId !== undefined) db.admin.notifications.whatsapp.phoneId = whatsapp.phoneId;
    if (whatsapp.token) db.admin.notifications.whatsapp.token = whatsapp.token;
    if (whatsapp.adminNumber !== undefined) db.admin.notifications.whatsapp.adminNumber = whatsapp.adminNumber;
  }
  if (email) {
    if (email.enabled !== undefined) db.admin.notifications.email.enabled = !!email.enabled;
    if (email.resendApiKey) db.admin.notifications.email.resendApiKey = email.resendApiKey;
    if (email.fromEmail !== undefined) db.admin.notifications.email.fromEmail = email.fromEmail;
  }

  await writeDb(db);
  res.json({ message: "Notification settings updated." });
});

// POST /api/admin/notifications/test-whatsapp - send a test message (admin only)
router.post("/notifications/test-whatsapp", requireAdmin, async (req, res) => {
  const { toNumber } = req.body;
  if (!toNumber) return res.status(400).json({ error: "toNumber is required." });
  const db = await readDb();
  const result = await whatsapp.sendWhatsApp(db, {
    toNumber,
    message: `✅ Test message from ${db.admin.companyName}'s Warranty Claim Hub. Your WhatsApp integration is working!`
  });
  if (!result.sent) return res.status(400).json({ error: result.reason || "Failed to send test message." });
  res.json({ message: "Test message sent." });
});

// POST /api/admin/notifications/test-email - send a test email (admin only)
// Returns the real error if it fails, so you can see exactly what's wrong
// (wrong API key, etc.) instead of guessing.
router.post("/notifications/test-email", requireAdmin, async (req, res) => {
  const { toEmail } = req.body;
  if (!toEmail) return res.status(400).json({ error: "toEmail is required." });
  const db = await readDb();
  const result = await mailer.sendEmail(db, {
    to: toEmail,
    subject: `Test Email — ${db.admin.companyName}`,
    html: mailer.testEmailTemplate(db)
  });
  if (!result.sent) return res.status(400).json({ error: result.reason || "Failed to send test email." });
  res.json({ message: "Test email sent." });
});

module.exports = { router, requireAdmin };
