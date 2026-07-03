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
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      console.error("Maytapi send failed:", data);
      return { sent: false, reason: data.message || "Maytapi API rejected the message." };
    }
    return { sent: true };
  } catch (err) {
    console.error("WhatsApp send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

// ---- Templates (plain text — WhatsApp doesn't render HTML) ----

function complaintRegisteredMessage(db, complaint) {
  const company = db.admin.companyName;
  return (
    `✅ *${company}* — Warranty Claim Registered\n\n` +
    `Hi ${complaint.contactName}, your claim has been logged.\n\n` +
    `*Claim ID:* ${complaint.id}\n` +
    `*Branch:* ${complaint.branchName}\n` +
    `*Fault:* ${complaint.faultType}\n` +
    `*Warranty Status:* ${complaint.warrantyStatus}\n` +
    `*Current Status:* ${complaint.status}\n\n` +
    `We'll keep you updated here on WhatsApp as your claim progresses.\n` +
    `Support: ${db.admin.supportPhone}`
  );
}

function statusUpdateMessage(db, complaint) {
  const company = db.admin.companyName;
  return (
    `🔔 *${company}* — Claim Status Updated\n\n` +
    `Hi ${complaint.contactName}, your claim *${complaint.id}* status is now:\n\n` +
    `*${complaint.status}*\n\n` +
    `Branch: ${complaint.branchName}\n` +
    `Fault: ${complaint.faultType}\n\n` +
    `Support: ${db.admin.supportPhone}`
  );
}

module.exports = { sendWhatsApp, complaintRegisteredMessage, statusUpdateMessage, formatIndianNumber };
