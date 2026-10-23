const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');
const settings = require('../src/services/settings');

// The System Administrator's tools: settings that change behaviour without a
// deployment, and the system health check.
let f; let app; let t;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const patch = (path, body, token) => app.api(path, { method: 'PATCH', token, body });
const sql = (q, p) => f.db.query(q, p);
const setting = async (key) => (await get('/system/settings', t.sys)).body.settings.find((s) => s.key === key);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    pm: await app.login(code(f.manager1)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };
});
after(() => app.close(f));

// ===================================================================== access
test('only the System Administrator can use settings and health', async () => {
  for (const path of ['/system/settings', '/system/health']) {
    for (const [who, expected] of [['sys', 200], ['hr', 403], ['mgmt', 403], ['pm', 403], ['a', 403]]) {
      assert.equal((await get(path, t[who])).status, expected, `${path} ${who}`);
    }
    assert.equal((await app.api(path)).status, 401);
  }
  assert.equal((await patch('/system/settings', { maxSessionHours: 8 }, t.hr)).status, 403);
});

// ===================================================================== settings
test('settings list their defaults, ranges and current values', async () => {
  const res = await get('/system/settings', t.sys);
  assert.deepEqual(res.body.settings.map((s) => s.key), ['maxSessionHours', 'budgetWarnPercent', 'budgetCriticalPercent', 'correctionWindowDays', 'emailMinSeverity', 'dailySummaryHour', 'sessionTimeoutMinutes']);
  const max = res.body.settings[0];
  assert.equal(max.value, 12);
  assert.equal(max.default, 12);
  assert.equal(max.isDefault, true);
  assert.equal(max.min, 1);
  assert.equal(max.max, 24);
  assert.equal(max.unit, 'hours');
  assert.ok(max.label && max.description);
});

test('saving a setting changes it, remembers who changed it and records it in the audit trail', async () => {
  const res = await patch('/system/settings', { correctionWindowDays: 30 }, t.sys);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.changed, ['correctionWindowDays']);
  const s = res.body.settings.find((x) => x.key === 'correctionWindowDays');
  assert.equal(s.value, 30);
  assert.equal(s.isDefault, false);
  assert.equal(s.updatedByName, 'System Admin');

  const [[entry]] = await sql("SELECT * FROM audit_log WHERE action = 'settings.update'");
  assert.equal(entry.actor_id, f.sysadmin);
  assert.match(entry.summary, /Correction request window.*14.*30/);
  const details = typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details;
  assert.deepEqual(details, { key: 'correctionWindowDays', from: 14, to: 30 });
});

test('saving the same value again changes nothing and records nothing', async () => {
  await sql('DELETE FROM audit_log');
  const res = await patch('/system/settings', { correctionWindowDays: 30 }, t.sys);
  assert.deepEqual(res.body.changed, []);
  const [rows] = await sql('SELECT 1 FROM audit_log');
  assert.equal(rows.length, 0);
});

test('values are validated against each setting’s range', async () => {
  for (const [body, pattern] of [
    [{ maxSessionHours: 0 }, /between 1 and 24/],
    [{ maxSessionHours: 25 }, /between 1 and 24/],
    [{ maxSessionHours: 1.5 }, /whole number/],
    [{ maxSessionHours: 'lots' }, /whole number/],
    [{ maxSessionHours: null }, /whole number/],
    [{ sessionTimeoutMinutes: 1 }, /between 5 and 480/],
    [{ correctionWindowDays: 500 }, /between 1 and 90/],
  ]) {
    const res = await patch('/system/settings', body, t.sys);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error.message, pattern);
  }
  assert.equal((await patch('/system/settings', { nonsense: 1 }, t.sys)).status, 400);
  assert.equal((await patch('/system/settings', {}, t.sys)).status, 400);
  assert.equal((await setting('maxSessionHours')).value, 12, 'nothing was saved');
});

test('the man-hour warning level must stay below the limit', async () => {
  // Both in one request.
  const both = await patch('/system/settings', { budgetWarnPercent: 95, budgetCriticalPercent: 95 }, t.sys);
  assert.equal(both.status, 400);
  assert.match(both.body.error.message, /lower than/);
  // Against the value already saved.
  assert.equal((await patch('/system/settings', { budgetCriticalPercent: 90 }, t.sys)).status, 200);
  assert.equal((await patch('/system/settings', { budgetWarnPercent: 90 }, t.sys)).status, 400);
  assert.equal((await patch('/system/settings', { budgetWarnPercent: 89 }, t.sys)).status, 200);
  assert.equal((await patch('/system/settings', { budgetWarnPercent: 80, budgetCriticalPercent: 100 }, t.sys)).status, 200);
});

test('one invalid value saves nothing from the same request', async () => {
  const res = await patch('/system/settings', { sessionTimeoutMinutes: 45, maxSessionHours: 99 }, t.sys);
  assert.equal(res.status, 400);
  assert.equal((await setting('sessionTimeoutMinutes')).value, 60);
});

test('settings survive a restart: they are read back from the database', async () => {
  await patch('/system/settings', { sessionTimeoutMinutes: 30 }, t.sys);
  settings.resetCache();
  assert.equal(settings.get('sessionTimeoutMinutes'), 60); // forgotten
  await settings.load();
  assert.equal(settings.get('sessionTimeoutMinutes'), 30); // remembered
});

// ===================================================================== they take effect
test('the longest timer session is enforced from the saved setting', async () => {
  await patch('/system/settings', { maxSessionHours: 4 }, t.sys);
  const taskId = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Long task', 10);
  await sql("INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW() - INTERVAL 6 HOUR, CURDATE())", [taskId, f.pipingA]);
  await get('/dashboard/exceptions', t.pm); // any request runs the sweep
  const [[row]] = await sql('SELECT duration_minutes, auto_stopped FROM time_logs WHERE task_id = ?', [taskId]);
  assert.equal(row.duration_minutes, 240);
  assert.equal(row.auto_stopped, 1);
  await sql('DELETE FROM time_logs');
  await patch('/system/settings', { maxSessionHours: 12 }, t.sys);
});

test('the correction window is enforced from the saved setting', async () => {
  const taskId = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Window task', 10);
  const log = await f.addLog(taskId, f.pipingA, 120, 20);
  await patch('/system/settings', { correctionWindowDays: 14 }, t.sys);
  assert.equal((await app.api('/corrections', { method: 'POST', token: t.a, body: { logId: log, durationMinutes: 60, reason: 'Too old now' } })).status, 400);
  await patch('/system/settings', { correctionWindowDays: 30 }, t.sys);
  assert.equal((await app.api('/corrections', { method: 'POST', token: t.a, body: { logId: log, durationMinutes: 60, reason: 'Now it is fine' } })).status, 201);
});

test('the man-hour thresholds drive project risk', async () => {
  const taskId = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Budget task', 10); // project2: 50h estimate
  await f.addLog(taskId, f.pipingA, 60 * 40, 1); // 40h = 80%
  await patch('/system/settings', { budgetWarnPercent: 80, budgetCriticalPercent: 100 }, t.sys);
  const risk = async () => (await get('/dashboard/projects', t.mgmt)).body.projects.find((p) => p.id === f.project2).risk;
  assert.equal(await risk(), 'AMBER');
  await patch('/system/settings', { budgetWarnPercent: 90 }, t.sys);
  assert.equal(await risk(), 'GREEN');
  await patch('/system/settings', { budgetCriticalPercent: 90, budgetWarnPercent: 70 }, t.sys);
  await patch('/system/settings', { budgetCriticalPercent: 100 }, t.sys);
});

test('the idle sign-out time is sent with the signed-in user', async () => {
  await patch('/system/settings', { sessionTimeoutMinutes: 20 }, t.sys);
  const me = await get('/auth/me', t.a);
  assert.equal(me.body.user.sessionTimeoutMinutes, 20);
  const login = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: 'Passw0rd!' } });
  assert.equal(login.body.user.sessionTimeoutMinutes, 20);
});

// ===================================================================== health
test('health reports the database, background jobs and what is in the system', async () => {
  const res = await get('/system/health', t.sys);
  assert.equal(res.status, 200);
  const h = res.body;
  assert.equal(h.database.ok, true);
  assert.ok(h.database.latencyMs >= 0);
  assert.equal(h.version, '1.0.0');
  assert.ok(h.uptimeSeconds >= 0);
  assert.ok(h.node.startsWith('v'));
  assert.equal(h.counts.activePeople, 12); // everyone but the inactive one
  assert.equal(h.counts.inactivePeople, 1);
  assert.equal(h.counts.activeProjects, 2);
  assert.equal(h.counts.pendingCorrections, 1); // from the window test above
  const roles = Object.fromEntries(h.counts.peopleByRole.map((r) => [r.role, r.count]));
  assert.equal(roles.system_admin, 1);
  assert.equal(roles.team_leader, 2);
  assert.ok(h.counts.peopleByRole.every((r) => r.label));
  assert.ok(['ok', 'degraded'].includes(h.status));
});

test('health counts running timers and failed sign-ins today', async () => {
  const taskId = await f.addTask(f.project1, f.subModelling, f.structA, 'Running', 5);
  const log = await f.addOpenLog(taskId, f.structA);
  await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: 'wrong-password' } });
  const h = (await get('/system/health', t.sys)).body;
  assert.equal(h.counts.runningTimers, 1);
  assert.equal(h.counts.failedLoginsToday, 1);
  await sql('DELETE FROM time_logs WHERE log_id = ?', [log]);
});
