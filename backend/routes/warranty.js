const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { readDb, writeDb, nextId } = require("../db");
const { requireAdmin } = require("./admin");

const router = express.Router();

// CSV file comes in as an upload, we only need it in memory (never saved to disk)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// This is the exact column set from the warranty registration CSV export.
// Keep this list in sync with the CSV headers your team exports — if the
// export format ever changes, update HEADER_MAP (left = CSV header text,
// right = internal field name) and nothing else needs to change.
// ---------------------------------------------------------------------------
const HEADER_MAP = {
  "warranty id": "warrantyId",
  "customer name": "customerName",
  "registration status": "registrationStatus",
  "total warranty": "totalWarranty",
  "warranty start date": "warrantyStartDate",
  "warranty end date": "warrantyEndDate",
  "registration date": "registrationDate",
  "sku id": "skuId",
  "sku name": "skuName",
  "brand": "brand",
  "email": "email",
  "project name": "projectName",
  "converter name": "converterName",
  "contact person number": "contactPersonNumber",
  "contact person name": "contactPersonName",
  "site address": "siteAddress",
  "city name": "cityName",
  "pin code": "pinCode",
  "product name": "productName",
  "product type": "productType"
};
const FIELD_ORDER = Object.values(HEADER_MAP);

function blankRecord() {
  const r = {};
  FIELD_ORDER.forEach((f) => (r[f] = ""));
  return r;
}

// GET /api/warranty - list all warranty records, optional ?q=
router.get("/", (req, res) => {
  const { q } = req.query;
  const db = readDb();
  let results = db.warranties;
  if (q) {
    const query = q.toLowerCase();
    results = results.filter(
      (w) =>
        (w.warrantyId || "").toLowerCase().includes(query) ||
        (w.customerName || "").toLowerCase().includes(query) ||
        (w.cityName || "").toLowerCase().includes(query) ||
        (w.skuId || "").toLowerCase().includes(query) ||
        (w.contactPersonName || "").toLowerCase().includes(query)
    );
  }
  res.json({ warranties: results, total: db.warranties.length });
});

// POST /api/warranty - add a single warranty record manually (admin only)
router.post("/", requireAdmin, (req, res) => {
  const body = req.body || {};
  if (!body.customerName) {
    return res.status(400).json({ error: "customerName is required." });
  }

  const record = blankRecord();
  FIELD_ORDER.forEach((f) => {
    if (body[f] !== undefined) record[f] = String(body[f]).trim();
  });
  record.warrantyId = record.warrantyId || nextId("WR");
  record.createdAt = new Date().toISOString();

  const db = readDb();
  if (db.warranties.some((w) => w.warrantyId === record.warrantyId)) {
    return res.status(409).json({ error: `Warranty ID ${record.warrantyId} already exists.` });
  }
  db.warranties.unshift(record);
  writeDb(db);

  res.status(201).json({ message: "Warranty record added.", record });
});

// PUT /api/warranty/:warrantyId - edit a warranty record (admin only)
router.put("/:warrantyId", requireAdmin, (req, res) => {
  const db = readDb();
  const record = db.warranties.find((w) => w.warrantyId === req.params.warrantyId);
  if (!record) return res.status(404).json({ error: "Warranty record not found." });

  FIELD_ORDER.forEach((f) => {
    if (req.body[f] !== undefined) record[f] = String(req.body[f]).trim();
  });
  record.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json({ message: "Warranty record updated.", record });
});

// DELETE /api/warranty/:warrantyId - remove a warranty record (admin only)
router.delete("/:warrantyId", requireAdmin, (req, res) => {
  const db = readDb();
  const before = db.warranties.length;
  db.warranties = db.warranties.filter((w) => w.warrantyId !== req.params.warrantyId);
  if (db.warranties.length === before) {
    return res.status(404).json({ error: "Warranty record not found." });
  }
  writeDb(db);
  res.json({ message: "Warranty record deleted." });
});

// POST /api/warranty/import - bulk upload from the exported CSV file (admin only)
// Field name in the multipart form must be "file".
router.post("/import", requireAdmin, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file was uploaded." });

  let rows;
  try {
    // CSV exports from Excel are often saved as Windows-1252, not UTF-8 —
    // if the file doesn't look like valid UTF-8, fall back automatically.
    let text = req.file.buffer.toString("utf8");
    if (text.includes("\uFFFD")) {
      text = req.file.buffer.toString("latin1");
    }
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true
    });
  } catch (e) {
    return res.status(400).json({ error: "Could not read this file as CSV: " + e.message });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: "The CSV file has no data rows." });
  }

  // Validate that at least the important headers are present
  const incomingHeaders = Object.keys(rows[0]).map((h) => h.trim().toLowerCase());
  const missingRequired = ["warranty id", "customer name"].filter(
    (h) => !incomingHeaders.includes(h)
  );
  if (missingRequired.length > 0) {
    return res.status(400).json({
      error: `CSV is missing required column(s): ${missingRequired.join(", ")}. Expected the same columns as the warranty export (Warranty ID, Customer Name, Registration Status, Total Warranty, Warranty Start Date, Warranty End Date, Registration Date, SKU ID, SKU Name, Brand, Email, Project Name, Converter Name, Contact Person Number, Contact Person Name, Site Address, City Name, Pin Code, Product Name, Product Type).`
    });
  }

  const db = readDb();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  rows.forEach((row, idx) => {
    // Map each CSV header (case-insensitively) to our internal field names
    const mapped = blankRecord();
    Object.entries(row).forEach(([csvHeader, value]) => {
      const key = HEADER_MAP[csvHeader.trim().toLowerCase()];
      if (key) mapped[key] = (value || "").toString().trim();
    });

    if (!mapped.customerName) {
      skipped++;
      errors.push(`Row ${idx + 2}: missing Customer Name, skipped.`);
      return;
    }
    if (!mapped.warrantyId) {
      mapped.warrantyId = nextId("WR");
    }

    const existingIndex = db.warranties.findIndex((w) => w.warrantyId === mapped.warrantyId);
    if (existingIndex >= 0) {
      db.warranties[existingIndex] = {
        ...db.warranties[existingIndex],
        ...mapped,
        updatedAt: new Date().toISOString()
      };
      updated++;
    } else {
      mapped.createdAt = new Date().toISOString();
      db.warranties.unshift(mapped);
      imported++;
    }
  });

  writeDb(db);

  res.json({
    message: `Import complete: ${imported} added, ${updated} updated, ${skipped} skipped.`,
    imported,
    updated,
    skipped,
    errors: errors.slice(0, 20), // cap the error list so the response stays small
    totalRows: rows.length
  });
});

module.exports = router;
