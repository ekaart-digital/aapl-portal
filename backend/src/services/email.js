// Email copies of notifications (SRS section 47). Switched on by setting either
//   - GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET: Microsoft 365, sent
//     through Microsoft Graph as the mailbox in MAIL_FROM (the way to go where
//     Microsoft no longer allows a password for SMTP), or
//   - SMTP_HOST: any ordinary mail server.
// Without either, nothing is sent and nothing else changes. A failure to send is
// logged and never undoes the action that caused it.
//
// Which notifications are emailed depends on their severity and the System
// Administrator's "Email notifications" setting (see settings.js).

const nodemailer = require('nodemailer');

const SEVERITY_RANK = { info: 1, attention: 2, critical: 3 };

let transport = null;
let transportFromEnv = null;
const pending = new Set();

const GRAPH_TIMEOUT_MS = 20000;

// "Name <name@example.com>" or "name@example.com" -> "name@example.com".
const addressOf = (from) => String(from || '').match(/<([^>]+)>/)?.[1]?.trim() || String(from || '').trim();

// Sends through Microsoft Graph as the mailbox in `from`, signing in as an
// application (client credentials) with the Mail.Send application permission.
// Same shape as a nodemailer transport: sendMail({ from, to, subject, text }).
function createGraphTransport({ tenantId, clientId, clientSecret, fetchImpl = fetch }) {
  let token = null;
  let expiresAt = 0;
  // Whatever Microsoft says, the secret never ends up in a message that gets logged.
  const scrub = (text) => String(text).split(clientSecret).join('***');

  async function accessToken() {
    if (token && Date.now() < expiresAt - 60000) return token;
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      const why = String(body.error_description || body.error || 'no reason given').split(/\r?\n/)[0];
      throw new Error(scrub(`Microsoft sign-in failed (${res.status}): ${why}`));
    }
    token = body.access_token;
    expiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
    return token;
  }

  return {
    async sendMail({ from, to, subject, text }) {
      const sender = addressOf(from);
      const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { subject, body: { contentType: 'Text', content: text }, toRecipients: [{ emailAddress: { address: to } }] },
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
      if (res.status === 202) return;
      if (res.status === 401) token = null; // an expired or revoked token: sign in again next time
      const body = await res.json().catch(() => ({}));
      throw new Error(scrub(`Microsoft Graph refused the email (${res.status} ${body.error?.code || ''}): ${body.error?.message || 'no reason given'}`.replace(/\s+/g, ' ')));
    },
  };
}

function buildTransport() {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET } = process.env;
  if (GRAPH_TENANT_ID && GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET) {
    if (!transportFromEnv) transportFromEnv = createGraphTransport({ tenantId: GRAPH_TENANT_ID, clientId: GRAPH_CLIENT_ID, clientSecret: GRAPH_CLIENT_SECRET });
    return transportFromEnv;
  }
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

// Sends one email and waits for the outcome, throwing if it fails. For checking the setup.
async function sendNow({ to, subject, text }) {
  const t = activeTransport();
  if (!t) throw new Error('Email is not set up: set the GRAPH_* or SMTP_HOST settings.');
  await t.sendMail({ from: sender(), to, subject, text });
}

// For tests: use a stand-in transport, or pass null to go back to the real one.
function setTransport(t) { transport = t; }

module.exports = { isConfigured, shouldEmail, send, sendNow, flush, setTransport, createGraphTransport, addressOf, SEVERITY_RANK };
