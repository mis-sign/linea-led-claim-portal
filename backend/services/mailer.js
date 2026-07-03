// mailer.js
// Sends branded emails via Gmail SMTP using credentials saved in the Admin
// Console (Module 05 → Notification Settings). If email notifications are
// disabled or not configured, sendEmail() just skips silently — it never
// throws, so a broken mail config can't break claim registration.

const nodemailer = require("nodemailer");

const BRAND_ORANGE = "#f7941d";
const BRAND_INK = "#313234";

function getTransporter(emailConfig) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: emailConfig.gmailUser,
      pass: emailConfig.gmailAppPassword
    }
  });
}

function wrapTemplate({ companyName, heading, bodyHtml, footerNote }) {
  return `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; background:#f4f4f5; padding:24px;">
    <div style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:10px; overflow:hidden; border:1px solid #e3e3e5;">
      <div style="background:${BRAND_INK}; padding:18px 24px;">
        <span style="color:#fff; font-weight:600; font-size:15px; letter-spacing:0.03em;">${companyName}</span>
      </div>
      <div style="padding:26px 24px;">
        <h2 style="color:${BRAND_INK}; font-size:19px; margin:0 0 14px;">${heading}</h2>
        ${bodyHtml}
      </div>
      <div style="background:#faf5ec; padding:14px 24px; font-size:12px; color:#8a8b8d;">
        ${footerNote}
      </div>
    </div>
  </div>`;
}

function detailRow(label, value) {
  if (!value) return "";
  return `<tr>
    <td style="padding:6px 0; color:#8a8b8d; font-size:13px; width:42%;">${label}</td>
    <td style="padding:6px 0; color:${BRAND_INK}; font-size:13px; font-weight:600;">${value}</td>
  </tr>`;
}

async function sendEmail(db, { to, subject, html }) {
  const cfg = db.admin.notifications && db.admin.notifications.email;
  if (!cfg || !cfg.enabled || !cfg.gmailUser || !cfg.gmailAppPassword) {
    return { sent: false, reason: "Email notifications are not configured/enabled." };
  }
  try {
    const transporter = getTransporter(cfg);
    await transporter.sendMail({
      from: `"${db.admin.companyName}" <${cfg.gmailUser}>`,
      to,
      subject,
      html
    });
    return { sent: true };
  } catch (err) {
    console.error("Email send failed:", err.message);
    return { sent: false, reason: err.message };
  }
}

// ---- Templates ----

function complaintRegisteredCustomerEmail(db, complaint) {
  const company = db.admin.companyName;
  const bodyHtml = `
    <p style="color:#4d4d4f; font-size:14px; line-height:1.5;">
      Hi ${complaint.contactName}, your warranty claim has been registered successfully.
      Our team will get in touch with you shortly.
    </p>
    <table style="width:100%; border-collapse:collapse; margin-top:10px;">
      ${detailRow("Claim ID", complaint.id)}
      ${detailRow("Branch / Site", complaint.branchName)}
      ${detailRow("Site Address", complaint.siteAddress)}
      ${detailRow("Fault Reported", complaint.faultType)}
      ${detailRow("Warranty ID", complaint.warrantySerial)}
      ${detailRow("Warranty Status", complaint.warrantyStatus)}
      ${detailRow("Current Status", complaint.status)}
    </table>
    <p style="color:#8a8b8d; font-size:12.5px; margin-top:18px;">
      Keep this Claim ID for future reference — you'll need it if you contact support.
    </p>`;
  return wrapTemplate({
    companyName: company,
    heading: "✅ Your Warranty Claim is Registered",
    bodyHtml,
    footerNote: `${company} Support · ${db.admin.supportEmail} · ${db.admin.supportPhone}`
  });
}

function complaintRegisteredAdminEmail(db, complaint) {
  const company = db.admin.companyName;
  const bodyHtml = `
    <p style="color:#4d4d4f; font-size:14px;">A new warranty claim has just been filed.</p>
    <table style="width:100%; border-collapse:collapse; margin-top:10px;">
      ${detailRow("Claim ID", complaint.id)}
      ${detailRow("Branch / Site", complaint.branchName)}
      ${detailRow("Site Address", complaint.siteAddress)}
      ${detailRow("Fault Reported", complaint.faultType)}
      ${detailRow("Warranty ID", complaint.warrantySerial)}
      ${detailRow("Warranty Status", complaint.warrantyStatus)}
      ${detailRow("Contact Name", complaint.contactName)}
      ${detailRow("WhatsApp Number", complaint.whatsappNumber)}
      ${detailRow("Email", complaint.email)}
      ${detailRow("Notes", complaint.notes)}
    </table>`;
  return wrapTemplate({
    companyName: company,
    heading: "📥 New Warranty Claim Filed",
    bodyHtml,
    footerNote: `Log in to the Admin Console to update this claim's status.`
  });
}

function statusUpdateCustomerEmail(db, complaint) {
  const company = db.admin.companyName;
  const statusColor =
    complaint.status === "Resolved" ? "#2e8b57" : complaint.status === "In Progress" ? "#2f7ec4" : BRAND_ORANGE;
  const bodyHtml = `
    <p style="color:#4d4d4f; font-size:14px; line-height:1.5;">
      Hi ${complaint.contactName}, there's an update on your warranty claim.
    </p>
    <div style="margin:14px 0; padding:12px 16px; background:#faf5ec; border-radius:8px;">
      <span style="color:#8a8b8d; font-size:12px; text-transform:uppercase;">New Status</span><br>
      <span style="color:${statusColor}; font-size:18px; font-weight:700;">${complaint.status}</span>
    </div>
    <table style="width:100%; border-collapse:collapse;">
      ${detailRow("Claim ID", complaint.id)}
      ${detailRow("Branch / Site", complaint.branchName)}
      ${detailRow("Fault Reported", complaint.faultType)}
    </table>`;
  return wrapTemplate({
    companyName: company,
    heading: "🔔 Your Claim Status Has Been Updated",
    bodyHtml,
    footerNote: `${company} Support · ${db.admin.supportEmail} · ${db.admin.supportPhone}`
  });
}

module.exports = {
  sendEmail,
  complaintRegisteredCustomerEmail,
  complaintRegisteredAdminEmail,
  statusUpdateCustomerEmail
};
