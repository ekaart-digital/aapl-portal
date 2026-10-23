const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');
const { ALL_ROLES, CAPABILITIES, permissionsFor, can, landingFor } = require('../src/auth/permissions');

let f; let app; let tokens;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;

// One signed-in person per role (SRS section 34).
const WHO = {
  employee: 'pipingA',
  team_leader: 'tlPiping',
  department_head: 'headPiping',
  project_manager: 'manager1',
  hr_admin: 'hr',
  management: 'mgmt',
  system_admin: 'sysadmin',
};

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  tokens = {};
  for (const [role, key] of Object.entries(WHO)) tokens[role] = await app.login(code(f[key]));
  await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Gives the employee a project');
});
after(() => app.close(f));

// Every guarded endpoint, with the roles allowed past the role check. Bodies
// are deliberately invalid so an allowed call can never change data: reaching
// validation (400/404/409) proves the permission check passed.
function endpoints() {
  return [
    ['GET', '/employees', null, ['team_leader', 'department_head', 'project_manager', 'hr_admin', 'management', 'system_admin']],
    ['POST', '/employees', {}, ['hr_admin', 'system_admin']],
    ['PATCH', `/employees/${f.pipingA}`, { status: 'bogus' }, ['hr_admin', 'system_admin']],
    ['PATCH', `/employees/${f.pipingA}/password`, { password: 'x' }, ['hr_admin', 'system_admin']],

    ['GET', '/projects', null, ['employee', 'team_leader', 'department_head', 'project_manager', 'management']],
    ['POST', '/projects', {}, ['project_manager', 'department_head']],
    ['PATCH', `/projects/${f.project1}`, { status: 'bogus' }, ['project_manager', 'department_head']],
    ['POST', `/projects/${f.project1}/tasks`, {}, ['project_manager', 'department_head', 'team_leader']],

    ['GET', '/reports/projects', null, ['team_leader', 'department_head', 'project_manager', 'management']],
    ['GET', '/reports/employee-work-time', null, ['team_leader', 'department_head', 'project_manager', 'management']],

    ['GET', '/time-logs/flagged', null, ['team_leader', 'department_head', 'project_manager']],
    ['PATCH', '/time-logs/99999', { durationMinutes: 5, note: 'check' }, ['team_leader', 'department_head', 'project_manager']],

    ['GET', '/tasks/99999', null, ['employee', 'team_leader', 'department_head', 'project_manager', 'management']],
    ['PATCH', '/tasks/99999', {}, ['employee', 'team_leader', 'department_head', 'project_manager', 'management']],
    ['GET', '/tasks/99999/time-logs', null, ['employee', 'team_leader', 'department_head', 'project_manager', 'management']],
    ['GET', '/tasks/mine', null, ['employee', 'team_leader']],
    ['GET', '/tasks/my-open-session', null, ['employee', 'team_leader']],
    ['POST', '/tasks/99999/time-logs/start', null, ['employee', 'team_leader']],
    ['POST', '/tasks/99999/time-logs/99999/stop', null, ['employee', 'team_leader']],
  ];
}

// Open to every signed-in person.
const OPEN = [
  ['GET', '/auth/me'],
  ['GET', '/departments'],
  ['GET', '/notifications'],
  ['GET', '/notifications/unread-count'],
];

test('the role list is the seven roles from the SRS', () => {
  assert.deepEqual(
    [...ALL_ROLES].sort(),
    ['department_head', 'employee', 'hr_admin', 'management', 'project_manager', 'system_admin', 'team_leader']
  );
});

test('every endpoint rejects a missing or invalid token', async () => {
  for (const [method, path, body] of endpoints()) {
    assert.equal((await app.api(path, { method, body: body || undefined })).status, 401, `${method} ${path}`);
    assert.equal((await app.api(path, { method, token: 'garbage', body: body || undefined })).status, 401);
  }
  for (const [method, path] of OPEN) assert.equal((await app.api(path, { method })).status, 401, path);
});

test('the permission matrix: each role is let in or turned away exactly as designed', async () => {
  for (const [method, path, body, allowed] of endpoints()) {
    for (const role of ALL_ROLES) {
      const res = await app.api(path, { method, token: tokens[role], body: body || undefined });
      if (allowed.includes(role)) {
        assert.ok(![401, 403].includes(res.status), `${role} should be allowed ${method} ${path}, got ${res.status}`);
      } else {
        assert.equal(res.status, 403, `${role} should be refused ${method} ${path}, got ${res.status}`);
      }
    }
  }
});

test('endpoints open to everyone work for every role', async () => {
  for (const role of ALL_ROLES) {
    for (const [method, path] of OPEN) {
      const res = await app.api(path, { method, token: tokens[role] });
      assert.equal(res.status, 200, `${role} ${method} ${path}`);
    }
  }
});

test('the capability table agrees with the matrix above', () => {
  // A capability that no role holds is a typo waiting to happen.
  for (const [capability, roles] of Object.entries(CAPABILITIES)) {
    assert.ok(roles.length > 0, capability);
    assert.ok(roles.every((r) => ALL_ROLES.includes(r)), `${capability} names an unknown role`);
  }
  assert.ok(can('management', 'dashboard.company'));
  assert.ok(!can('project_manager', 'employees.manage'));
  assert.ok(!can('management', 'projects.edit'), 'Management has company-wide visibility but edits nothing');
  assert.ok(!can('system_admin', 'projects.view'), 'technical configuration is not business data');
  assert.ok(!can('hr_admin', 'projects.view'));
  assert.deepEqual(permissionsFor('no-such-role'), []);
});

test('sign-in tells each role what it may do and where to land', async () => {
  const landing = {
    employee: '/my-tasks', team_leader: '/team', department_head: '/department', project_manager: '/projects',
    hr_admin: '/employees', management: '/dashboard', system_admin: '/admin',
  };
  for (const [role, key] of Object.entries(WHO)) {
    const res = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f[key]), password: 'Passw0rd!' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, role);
    assert.deepEqual(res.body.user.permissions, permissionsFor(role));
    assert.equal(res.body.user.landing, landing[role]);
    assert.equal(landingFor(role), landing[role]);
    assert.ok(res.body.user.roleLabel);

    const me = await app.api('/auth/me', { token: tokens[role] });
    assert.deepEqual(me.body.user.permissions, permissionsFor(role));
  }
});

test('a role change in the database applies without signing in again', async () => {
  const token = await app.login(code(f.pipingB));
  assert.equal((await app.api('/employees', { token })).status, 403);

  await f.db.query("UPDATE employees SET role = 'hr_admin', department_id = NULL, team_id = NULL WHERE employee_id = ?", [f.pipingB]);
  assert.equal((await app.api('/employees', { token })).status, 200);

  await f.db.query("UPDATE employees SET role = 'employee', department_id = ?, team_id = ? WHERE employee_id = ?", [f.piping, f.pipingTeam, f.pipingB]);
});

test('a leadership change in the database applies immediately', async () => {
  const token = tokens.team_leader;
  const before = await app.api('/employees', { token });
  assert.ok(before.body.employees.some((e) => e.id === f.pipingA));

  await f.db.query('UPDATE teams SET leader_id = NULL WHERE team_id = ?', [f.pipingTeam]);
  const after = await app.api('/employees', { token });
  assert.ok(!after.body.employees.some((e) => e.id === f.pipingA), 'no longer leads the team, no longer sees its people');

  await f.db.query('UPDATE teams SET leader_id = ? WHERE team_id = ?', [f.tlPiping, f.pipingTeam]);
});

test('unknown routes return a JSON 404', async () => {
  const res = await app.api('/nope', { token: tokens.management });
  assert.equal(res.status, 404);
  assert.ok(res.body.error.message);
});
