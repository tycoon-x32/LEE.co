const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_for_prod';

// Admin credentials (as requested)
// Accept multiple aliases/emails for convenience: leemesse (alias), leemessi63@gmail.com, original leemessi632gmail.com
const ADMIN_EMAILS = ['leemesse', 'leemessi63@gmail.com', 'leemessi632gmail.com'];
const ADMIN_PASSWORD = 'leemessi2005';
const ADMIN_KEY = 'LEE_ADMIN';

// Admin functionality toggle - set ADMIN_ENABLED=1 to re-enable admin endpoints
const ADMIN_ENABLED = (process.env.ADMIN_ENABLED === '1');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

function readDB() {
  try {
    return fs.readJsonSync(DB_FILE);
  } catch (e) {
    const init = { submissions: [], balances: {}, transfers: [] };
    fs.writeJsonSync(DB_FILE, init, { spaces: 2 });
    return init;
  }
}

function writeDB(obj) {
  fs.writeJsonSync(DB_FILE, obj, { spaces: 2 });
}

// Public endpoint to submit payment confirmations
// Create a transporter only if SMTP config provided
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || '';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER || 'no-reply@leeglobal.local';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}

// POST /api/submit: create submission and auto-verify (transfer) and email dashboard link
app.post('/api/submit', (req, res) => {
  const { name, phone, usd, lee, txRef, screenshot, email } = req.body || {};
  if (!usd || isNaN(Number(usd))) return res.status(400).json({ error: 'Invalid amount' });
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const db = readDB();
  const id = `MPESA-${Date.now()}`;
  const submission = {
    id,
    name: name || null,
    phone: phone || null,
    email: email || null,
    usd: Number(usd),
    lee: Number(lee || usd),
    txRef: txRef || null,
    screenshot: screenshot || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.submissions.push(submission);

  // auto-verify: transfer from admin balance to recipient identified by email
  db.balances = db.balances || {};
  db.balances[ADMIN_KEY] = db.balances[ADMIN_KEY] || 0;
  const amount = Number(submission.lee || submission.usd || 0);
  // ensure admin has balance; if not, seed to 1,000,000,000
  if (db.balances[ADMIN_KEY] < amount) db.balances[ADMIN_KEY] = Math.max(db.balances[ADMIN_KEY] || 0, 1000000000);

  if (db.balances[ADMIN_KEY] < amount) {
    // still insufficient
    submission.status = 'failed';
    writeDB(db);
    return res.status(500).json({ error: 'Insufficient system balance, contact support' });
  }

  db.balances[ADMIN_KEY] -= amount;
  const recipient = submission.email;
  db.balances[recipient] = (db.balances[recipient] || 0) + amount;

  const transfer = { id: `TR-${Date.now()}`, from: ADMIN_KEY, to: recipient, amount, createdAt: new Date().toISOString(), submissionId: submission.id };
  db.transfers = db.transfers || [];
  db.transfers.push(transfer);

  // mark submission verified
  submission.status = 'verified';
  submission.verifiedBy = 'system';
  submission.verifiedAt = new Date().toISOString();

  writeDB(db);

  // generate dashboard token for recipient (long-lived)
  const token = jwt.sign({ email: recipient }, JWT_SECRET, { expiresIn: '30d' });
  const dashboardLink = `${APP_BASE_URL.replace(/\/$/, '')}/dashboard.html?token=${token}`;

  // send email with dashboard link if transporter exists
  if (transporter) {
    const mailOptions = { from: FROM_EMAIL, to: recipient, subject: 'Your LeeCoin Dashboard', html: `<p>Thanks ${submission.name || ''},</p><p>Your payment of ${amount} LΞΞ has been confirmed. Open your dashboard: <a href="${dashboardLink}">${dashboardLink}</a></p>` };
    transporter.sendMail(mailOptions).then(info => {
      // email sent
      return res.json({ ok: true, id, dashboardLink, emailSent: true });
    }).catch(err => {
      console.error('SendMail error', err);
      return res.json({ ok: true, id, dashboardLink, emailSent: false, note: 'Email failed to send; dashboard link returned' });
    });
  } else {
    console.log('No SMTP configured — dashboard link:', dashboardLink);
    return res.json({ ok: true, id, dashboardLink, emailSent: false, note: 'No SMTP configured; link returned in response' });
  }
});
// Admin endpoints are disabled by default. This middleware short-circuits /api/admin routes
app.use('/api/admin', (req, res, next) => {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Admin functionality is disabled' });
  next();
});

// Admin login - returns JWT token
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Admin functionality is disabled' });
  const { email, password } = req.body || {};
  if (ADMIN_EMAILS.includes((email || '').toString().toLowerCase()) && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '8h' });
    // ensure admin balance exists and seed
    const db = readDB();
    db.balances = db.balances || {};
    db.balances[ADMIN_KEY] = db.balances[ADMIN_KEY] || 1000000000;
    writeDB(db);
    return res.json({ ok: true, token, email });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

// Dashboard data endpoint (validate token param)
app.get('/api/dashboard', (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;
    const db = readDB();
    const balances = db.balances || {};
    const transfers = (db.transfers || []).filter(t => t.to === email || t.from === email);
    return res.json({ ok: true, email, balance: balances[email] || 0, transfers });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Auth middleware
function authMiddleware(req, res, next) {
  if (!ADMIN_ENABLED) return res.status(404).json({ error: 'Admin functionality is disabled' });
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/api/admin/submissions', authMiddleware, (req, res) => {
  const db = readDB();
  return res.json({ submissions: db.submissions || [] });
});

app.get('/api/admin/balances', authMiddleware, (req, res) => {
  const db = readDB();
  db.balances = db.balances || {};
  db.balances[ADMIN_KEY] = db.balances[ADMIN_KEY] || 0;
  return res.json({ balances: db.balances });
});

app.post('/api/admin/verify', authMiddleware, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const db = readDB();
  const submissions = db.submissions || [];
  const idx = submissions.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Submission not found' });
  const s = submissions[idx];
  if (s.status !== 'pending') return res.status(400).json({ error: 'Submission not pending' });

  db.balances = db.balances || {};
  db.balances[ADMIN_KEY] = db.balances[ADMIN_KEY] || 0;
  const amount = Number(s.lee || s.usd || 0);
  if (db.balances[ADMIN_KEY] < amount) return res.status(400).json({ error: 'Insufficient admin balance' });

  const recipient = s.phone && s.phone.trim() ? s.phone.trim() : (s.txRef || `user-${Date.now()}`);
  db.balances[ADMIN_KEY] -= amount;
  db.balances[recipient] = (db.balances[recipient] || 0) + amount;

  const transfer = { id: `TR-${Date.now()}`, from: ADMIN_KEY, to: recipient, amount, createdAt: new Date().toISOString(), submissionId: s.id };
  db.transfers = db.transfers || [];
  db.transfers.push(transfer);

  submissions[idx].status = 'verified';
  submissions[idx].verifiedBy = req.admin.email || ADMIN_EMAIL;
  submissions[idx].verifiedAt = new Date().toISOString();

  db.submissions = submissions;
  writeDB(db);
  return res.json({ ok: true, transfer });
});

app.post('/api/admin/reject', authMiddleware, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const db = readDB();
  const submissions = db.submissions || [];
  const idx = submissions.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Submission not found' });
  submissions[idx].status = 'rejected';
  submissions[idx].rejectedAt = new Date().toISOString();
  db.submissions = submissions;
  writeDB(db);
  return res.json({ ok: true });
});

app.get('/api/admin/transfers', authMiddleware, (req, res) => {
  const db = readDB();
  return res.json({ transfers: db.transfers || [] });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
