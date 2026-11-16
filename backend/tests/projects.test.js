const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let pipingA; let structA;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const valid = (over = {}) => ({
  name: 'New Project', jobCode: 'T-100', clientName: 'Client', estimatedManHours: 200,
  departmentIds: [f.piping], projectManagerId: f.manager1, ...over,
});

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  pipingA = await app.login(code(f.pipingA));
  structA = await app.login(code(f.structA));
});
after(() => app.close(f));

test('create project: required fields', async () => {
  const cases = [
    [valid({ name: undefined }), 'name'],
    [valid({ jobCode: undefined }), 'jobCode'],
    [valid({ clientName: undefined }), 'clientName'],
    [valid({ estimatedManHours: undefined }), 'estimatedManHours'],
    [valid({ departmentIds: [] }), 'empty departments'],
    [valid({ departmentIds: 'piping' }), 'departments not an array'],
    [valid({ departmentIds: [99999] }), 'unknown department'],
    [valid({ departmentIds: [null] }), 'department is not an ID'],
    [valid({ departmentIds: ['x'] }), 'department is not a number'],
  ];
  for (const [body, label] of cases) {
    const res = await app.api('/projects', { method: 'POST', token: mgr, body });
    assert.equal(res.status, 400, label);
  }
});

test('create project: project manager must be an existing manager', async () => {
  const notManager = await app.api('/projects', { method: 'POST', token: mgr, body: valid({ jobCode: 'T-101', projectManagerId: f.pipingA }) });
  assert.equal(notManager.status, 400);
  const missing = await app.api('/projects', { method: 'POST', token: mgr, body: valid({ jobCode: 'T-102', projectManagerId: 99999 }) });
  assert.equal(missing.status, 400);
});

test('create project: starts in Planning, defaults PM to the creator, links departments', async () => {
  const res = await app.api('/projects', {
    method: 'POST', token: mgr,
    body: valid({ jobCode: 'T-103', projectManagerId: undefined, departmentIds: [f.piping, f.structural] }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.project.status, 'Planning');
  assert.equal(res.body.project.projectManagerId, f.manager1);
  assert.equal(res.body.project.completedManHours, 0);

  const detail = await app.api(`/projects/${res.body.project.id}`, { token: mgr });
  assert.deepEqual(detail.body.project.departments.map((d) => d.name).sort(), ['Piping', 'Structural']);
});

test('create project: duplicate job code is 409', async () => {
  const res = await app.api('/projects', { method: 'POST', token: mgr, body: valid({ jobCode: 'T-001' }) });
  assert.equal(res.status, 409);
});

test('project list: manager sees all, employee only projects they have a task in', async () => {
  const taskId = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Scoped task');
  assert.ok(taskId);

  const all = await app.api('/projects', { token: mgr });
  assert.ok(all.body.projects.length >= 3);

  const mine = await app.api('/projects', { token: pipingA });
  assert.deepEqual(mine.body.projects.map((p) => p.id), [f.project2]);

  const none = await app.api('/projects', { token: structA });
  assert.deepEqual(none.body.projects, []);
});

test('completedManHours is the sum of all sessions across the project’s tasks', async () => {
  const t1 = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Sum A');
  const t2 = await f.addTask(f.project1, f.subModelling, f.structA, 'Sum B');
  await f.addLog(t1, f.pipingA, 90);
  await f.addLog(t1, f.pipingA, 30);
  await f.addLog(t2, f.structA, 60);

  const res = await app.api(`/projects/${f.project1}`, { token: mgr });
  assert.equal(res.body.project.completedManHours, 3);
  assert.equal(res.body.project.estimatedManHours, 100);
  assert.equal(res.body.project.taskCount, 2);
});

test('a running session adds nothing to project hours until it is stopped', async () => {
  const t = await f.addTask(f.project2, f.subAnalysis, f.pipingB, 'Open session task');
  const before = (await app.api(`/projects/${f.project2}`, { token: mgr })).body.project.completedManHours;
  await f.addOpenLog(t, f.pipingB);
  const after = (await app.api(`/projects/${f.project2}`, { token: mgr })).body.project.completedManHours;
  assert.equal(after, before);
});

test('get project: 404 for unknown ID, whoever asks', async () => {
  assert.equal((await app.api('/projects/99999', { token: mgr })).status, 404);
  assert.equal((await app.api('/projects/99999/tasks', { token: mgr })).status, 404);
  assert.equal((await app.api('/projects/99999', { token: pipingA })).status, 404);
});

test('update project: validation', async () => {
  const bad = (body) => app.api(`/projects/${f.project1}`, { method: 'PATCH', token: mgr, body });
  assert.equal((await bad({ status: 'Finished' })).status, 400);
  assert.equal((await bad({ priority: 'Urgent' })).status, 400);
  assert.equal((await bad({ estimatedManHours: -5 })).status, 400);
  assert.equal((await bad({ estimatedManHours: 'abc' })).status, 400);
  assert.equal((await app.api('/projects/99999', { method: 'PATCH', token: mgr, body: { name: 'x' } })).status, 404);
});

test('update project: changes only the fields sent', async () => {
  const res = await app.api(`/projects/${f.project2}`, {
    method: 'PATCH', token: mgr, body: { priority: 'Critical', estimatedManHours: 75, status: 'On Hold' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.project.priority, 'Critical');
  assert.equal(res.body.project.estimatedManHours, 75);
  assert.equal(res.body.project.status, 'On Hold');
  assert.equal(res.body.project.name, 'Project Two');
  assert.equal(res.body.project.clientName, 'Test Client');
});
