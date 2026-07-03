# linea LED — Warranty Claim Hub

A full warranty-claim portal for linea LED Signage Networks:

1. **QR Generator** — create a QR code per branch that opens a pre-filled claim form
2. **Register Complaint** — field form with photos, GPS capture and fault diagnosis
3. **Live Dashboard** — real-time stats + claim list, status updates (admin)
4. **Warranty Database** — master list of installations and warranty windows (admin)
5. **Admin Console** — password-protected settings and claim management

```
linea-led-portal/
├── backend/     → deploy to Render (API + JSON database + photo storage)
└── frontend/    → deploy to GitHub Pages (the site people actually visit)
```

The two run separately: GitHub Pages only serves static files, so all the
"database" logic lives in `backend/`, deployed on Render, and the frontend
talks to it over the internet.

---

## Part 1 — Deploy the backend on Render

1. Push the **whole `linea-led-portal` folder** to a new GitHub repository
   (e.g. `linea-led-claim-portal`).
2. Go to [render.com](https://render.com) → **New +** → **Web Service** →
   connect that GitHub repo.
3. When Render asks for settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free is fine to start
4. Under **Environment**, add these variables (see `backend/.env.example`):
   | Key | Value |
   |---|---|
   | `JWT_SECRET` | any long random string |
   | `ADMIN_DEFAULT_PASSWORD` | the admin password you want on first launch |
   | `ALLOWED_ORIGIN` | your GitHub Pages URL, e.g. `https://yourusername.github.io` |
5. Click **Create Web Service**. Render will build and give you a live URL like:
   `https://linea-led-backend.onrender.com`
6. **Important — persistent storage:** on Render's free tier, the file
   system resets on every redeploy, which means claims/photos would be
   lost. Before going live for real, add a **Render Disk** (Dashboard →
   your service → **Disks** → Add Disk, mount path `/opt/render/project/src/backend/data`
   and another for `/opt/render/project/src/backend/uploads`) — this is a
   couple of dollars a month and makes storage permanent. Skip this while
   you're just testing.

Test it worked by opening `https://your-app-name.onrender.com/api/health`
in a browser — you should see `{"status":"ok"}`.

---

## Part 2 — Connect the frontend to your backend

1. Open `frontend/js/config.js`.
2. Replace the placeholder with your real Render URL:
   ```js
   const API_BASE_URL = "https://linea-led-backend.onrender.com";
   ```
3. Save and commit this change.

---

## Part 3 — Deploy the frontend on GitHub Pages

1. In the same (or a separate) GitHub repo, go to **Settings → Pages**.
2. Under **Source**, choose the branch (e.g. `main`) and set the folder to
   `/frontend` (or move the contents of `frontend/` to the repo root /
   `docs` folder — whichever your GitHub Pages setup expects).
3. Save. GitHub will give you a URL like:
   `https://yourusername.github.io/linea-led-claim-portal/`
4. Open it — you should see the linea LED Warranty Claim Hub.

---

## First login

- Default admin password: whatever you set as `ADMIN_DEFAULT_PASSWORD` on
  Render (falls back to `linea@admin123` if you didn't set one).
- Go to **Module 05 → Admin Console**, log in, then immediately use
  **Change Admin Password** to set your own.

## Warranty CSV upload

Go to **Module 04 → Warranty Database → Upload Warranty CSV**. Upload the
exact export file with these columns (any order, matched by header name,
case-insensitive):

`Warranty ID, Customer Name, Registration Status, Total Warranty, Warranty Start Date, Warranty End Date, Registration Date, SKU ID, SKU Name, Brand, Email, Project Name, Converter Name, Contact Person Number, Contact Person Name, Site Address, City Name, Pin Code, Product Name, Product Type`

Re-uploading the same file (or an updated one) is safe — rows are matched
by **Warranty ID**: existing IDs get updated, new IDs get added, nothing
is duplicated.

## Automatic warranty matching (the "green row")

When someone registers a complaint, they can enter the **Warranty ID**
from their registration. The system automatically looks it up in the
Warranty Database and checks whether today's date falls inside the
Warranty Start/End Date range:

- **In Warranty** → the row is highlighted green on the Live Dashboard
- **Out of Warranty** → today is past the end date
- **Not Found** → that Warranty ID isn't in the database
- **Unknown Dates** → the ID matched, but the dates in that row couldn't
  be parsed (rare — only if the CSV has an unusual date format)

## WhatsApp & Email notifications

Go to **Module 05 → Admin Console → Notification Settings**.

**WhatsApp (via [Maytapi](https://maytapi.com)):**
1. Enter your **Product ID Key**, **Phone Configuration ID**, and
   **Token Secure ID** (the same three values shown on your Maytapi
   dashboard).
2. Tick **Enable WhatsApp notifications** and save.
3. Use **Send Test Message** to confirm it works before relying on it.

**Email (via Gmail SMTP):**
1. Enter the Gmail address you want to send from.
2. Generate a **Gmail App Password** (not your normal password): go to
   [myaccount.google.com](https://myaccount.google.com) → Security →
   2-Step Verification (must be turned on) → App Passwords → create one
   for "Mail". Paste that 16-character password in.
3. Tick **Enable email notifications** and save.

Once both are enabled:
- **On new claim:** the customer gets a WhatsApp + email confirmation
  (with Claim ID and warranty status), and your Support Email gets an
  internal notification email.
- **On status change:** whenever you update a claim's status in the
  dashboard, the customer automatically gets a WhatsApp + email update.

Notifications are always "best effort" — if WhatsApp/email isn't
configured yet, or a send fails, claim registration and status updates
still work normally; they just won't notify anyone until you set it up.

## Notes

- Photos are capped at 5MB each, 3 photos per claim.
- The QR codes encode a link back to your GitHub Pages site with the
  branch name/code pre-filled — so print one QR per branch and stick it
  on-site.
- All data (claims + warranty records) lives in `backend/data/database.json`
  on the Render server — that's your "database" for this portal.
- To reset the admin password if you get locked out: delete
  `backend/data/database.json` on the server (via Render Shell) — this
  also wipes all claims and warranty records, so only do it as a last
  resort.
