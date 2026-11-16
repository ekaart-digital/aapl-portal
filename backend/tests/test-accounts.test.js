process.env.ROLLOUT_BATCH = '5';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { seedFixtures, startApp } = require('./helpers');

// Handing the system to a client: everything removed, one test account per role.
let f; let app;
const root = path.join(__dirname, '..');
const run = (args, env) => spawnSync('node', [path.join(root, 'scripts', 'reset-test-accounts.js'), ...args], {
  cwd: root, env: { ...process.env, ...env }, encoding: 'utf8',
});
const rows = async (sql) => (await f.db.query(sql))[0];

before(async () => {
  f = await seedFixtures(); // people, two departments, projects and tasks
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Some task');
  await f.addLog(task, f.pipingA, 60);
  await f.db.query("INSERT INTO notifications (recipient_id, type, title) VALUES (?, 'x', 'hello')", [f.pipingA]);
  app = await startApp();
});
after(() => app.close(f));

test('refuses without --yes or without a password, and removes nothing', async () => {
  assert.match(run([], { TEST_PASSWORD: 'Password@123' }).stderr, /--yes/);
  assert.match(run(['--yes'], { TEST_PASSWORD: '' }).stderr, /TEST_PASSWORD/);
  assert.match(run(['--yes'], { TEST_PASSWORD: 'short' }).stderr, /at least 8/);
  assert.ok(Number((await rows('SELECT COUNT(*) AS c FROM projects'))[0].c) > 0);
});

test('leaves exactly one account per role, numbered from EMP-001, with the shared password', async () => {
  const result = run(['--yes'], { TEST_PASSWORD: 'Password@123' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM audit_log'))[0].c), 0, 'the old audit trail is gone');

  const people = await rows('SELECT employee_id, name, role FROM employees ORDER BY employee_id');
  assert.deepEqual(people.map((p) => p.employee_id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(people.map((p) => p.name), [
    'testsystemadministrator', 'testhradmin', 'testmanagement', 'testprojectmanager', 'testdepartmenthead', 'testteamleader', 'testemployee',
  ]);
  assert.equal(new Set(people.map((p) => p.role)).size, 7);

  for (const p of people) {
    const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: `EMP-00${p.employee_id}`, password: 'Password@123' } });
    assert.equal(res.status, 200, `${p.name}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.user.role, p.role);
  }
  assert.equal((await app.api('/auth/login', { method: 'POST', body: { employeeId: 'EMP-001', password: 'Passw0rd!' } })).status, 401, 'old passwords are gone');
});

test('removes the earlier work, keeps departments and sub-disciplines, and sets up one team', async () => {
  for (const table of ['projects', 'tasks', 'time_logs', 'notifications', 'correction_requests']) {
    assert.equal(Number((await rows(`SELECT COUNT(*) AS c FROM ${table}`))[0].c), 0, table);
  }
  assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM departments'))[0].c), 2);
  assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM sub_departments'))[0].c), 3);

  const [team] = await rows('SELECT name, leader_id FROM teams');
  assert.equal(team.name, 'Test Team');
  assert.equal(team.leader_id, 6);
  assert.equal((await rows('SELECT head_id FROM departments ORDER BY department_id LIMIT 1'))[0].head_id, 5);
  assert.deepEqual((await rows('SELECT employee_id FROM employees WHERE team_id IS NOT NULL ORDER BY employee_id')).map((r) => r.employee_id), [6, 7]);
});

// ===================================================================== sample projects
const samples = () => spawnSync('node', [path.join(root, 'scripts', 'seed-demo.js'), 'samples'], { cwd: root, env: { ...process.env }, encoding: 'utf8' });

test('sample projects: tasks for the test employee and team leader, owned by the test project manager', async () => {
  const result = samples();
  assert.equal(result.status, 0, result.stderr);

  const projects = await rows(`
    SELECT p.name, p.status, p.project_manager_id AS pm, p.team_leader_id AS tl, p.estimated_man_hours AS estimate,
           COALESCE(SUM(tl2.duration_minutes), 0) / 60 AS hours
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.project_id LEFT JOIN time_logs tl2 ON tl2.task_id = t.task_id
     GROUP BY p.project_id`);
  assert.equal(projects.length, 5);
  assert.ok(projects.every((p) => p.pm === 4), 'owned by testprojectmanager');
  assert.equal(projects.filter((p) => p.tl === 6).length, 1, 'one project names the test team leader');
  const used = Object.fromEntries(projects.map((p) => [p.name, (Number(p.hours) / Number(p.estimate)) * 100]));
  assert.ok(used['Saria Refinery Expansion'] > 20 && used['Saria Refinery Expansion'] < 80);
  assert.ok(used['Al Reem Hospital'] >= 80 && used['Al Reem Hospital'] < 100, 'nearing its estimate');
  assert.ok(used['Marbella Coastal Residences'] >= 100, 'over its estimate');
  assert.equal(used['Duqm Port Pipeline'], 0);

  const holders = (await rows('SELECT DISTINCT employee_id AS id FROM tasks ORDER BY employee_id')).map((r) => r.id);
  assert.deepEqual(holders, [6, 7]);
  assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM time_logs WHERE end_time IS NULL'))[0].c), 0);
  assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM time_logs WHERE auto_stopped = 1'))[0].c), 1);
  const types = (await rows('SELECT DISTINCT type FROM notifications')).map((r) => r.type);
  for (const wanted of ['budget-warning', 'budget-exceeded', 'task-assigned', 'session-needs-review']) assert.ok(types.includes(wanted), wanted);
});

test('the test accounts see the samples through the real screens', async () => {
  const pm = await app.login('EMP-004', 'Password@123');
  assert.equal((await app.api('/projects', { token: pm })).body.projects.length, 5);

  const employee = await app.login('EMP-007', 'Password@123');
  const mine = (await app.api('/tasks/mine', { token: employee })).body.tasks;
  assert.ok(mine.length >= 4);

  for (const [id, path] of [['EMP-003', '/dashboard'], ['EMP-005', '/dashboard/projects'], ['EMP-006', '/dashboard/exceptions'], ['EMP-003', '/reports/summary']]) {
    const res = await app.api(path, { token: await app.login(id, 'Password@123') });
    assert.equal(res.status, 200, `${id} ${path}: ${JSON.stringify(res.body)}`);
  }
});

test('sample projects are only added once', () => {
  const again = samples();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /There are projects already/);
});
