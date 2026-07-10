// whatsapp.js
// Sends WhatsApp messages via Maytapi (https://maytapi.com) using the
// credentials saved in the Admin Console (Module 05 → Notification Settings):
//   - Product ID Key   -> productId
//   - Phone Configuration ID -> phoneId
//   - Token Secure ID  -> token (sent as the x-maytapi-key header)
//
// If WhatsApp notifications are disabled/not configured, sendWhatsApp()
// skips silently and never throws — a broken WhatsApp config can't break
// claim registration.

function formatIndianNumber(number) {
  const digits = (number || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits; // assume India if no country code given
  return digits;
}

async function sendWhatsApp(db, { toNumber, message }) {
  const cfg = db.admin.notifications && db.admin.notifications.whatsapp;
  if (!cfg || !cfg.enabled || !cfg.productId || !cfg.phoneId || !cfg.token) {
    return { sent: false, reason: "WhatsApp notifications are not configured/enabled." };
  }

  const url = `https://api.maytapi.com/api/${cfg.productId}/${cfg.phoneId}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-maytapi-key": cfg.token
      },
      body: JSON.stringify({
        to_number: formatIndianNumber(toNumber),
        type: "text",
        message
      }),
      signal: AbortSignal.timeout(15000) // fail fast instead of hanging forever
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      console.error("Maytapi send failed:", data);
      return { sent: false, reason: data.message || "Maytapi API rejected the message." };
    }
    return { sent: true };
  } catch (err) {
    console.error("WhatsApp send failed:", err.message);
    const reason = err.name === "TimeoutError" || err.name === "AbortError"
      ? "Couldn't reach Maytapi (connection timed out after 15s). Check your Product ID Key / Phone Configuration ID are correct."
      : err.message;
    return { sent: false, reason };
  }
}

// ---- Templates (plain text — WhatsApp doesn't render HTML, so we build a
// "card" look using unicode dividers, bold markers and emoji icons) ----

const DIVIDER = "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

// Builds a direct link to the "Track My Claim" page, pre-filled with this
// customer's Claim ID and WhatsApp number so one tap shows their status.
function trackingLink(complaint) {
  const base = process.env.FRONTEND_URL || "";
  if (!base) return "";
  const link = `${base.replace(/\/$/, "")}/?module=track&claimId=${encodeURIComponent(complaint.id)}&whatsapp=${encodeURIComponent(complaint.whatsappNumber)}`;
  return `\n🔗 *Track your claim:*\n${link}\n`;
}

function complaintRegisteredMessage(db, complaint) {
  const company = db.admin.companyName;
  return (
    `✅ *${company}*\n${DIVIDER}\n` +
    `*🎫 WARRANTY CLAIM REGISTERED*\n${DIVIDER}\n\n` +
    `Hi *${complaint.contactName}*, your claim has been logged successfully. Our team will reach out shortly.\n\n` +
    `🆔 *Claim ID:* ${complaint.id}\n` +
    `🏢 *Branch:* ${complaint.branchName}\n` +
    `⚡ *Fault:* ${complaint.faultType}\n` +
    `🛡️ *Warranty:* ${complaint.warrantyStatus}\n` +
    `📌 *Status:* ${complaint.status}\n` +
    trackingLink(complaint) +
    `\n${DIVIDER}\n` +
    `We'll message you here as your claim progresses.\n` +
    `📞 Support: ${db.admin.supportPhone}`
  );
}

function statusUpdateMessage(db, complaint) {
  const company = db.admin.companyName;
  return (
    `🔔 *${company}*\n${DIVIDER}\n` +
    `*CLAIM STATUS UPDATED*\n${DIVIDER}\n\n` +
    `Hi *${complaint.contactName}*, here's the latest on your claim.\n\n` +
    `🆔 *Claim ID:* ${complaint.id}\n` +
    `🏢 *Branch:* ${complaint.branchName}\n` +
    `⚡ *Fault:* ${complaint.faultType}\n` +
    `📌 *New Status:* ${complaint.status}\n` +
    trackingLink(complaint) +
    `\n${DIVIDER}\n` +
    `📞 Support: ${db.admin.supportPhone}`
  );
}

// Sent to the admin's own WhatsApp number (Notification Settings → Admin
// WhatsApp Number) whenever a new claim comes in — separate from the
// customer's copy so the wording/tone fits an internal alert.
function adminNewClaimMessage(db, complaint) {
  const company = db.admin.companyName;
  return (
    `📥 *${company} — New Claim Alert*\n${DIVIDER}\n\n` +
    `A new warranty claim was just filed.\n\n` +
    `🆔 *Claim ID:* ${complaint.id}\n` +
    `🏢 *Branch:* ${complaint.branchName}\n` +
    `📍 *Address:* ${complaint.siteAddress}\n` +
    `⚡ *Fault:* ${complaint.faultType}\n` +
    `🛡️ *Warranty:* ${complaint.warrantyStatus}\n` +
    `👤 *Contact:* ${complaint.contactName}\n` +
    `📱 *Number:* ${complaint.whatsappNumber}\n\n` +
    `${DIVIDER}\n` +
    `Open the Admin Console → Live Dashboard to update this claim.`
  );
}

// Sent to the admin's own WhatsApp number when a new customer registers,
// asking them to review it in the Admin Console.
function customerRegistrationAdminMessage(db, account) {
  const company = db.admin.companyName;
  const reviewLink = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL.replace(/\/$/, "")}/?module=admin`
    : "";
  return (
    `👤 *${company} — New Customer Registration*\n${DIVIDER}\n\n` +
    `*Account ID:* ${account.id}\n` +
    `*Customer Name:* ${account.customerName}\n` +
    `*Phone:* ${account.phone}\n` +
    `*Email:* ${account.email || "—"}\n` +
    `*Address:* ${account.address || "—"}\n\n` +
    (reviewLink ? `🔗 *Review & verify:*\n${reviewLink}\n\n` : "") +
    `${DIVIDER}\n` +
    `Open Admin Console → Customer Account Registrations to Verify or Reject.`
  );
}

// Sent to the customer once the admin verifies their account, with
// step-by-step login instructions.
function customerVerifiedMessage(db, account) {
  const company = db.admin.companyName;
  const dashboardLink = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL.replace(/\/$/, "")}/?module=mydashboard`
    : "";
  return (
    `✅ *${company} — Account Verified*\n${DIVIDER}\n\n` +
    `Hi *${account.customerName}*, your account is verified! You can now log in to see all your warranty claims.\n\n` +
    `*How to log in:*\n` +
    `1️⃣ Tap the link below\n` +
    `2️⃣ Enter your registered number: *${account.phone}*\n` +
    `3️⃣ Enter the 6-digit code sent to your WhatsApp\n\n` +
    (dashboardLink ? `🔗 *Log in here:*\n${dashboardLink}\n\n` : "") +
    `${DIVIDER}\n` +
    `📞 Support: ${db.admin.supportPhone}`
  );
}

module.exports = {
  sendWhatsApp,
  complaintRegisteredMessage,
  statusUpdateMessage,
  adminNewClaimMessage,
  customerRegistrationAdminMessage,
  customerVerifiedMessage,
  formatIndianNumber
};
