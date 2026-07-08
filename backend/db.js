// db.js
// Stores all portal data (complaints, warranty records, admin settings) in
// MongoDB Atlas — a real cloud database, not a file on Render's disk.
//
// WHY THIS CHANGE: Render's free web services have an EPHEMERAL filesystem.
// Every redeploy (and sometimes every restart) wipes any files the app
// wrote to disk — which is exactly why the admin password, warranty CSV
// uploads, and complaints kept disappearing. A cloud database survives
// all of that, because it lives outside Render entirely.
//
// To keep the rest of the app (routes/*.js) almost unchanged, everything is
// still stored as ONE document shaped exactly like the old JSON file
// (complaints, warranties, admin, counters). That's not "proper" MongoDB
// schema design, but it's the simplest, lowest-risk way to move off the
// disk — and comfortably handles thousands of records. If this ever needs
// to scale further, split each key into its own collection.

const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || "linea_led_portal";
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "linea@admin123";

let client = null;
let collectionPromise = null;

function buildDefaultData() {
  return {
    _id: "main",
    complaints: [],
    warranties: [],
    admin: {
      passwordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10),
      companyName: "linea LED Signage Networks",
      supportEmail: "support@linealed.com",
      supportPhone: "+91 90000 00000",
      lastLogin: null,
      notifications: {
        whatsapp: { enabled: false, productId: "", phoneId: "", token: "", adminNumber: "" },
        email: { enabled: false, resendApiKey: "", fromEmail: "" }
      },
      photoStorage: { cloudName: "", uploadPreset: "" }
    },
    counters: { complaint: 0, warranty: 0 }
  };
}

// Connects once and reuses the same connection for the lifetime of the
// server (this is the recommended MongoDB driver pattern — don't reconnect
// per-request). Also runs one-time migrations for older documents.
async function getCollection() {
  if (collectionPromise) return collectionPromise;

  collectionPromise = (async () => {
    if (!MONGODB_URI) {
      throw new Error(
        "MONGODB_URI environment variable is not set. Add your MongoDB Atlas connection string in Render → Environment. See README.md for setup steps."
      );
    }
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    const collection = client.db(DB_NAME).collection("app_data");

    const existing = await collection.findOne({ _id: "main" });
    if (!existing) {
      await collection.insertOne(buildDefaultData());
    } else {
      // Backfill fields added in later versions of the app so upgrading
      // never loses existing data.
      let changed = false;
      if (!existing.admin.notifications) {
        existing.admin.notifications = buildDefaultData().admin.notifications;
        changed = true;
      } else {
        if (existing.admin.notifications.whatsapp.adminNumber === undefined) {
          existing.admin.notifications.whatsapp.adminNumber = "";
          changed = true;
        }
        if (existing.admin.notifications.email.resendApiKey === undefined) {
          existing.admin.notifications.email = { enabled: false, resendApiKey: "", fromEmail: "" };
          changed = true;
        }
      }
      if (!existing.admin.photoStorage) {
        existing.admin.photoStorage = { cloudName: "", uploadPreset: "" };
        changed = true;
      }
      if (changed) {
        await collection.replaceOne({ _id: "main" }, existing);
      }
    }
    return collection;
  })();

  return collectionPromise;
}

async function readDb() {
  const collection = await getCollection();
  return collection.findOne({ _id: "main" });
}

async function writeDb(data) {
  const collection = await getCollection();
  await collection.replaceOne({ _id: "main" }, data, { upsert: true });
}

async function nextId(prefix) {
  const data = await readDb();
  const key = prefix === "LC" ? "complaint" : "warranty";
  data.counters[key] += 1;
  const num = String(data.counters[key]).padStart(5, "0");
  await writeDb(data);
  return `${prefix}-${num}`;
}

module.exports = { readDb, writeDb, nextId, getCollection };
