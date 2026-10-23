const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let pipingA; let structA; let ownTask; let otherTask;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  pipingA = await app.login(code(f.pipingA));
  structA = await app.login(code(f.structA));
  // pipingA works on project2 only; structA works on project1 only
  ownTask = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'A on project 2');
  otherTask = await f.addTask(f.project1, f.subModelling, f.structA, 'S on project 1');
});
after(() => app.close(f));

test('an employee can open a project they have a task in, with its task list', async () => {
  assert.equal((await app.api(`/projects/${f.project2}`, { token: pipingA })).status, 200);
  const tasks = await app.api(`/projects/${f.project2}/tasks`, { token: pipingA });
  assert.equal(tasks.status, 200);
  assert.equal(tasks.body.tasks.length, 1);
});

test('an employee cannot open a project or task list they are not part of', async () => {
  assert.equal((await app.api(`/projects/${f.project1}`, { token: pipingA })).status, 403);
  assert.equal((await app.api(`/projects/${f.project1}/tasks`, { token: pipingA })).status, 403);
  assert.equal((await app.api(`/projects/${f.project2}`, { token: structA })).status, 403);
  assert.equal((await app.api(`/projects/${f.project2}/tasks`, { token: structA })).status, 403);
});

test('an employee can read only their own task by ID', async () => {
  assert.equal((await app.api(`/tasks/${ownTask}`, { token: pipingA })).status, 200);
  assert.equal((await app.api(`/tasks/${otherTask}`, { token: pipingA })).status, 403);
});

test('a manager can open any project, task list and task', async () => {
  assert.equal((await app.api(`/projects/${f.project1}`, { token: mgr })).status, 200);
  assert.equal((await app.api(`/projects/${f.project2}/tasks`, { token: mgr })).status, 200);
  assert.equal((await app.api(`/tasks/${otherTask}`, { token: mgr })).status, 200);
});

test('unknown project is 404 for a manager', async () => {
  assert.equal((await app.api('/projects/99999', { token: mgr })).status, 404);
  assert.equal((await app.api('/projects/99999/tasks', { token: mgr })).status, 404);
});
