const express = require("express");
const { readDb, writeDb, nextId } = require("../db");
const { requireAdmin } = require("./admin");

const router = express.Router();

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + Number(months));
  return d.toISOString().slice(0, 10);
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
        w.id.toLowerCase().includes(query) ||
        w.customerName.toLowerCase().includes(query) ||
        w.branchCode.toLowerCase().includes(query)
    );
  }
  res.json({ warranties: results });
});

// POST /api/warranty - add a new warranty record (admin only)
router.post("/", requireAdmin, (req, res) => {
  const {
    customerName,
    branchCode,
    productModel,
    installationDate,
    warrantyMonths,
    contactNumber,
    address
  } = req.body;

  if (!customerName || !branchCode || !productModel || !installationDate || !warrantyMonths) {
    return res.status(400).json({
      error:
        "customerName, branchCode, productModel, installationDate and warrantyMonths are required."
    });
  }

  const record = {
    id: nextId("WR"),
    customerName,
    branchCode,
    productModel,
    installationDate,
    warrantyMonths: Number(warrantyMonths),
    expiryDate: addMonths(installationDate, warrantyMonths),
    contactNumber: contactNumber || "",
    address: address || "",
    createdAt: new Date().toISOString()
  };

  const db = readDb();
  db.warranties.unshift(record);
  writeDb(db);

  res.status(201).json({ message: "Warranty record added.", record });
});

// PUT /api/warranty/:id - edit a warranty record (admin only)
router.put("/:id", requireAdmin, (req, res) => {
  const db = readDb();
  const record = db.warranties.find((w) => w.id === req.params.id);
  if (!record) return res.status(404).json({ error: "Warranty record not found." });

  const fields = [
    "customerName",
    "branchCode",
    "productModel",
    "installationDate",
    "warrantyMonths",
    "contactNumber",
    "address"
  ];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) record[f] = req.body[f];
  });
  if (req.body.installationDate || req.body.warrantyMonths) {
    record.expiryDate = addMonths(record.installationDate, record.warrantyMonths);
  }

  writeDb(db);
  res.json({ message: "Warranty record updated.", record });
});

// DELETE /api/warranty/:id - remove a warranty record (admin only)
router.delete("/:id", requireAdmin, (req, res) => {
  const db = readDb();
  const before = db.warranties.length;
  db.warranties = db.warranties.filter((w) => w.id !== req.params.id);
  if (db.warranties.length === before) {
    return res.status(404).json({ error: "Warranty record not found." });
  }
  writeDb(db);
  res.json({ message: "Warranty record deleted." });
});

module.exports = router;
