const express = require("express");
const { readDb } = require("../db");
const { requestOtp, verifyOtp, requireCustomer } = require("../services/customerAuth");

const router = express.Router();

// POST /api/customer/request-otp - send a login code via WhatsApp
router.post("/request-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit WhatsApp number." });
  }
  const db = await readDb();
  if (!db.admin.notifications.whatsapp.enabled) {
    return res.status(400).json({
      error: "WhatsApp login isn't set up yet — ask the admin to enable WhatsApp notifications in the Admin Console first."
    });
  }
  const result = await requestOtp(db, phone);
  if (!result.sent) {
    return res.status(400).json({ error: result.reason || "Couldn't send the code. Try again." });
  }
  res.json({ message: "A 6-digit code has been sent to your WhatsApp." });
});

// POST /api/customer/verify-otp - verify the code and get a session token
router.post("/verify-otp", async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) return res.status(400).json({ error: "Phone and code are required." });
  const result = verifyOtp(phone, code);
  if (!result.valid) return res.status(401).json({ error: result.reason });
  res.json({ token: result.token });
});

// GET /api/customer/my-claims - this customer's own claims only, same shape
// as the admin dashboard endpoint so the UI can reuse the same rendering code.
router.get("/my-claims", requireCustomer, async (req, res) => {
  const db = await readDb();
  const mine = db.complaints.filter((c) => c.whatsappNumber === req.customerPhone);

  const stats = {
    total: mine.length,
    pending: mine.filter((c) => c.status === "Pending").length,
    inProgress: mine.filter((c) => c.status === "In Progress").length,
    resolved: mine.filter((c) => c.status === "Resolved").length
  };

  res.json({ complaints: mine, stats });
});

module.exports = router;
