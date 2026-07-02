const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { readDb, writeDb } = require("../db");

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
router.post("/login", (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password is required." });

  const db = readDb();
  const ok = bcrypt.compareSync(password, db.admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  db.admin.lastLogin = new Date().toISOString();
  writeDb(db);

  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, companyName: db.admin.companyName });
});

// GET /api/admin/config - public bits used to brand the site (no auth needed)
router.get("/config", (req, res) => {
  const db = readDb();
  res.json({
    companyName: db.admin.companyName,
    supportEmail: db.admin.supportEmail,
    supportPhone: db.admin.supportPhone
  });
});

// PUT /api/admin/config - update company info (admin only)
router.put("/config", requireAdmin, (req, res) => {
  const { companyName, supportEmail, supportPhone } = req.body;
  const db = readDb();
  if (companyName) db.admin.companyName = companyName;
  if (supportEmail) db.admin.supportEmail = supportEmail;
  if (supportPhone) db.admin.supportPhone = supportPhone;
  writeDb(db);
  res.json({ message: "Config updated.", config: db.admin });
});

// PUT /api/admin/password - change admin password (admin only)
router.put("/password", requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const db = readDb();
  const ok = bcrypt.compareSync(currentPassword, db.admin.passwordHash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect." });

  db.admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeDb(db);
  res.json({ message: "Password changed successfully." });
});

module.exports = { router, requireAdmin };
