# Wego ADM Tracker — Live Web App

A Node.js + Express app, ready to deploy to **Render.com** (free tier) or any Node host. Result: a public URL like `https://wego-adm-tracker.onrender.com` your team can sign up on.

Has signup with email/password, admin email approval (you receive an email — click Approve or Reject), and the full ADM Tracker UI with the animated Wegomon mascot.

---

## Deploy on Render — 5 minutes, free, no credit card

### 1. Get the code into a GitHub repo (~2 min)
1. Sign up at https://github.com (free) if you don't already have one.
2. Click **+ → New repository**. Name it `wego-adm-tracker`. Public OR private — both work with Render free tier.
3. On the repo page → **Add file → Upload files** → drag every file in this `render-app` folder (including the `public` subfolder).
4. Scroll down → **Commit changes**.

### 2. Deploy on Render (~3 min)
1. Sign up at https://render.com with your GitHub account (free, no card).
2. Click **+ New → Web Service** → Connect your `wego-adm-tracker` repo.
3. Settings:
   - **Name:** `wego-adm-tracker` (becomes your URL: `wego-adm-tracker.onrender.com`)
   - **Region:** any
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Scroll to **Environment Variables**, click **Add Environment Variable** for each:
   - `ADMIN_EMAIL` = `abdallah.matarawy@wego.com`
   - `GMAIL_USER` = `abdallah.matarawy@wego.com` *(or any Gmail you control)*
   - `GMAIL_PASS` = *the Gmail App Password* (see step 3 below)
   - `SESSION_SECRET` = any long random string (e.g. mash the keyboard for ~30 chars)
   - *(optional)* `ANTHROPIC_API_KEY` = `sk-ant-...` (only needed for AI screenshot extraction)
5. Click **Create Web Service**. Wait ~2 min for the first build.
6. Done — Render shows your URL. Share that URL with the team.

### 3. Get the Gmail App Password (~1 min)
You need an "App Password" — a 16-char password that lets the app send mail without your real password.

1. Go to https://myaccount.google.com/security
2. **2-Step Verification** must be on (turn it on if not).
3. Search for **App passwords** in the Google Account search bar (or visit https://myaccount.google.com/apppasswords).
4. **App name:** `ADM Tracker` → **Create**.
5. Copy the 16-character password. Paste it as `GMAIL_PASS` in Render's env vars (step 2.4 above).

### 4. First sign-in
1. Open your Render URL.
2. Click **Request access**, fill in your name + email + password.
3. Submission triggers an email to `ADMIN_EMAIL` (you).
4. Open the email → click **Approve**.
5. Go back to the URL → **Sign in** with your email + password.
6. You're in. Add an ADM to test.

---

## What's included

| Path | What it is |
|---|---|
| `server.js` | Express server: auth, ADM CRUD, reasons, taxes, AI proxy |
| `package.json` | Dependencies + `npm start` script |
| `public/login.html` | Sign-in page (animated mascot + green-blob background) |
| `public/signup.html` | Request-access form |
| `public/index.html` | Full ADM Tracker (table, charts, import) |
| `data.json` | Auto-created on first run — your data lives here |

## Features

- **Auth:** email + password, with admin email approval. Sessions persist 30 days.
- **ADM Tracker:** all the columns, dynamic Reasons + Taxes lists, multi-checkbox Caused By + Platform, multi-value Tickets/PNRs, Finance Payment Status (Paid/Received/Needs Review).
- **Analytics:** charts by airline, time, status, reason, payment.
- **CSV export** + **PDF/screenshot import** (AI-powered, needs `ANTHROPIC_API_KEY`).
- **Wego brand:** animated 3D mascot, breathing/blinking, drifting green blob background.

## Day-2

- **Add a teammate:** they go to your URL → Request access → you get an email → click Approve.
- **Update the code:** push to the GitHub repo → Render auto-redeploys.
- **Backup data:** download `data.json` from Render's **Disk** tab, or have the app's "Export CSV" button run weekly.
- **Rotate keys:** edit env vars in Render → click **Save** → it auto-redeploys.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Render says "build failed: no start command" | Check `package.json` has `"start": "node server.js"` |
| Sign-up works but no email arrives | Verify `GMAIL_USER`/`GMAIL_PASS` env vars; check Render's Logs tab for `[mail]` lines |
| Approval link says "Forbidden" | The link must be opened while signed into the `ADMIN_EMAIL` Google account |
| `data.json` resets to empty after redeploy | Add a Render Disk under **Disks** → mount at `/opt/render/project/src` (free tier includes 1 GB) |
| Render free tier sleeps after 15 min idle | Normal. First request after sleep takes ~30 sec to wake. Upgrade to paid ($7/mo) for always-on. |
