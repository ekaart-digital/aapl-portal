const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const byId = (rows, id) => rows.find((r) => r.employeeId === id);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));

  // project1: Piping A 90 min + 30 min (recent), Structural A 60 min (old)
  const a1 = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'A on P1');
  const a2 = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'A on P2');
  const s1 = await f.addTask(f.project1, f.subModelling, f.structA, 'S on P1');
  await f.addLog(a1, f.pipingA, 90, 1);
  await f.addLog(a1, f.pipingA, 30, 2);
  await f.addLog(a2, f.pipingA, 60, 40);
  await f.addLog(s1, f.structA, 60, 40);
  await f.addOpenLog(s1, f.structA); // running session: must count as 0
  // Piping B has a task but no sessions; inactive person has no tasks
  await f.addTask(f.project2, f.subAnalysis, f.pipingB, 'B on P2');
});
after(() => app.close(f));

test('project report: totals per project and department list', async () => {
  const res = await app.api('/reports/projects', { token: mgr });
  assert.equal(res.status, 200);

  const p1 = res.body.projects.find((p) => p.id === f.project1);
  assert.equal(p1.completedManHours, 3); // (90 + 30 + 60) / 60, open session adds nothing
  assert.equal(p1.taskCount, 2);
  assert.deepEqual([...p1.departments].sort(), ['Piping', 'Structural']);

  const p2 = res.body.projects.find((p) => p.id === f.project2);
  assert.equal(p2.completedManHours, 1);
  assert.equal(p2.taskCount, 2);
  assert.deepEqual(p2.departments, ['Piping']);
});

test('employee report: only employees with tasks, sorted by hours', async () => {
  const res = await app.api('/reports/employee-work-time', { token: mgr });
  const ids = res.body.employees.map((e) => e.employeeId);
  assert.ok(ids.includes(f.pipingA) && ids.includes(f.structA) && ids.includes(f.pipingB));
  assert.ok(!ids.includes(f.inactive), 'no tasks, so not listed');
  assert.ok(!ids.includes(f.manager1), 'managers are not listed');

  const hours = res.body.employees.map((e) => e.totalHours);
  assert.deepEqual(hours, [...hours].sort((x, y) => y - x));

  const a = byId(res.body.employees, f.pipingA);
  assert.equal(a.totalHours, 3); // 90 + 30 + 60 min
  assert.equal(a.taskCount, 2);
  assert.equal(a.sessionCount, 3);

  const b = byId(res.body.employees, f.pipingB);
  assert.equal(b.totalHours, 0);
  assert.equal(b.sessionCount, 0);

  const s = byId(res.body.employees, f.structA);
  assert.equal(s.totalHours, 1);
  assert.equal(s.sessionCount, 1, 'the open session is not counted as a logged session total');
});

test('employee report: date range filter', async () => {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const daysAgo = (n) => fmt(new Date(Date.now() - n * 86400000));

  const recent = await app.api(`/reports/employee-work-time?from=${daysAgo(5)}`, { token: mgr });
  assert.equal(byId(recent.body.employees, f.pipingA).totalHours, 2); // only the 90 + 30 min sessions
  assert.equal(byId(recent.body.employees, f.structA).totalHours, 0);

  const old = await app.api(`/reports/employee-work-time?to=${daysAgo(30)}`, { token: mgr });
  assert.equal(byId(old.body.employees, f.pipingA).totalHours, 1);
  assert.equal(byId(old.body.employees, f.structA).totalHours, 1);

  const window = await app.api(`/reports/employee-work-time?from=${daysAgo(3)}&to=${daysAgo(1)}`, { token: mgr });
  assert.equal(byId(window.body.employees, f.pipingA).totalHours, 2);
});

test('employee report: project filter only counts that project’s tasks and sessions', async () => {
  const res = await app.api(`/reports/employee-work-time?projectId=${f.project2}`, { token: mgr });
  const ids = res.body.employees.map((e) => e.employeeId);
  assert.ok(!ids.includes(f.structA), 'structural employee has no task on project 2');
  const a = byId(res.body.employees, f.pipingA);
  assert.equal(a.taskCount, 1);
  assert.equal(a.totalHours, 1);
});

test('employee report: department filter', async () => {
  const res = await app.api(`/reports/employee-work-time?departmentId=${f.structural}`, { token: mgr });
  assert.deepEqual(res.body.employees.map((e) => e.employeeId), [f.structA]);
});

test('employee report: filters combine', async () => {
  const res = await app.api(`/reports/employee-work-time?departmentId=${f.piping}&projectId=${f.project1}`, { token: mgr });
  assert.deepEqual(res.body.employees.map((e) => e.employeeId), [f.pipingA]);
  assert.equal(res.body.employees[0].totalHours, 2);
});

test('employee report: malformed dates are rejected', async () => {
  for (const q of ['from=yesterday', 'to=2026-13', 'from=2026-1-1', "from=2026-01-01' OR 1=1"]) {
    const res = await app.api(`/reports/employee-work-time?${q}`, { token: mgr });
    assert.equal(res.status, 400, q);
  }
});

test('employee report: non-numeric ids are a 400, never SQL', async () => {
  for (const q of ['projectId=1 OR 1=1', 'departmentId=abc', "projectId=1; DROP TABLE employees"]) {
    const res = await app.api(`/reports/employee-work-time?${encodeURIComponent(q).replace('%3D', '=')}`, { token: mgr });
    assert.equal(res.status, 400, q);
  }
  const tables = await f.db.query('SELECT COUNT(*) AS n FROM employees');
  assert.ok(tables[0][0].n >= 6);
});
