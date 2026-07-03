// db.js
// Lightweight JSON-file database. No native modules required, so it deploys
// cleanly on Render without any build issues. Good fit for this portal's
// scale (hundreds/thousands of warranty claims). If you outgrow this,
// swap this file for a real Postgres connection - the rest of the app
// only talks to the functions exported here, so nothing else changes.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

// The default admin password. Change this via the .env file (ADMIN_DEFAULT_PASSWORD)
// BEFORE first deploy, or change it from the Admin Console after logging in once.
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "linea@admin123";

function buildDefaultData() {
  return {
    complaints: [],
    warranties: [],
    admin: {
      passwordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10),
      companyName: "linea LED Signage Networks",
      supportEmail: "support@linealed.com",
      supportPhone: "+91 90000 00000",
      lastLogin: null,
      notifications: {
        whatsapp: {
          enabled: false,
          productId: "",
          phoneId: "",
          token: ""
        },
        email: {
          enabled: false,
          gmailUser: "",
          gmailAppPassword: ""
        }
      }
    },
    counters: {
      complaint: 0,
      warranty: 0
    }
  };
}

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(buildDefaultData(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  try {
    const data = JSON.parse(raw);
    // Migration: older database.json files (created before notifications existed)
    // won't have this block — backfill it so the rest of the app can rely on it.
    if (!data.admin.notifications) {
      data.admin.notifications = buildDefaultData().admin.notifications;
      writeDb(data);
    }
    return data;
  } catch (e) {
    console.error("Database file corrupted, resetting to default.", e);
    const fresh = buildDefaultData();
    fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(prefix) {
  const data = readDb();
  const key = prefix === "LC" ? "complaint" : "warranty";
  data.counters[key] += 1;
  const num = String(data.counters[key]).padStart(5, "0");
  writeDb(data);
  return `${prefix}-${num}`;
}

module.exports = { readDb, writeDb, nextId, ensureDb };
