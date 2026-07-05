// cloudinaryUpload.js
// Uploads photos to Cloudinary (https://cloudinary.com) instead of saving
// them to Render's local disk. This is the actual fix for photos
// "disappearing" — Render's free web services have an ephemeral
// filesystem, so anything written to /uploads gets wiped on every restart
// or redeploy. Cloudinary is a real cloud file store, so the URL it gives
// back keeps working forever.
//
// Uses an UNSIGNED upload preset (configured in the Admin Console — just a
// Cloud Name + Upload Preset name, both created free on cloudinary.com) so
// the server never needs to hold a Cloudinary API secret.

async function uploadPhoto(db, fileBuffer, originalName) {
  const cfg = db.admin.photoStorage;
  if (!cfg || !cfg.cloudName || !cfg.uploadPreset) {
    return { uploaded: false, reason: "not_configured" };
  }

  const base64 = fileBuffer.toString("base64");
  const mimeGuess = originalName && originalName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUri = `data:${mimeGuess};base64,${base64}`;

  const form = new URLSearchParams();
  form.set("file", dataUri);
  form.set("upload_preset", cfg.uploadPreset);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      console.error("Cloudinary upload failed:", data);
      return { uploaded: false, reason: (data.error && data.error.message) || "Cloudinary rejected the upload." };
    }
    return { uploaded: true, url: data.secure_url };
  } catch (err) {
    console.error("Cloudinary upload error:", err.message);
    return { uploaded: false, reason: err.message };
  }
}

module.exports = { uploadPhoto };
