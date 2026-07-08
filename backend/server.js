require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { getCollection } = require("./db");
const { checkExpiringWarranties } = require("./services/warrantyExpiry");

const { router: adminRouter } = require("./routes/admin");
const complaintsRouter = require("./routes/complaints");
const warrantyRouter = require("./routes/warranty");
const customerRouter = require("./routes/customer");

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
app.use("/api/customer", customerRouter);

// Fallback error handler (e.g. multer file-too-large, bad CORS, etc.)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
});

// Connect to MongoDB Atlas BEFORE accepting any requests — this way, if
// MONGODB_URI is missing or wrong, the server fails immediately with a
// clear error in the Render logs instead of accepting requests that would
// all fail mysteriously later.
getCollection()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`linea LED Claim Portal API running on port ${PORT}`);
      console.log("Connected to MongoDB — data will persist across deploys.");
    });

    // Check for expiring warranties on startup, then once every 24 hours.
    // NOTE: Render's free tier spins the service down after inactivity, so
    // this only runs reliably while the app is awake. For guaranteed daily
    // runs regardless of traffic, ping /api/health periodically with a free
    // service like cron-job.org, or use Render's paid Cron Jobs feature.
    checkExpiringWarranties()
      .then((r) => console.log(`Warranty expiry check: ${r.remindersSent} reminder(s) sent (${r.checked} records checked).`))
      .catch((err) => console.error("Warranty expiry check failed:", err.message));
    setInterval(() => {
      checkExpiringWarranties().catch((err) => console.error("Warranty expiry check failed:", err.message));
    }, 24 * 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error("FATAL: could not connect to MongoDB.", err.message);
    console.error("Check that MONGODB_URI is set correctly in Render → Environment.");
    process.exit(1);
  });
