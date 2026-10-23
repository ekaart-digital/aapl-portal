process.env.LOGIN_RATE_LIMIT = '2'; // must be set before helpers/app load
process.env.TRUST_PROXY = '1'; // as it is behind Nginx

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const { seedFixtures, startApp } = require('./helpers');

// What a new installation depends on: the proxy setting, the script that builds
// an empty database, and the script that creates the first administrator.
let f; let app;
const root = path.join(__dirname, '..');
const run = (script, env) => spawnSync('node', [path.join(root, 'scripts', script)], {
  cwd: root, env: { ...process.env, ...env }, encoding: 'utf8',
});

before(async () => {
  f = await seedFixtures();
  app = await startApp();
});
after(() => app.close(f));

// ===================================================================== trust proxy
test('behind a proxy, each client address has its own login limit', async () => {
  const from = (ip) => fetch(`${app.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ employeeId: 'EMP-999', password: 'wrong' }),
  });
  assert.equal((await from('203.0.113.10')).status, 401);
  assert.equal((await from('203.0.113.10')).status, 401);
  assert.equal((await from('203.0.113.10')).status, 429, 'the first client is blocked');
  assert.equal((await from('203.0.113.99')).status, 401, 'a different client is not');
});

// ===================================================================== create-admin
const ADMIN = { ADMIN_NAME: 'First Admin', ADMIN_EMAIL: 'first.admin@example.com' };

test('creates a System Administrator who can sign in with the generated password', async () => {
  const result = run('create-admin.js', ADMIN);
  assert.equal(result.status, 0, result.stderr);
  const id = result.stdout.match(/Employee ID:\s*(EMP-\d+)/)[1];
  const password = result.stdout.match(/Password:\s*(\S+)/)[1];
  assert.match(password, /^[A-Za-z0-9]{16}$/);
  assert.match(password, /[A-Za-z]/);
  assert.match(password, /\d/);

  const login = await app.api('/auth/login', { method: 'POST', body: { employeeId: id, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.role, 'system_admin');
  assert.equal(login.body.user.name, 'First Admin');
  assert.equal(login.body.user.landing, '/admin');
});

test('generated passwords differ each time', () => {
  const a = run('create-admin.js', { ...ADMIN, ADMIN_EMAIL: 'second@example.com' });
  const b = run('create-admin.js', { ...ADMIN, ADMIN_EMAIL: 'third@example.com' });
  assert.notEqual(a.stdout.match(/Password:\s*(\S+)/)[1], b.stdout.match(/Password:\s*(\S+)/)[1]);
});

test('uses the password it is given, and does not print it', () => {
  const result = run('create-admin.js', { ...ADMIN, ADMIN_EMAIL: 'given@example.com', ADMIN_PASSWORD: 'Chosen!Pass1' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes('Chosen!Pass1'));
  assert.match(result.stdout, /the one you supplied/);
});

test('refuses a duplicate email, a weak password, a bad email and a missing name', () => {
  assert.equal(run('create-admin.js', ADMIN).status, 1); // first.admin@example.com exists already
  const dupe = run('create-admin.js', ADMIN);
  assert.match(dupe.stderr, /already exists/);

  const weak = run('create-admin.js', { ...ADMIN, ADMIN_EMAIL: 'weak@example.com', ADMIN_PASSWORD: 'short' });
  assert.equal(weak.status, 1);
  assert.match(weak.stderr, /at least 8/);

  assert.equal(run('create-admin.js', { ...ADMIN, ADMIN_EMAIL: 'not-an-email' }).status, 1);
  assert.equal(run('create-admin.js', { ADMIN_NAME: '', ADMIN_EMAIL: 'x@example.com' }).status, 1);
});

// ===================================================================== init-db
test('builds an empty database with the full schema, and can be run again', async () => {
  const name = 'aapl_init_check_test';
  const opts = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
  };
  const admin = await mysql.createConnection(opts);
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    const first = run('init-db.js', { DB_NAME: name });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /ready with \d+ tables/);

    const [tables] = await admin.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?`, [name]);
    const names = tables.map((r) => r.t);
    for (const table of ['employees', 'projects', 'tasks', 'time_logs', 'teams', 'audit_log', 'correction_requests', 'system_settings', 'notifications']) {
      assert.ok(names.includes(table), `missing table ${table}`);
    }
    // The newest columns are there too, so no migration is needed on a fresh database.
    const [cols] = await admin.query(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = 'projects'", [name]
    );
    assert.ok(cols.some((r) => r.c === 'agreed_fee'));

    assert.equal(run('init-db.js', { DB_NAME: name }).status, 0, 'running it again is safe');
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  }
});

test('init-db refuses an unsafe database name', () => {
  const result = run('init-db.js', { DB_NAME: 'bad name; DROP DATABASE x' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /letters, numbers and underscores/);
});
