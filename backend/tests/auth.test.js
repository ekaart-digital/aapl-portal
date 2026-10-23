const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp, PASSWORD } = require('./helpers');

let f; let app;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;

before(async () => {
  f = await seedFixtures();
  app = await startApp();
});
after(() => app.close(f));

test('login accepts EMP-001 style, plain number and padded number', async () => {
  for (const id of [code(f.pipingA), String(f.pipingA), String(f.pipingA).padStart(3, '0'), code(f.pipingA).toLowerCase()]) {
    const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: id, password: PASSWORD } });
    assert.equal(res.status, 200, `employeeId ${id}`);
    assert.equal(res.body.user.id, f.pipingA);
    assert.ok(res.body.token);
  }
});

test('login response exposes the public profile only (no password hash)', async () => {
  const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: PASSWORD } });
  assert.equal(res.body.user.role, 'employee');
  assert.equal(res.body.user.department, 'Piping');
  assert.equal(JSON.stringify(res.body).includes('password'), false);
});

test('project manager login has no department', async () => {
  const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.manager1), password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'project_manager');
  assert.equal(res.body.user.departmentId, null);
});

test('wrong password is rejected with the same message as an unknown ID', async () => {
  const wrongPw = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: 'nope' } });
  const unknown = await app.api('/auth/login', { method: 'POST', body: { employeeId: 'EMP-999', password: PASSWORD } });
  assert.equal(wrongPw.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.body.error.message, unknown.body.error.message);
});

test('inactive account cannot log in', async () => {
  const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.inactive), password: PASSWORD } });
  assert.equal(res.status, 403);
});

test('missing or non-numeric employee ID / password returns 400', async () => {
  for (const body of [{}, { password: PASSWORD }, { employeeId: code(f.pipingA) }, { employeeId: 'abc', password: PASSWORD }]) {
    const res = await app.api('/auth/login', { method: 'POST', body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('email can no longer be used to log in', async () => {
  const res = await app.api('/auth/login', { method: 'POST', body: { email: 'pa@test.local', password: PASSWORD } });
  assert.equal(res.status, 400);
});

test('/auth/me returns the logged-in user; missing or bad token is 401', async () => {
  const token = await app.login(code(f.pipingA));
  const me = await app.api('/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.name, 'Piping A');

  assert.equal((await app.api('/auth/me')).status, 401);
  assert.equal((await app.api('/auth/me', { token: 'not.a.token' })).status, 401);
});

test('a token for a deactivated employee stops working immediately', async () => {
  const token = await app.login(code(f.pipingB));
  assert.equal((await app.api('/auth/me', { token })).status, 200);

  await f.db.query("UPDATE employees SET status = 'inactive' WHERE employee_id = ?", [f.pipingB]);
  const res = await app.api('/auth/me', { token });
  assert.equal(res.status, 401);

  await f.db.query("UPDATE employees SET status = 'active' WHERE employee_id = ?", [f.pipingB]);
});

test('change-password: validation, wrong current password, then success', async () => {
  const token = await app.login(code(f.structA));

  assert.equal((await app.api('/auth/change-password', { method: 'POST', token, body: {} })).status, 400);
  assert.equal((await app.api('/auth/change-password', { method: 'POST', token, body: { currentPassword: PASSWORD, newPassword: 'short' } })).status, 400);
  assert.equal((await app.api('/auth/change-password', { method: 'POST', token, body: { currentPassword: 'wrong', newPassword: 'longenough1' } })).status, 400);

  const ok = await app.api('/auth/change-password', { method: 'POST', token, body: { currentPassword: PASSWORD, newPassword: 'NewPassw0rd!' } });
  assert.equal(ok.status, 200);

  const oldLogin = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.structA), password: PASSWORD } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.structA), password: 'NewPassw0rd!' } });
  assert.equal(newLogin.status, 200);
});

test('change-password requires authentication', async () => {
  const res = await app.api('/auth/change-password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'longenough1' } });
  assert.equal(res.status, 401);
});

test('security headers are set', async () => {
  const res = await app.api('/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('strict-transport-security'));
  assert.equal(res.headers.get('x-powered-by'), null);
});
