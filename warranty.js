require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { ensureDb } = require("./db");

const { router: adminRouter } = require("./routes/admin");
const complaintsRouter = require("./routes/complaints");
const warrantyRouter = require("./routes/warranty");

ensureDb();

const app = express();
const PORT = process.env.PORT || 4000;

// Allow your GitHub Pages frontend (and localhost for testing) to call this API.
// Set ALLOWED_ORIGIN in Render's environment variables to your GitHub Pages URL,
// e.g. https://yourusername.github.io
const allowedOrigins = (process.env.ALLOWED_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "linea LED Warranty Claim Hub API" });
});
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/admin", adminRouter);
app.use("/api/complaints", complaintsRouter);
app.use("/api/warranty", warrantyRouter);

// Fallback error handler (e.g. multer file-too-large, bad CORS, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`linea LED Claim Portal API running on port ${PORT}`);
});
