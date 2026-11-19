const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const email = require('../src/services/email');

// Sending through Microsoft Graph, with a stand-in for the network.
const SECRET = 'very-secret-value-123';
const creds = { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: SECRET };
const FROM = 'AAPL Platform <Johnson@aaplconsultants.com>';
const mail = { from: FROM, to: 'someone@example.com', subject: 'Hello', text: 'Body text' };

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// Records every call and answers by URL.
function fakeNetwork({ token = { access_token: 'tok-1', expires_in: 3600 }, tokenStatus = 200, send = () => ({ status: 202 }) } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('login.microsoftonline.com')) return json(tokenStatus, token);
    const reply = send(calls.filter((c) => !String(c.url).includes('login.microsoftonline.com')).length);
    return { status: reply.status, ok: reply.status < 300, json: async () => reply.body ?? {} };
  };
  return { calls, fetchImpl };
}
const tokenCalls = (calls) => calls.filter((c) => String(c.url).includes('login.microsoftonline.com'));
const sendCalls = (calls) => calls.filter((c) => String(c.url).includes('graph.microsoft.com'));

test('signs in as the application and sends as the mailbox in the From address', async () => {
  const net = fakeNetwork();
  await email.createGraphTransport({ ...creds, fetchImpl: net.fetchImpl }).sendMail(mail);

  const [signIn] = tokenCalls(net.calls);
  assert.equal(signIn.url, 'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
  const form = new URLSearchParams(String(signIn.options.body));
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), 'client-1');
  assert.equal(form.get('client_secret'), SECRET);
  assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default');

  const [sent] = sendCalls(net.calls);
  assert.equal(sent.url, 'https://graph.microsoft.com/v1.0/users/Johnson%40aaplconsultants.com/sendMail');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.headers.Authorization, 'Bearer tok-1');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.message.subject, 'Hello');
  assert.deepEqual(body.message.body, { contentType: 'Text', content: 'Body text' });
  assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: 'someone@example.com' } }]);
  assert.equal(body.saveToSentItems, false);
});

test('a plain address works as the sender too', () => {
  assert.equal(email.addressOf('johnson@aaplconsultants.com'), 'johnson@aaplconsultants.com');
  assert.equal(email.addressOf('AAPL Platform <johnson@aaplconsultants.com>'), 'johnson@aaplconsultants.com');
});

test('the sign-in token is reused until it is about to expire', async () => {
  const net = fakeNetwork();
  const transport = email.createGraphTransport({ ...creds, fetchImpl: net.fetchImpl });
  await transport.sendMail(mail);
  await transport.sendMail(mail);
  assert.equal(tokenCalls(net.calls).length, 1, 'signed in once');
  assert.equal(sendCalls(net.calls).length, 2);

  const short = fakeNetwork({ token: { access_token: 'tok-2', expires_in: 30 } }); // inside the one-minute margin
  const quick = email.createGraphTransport({ ...creds, fetchImpl: short.fetchImpl });
  await quick.sendMail(mail);
  await quick.sendMail(mail);
  assert.equal(tokenCalls(short.calls).length, 2, 'a token about to expire is replaced');
});

test('a rejected token is dropped so the next email signs in again', async () => {
  const net = fakeNetwork({ send: (n) => (n === 1 ? { status: 401, body: { error: { code: 'InvalidAuthenticationToken', message: 'Expired' } } } : { status: 202 }) });
  const transport = email.createGraphTransport({ ...creds, fetchImpl: net.fetchImpl });
  await assert.rejects(transport.sendMail(mail), /401/);
  await transport.sendMail(mail);
  assert.equal(tokenCalls(net.calls).length, 2);
});

test('a failed sign-in says why, and never repeats the secret', async () => {
  const net = fakeNetwork({ tokenStatus: 401, token: { error: 'invalid_client', error_description: `AADSTS7000215: Invalid client secret provided (${SECRET}).\r\nTrace ID: abc` } });
  const err = await email.createGraphTransport({ ...creds, fetchImpl: net.fetchImpl }).sendMail(mail).then(() => null, (e) => e);
  assert.match(err.message, /sign-in failed \(401\).*AADSTS7000215/);
  assert.ok(!err.message.includes(SECRET), 'the secret is not repeated');
  assert.ok(!err.message.includes('Trace ID'), 'only the first line');
  assert.equal(sendCalls(net.calls).length, 0, 'nothing is sent without a token');
});

test('Microsoft refusing the email is reported with its reason', async () => {
  const net = fakeNetwork({ send: () => ({ status: 403, body: { error: { code: 'ErrorAccessDenied', message: `Access is denied.\n Check credentials ${SECRET}` } } }) });
  const err = await email.createGraphTransport({ ...creds, fetchImpl: net.fetchImpl }).sendMail(mail).then(() => null, (e) => e);
  assert.match(err.message, /refused the email \(403 ErrorAccessDenied\): Access is denied\. Check credentials \*\*\*$/);
  assert.ok(!err.message.includes(SECRET));
});

// ===================================================================== choosing the transport
const SAVED = { ...process.env };
let realFetch;
beforeEach(() => { realFetch = global.fetch; email.setTransport(null); });
afterEach(() => {
  global.fetch = realFetch;
  for (const k of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'SMTP_HOST', 'MAIL_FROM']) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
});

test('nothing is sent, and sendNow says so, when no mail settings are present', async () => {
  for (const k of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'SMTP_HOST']) delete process.env[k];
  assert.equal(email.isConfigured(), false);
  await assert.rejects(email.sendNow(mail), /not set up/);
});

test('with the Graph settings present, email goes through Graph from MAIL_FROM', async () => {
  const net = fakeNetwork();
  global.fetch = net.fetchImpl;
  Object.assign(process.env, { GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: SECRET, MAIL_FROM: FROM });
  delete process.env.SMTP_HOST;
  // A fresh module, so the transport is built from these settings.
  delete require.cache[require.resolve('../src/services/email')];
  const fresh = require('../src/services/email');
  assert.equal(fresh.isConfigured(), true);
  await fresh.sendNow({ to: 'a@example.com', subject: 's', text: 't' });
  assert.equal(sendCalls(net.calls)[0].url, 'https://graph.microsoft.com/v1.0/users/Johnson%40aaplconsultants.com/sendMail');
});

test('Graph wins when SMTP is set as well, and half a set of Graph settings is not enough', async () => {
  const net = fakeNetwork();
  global.fetch = net.fetchImpl;
  Object.assign(process.env, { GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: SECRET, SMTP_HOST: 'smtp.invalid', MAIL_FROM: FROM });
  delete require.cache[require.resolve('../src/services/email')];
  await require('../src/services/email').sendNow({ to: 'a@example.com', subject: 's', text: 't' });
  assert.equal(sendCalls(net.calls).length, 1, 'sent through Graph, not SMTP');

  delete process.env.GRAPH_CLIENT_SECRET;
  delete process.env.SMTP_HOST;
  delete require.cache[require.resolve('../src/services/email')];
  assert.equal(require('../src/services/email').isConfigured(), false);
});
