process.env.ROLLOUT_BATCH = '1'; // the demo is shown with Batch 1 only

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { resetDatabase, startApp } = require('./helpers');

let db; let app; let password; let accounts;
const root = path.join(__dirname, '..');
const run = (...args) => spawnSync('node', [path.join(root, 'scripts', 'seed-demo.js'), ...args], {
  cwd: root, env: { ...process.env }, encoding: 'utf8',
});
const rows = async (sql, params) => (await db.query(sql, params))[0];

before(async () => {
  db = await resetDatabase();
  await db.query(
    "INSERT INTO employees (name, email, password_hash, role, status) VALUES ('Admin', 'admin@example.com', ?, 'system_admin', 'active')",
    [await bcrypt.hash('Admin!Pass123', 4)]
  );
  app = await startApp();
});
after(() => app.close({ db }));

test('loads into a database that has only the administrator, and prints how to sign in', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  password = result.stdout.match(/Password:\s*(\S+)/)[1];
  assert.match(password, /^[A-Za-z0-9]{14}$/);
  accounts = [...result.stdout.matchAll(/(EMP-\d+)\s+(HR \/ Admin|Project Manager|Employee)\s+(.+)/g)].map((m) => ({ id: m[1], role: m[2], name: m[3].trim() }));
  assert.equal(accounts.length, 24); // 1 HR, 3 project managers, 20 employees
});

test('uses only the roles Batch 1 opens, and every one of them can sign in', async () => {
  assert.deepEqual(
    (await rows("SELECT DISTINCT role FROM employees")).map((r) => r.role).sort(),
    ['employee', 'hr_admin', 'project_manager', 'system_admin']
  );
  for (const a of [accounts.find((x) => x.role === 'HR / Admin'), accounts.find((x) => x.role === 'Project Manager'), accounts.find((x) => x.role === 'Employee')]) {
    const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: a.id, password } });
    assert.equal(res.status, 200, `${a.name}: ${JSON.stringify(res.body)}`);
  }
});

test('refuses to load a second time', () => {
  const again = run();
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already has/);
});

test('projects span the stages the client should see', async () => {
  const projects = await rows(`
    SELECT p.name, p.status, p.estimated_man_hours AS estimate, COALESCE(SUM(tl.duration_minutes), 0) / 60 AS hours
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.project_id LEFT JOIN time_logs tl ON tl.task_id = t.task_id
     GROUP BY p.project_id`);
  assert.equal(projects.length, 6);
  const used = Object.fromEntries(projects.map((p) => [p.name, (Number(p.hours) / Number(p.estimate)) * 100]));
  assert.ok(used['Saria Refinery Expansion'] > 30 && used['Saria Refinery Expansion'] < 70, 'healthy');
  assert.ok(used['Wynn Tower Development'] >= 80 && used['Wynn Tower Development'] < 100, 'nearly used up');
  assert.ok(used['Marbella Coastal Residences'] >= 100, 'over its estimate');
  assert.equal(used['Duqm Port Pipeline'], 0, 'not started');
  assert.deepEqual(new Set(projects.map((p) => p.status)), new Set(['In Progress', 'Planning', 'Completed']));
});

test('logged time is believable: in the past, on working days, never overlapping', async () => {
  const logs = await rows(`SELECT employee_id, DATE_FORMAT(log_date, '%Y-%m-%d') AS log_date, start_time, end_time, duration_minutes, auto_stopped FROM time_logs ORDER BY employee_id, start_time`);
  const [[{ today }]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  assert.ok(logs.length > 300);
  let previous = null;
  for (const l of logs) {
    assert.ok(l.log_date < today, `a session dated ${l.log_date} is not in the past`);
    assert.ok(![5, 6].includes(new Date(`${l.log_date}T12:00:00Z`).getUTCDay()), `a session on a weekend: ${l.log_date}`);
    assert.ok(l.end_time, 'no timer is left running');
    assert.ok(Number(l.duration_minutes) > 0);
    if (previous && previous.employee_id === l.employee_id) {
      assert.ok(new Date(l.start_time) >= new Date(previous.end_time), `overlapping sessions for employee ${l.employee_id}`);
    }
    previous = l;
  }
  assert.equal(logs.filter((l) => l.auto_stopped).length, 1, 'one forgotten timer awaiting review');
  const [open] = await rows('SELECT COUNT(*) AS c FROM time_logs WHERE end_time IS NULL');
  assert.equal(Number(open.c), 0);
});

test('shows the alerts the platform would really have raised', async () => {
  const types = (await rows('SELECT DISTINCT type FROM notifications')).map((r) => r.type);
  for (const wanted of ['budget-warning', 'budget-exceeded', 'task-overdue', 'task-due-soon', 'timer-auto-stopped', 'session-needs-review', 'task-assigned']) {
    assert.ok(types.includes(wanted), `missing ${wanted} notification`);
  }
  // Notifications only point at screens Batch 1 shows.
  const links = (await rows('SELECT DISTINCT link FROM notifications')).map((r) => r.link);
  for (const link of links) assert.match(link, /^\/(my-tasks|projects\/\d+)$/);
});

test('a project manager sees their own projects and an employee only their own tasks', async () => {
  const pm = accounts.find((a) => a.name === 'Salim Al-Busaidi');
  const pmToken = await app.login(pm.id, password);
  const list = (await app.api('/projects', { token: pmToken })).body.projects;
  assert.ok(list.length >= 2);

  const emp = accounts.find((a) => a.name === 'Ahmed Khalil');
  const mine = await app.api('/tasks/mine', { token: await app.login(emp.id, password) });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  const [{ c }] = await rows('SELECT COUNT(*) AS c FROM tasks t JOIN employees e ON e.employee_id = t.employee_id WHERE e.name = ?', [emp.name]);
  assert.ok(mine.body.tasks.length >= 1);
  assert.equal(mine.body.tasks.length, Number(c), 'exactly their own tasks');
});

test('the audit trail for HR shows people and structure, with dates in order', async () => {
  const hr = accounts.find((a) => a.role === 'HR / Admin');
  const res = await app.api('/audit?limit=100', { token: await app.login(hr.id, password) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const entries = res.body.entries;
  assert.ok(entries.length > 20);
  const actions = new Set(entries.map((e) => e.action));
  for (const wanted of ['department.create', 'team.create', 'employee.create']) assert.ok(actions.has(wanted), wanted);
});

test('leadership accounts: heads, team leaders and management can sign in and see their own part', async () => {
  process.env.ROLLOUT_BATCH = '5';
  const lead = () => spawnSync('node', [path.join(root, 'scripts', 'seed-demo.js'), 'leadership'], { cwd: root, env: { ...process.env, DEMO_PASSWORD: password }, encoding: 'utf8' });
  try {
    assert.equal(run('leadership').status, 1, 'needs the demo password');
    const added = lead();
    assert.equal(added.status, 0, added.stderr);
    const people = [...added.stdout.matchAll(/(EMP-\d+)\s+(Department Head|Team Leader|Management)\s+(.+)/g)].map((m) => ({ id: m[1], role: m[2], name: m[3].trim() }));
    assert.equal(people.length, 11); // 5 heads, 5 team leaders, 1 managing director

    const again = lead();
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exist/);

    for (const role of ['Management', 'Department Head', 'Team Leader']) {
      const token = await app.login(people.find((p) => p.role === role).id, password);
      const res = await app.api('/dashboard', { token });
      assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
    }
    assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM departments WHERE head_id IS NULL'))[0].c), 0);
    assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM teams WHERE leader_id IS NOT NULL'))[0].c), 5);
    assert.equal(Number((await rows('SELECT COUNT(*) AS c FROM projects WHERE team_leader_id IS NOT NULL'))[0].c), 4);
  } finally {
    process.env.ROLLOUT_BATCH = '1';
  }
});

test('clearing needs --yes, then removes the business data and keeps administrators and the real audit trail', async () => {
  await db.query("INSERT INTO audit_log (actor_name, action, entity_type, summary) VALUES ('Admin', 'auth.login', 'auth', 'real entry')");
  const refused = run('clear');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /--yes/);
  assert.ok((await rows('SELECT COUNT(*) AS c FROM projects'))[0].c > 0, 'nothing was removed');

  const cleared = run('clear', '--yes');
  assert.equal(cleared.status, 0, cleared.stderr);
  for (const table of ['projects', 'tasks', 'time_logs', 'notifications', 'teams', 'departments', 'sub_departments']) {
    assert.equal(Number((await rows(`SELECT COUNT(*) AS c FROM ${table}`))[0].c), 0, table);
  }
  assert.deepEqual((await rows('SELECT name FROM employees')).map((r) => r.name), ['Admin']);
  const left = (await rows('SELECT summary FROM audit_log')).map((r) => r.summary);
  assert.ok(left.includes('real entry'));
  assert.ok(left.every((x) => x === 'real entry' || x.endsWith('signed in')), 'only the demo history is gone; sign-ins stay');

  const again = run(); // and it can be loaded afresh
  assert.equal(again.status, 0, again.stderr);
});
