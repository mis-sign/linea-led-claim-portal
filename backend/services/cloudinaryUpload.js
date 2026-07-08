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

  const mimeGuess = originalName && originalName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

  // Standard multipart/form-data upload (not base64-in-a-URL-encoded-string,
  // which gets unwieldy for larger photos and is not how Cloudinary's docs
  // recommend uploading). fetch sets the correct multipart boundary
  // automatically when given a FormData body.
  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeGuess }), originalName || "photo.jpg");
  form.append("upload_preset", cfg.uploadPreset);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      console.error("Cloudinary upload failed:", JSON.stringify(data));
      let reason = (data.error && data.error.message) || `Cloudinary rejected the upload (HTTP ${res.status}).`;
      if (/preset not found/i.test(reason)) {
        reason = `Upload preset "${cfg.uploadPreset}" wasn't found — double-check the name (Settings → Upload → Upload presets on cloudinary.com) and that it exists on this exact Cloud Name.`;
      } else if (/signing mode|must be unsigned|unsigned/i.test(reason)) {
        reason = `This upload preset isn't set to "Unsigned" — open it on cloudinary.com (Settings → Upload → Upload presets) and set Signing Mode to Unsigned.`;
      } else if (/cloud[_ ]?name/i.test(reason) || res.status === 404) {
        reason = `Cloud Name "${cfg.cloudName}" looks incorrect — copy it exactly from your Cloudinary dashboard (top of the page, not the account/organization name).`;
      }
      return { uploaded: false, reason };
    }
    return { uploaded: true, url: data.secure_url };
  } catch (err) {
    console.error("Cloudinary upload error:", err.message);
    const reason =
      err.name === "TimeoutError" || err.name === "AbortError"
        ? "Couldn't reach Cloudinary (connection timed out after 20s)."
        : err.message;
    return { uploaded: false, reason };
  }
}

module.exports = { uploadPhoto };
