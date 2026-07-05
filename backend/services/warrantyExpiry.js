// warrantyExpiry.js
// Checks the warranty database for records whose warranty is about to
// expire, and sends a one-time reminder — to the customer (if they have an
// email on file) and a digest to the admin's Support Email. Each record is
// only ever reminded once (tracked via `expiryReminderSent`), so re-running
// this on a schedule never spams anyone twice for the same warranty.

const { readDb, writeDb } = require("../db");
const { parseFlexibleDate } = require("./warrantyMatch");
const mailer = require("./mailer");

const REMINDER_WINDOW_DAYS = 15;

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

async function checkExpiringWarranties() {
  const db = await readDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dueForReminder = [];

  db.warranties.forEach((w) => {
    if (w.expiryReminderSent) return;
    const end = parseFlexibleDate(w.warrantyEndDate);
    if (!end) return;
    const daysLeft = daysBetween(today, end);
    if (daysLeft >= 0 && daysLeft <= REMINDER_WINDOW_DAYS) {
      dueForReminder.push({ warranty: w, daysLeft });
    }
  });

  if (dueForReminder.length === 0) {
    return { checked: db.warranties.length, remindersSent: 0 };
  }

  // Email the customer for each expiring warranty (best effort)
  for (const { warranty, daysLeft } of dueForReminder) {
    if (warranty.email) {
      await mailer.sendEmail(db, {
        to: warranty.email,
        subject: `Your ${db.admin.companyName} warranty expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        html: mailer.warrantyExpiringEmail(db, warranty, daysLeft)
      });
    }
    warranty.expiryReminderSent = true;
  }

  // One digest email to the admin listing everything expiring soon
  if (db.admin.supportEmail) {
    await mailer.sendEmail(db, {
      to: db.admin.supportEmail,
      subject: `${dueForReminder.length} warranty record(s) expiring within ${REMINDER_WINDOW_DAYS} days`,
      html: mailer.warrantyExpiringAdminDigestEmail(db, dueForReminder)
    });
  }

  await writeDb(db);
  return { checked: db.warranties.length, remindersSent: dueForReminder.length };
}

module.exports = { checkExpiringWarranties, REMINDER_WINDOW_DAYS };
