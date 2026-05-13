// ─────────────────────────────────────────────────────────────────────────────
// Wego ADM Tracker — Node.js + Express server
// Designed for one-click deploy to Render.com (or any Node host).
// Storage:  data.json file on disk (persists with Render's free disk).
// Auth:     email/password signup + admin email approval workflow.
// Email:    nodemailer (Gmail SMTP via App Password — set GMAIL_USER + GMAIL_PASS env).
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT       = process.env.PORT || 10000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'abdallah.matarawy@wego.com';
const APP_NAME   = 'ADM Tracker';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_FILE  = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const INITIAL_ADMIN_HASH = '4bcee5a547d564e64dd99bed08ef7d76:b81c2dccfd31b385ecac44edab355fdfe480f96a2638feb2adc4bbb037f0d812aefb9e181597658171ddcdfcc089bf218e0388b93b691c1cfff1de29c1469d97'; // scrypt hash of the seeded admin password — change via /reset-password after first sign-in

// ── Persistent JSON store ──────────────────────────────────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) {
    return {
      users: [],          // {id, email, name, passwordHash, status: 'pending'|'approved'|'rejected', createdAt, approvedAt, isAdmin}
      adms:  [],          // {id, ...all the ADM fields}
      reasons: ['Fare Difference','Commission Recall','Tax Issue','No-Show','Waiver Rejected','Other'],
      taxes:   [
        ['YQ','Carrier-imposed Fuel Surcharge'], ['YR','Carrier-imposed Surcharge'],
        ['AY','US September 11 Security Fee'], ['XF','US Passenger Facility Charge'],
        ['ZP','US Flight Segment Fee'], ['US','US Transportation Tax'],
        ['GB','UK Air Passenger Duty'], ['DE','Germany Air Travel Tax'],
        ['MJ','Japan Passenger Service Facility Charge'], ['IN','India User Development Fee'],
        ['TR','Turkey Passenger Charge'], ['AE','UAE Passenger Service Charge'],
        ['SA','Saudi Arabia Passenger Service'], ['EG','Egypt Departure Tax'],
        ['BP','Airport Tax — General'], ['QX','Service Charge'],
        ['VT','VAT'], ['CP','Country Passenger Charge']
      ].map(([code, description]) => ({ code, description }))
    };
  }
}
let db = loadDB();
let saveTimer = null;
function saveDB() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }, 50);
}

// Bootstrap: ensure admin exists and is approved
(function ensureAdmin() {
  let admin = db.users.find(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!admin) {
    db.users.push({
      id: crypto.randomBytes(8).toString('hex'),
      email: ADMIN_EMAIL.toLowerCase(),
      name: 'Admin',
      passwordHash: INITIAL_ADMIN_HASH,
      status: 'approved',
      isAdmin: true,
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString()
    });
    saveDB();
    console.log('[boot] seeded admin user:', ADMIN_EMAIL);
  } else if (!admin.passwordHash) {
    admin.passwordHash = INITIAL_ADMIN_HASH;
    saveDB();
    console.log('[boot] backfilled initial password for admin:', ADMIN_EMAIL);
  }
})();

// ── Email transport ────────────────────────────────────────────────────
let transporter = null;
function getMailer() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
  return transporter;
}
async function sendMail(to, subject, html, text) {
  const mailer = getMailer();
  if (!mailer) {
    console.warn('[mail] GMAIL_USER/GMAIL_PASS not set — skipping email to', to);
    return;
  }
  try {
    await mailer.sendMail({
      from: '"' + APP_NAME + '" <' + process.env.GMAIL_USER + '>',
      to, subject, text: text || html.replace(/<[^>]+>/g, ''), html
    });
  } catch (err) { console.error('[mail] send failed:', err.message); }
}

// ── Helpers ────────────────────────────────────────────────────────────
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pwd, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function newId() { return crypto.randomBytes(8).toString('hex'); }
function getUser(req) {
  if (!req.session || !req.session.userId) return null;
  return db.users.find(u => u.id === req.session.userId) || null;
}
function requireApproved(req, res, next) {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  if (u.status !== 'approved') return res.status(403).json({ error: 'Not approved yet' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  const u = getUser(req);
  if (!u || !u.isAdmin) return res.status(403).send('Forbidden');
  req.user = u;
  next();
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── App ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: 'auto' }
}));

// ── Auth routes ────────────────────────────────────────────────────────
app.post('/api/signup', async (req, res) => {
  try {
    const { email, name, password, reason } = req.body || {};
    if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const e = email.trim().toLowerCase();
    const existing = db.users.find(u => u.email === e);
    if (existing) {
      if (existing.status === 'approved') return res.status(409).json({ error: 'Account exists. Please sign in.' });
      return res.status(409).json({ error: 'A request for this email is already pending.' });
    }
    const user = {
      id: newId(),
      email: e,
      name: String(name).trim(),
      passwordHash: hashPassword(password),
      status: 'pending',
      isAdmin: false,
      reason: String(reason || '').trim(),
      createdAt: new Date().toISOString(),
      token: newId()    // for approve/reject links
    };
    db.users.push(user);
    saveDB();

    // Email admin
    const base = req.protocol + '://' + req.get('host');
    const approveUrl = `${base}/admin/approve?id=${user.id}&token=${user.token}`;
    const rejectUrl  = `${base}/admin/reject?id=${user.id}&token=${user.token}`;
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:560px">` +
      `<div style="background:#7DBC2A;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0"><b>wego</b> / ${APP_NAME}</div>` +
      `<div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 10px 10px">` +
      `<h2 style="margin:0 0 16px;font-size:18px">New access request</h2>` +
      `<table cellpadding="6" style="font-size:14px">` +
        `<tr><td><b>Name</b></td><td>${escapeHtml(user.name)}</td></tr>` +
        `<tr><td><b>Email</b></td><td>${escapeHtml(user.email)}</td></tr>` +
        `<tr><td><b>Reason</b></td><td>${escapeHtml(user.reason || '(none)')}</td></tr>` +
      `</table>` +
      `<div style="margin:24px 0">` +
        `<a href="${approveUrl}" style="background:#7DBC2A;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;margin-right:10px">Approve</a>` +
        `<a href="${rejectUrl}"  style="background:#ef4444;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Reject</a>` +
      `</div></div></div>`;
    sendMail(ADMIN_EMAIL, `[${APP_NAME}] Access request from ${user.name}`, html);

    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
    const u = db.users.find(x => x.email === String(email).trim().toLowerCase());
    if (!u || !verifyPassword(password, u.passwordHash)) return res.status(401).json({ error: 'Invalid email or password' });
    if (u.status === 'pending') return res.status(403).json({ error: 'Your access request is awaiting admin approval.' });
    if (u.status === 'rejected') return res.status(403).json({ error: 'Your access request was rejected.' });
    req.session.userId = u.id;
    res.json({ ok: true, user: { email: u.email, name: u.name, isAdmin: !!u.isAdmin } });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const u = getUser(req);
  if (!u) return res.json({ user: null });
  res.json({ user: { email: u.email, name: u.name, status: u.status, isAdmin: !!u.isAdmin } });
});


// ── Password reset ─────────────────────────────────────────────────────
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });
    const e = String(email).trim().toLowerCase();
    const u = db.users.find(x => x.email === e);
    // Always respond OK to avoid leaking which emails are registered.
    if (u && u.status === 'approved') {
      u.resetToken = crypto.randomBytes(24).toString('hex');
      u.resetExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
      saveDB();
      const base = req.protocol + '://' + req.get('host');
      const resetUrl = `${base}/reset-password?id=${u.id}&token=${u.resetToken}`;
      const html =
        `<div style="font-family:Arial,sans-serif;max-width:560px">` +
          `<div style="background:#7DBC2A;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0"><b>wego</b> / ${APP_NAME}</div>` +
          `<div style="border:1px solid #eee;border-top:none;padding:24px;border-radius:0 0 10px 10px">` +
            `<h2 style="margin:0 0 12px;font-size:18px">Password reset</h2>` +
            `<p style="font-size:14px;color:#333">Hi ${escapeHtml(u.name || '')},</p>` +
            `<p style="font-size:14px;color:#333">Click the button below to set a new password for ${APP_NAME}. This link expires in 1 hour.</p>` +
            `<div style="margin:24px 0">` +
              `<a href="${resetUrl}" style="background:#7DBC2A;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600">Set new password</a>` +
            `</div>` +
            `<p style="font-size:12px;color:#888">If you didn't request this, you can safely ignore this email.</p>` +
          `</div></div>`;
      sendMail(u.email, `Password reset · ${APP_NAME}`, html);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));

app.post('/api/reset-password', async (req, res) => {
  try {
    const { id, token, password } = req.body || {};
    if (!id || !token || !password) return res.status(400).json({ error: 'Missing fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const u = db.users.find(x => x.id === id);
    if (!u || !u.resetToken || u.resetToken !== token || !u.resetExpiry || u.resetExpiry < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }
    u.passwordHash = hashPassword(password);
    delete u.resetToken;
    delete u.resetExpiry;
    saveDB();
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ── Admin approve/reject (clicked from email) ──────────────────────────
app.get('/admin/approve', async (req, res) => {
  const u = db.users.find(x => x.id === req.query.id && x.token === req.query.token);
  if (!u) return res.status(404).send(adminPage('Not found', 'No matching pending request — it may already be processed.'));
  if (u.status === 'approved') return res.send(adminPage('Already approved', `${escapeHtml(u.email)} is already approved.`));
  u.status = 'approved';
  u.approvedAt = new Date().toISOString();
  delete u.token;
  saveDB();
  const base = req.protocol + '://' + req.get('host');
  sendMail(u.email, `Access approved · ${APP_NAME}`,
    `<p>Hi ${escapeHtml(u.name)},</p><p>Your access has been approved. <a href="${base}/login">Sign in here</a>.</p><p>— Admin</p>`);
  res.send(adminPage('Approved ✓', `<b>${escapeHtml(u.email)}</b> has been approved and notified.`));
});
app.get('/admin/reject', async (req, res) => {
  const u = db.users.find(x => x.id === req.query.id && x.token === req.query.token);
  if (!u) return res.status(404).send(adminPage('Not found', 'No matching request.'));
  u.status = 'rejected';
  delete u.token;
  saveDB();
  sendMail(u.email, `Access declined · ${APP_NAME}`,
    `<p>Hi ${escapeHtml(u.name)},</p><p>Your access request was not approved.</p><p>— Admin</p>`);
  res.send(adminPage('Rejected ✕', `<b>${escapeHtml(u.email)}</b> has been rejected and notified.`));
});

// ── ADM CRUD (approved users only) ─────────────────────────────────────
app.get('/api/adms', requireApproved, (req, res) => res.json(db.adms));

app.post('/api/adms', requireApproved, (req, res) => {
  const adm = req.body || {};
  const now = new Date().toISOString();
  if (adm.id) {
    const idx = db.adms.findIndex(a => a.id === adm.id);
    if (idx === -1) return res.status(404).json({ error: 'ADM not found' });
    adm.createdAt = db.adms[idx].createdAt;
    adm.createdBy = db.adms[idx].createdBy;
    adm.updatedAt = now;
    adm.updatedBy = req.user.email;
    db.adms[idx] = adm;
  } else {
    adm.id = newId();
    adm.createdAt = now;
    adm.updatedAt = now;
    adm.createdBy = req.user.email;
    db.adms.push(adm);
  }
  saveDB();
  res.json({ ok: true, id: adm.id });
});

app.delete('/api/adms/:id', requireApproved, (req, res) => {
  const before = db.adms.length;
  db.adms = db.adms.filter(a => a.id !== req.params.id);
  if (db.adms.length === before) return res.status(404).json({ error: 'Not found' });
  saveDB();
  res.json({ ok: true });
});

// ── Reasons / Taxes ────────────────────────────────────────────────────
app.get('/api/reasons', requireApproved, (req, res) => res.json(db.reasons));
app.post('/api/reasons', requireApproved, (req, res) => {
  const name = String(req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Reason name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Too long' });
  if (!db.reasons.find(r => r.toLowerCase() === name.toLowerCase())) {
    db.reasons.push(name); saveDB();
  }
  res.json({ ok: true, reason: name });
});

app.get('/api/taxes', requireApproved, (req, res) => res.json(db.taxes));
app.post('/api/taxes', requireApproved, (req, res) => {
  const code = String(req.body && req.body.code || '').trim().toUpperCase();
  const description = String(req.body && req.body.description || '').trim();
  if (!code) return res.status(400).json({ error: 'Tax code is required' });
  if (code.length > 8) return res.status(400).json({ error: 'Code too long' });
  if (!db.taxes.find(t => t.code === code)) {
    db.taxes.push({ code, description }); saveDB();
  }
  res.json({ ok: true, code, description });
});

// ── Anthropic AI proxy (server-side key) ───────────────────────────────
app.post('/api/ai', requireApproved, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY env var not set on this server' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Pages ──────────────────────────────────────────────────────────────
app.get('/login',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/',       (req, res) => {
  const u = getUser(req);
  if (!u) return res.redirect('/login');
  if (u.status !== 'approved') return res.redirect('/login?status=' + u.status);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

function adminPage(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} · ${APP_NAME}</title>` +
    `<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">` +
    `<style>body{font-family:'DM Sans',sans-serif;color:#1f2a17;background:#f6faf0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;margin:0}` +
    `.card{background:#fff;border-radius:20px;padding:40px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(125,188,42,0.10);text-align:center}` +
    `.b{background:#7DBC2A;color:#fff;padding:6px 14px;border-radius:8px;font-weight:700;font-size:18px;display:inline-block;margin-bottom:18px}` +
    `h1{font-size:22px;margin:0 0 12px}p{color:#6b7a6b;font-size:14px}p b{color:#1f2a17}</style>` +
    `</head><body><div class="card"><div class="b">wego.</div><h1>${escapeHtml(title)}</h1><p>${body}</p></div></body></html>`;
}

app.listen(PORT, () => {
  console.log(`[boot] ${APP_NAME} server listening on :${PORT}`);
  console.log(`[boot] admin: ${ADMIN_EMAIL}`);
  console.log(`[boot] mail:  ${process.env.GMAIL_USER ? 'configured (' + process.env.GMAIL_USER + ')' : 'NOT configured — set GMAIL_USER + GMAIL_PASS'}`);
});
