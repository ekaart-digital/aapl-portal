const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

// The monthly summary report (SRS §45): hours by project, department and person.
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const monthly = (month, token) => get(`/reports/monthly?month=${month}`, token);
const sql = (q, p) => f.db.query(q, p);

// A finished session on an exact date.
const logOn = (taskId, employeeId, date, minutes) => sql(
  `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date)
   VALUES (?, ?, ?, ? + INTERVAL ? MINUTE, ?, ?)`,
  [taskId, employeeId, `${date} 09:00:00`, `${date} 09:00:00`, minutes, minutes, date]
);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    tl: await app.login(code(f.tlPiping)),
    head: await app.login(code(f.headPiping)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
  };
  task = {
    a: await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'A task', 50),
    b: await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'B task', 50),
    s: await f.addTask(f.project1, f.subModelling, f.structA, 'S task', 50),
    p2: await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'P2 task', 50),
  };
  await logOn(task.a, f.pipingA, '2025-03-10', 120); // 2h
  await logOn(task.a, f.pipingA, '2025-03-31', 60); // 1h, last day of the month
  await logOn(task.b, f.pipingB, '2025-03-15', 180); // 3h
  await logOn(task.s, f.structA, '2025-03-20', 240); // 4h
  await logOn(task.p2, f.pipingA, '2025-03-05', 30); // 0.5h
  await logOn(task.a, f.pipingA, '2025-04-01', 600); // next month: must not count
  await logOn(task.a, f.pipingA, '2025-02-28', 600); // previous month: must not count
});
after(() => app.close(f));

test('totals the hours of one month by project, department and person', async () => {
  const res = await monthly('2025-03', t.mgmt);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.month, '2025-03');
  assert.equal(res.body.totalHours, 10.5);
  assert.deepEqual(res.body.byProject.map((r) => [r.name, r.jobCode, r.hours]), [['Project One', 'T-001', 10], ['Project Two', 'T-002', 0.5]]);
  assert.deepEqual(res.body.byDepartment.map((r) => [r.name, r.hours]), [['Piping', 6.5], ['Structural', 4]]);
  assert.deepEqual(res.body.byEmployee.map((r) => [r.name, r.hours]), [['Structural A', 4], ['Piping B', 3], ['Piping A', 3.5]].sort((a, b) => b[1] - a[1]));
});

test('the first and last day of the month count, the neighbouring months do not', async () => {
  const march = (await monthly('2025-03', t.mgmt)).body;
  assert.equal(march.byEmployee.find((r) => r.name === 'Piping A').hours, 3.5); // includes the 31st
  assert.equal((await monthly('2025-04', t.mgmt)).body.totalHours, 10);
  assert.equal((await monthly('2025-02', t.mgmt)).body.totalHours, 10);
  assert.equal((await monthly('2024-12', t.mgmt)).body.totalHours, 0);
});

test('counts sessions and tasks worked on', async () => {
  const a = (await monthly('2025-03', t.mgmt)).body.byEmployee.find((r) => r.name === 'Piping A');
  assert.equal(a.sessions, 3);
  assert.equal(a.tasks, 2);
});

test('a running session is not counted', async () => {
  // Started just now (so the stale-timer sweep leaves it alone) but dated inside the month.
  await sql("INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW(), '2025-03-12')", [task.a, f.pipingA]);
  assert.equal((await monthly('2025-03', t.mgmt)).body.totalHours, 10.5);
  await sql('DELETE FROM time_logs WHERE end_time IS NULL');
});

test('each role sees only the work in its scope', async () => {
  const total = async (who) => (await monthly('2025-03', t[who])).body.totalHours;
  assert.equal(await total('mgmt'), 10.5);
  assert.equal(await total('pm'), 10.5); // manages both projects
  assert.equal(await total('head'), 6.5); // Piping tasks only
  assert.equal(await total('tl'), 6.5); // their team's tasks
  assert.equal(await total('pm2'), 0);
  const head = (await monthly('2025-03', t.head)).body;
  assert.deepEqual(head.byDepartment.map((r) => r.name), ['Piping']);
  assert.ok(!head.byEmployee.some((r) => r.name === 'Structural A'));
});

test('access and validation', async () => {
  assert.equal((await monthly('2025-03', t.a)).status, 403);
  assert.equal((await monthly('2025-03', t.hr)).status, 403);
  assert.equal((await app.api('/reports/monthly?month=2025-03')).status, 401);
  for (const bad of ['2025-13', '2025-3', 'March', '2025-03-01', '2025-00']) {
    assert.equal((await monthly(bad, t.mgmt)).status, 400, bad);
  }
});

test('defaults to the current month', async () => {
  const res = await get('/reports/monthly', t.mgmt);
  assert.equal(res.status, 200);
  assert.equal(res.body.month, new Date().toISOString().slice(0, 7));
});
