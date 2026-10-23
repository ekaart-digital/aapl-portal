const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const { resetDatabase, startApp, PASSWORD } = require('./helpers');

// The real seed script, run against an empty database: the path a fresh
// install takes. Every role must end up with a working account.
let db; let app;

before(async () => {
  db = await resetDatabase();
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'seed.js')], {
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, `seed failed:\n${run.stdout}\n${run.stderr}`);
  app = await startApp();
});
after(async () => {
  await app.close({ db });
});

const code = (id) => `EMP-${String(id).padStart(3, '0')}`;

test('the seed creates one demo account for each of the seven roles', async () => {
  const [rows] = await db.query('SELECT role, COUNT(*) AS n FROM employees GROUP BY role');
  const byRole = Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]));
  assert.deepEqual(Object.keys(byRole).sort(), [
    'department_head', 'employee', 'hr_admin', 'management', 'project_manager', 'system_admin', 'team_leader',
  ]);
  assert.equal(byRole.project_manager, 3);
  assert.equal(byRole.employee, 20);
  assert.equal(byRole.department_head, 5);
  assert.equal(byRole.team_leader, 5);
  assert.equal(byRole.hr_admin, 1);
  assert.equal(byRole.management, 1);
  assert.equal(byRole.system_admin, 1);
});

test('every department has a head and a team with a leader and members', async () => {
  const [departments] = await db.query('SELECT department_id, name, head_id FROM departments');
  assert.equal(departments.length, 5);
  for (const d of departments) {
    assert.ok(d.head_id, `${d.name} has a head`);
    const [teams] = await db.query('SELECT team_id, leader_id FROM teams WHERE department_id = ?', [d.department_id]);
    assert.equal(teams.length, 1, `${d.name} has a team`);
    assert.ok(teams[0].leader_id, `${d.name} team has a leader`);
    const [members] = await db.query("SELECT COUNT(*) AS n FROM employees WHERE team_id = ? AND role = 'employee'", [teams[0].team_id]);
    assert.equal(Number(members[0].n), 4, `${d.name} team members`);
  }
});

test('every seeded person has a joining date and a working sign-in', async () => {
  const [[missing]] = await db.query('SELECT COUNT(*) AS n FROM employees WHERE date_of_joining IS NULL');
  assert.equal(Number(missing.n), 0);

  const [people] = await db.query('SELECT employee_id, role FROM employees ORDER BY employee_id');
  assert.equal(people.length, 36);
  const seen = new Set();
  for (const p of people) {
    const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(p.employee_id), password: PASSWORD } });
    assert.equal(res.status, 200, `${code(p.employee_id)} (${p.role})`);
    assert.equal(res.body.user.role, p.role);
    seen.add(p.role);
  }
  assert.equal(seen.size, 7);
});

test('a team leader and a department head see their own people straight after seeding', async () => {
  const [[tl]] = await db.query("SELECT employee_id FROM employees WHERE role = 'team_leader' ORDER BY employee_id LIMIT 1");
  const [[head]] = await db.query("SELECT employee_id FROM employees WHERE role = 'department_head' ORDER BY employee_id LIMIT 1");
  const tlToken = await app.login(code(tl.employee_id));
  const headToken = await app.login(code(head.employee_id));

  const team = await app.api('/employees', { token: tlToken });
  assert.equal(team.body.employees.length, 5, 'four members plus themselves');
  const dept = await app.api('/employees', { token: headToken });
  assert.equal(dept.body.employees.length, 6, 'four members, the team leader and themselves');

  const projects = await app.api('/projects', { token: headToken });
  assert.ok(projects.body.projects.length >= 1);
});

test('running the role seed again changes nothing', async () => {
  const before = (await db.query('SELECT COUNT(*) AS n FROM employees'))[0][0].n;
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'seed-roles.js')], { env: { ...process.env }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const after = (await db.query('SELECT COUNT(*) AS n FROM employees'))[0][0].n;
  assert.equal(after, before);
  assert.match(run.stdout, /already existed/);
});
