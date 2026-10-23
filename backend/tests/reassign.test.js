const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let mgr2; let pipingA; let pipingB;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const patchTask = (id, body, token = mgr) => app.api(`/tasks/${id}`, { method: 'PATCH', token, body });
const patchProject = (id, body, token = mgr) => app.api(`/projects/${id}`, { method: 'PATCH', token, body });
const getTask = async (id) => (await app.api(`/tasks/${id}`, { token: mgr })).body.task;
const getProject = async (id) => (await app.api(`/projects/${id}`, { token: mgr })).body.project;
const deptNames = (project) => project.departments.map((d) => d.name).sort();

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  mgr2 = await app.login(code(f.manager2));
  pipingA = await app.login(code(f.pipingA));
  pipingB = await app.login(code(f.pipingB));
});
after(() => app.close(f));

// ------------------------------------------------------------ reassign a task

test('reassign: a manager can move a task to another employee of the same department', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Move me', 20, 'In Progress');
  const res = await patchTask(id, { employeeId: f.pipingB });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.employeeId, f.pipingB);
  assert.equal(res.body.task.employeeName, 'Piping B');
  assert.equal(res.body.task.status, 'In Progress', 'status is not reset');

  const mineA = await app.api('/tasks/mine', { token: pipingA });
  const mineB = await app.api('/tasks/mine', { token: pipingB });
  assert.ok(!mineA.body.tasks.some((t) => t.id === id));
  assert.ok(mineB.body.tasks.some((t) => t.id === id));
});

test('reassign: can be combined with other edits in one request', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Combined', 10);
  const res = await patchTask(id, { employeeId: f.pipingB, allocatedHours: 40, taskName: 'Combined (renamed)' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.employeeId, f.pipingB);
  assert.equal(res.body.task.allocatedHours, 40);
  assert.equal(res.body.task.taskName, 'Combined (renamed)');
});

test('reassign: naming the current assignee changes nothing', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Same person');
  const res = await patchTask(id, { employeeId: f.pipingA, remarks: 'still mine' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.employeeId, f.pipingA);
  assert.equal(res.body.task.remarks, 'still mine');
});

test('reassign: only a manager can do it, even the task’s own employee', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Not for employees');
  const res = await patchTask(id, { employeeId: f.pipingB }, pipingA);
  assert.equal(res.status, 403);
  assert.equal((await getTask(id)).employeeId, f.pipingA);
});

test('reassign: the new assignee must be an active employee of the same department', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Validate target');
  const cases = [
    [f.structA, 'other department'],
    [f.manager2, 'a manager'],
    [f.inactive, 'inactive employee'],
    [99999, 'unknown employee'],
    ['abc', 'not a number'],
  ];
  for (const [employeeId, label] of cases) {
    const res = await patchTask(id, { employeeId });
    assert.equal(res.status, 400, label);
  }
  assert.equal((await getTask(id)).employeeId, f.pipingA, 'nothing changed');
});

test('reassign: refused while the current assignee has a timer running on it', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Running now');
  const log = await f.addOpenLog(id, f.pipingA);

  const res = await patchTask(id, { employeeId: f.pipingB });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /running timer/i);
  assert.equal((await getTask(id)).employeeId, f.pipingA);

  await f.db.query('UPDATE time_logs SET end_time = NOW(), duration_minutes = 5 WHERE log_id = ?', [log]);
  assert.equal((await patchTask(id, { employeeId: f.pipingB })).status, 200, 'works once it is stopped');
});

test('reassign: a forgotten (stale) timer does not block it', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Forgotten timer');
  const log = await f.addOpenLog(id, f.pipingA);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 20 HOUR WHERE log_id = ?', [log]);

  assert.equal((await patchTask(id, { employeeId: f.pipingB })).status, 200);
  const closed = (await f.db.query('SELECT * FROM time_logs WHERE log_id = ?', [log]))[0][0];
  assert.equal(closed.auto_stopped, 1);
  assert.equal(closed.duration_minutes, 720);
});

test('reassign: the old assignee loses access, the new one gains it', async () => {
  const id = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Access moves');
  await patchTask(id, { employeeId: f.pipingB });

  assert.equal((await app.api(`/tasks/${id}`, { token: pipingA })).status, 403);
  assert.equal((await app.api(`/tasks/${id}/time-logs/start`, { method: 'POST', token: pipingA })).status, 403);
  assert.equal((await patchTask(id, { status: 'Completed' }, pipingA)).status, 403);

  const start = await app.api(`/tasks/${id}/time-logs/start`, { method: 'POST', token: pipingB });
  assert.equal(start.status, 201);
  await app.api(`/tasks/${id}/time-logs/${start.body.timeLog.id}/stop`, { method: 'POST', token: pipingB });
});

test('reassign: hours already logged stay on the task and with whoever logged them', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'History stays', 20);
  await f.addLog(id, f.pipingA, 120);
  await patchTask(id, { employeeId: f.pipingB });
  await f.addLog(id, f.pipingB, 60);

  assert.equal((await getTask(id)).completedHours, 3, 'task total includes both people’s time');

  const history = await app.api(`/tasks/${id}/time-logs`, { token: mgr });
  assert.deepEqual(history.body.timeLogs.map((l) => l.employeeId).sort(), [f.pipingA, f.pipingB].sort());
});

test('employee report: a previous assignee keeps credit for the hours they logged', async () => {
  const id = await f.addTask(f.project2, f.subAnalysis, f.pipingA, 'Credit stays', 10);
  await f.addLog(id, f.pipingA, 90);
  const before = (await app.api('/reports/employee-work-time', { token: mgr })).body.employees.find((e) => e.employeeId === f.pipingA);

  await patchTask(id, { employeeId: f.pipingB });
  const afterRes = await app.api('/reports/employee-work-time', { token: mgr });
  const a = afterRes.body.employees.find((e) => e.employeeId === f.pipingA);
  assert.equal(a.totalHours, before.totalHours, 'hours do not move to the new assignee');
  assert.equal(a.taskCount, before.taskCount - 1, 'but the task count does');
});

test('employee report: someone with hours but no current tasks still appears', async () => {
  const solo = await f.addTask(f.project2, f.subAnalysis, f.pipingB, 'Only task', 10);
  await f.addLog(solo, f.pipingB, 30);
  await f.db.query('UPDATE tasks SET employee_id = ? WHERE task_id = ?', [f.pipingA, solo]);

  const res = await app.api('/reports/employee-work-time', { token: mgr });
  const b = res.body.employees.find((e) => e.employeeId === f.pipingB);
  assert.ok(b, 'listed because of logged time');
  assert.ok(b.totalHours >= 0.5);
});

// --------------------------------------------------------- project departments

test('departments: adding one makes its sub-departments assignable', async () => {
  const blocked = await app.api(`/projects/${f.project2}/tasks`, {
    method: 'POST', token: mgr,
    body: { subDepartmentId: f.subModelling, taskName: 'Before', employeeId: f.structA, allocatedHours: 5 },
  });
  assert.equal(blocked.status, 400, 'Structural is not on project 2 yet');

  const res = await patchProject(f.project2, { departmentIds: [f.piping, f.structural] });
  assert.equal(res.status, 200);
  assert.deepEqual(deptNames(res.body.project), ['Piping', 'Structural']);

  const ok = await app.api(`/projects/${f.project2}/tasks`, {
    method: 'POST', token: mgr,
    body: { subDepartmentId: f.subModelling, taskName: 'After', employeeId: f.structA, allocatedHours: 5 },
  });
  assert.equal(ok.status, 201);
});

test('departments: one with no tasks can be removed, and the response lists the new set', async () => {
  const project = await app.api('/projects', {
    method: 'POST', token: mgr,
    body: { name: 'Dept edits', jobCode: 'T-DEPT', clientName: 'C', estimatedManHours: 10, departmentIds: [f.piping, f.structural] },
  });
  const id = project.body.project.id;
  const res = await patchProject(id, { departmentIds: [f.piping] });
  assert.equal(res.status, 200);
  assert.deepEqual(deptNames(res.body.project), ['Piping']);
  assert.deepEqual(deptNames(await getProject(id)), ['Piping']);
});

test('departments: one that already has tasks cannot be removed', async () => {
  const project = await app.api('/projects', {
    method: 'POST', token: mgr,
    body: { name: 'Locked dept', jobCode: 'T-LOCK', clientName: 'C', estimatedManHours: 10, departmentIds: [f.piping, f.structural] },
  });
  const id = project.body.project.id;
  await f.addTask(id, f.subModelling, f.structA, 'Structural work');

  const res = await patchProject(id, { departmentIds: [f.piping], name: 'Should not apply' });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /Structural/);
  const now = await getProject(id);
  assert.deepEqual(deptNames(now), ['Piping', 'Structural'], 'unchanged');
  assert.equal(now.name, 'Locked dept', 'other fields were not applied either');
});

test('departments: invalid lists are rejected without changing anything', async () => {
  const before = deptNames(await getProject(f.project1));
  for (const [body, label] of [
    [{ departmentIds: [] }, 'empty list'],
    [{ departmentIds: 'Piping' }, 'not a list'],
    [{ departmentIds: ['x'] }, 'non-numeric'],
    [{ departmentIds: [0] }, 'zero'],
    [{ departmentIds: [f.piping, 99999] }, 'unknown department'],
    [{ departmentIds: null }, 'null'],
  ]) {
    const res = await patchProject(f.project1, body);
    assert.equal(res.status, 400, label);
  }
  assert.deepEqual(deptNames(await getProject(f.project1)), before);
});

test('departments: duplicates are ignored and omitting the field leaves them alone', async () => {
  const dupes = await patchProject(f.project1, { departmentIds: [f.piping, f.piping, f.structural] });
  assert.equal(dupes.status, 200);
  assert.deepEqual(deptNames(dupes.body.project), ['Piping', 'Structural']);

  const untouched = await patchProject(f.project1, { priority: 'High' });
  assert.deepEqual(deptNames(untouched.body.project), ['Piping', 'Structural']);
});

test('departments: only managers can change them', async () => {
  const res = await patchProject(f.project1, { departmentIds: [f.piping] }, pipingA);
  assert.equal(res.status, 403);
});

// ------------------------------------------------------------- project manager

test('project manager: can be changed to another active manager', async () => {
  const res = await patchProject(f.project1, { projectManagerId: f.manager2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.projectManagerId, f.manager2);
  assert.equal(res.body.project.projectManagerName, 'Manager Two');
  // Manager One no longer manages it and can no longer change it; Manager Two hands it back.
  assert.equal((await patchProject(f.project1, { priority: 'Low' })).status, 403);
  assert.equal((await patchProject(f.project1, { projectManagerId: f.manager1 }, mgr2)).status, 200);
});

test('project manager: must be an active manager', async () => {
  for (const [projectManagerId, label] of [[f.pipingA, 'an employee'], [99999, 'unknown'], [f.inactive, 'inactive employee']]) {
    assert.equal((await patchProject(f.project1, { projectManagerId })).status, 400, label);
  }
  await f.db.query("UPDATE employees SET status = 'inactive' WHERE employee_id = ?", [f.manager2]);
  assert.equal((await patchProject(f.project1, { projectManagerId: f.manager2 })).status, 400, 'inactive manager');
  await f.db.query("UPDATE employees SET status = 'active' WHERE employee_id = ?", [f.manager2]);
  assert.equal((await getProject(f.project1)).projectManagerId, f.manager1);
});

test('project update response includes the department list', async () => {
  const res = await patchProject(f.project1, { priority: 'Low' });
  assert.ok(Array.isArray(res.body.project.departments));
  assert.ok(res.body.project.departments.length >= 1);
});
