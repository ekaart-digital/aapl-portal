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
