// Email copies of notifications (SRS section 47). Switched on by setting SMTP_HOST
// (see .env.example); without it nothing is sent and nothing else changes. A
// failure to send is logged and never undoes the action that caused it.
//
// Which notifications are emailed depends on their severity and the System
// Administrator's "Email notifications" setting (see settings.js).

const nodemailer = require('nodemailer');

const SEVERITY_RANK = { info: 1, attention: 2, critical: 3 };

let transport = null;
let transportFromEnv = null;
const pending = new Set();

function buildTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (transportFromEnv) return transportFromEnv;
  transportFromEnv = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}),
  });
  return transportFromEnv;
}

const activeTransport = () => transport || buildTransport();
const isConfigured = () => Boolean(activeTransport());
const sender = () => process.env.MAIL_FROM || 'AAPL Platform <no-reply@localhost>';

// Whether a notification of this severity is emailed, for a minimum level of
// 0 (never), 1 (everything), 2 (attention and critical) or 3 (critical only).
const shouldEmail = (severity, minLevel) => minLevel > 0 && (SEVERITY_RANK[severity] || 1) >= minLevel;

// Sends one email without making the caller wait. Use flush() to wait for the
// ones still on their way (tests, and a clean shutdown).
function send({ to, subject, text }) {
  const t = activeTransport();
  if (!t || !to) return;
  const job = t.sendMail({ from: sender(), to, subject: String(subject).slice(0, 200), text })
    .catch((err) => console.error(`Could not email ${to}:`, err.message))
    .finally(() => pending.delete(job));
  pending.add(job);
}

const flush = () => Promise.all([...pending]);

// For tests: use a stand-in transport, or pass null to go back to the real one.
function setTransport(t) { transport = t; }

module.exports = { isConfigured, shouldEmail, send, flush, setTransport, SEVERITY_RANK };
