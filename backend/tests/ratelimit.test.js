process.env.LOGIN_RATE_LIMIT = '3'; // must be set before helpers/app load

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp, PASSWORD } = require('./helpers');

let f; let app;

before(async () => {
  f = await seedFixtures();
  app = await startApp();
});
after(() => app.close(f));

test('login is rate limited after too many attempts', async () => {
  const attempt = () => app.api('/auth/login', { method: 'POST', body: { employeeId: 'EMP-999', password: 'wrong' } });

  for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error.message, /too many/i);
});

test('the limit applies to valid logins too, but other endpoints are unaffected', async () => {
  const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: String(f.pipingA), password: PASSWORD } });
  assert.equal(res.status, 429);
  assert.equal((await app.api('/health')).status, 200);
});
