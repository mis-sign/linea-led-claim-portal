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
    // Using explicit host/port 587 (STARTTLS) instead of the "service: gmail"
    // shortcut (which defaults to port 465) — 587 is more reliably allowed
    // through cloud-host firewalls like Render's.
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: (emailConfig.gmailUser || "").trim(),
      // Google displays App Passwords with spaces ("abcd efgh ijkl mnop") for
      // readability — if pasted as-is, SMTP auth fails. Strip them here so
      // copy-pasting straight from Google's page always works.
      pass: (emailConfig.gmailAppPassword || "").replace(/\s+/g, "")
    },
    // Without these, a blocked/slow connection hangs forever instead of
    // failing — which is exactly what was leaving the "Sending..." button
    // stuck and silently dropping notifications. Now it fails within ~15s
    // with a clear error instead.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
  });
}

function wrapTemplate({ companyName, headerIcon, heading, subheading, bodyHtml, footerNote }) {
  return `
  <div style="font-family:'Segoe UI', Arial, sans-serif; background:#eef0f2; padding:28px 16px;">
    <div style="max-width:540px; margin:0 auto; background:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 8px 30px rgba(49,50,52,0.12);">
      <div style="background:linear-gradient(135deg,#3d3e40 0%,#26272a 100%); padding:22px 26px; position:relative;">
        <div style="font-family:'Trebuchet MS', sans-serif; font-weight:700; font-size:15px; color:#ffffff; letter-spacing:0.04em; text-transform:uppercase;">${companyName}</div>
        <div style="height:3px; background:linear-gradient(90deg,#ffb454,#f7941d,#d9770a); border-radius:2px; margin-top:12px; width:56px;"></div>
      </div>
      <div style="padding:8px 26px 4px;">
        <div style="text-align:center; margin:22px 0 6px;">
          <span style="display:inline-block; width:52px; height:52px; line-height:52px; border-radius:50%; background:#fdecd4; font-size:24px;">${headerIcon}</span>
        </div>
        <h2 style="text-align:center; color:#313234; font-size:19px; margin:6px 0 4px;">${heading}</h2>
        ${subheading ? `<p style="text-align:center; color:#8a8b8d; font-size:13px; margin:0 0 18px;">${subheading}</p>` : '<div style="margin-bottom:10px;"></div>'}
        ${bodyHtml}
      </div>
      <div style="background:#faf5ec; padding:16px 26px; font-size:12px; color:#8a8b8d; margin-top:20px; text-align:center;">
        ${footerNote}
      </div>
    </div>
    <p style="text-align:center; color:#b3b4b6; font-size:11px; margin-top:14px;">Sent automatically by the ${companyName} Warranty Claim Hub</p>
  </div>`;
}

// Small emoji glyph per field so the detail card reads like a scan sheet rather than a table
const FIELD_ICON = {
  "Claim ID": "🆔", "Branch / Site": "🏢", "Site Address": "📍", "Fault Reported": "⚡",
  "Warranty ID": "🛡️", "Warranty Status": "🛡️", "Current Status": "📌", "Contact Name": "👤",
  "WhatsApp Number": "📱", "Email": "✉️", "Notes": "📝"
};

function detailRow(label, value) {
  if (!value) return "";
  const icon = FIELD_ICON[label] || "•";
  return `<div style="display:flex; align-items:flex-start; gap:10px; padding:9px 0; border-bottom:1px solid #f0f0f1;">
    <span style="font-size:14px; width:20px; flex-shrink:0;">${icon}</span>
    <span style="color:#8a8b8d; font-size:12px; width:120px; flex-shrink:0; padding-top:1px;">${label}</span>
    <span style="color:#313234; font-size:13.5px; font-weight:600; flex:1;">${value}</span>
  </div>`;
}

function statusPill(text, color, bg) {
  return `<div style="text-align:center; margin:6px 0 18px;">
    <span style="display:inline-block; padding:7px 18px; border-radius:20px; background:${bg}; color:${color}; font-size:13px; font-weight:700; letter-spacing:0.02em;">${text}</span>
  </div>`;
}

// Row of colored highlight boxes (e.g. Claim ID + Warranty Status side by side)
function statBoxRow(boxes) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate; border-spacing:8px 0; margin:16px 0;"><tr>
    ${boxes
      .map(
        (b) => `<td style="background:${b.bg}; border-radius:12px; padding:14px 10px; text-align:center; width:${100 / boxes.length}%;">
          <div style="font-size:10px; color:${b.color}; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; opacity:0.85;">${b.label}</div>
          <div style="font-size:16px; color:${b.color}; font-weight:800; margin-top:5px; word-break:break-word;">${b.value}</div>
        </td>`
      )
      .join("")}
  </tr></table>`;
}

// Clean detail table with a dark colored header row, matching the "Order List"
// style reference — much easier to scan than plain label/value rows.
function detailTable(rows) {
  const filtered = rows.filter((r) => r[1]);
  if (filtered.length === 0) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; border-radius:10px; overflow:hidden; margin-top:4px;">
    <tr style="background:linear-gradient(135deg,#303134,#1a1b1d);">
      <th style="text-align:left; padding:10px 14px; color:#ffffff; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; width:38%;">Field</th>
      <th style="text-align:left; padding:10px 14px; color:#ffffff; font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">Detail</th>
    </tr>
    ${filtered
      .map(
        (r, i) => `<tr style="background:${i % 2 === 0 ? "#fbfbfc" : "#ffffff"};">
          <td style="padding:10px 14px; color:#83848a; font-size:12.5px; border-bottom:1px solid #eef0f1;">${r[0]}</td>
          <td style="padding:10px 14px; color:#232426; font-size:13px; font-weight:600; border-bottom:1px solid #eef0f1;">${r[1]}</td>
        </tr>`
      )
      .join("")}
  </table>`;
}

function warrantyPillColors(status) {
  if (status === "In Warranty") return { color: "#2e8b57", bg: "#e3f3ea" };
  if (status === "Out of Warranty") return { color: "#d64545", bg: "#fbe6e6" };
  return { color: "#8a8b8d", bg: "#eee" };
}

function statusColorFor(status) {
  if (status === "Resolved") return { color: "#2e8b57", bg: "#e3f3ea" };
  if (status === "In Progress") return { color: "#2f7ec4", bg: "#e2eefb" };
  return { color: "#d9770a", bg: "#fdecd4" };
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
    console.error("Email send failed:", err.code || "", err.message);
    let reason = err.message;
    if (err.code === "EAUTH") {
      reason =
        "Gmail rejected the login. Double-check the Gmail address and that you're using a 16-character App Password (not your normal Gmail password) — it requires 2-Step Verification to be turned on first.";
    } else if (["ETIMEDOUT", "ESOCKET", "ECONNECTION"].includes(err.code)) {
      reason =
        "Couldn't reach Gmail's mail server (connection timed out). This is usually the hosting provider blocking outbound mail — try again, or contact Render support if it keeps happening.";
    }
    return { sent: false, reason };
  }
}

// ---- Templates ----

function complaintRegisteredCustomerEmail(db, complaint) {
  const company = db.admin.companyName;
  const wPill = warrantyPillColors(complaint.warrantyStatus);
  const bodyHtml = `
    <p style="text-align:center; color:#4d4d4f; font-size:14px; line-height:1.5; margin:0 0 6px;">
      Hi <strong>${complaint.contactName}</strong>, your warranty claim has been registered successfully.
      Our team will get in touch with you shortly.
    </p>
    ${statBoxRow([
      { label: "Claim ID", value: complaint.id, color: "#1d6fb8", bg: "#d8e9fa" },
      { label: "Warranty Status", value: complaint.warrantyStatus, color: wPill.color, bg: wPill.bg }
    ])}
    ${detailTable([
      ["Branch / Site", complaint.branchName],
      ["Site Address", complaint.siteAddress],
      ["Fault Reported", complaint.faultType],
      ["Warranty ID", complaint.warrantySerial],
      ["Current Status", complaint.status]
    ])}
    <p style="color:#b3b4b6; font-size:11.5px; margin-top:16px; text-align:center;">
      Keep this Claim ID for future reference — you'll need it if you contact support.
    </p>`;
  return wrapTemplate({
    companyName: company,
    headerIcon: "✅",
    heading: "Your Warranty Claim is Registered",
    subheading: "We've logged your fault report and started tracking it.",
    bodyHtml,
    footerNote: `${company} Support · ${db.admin.supportEmail} · ${db.admin.supportPhone}`
  });
}

function complaintRegisteredAdminEmail(db, complaint) {
  const company = db.admin.companyName;
  const wPill = warrantyPillColors(complaint.warrantyStatus);
  const bodyHtml = `
    <p style="text-align:center; color:#4d4d4f; font-size:14px; margin:0 0 6px;">A new warranty claim has just been filed.</p>
    ${statBoxRow([
      { label: "Claim ID", value: complaint.id, color: "#1d6fb8", bg: "#d8e9fa" },
      { label: "Warranty Status", value: complaint.warrantyStatus, color: wPill.color, bg: wPill.bg }
    ])}
    ${detailTable([
      ["Branch / Site", complaint.branchName],
      ["Site Address", complaint.siteAddress],
      ["Fault Reported", complaint.faultType],
      ["Warranty ID", complaint.warrantySerial],
      ["Contact Name", complaint.contactName],
      ["WhatsApp Number", complaint.whatsappNumber],
      ["Email", complaint.email],
      ["Notes", complaint.notes]
    ])}`;
  return wrapTemplate({
    companyName: company,
    headerIcon: "📥",
    heading: "New Warranty Claim Filed",
    subheading: "Log in to the Admin Console to update this claim's status.",
    bodyHtml,
    footerNote: `Internal notification · Admin Console → Live Dashboard`
  });
}

function statusUpdateCustomerEmail(db, complaint) {
  const company = db.admin.companyName;
  const sPill = statusColorFor(complaint.status);
  const bodyHtml = `
    <p style="text-align:center; color:#4d4d4f; font-size:14px; line-height:1.5; margin:0 0 6px;">
      Hi <strong>${complaint.contactName}</strong>, there's an update on your warranty claim.
    </p>
    ${statBoxRow([
      { label: "Claim ID", value: complaint.id, color: "#1d6fb8", bg: "#d8e9fa" },
      { label: "New Status", value: complaint.status, color: sPill.color, bg: sPill.bg }
    ])}
    ${detailTable([
      ["Branch / Site", complaint.branchName],
      ["Fault Reported", complaint.faultType]
    ])}`;
  return wrapTemplate({
    companyName: company,
    headerIcon: "🔔",
    heading: "Your Claim Status Has Been Updated",
    subheading: null,
    bodyHtml,
    footerNote: `${company} Support · ${db.admin.supportEmail} · ${db.admin.supportPhone}`
  });
}

function testEmailTemplate(db) {
  const bodyHtml = `
    <p style="text-align:center; color:#4d4d4f; font-size:14px; line-height:1.5;">
      This is a test email from your ${db.admin.companyName} Warranty Claim Hub.
      If you're reading this, your Gmail SMTP integration is working correctly! 🎉
    </p>`;
  return wrapTemplate({
    companyName: db.admin.companyName,
    headerIcon: "✅",
    heading: "Test Email Successful",
    subheading: null,
    bodyHtml,
    footerNote: `Sent from the Admin Console · Notification Settings`
  });
}

module.exports = {
  sendEmail,
  complaintRegisteredCustomerEmail,
  complaintRegisteredAdminEmail,
  statusUpdateCustomerEmail,
  testEmailTemplate
};
