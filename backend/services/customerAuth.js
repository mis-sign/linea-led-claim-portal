// customerAuth.js
// Lets a customer log into their own personal dashboard using just their
// WhatsApp number + a one-time code (no password to manage). The OTP is
// sent via the same Maytapi WhatsApp integration already configured in
// Admin Console → Notification Settings, so there's nothing extra to set up.
//
// OTPs are kept in memory (not the database) since they're short-lived
// (5 minutes) and only need to survive within a single server process.

const jwt = require("jsonwebtoken");
const whatsapp = require("./whatsapp");

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-production";
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const otpStore = new Map(); // phone -> { code, expiresAt }

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function requestOtp(db, phone) {
  const code = generateOtp();
  otpStore.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS });

  const message =
    `🔐 *${db.admin.companyName}*\n\n` +
    `Your login code is:\n\n*${code}*\n\n` +
    `This code expires in 5 minutes. Don't share it with anyone.`;

  const result = await whatsapp.sendWhatsApp(db, { toNumber: phone, message });
  return result; // { sent: true } or { sent: false, reason }
}

function verifyOtp(phone, code) {
  const entry = otpStore.get(phone);
  if (!entry) return { valid: false, reason: "No code was requested for this number, or it already expired. Request a new one." };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return { valid: false, reason: "This code has expired. Request a new one." };
  }
  if (entry.code !== code) {
    return { valid: false, reason: "Incorrect code. Please check and try again." };
  }
  otpStore.delete(phone); // one-time use
  const token = jwt.sign({ role: "customer", phone }, JWT_SECRET, { expiresIn: "12h" });
  return { valid: true, token };
}

// Middleware: protects customer-only routes, attaches req.customerPhone
function requireCustomer(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Login required." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "customer") return res.status(403).json({ error: "Not authorized." });
    req.customerPhone = decoded.phone;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

module.exports = { requestOtp, verifyOtp, requireCustomer };
