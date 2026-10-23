const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let pipingA; let pipingB;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const assign = (projectId, body, token = mgr) => app.api(`/projects/${projectId}/tasks`, { method: 'POST', token, body });
const valid = (over = {}) => ({
  subDepartmentId: f.subInputStudy, taskName: 'Review input', employeeId: f.pipingA, allocatedHours: 20, ...over,
});

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  pipingA = await app.login(code(f.pipingA));
  pipingB = await app.login(code(f.pipingB));
});
after(() => app.close(f));

test('assign task: required fields', async () => {
  for (const key of ['subDepartmentId', 'taskName', 'employeeId', 'allocatedHours']) {
    const res = await assign(f.project1, valid({ [key]: undefined }));
    assert.equal(res.status, 400, `missing ${key}`);
  }
});

test('assign task: unknown project is 404', async () => {
  assert.equal((await assign(99999, valid())).status, 404);
});

test('assign task: sub-department must belong to one of the project’s departments', async () => {
  // project2 is Piping only, Modelling belongs to Structural
  const res = await assign(f.project2, valid({ subDepartmentId: f.subModelling, employeeId: f.structA }));
  assert.equal(res.status, 400);
});

test('assign task: employee must belong to the task’s department', async () => {
  const res = await assign(f.project1, valid({ subDepartmentId: f.subInputStudy, employeeId: f.structA }));
  assert.equal(res.status, 400);
});

test('assign task: a manager cannot be assigned work', async () => {
  const res = await assign(f.project1, valid({ employeeId: f.manager2 }));
  assert.equal(res.status, 400);
});

test('assign task: an inactive employee cannot be assigned work', async () => {
  const res = await assign(f.project1, valid({ employeeId: f.inactive }));
  assert.equal(res.status, 400);
});

test('assign task: rejects non-positive hours', async () => {
  assert.equal((await assign(f.project1, valid({ allocatedHours: -4 }))).status, 400);
  assert.equal((await assign(f.project1, valid({ allocatedHours: 'abc' }))).status, 400);
});

test('assign task: success starts Not Started with 0 completed hours', async () => {
  const res = await assign(f.project1, valid({ dueDate: '2030-01-31', remarks: 'first' }));
  assert.equal(res.status, 201);
  const t = res.body.task;
  assert.equal(t.status, 'Not Started');
  assert.equal(t.completedHours, 0);
  assert.equal(t.allocatedHours, 20);
  assert.equal(t.departmentName, 'Piping');
  assert.equal(t.subDepartmentName, 'Input Study');
  assert.equal(t.employeeName, 'Piping A');
  assert.equal(t.dueDate, '2030-01-31');
  assert.equal(t.remarks, 'first');
});

test('task lists: project tasks, and an employee’s own tasks only', async () => {
  await assign(f.project1, valid({ taskName: 'For B', employeeId: f.pipingB }));

  // A project manager sees every task on the project; an employee only their own.
  const everything = await app.api(`/projects/${f.project1}/tasks`, { token: mgr });
  assert.ok(everything.body.tasks.length >= 2);
  const projectTasks = await app.api(`/projects/${f.project1}/tasks`, { token: pipingA });
  assert.ok(projectTasks.body.tasks.length >= 1);
  assert.ok(projectTasks.body.tasks.every((t) => t.employeeId === f.pipingA), 'work of colleagues is not shown');

  const mineA = await app.api('/tasks/mine', { token: pipingA });
  assert.ok(mineA.body.tasks.length >= 1);
  assert.ok(mineA.body.tasks.every((t) => t.employeeId === f.pipingA));

  const mineB = await app.api('/tasks/mine', { token: pipingB });
  assert.ok(mineB.body.tasks.every((t) => t.employeeId === f.pipingB));
});

test('task hours are derived from sessions', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Derived hours', 8);
  await f.addLog(id, f.pipingA, 45);
  await f.addLog(id, f.pipingA, 45);
  const res = await app.api(`/tasks/${id}`, { token: pipingA });
  assert.equal(res.body.task.completedHours, 1.5);
});

test('update task: employee can change status and remarks on their own task', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Own task');
  const res = await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingA, body: { status: 'On Hold', remarks: 'Waiting for client' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.status, 'On Hold');
  assert.equal(res.body.task.remarks, 'Waiting for client');
});

test('update task: remarks can be cleared with an empty string', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Clear remarks');
  await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingA, body: { remarks: 'temp' } });
  const res = await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingA, body: { remarks: '' } });
  assert.equal(res.body.task.remarks, '');
});

test('update task: an employee cannot change another employee’s task', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Not yours');
  const res = await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingB, body: { status: 'Completed' } });
  assert.equal(res.status, 403);
});

test('update task: employee edits to hours, name and due date are ignored', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Locked fields', 10);
  const res = await app.api(`/tasks/${id}`, {
    method: 'PATCH', token: pipingA,
    body: { allocatedHours: 999, taskName: 'Renamed', dueDate: '2031-01-01', status: 'In Progress' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.allocatedHours, 10);
  assert.equal(res.body.task.taskName, 'Locked fields');
  assert.equal(res.body.task.dueDate, null);
  assert.equal(res.body.task.status, 'In Progress');
});

test('update task: a manager can change name, hours, due date, status', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Manager edits', 10);
  const res = await app.api(`/tasks/${id}`, {
    method: 'PATCH', token: mgr,
    body: { taskName: 'Renamed', allocatedHours: 25, dueDate: '2031-02-02', status: 'Completed' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.task.taskName, 'Renamed');
  assert.equal(res.body.task.allocatedHours, 25);
  assert.equal(res.body.task.dueDate, '2031-02-02');
  assert.equal(res.body.task.status, 'Completed');
});

test('update task: invalid status, non-positive hours and unknown task', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Validation');
  assert.equal((await app.api(`/tasks/${id}`, { method: 'PATCH', token: mgr, body: { status: 'Done' } })).status, 400);
  assert.equal((await app.api(`/tasks/${id}`, { method: 'PATCH', token: mgr, body: { allocatedHours: -1 } })).status, 400);
  assert.equal((await app.api('/tasks/99999', { method: 'PATCH', token: mgr, body: { status: 'Completed' } })).status, 404);
  assert.equal((await app.api('/tasks/99999', { token: mgr })).status, 404);
});

test('update task: status cannot be changed while its timer is running', async () => {
  const id = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Running');
  await f.addOpenLog(id, f.pipingA);
  const blocked = await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingA, body: { status: 'Completed' } });
  assert.equal(blocked.status, 409);
  const remarksOnly = await app.api(`/tasks/${id}`, { method: 'PATCH', token: pipingA, body: { remarks: 'still fine' } });
  assert.equal(remarksOnly.status, 200);
  await f.db.query('UPDATE time_logs SET end_time = NOW(), duration_minutes = 1 WHERE task_id = ?', [id]);
});
