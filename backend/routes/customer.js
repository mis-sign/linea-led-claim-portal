const express = require("express");
const { readDb, writeDb } = require("../db");
const { requestOtp, verifyOtp, requireCustomer } = require("../services/customerAuth");
const { requireAdmin } = require("./admin");

const router = express.Router();

// ---------------------------------------------------------------------------
// Registration + verification workflow:
//   1. Customer submits their details (name, email, phone, address) -> saved
//      with status "Pending".
//   2. Admin reviews it in the Admin Console and marks it "Verified" (or
//      "Rejected").
//   3. Only a "Verified" phone number can request/receive an OTP and log
//      into My Dashboard.
// This is deliberately separate from admin login — customers never get an
// admin password, and admins never see a customer's OTP.
// ---------------------------------------------------------------------------

// POST /api/customer/register - public: submit a new registration for review
router.post("/register", async (req, res) => {
  const { customerName, email, phone, address } = req.body;
  if (!customerName || !phone || !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: "Customer name and a valid 10-digit phone number are required." });
  }

  const db = await readDb();
  const existing = db.customerAccounts.find((a) => a.phone === phone);
  if (existing) {
    if (existing.status === "Verified") {
      return res.status(409).json({ error: "This number is already registered and verified — just log in with it." });
    }
    if (existing.status === "Pending") {
      return res.status(409).json({ error: "This number already has a pending registration — please wait for admin approval." });
    }
  }

  db.counters.customerAccount += 1;
  const account = {
    id: `CUST-${String(db.counters.customerAccount).padStart(5, "0")}`,
    customerName,
    email: email || "",
    phone,
    address: address || "",
    status: "Pending",
    createdAt: new Date().toISOString(),
    verifiedAt: null
  };
  db.customerAccounts.unshift(account);
  await writeDb(db);

  res.status(201).json({
    message: "Registration submitted! You'll be able to log in once the admin verifies your account.",
    account
  });
});

// POST /api/customer/request-otp - send a login code via WhatsApp (verified customers only)
router.post("/request-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: "Enter a valid 10-digit WhatsApp number." });
  }
  const db = await readDb();

  const account = db.customerAccounts.find((a) => a.phone === phone);
  if (!account) {
    return res.status(404).json({ error: "This number isn't registered yet. Please register first." });
  }
  if (account.status === "Pending") {
    return res.status(403).json({ error: "Your registration is still pending admin approval. Please check back soon." });
  }
  if (account.status === "Rejected") {
    return res.status(403).json({ error: "This registration was not approved. Please contact support." });
  }

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

// ---- Admin-only: review and manage customer registrations ----

// GET /api/customer/accounts - list all registrations (admin only)
router.get("/accounts", requireAdmin, async (req, res) => {
  const db = await readDb();
  res.json({ accounts: db.customerAccounts });
});

// PATCH /api/customer/accounts/:id/verify - approve a registration (admin only)
router.patch("/accounts/:id/verify", requireAdmin, async (req, res) => {
  const db = await readDb();
  const account = db.customerAccounts.find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Registration not found." });
  account.status = "Verified";
  account.verifiedAt = new Date().toISOString();
  await writeDb(db);
  res.json({ message: `${account.customerName} verified — they can now log in.`, account });
});

// PATCH /api/customer/accounts/:id/reject - reject a registration (admin only)
router.patch("/accounts/:id/reject", requireAdmin, async (req, res) => {
  const db = await readDb();
  const account = db.customerAccounts.find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Registration not found." });
  account.status = "Rejected";
  await writeDb(db);
  res.json({ message: `${account.customerName}'s registration was rejected.`, account });
});

module.exports = router;
