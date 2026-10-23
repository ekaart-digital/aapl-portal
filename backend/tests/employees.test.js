const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp, PASSWORD } = require('./helpers');

let f; let app; let hr; let sys; let tokens;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const valid = (over = {}) => ({
  name: 'New Hire', email: 'new.hire@test.local', password: 'Passw0rd!', role: 'employee',
  departmentId: undefined, designation: 'Engineer', ...over,
});
const create = (body, token = hr) => app.api('/employees', { method: 'POST', token, body });
const patch = (id, body, token = hr) => app.api(`/employees/${id}`, { method: 'PATCH', token, body });
const reset = (id, password, token = hr) => app.api(`/employees/${id}/password`, { method: 'PATCH', token, body: { password } });
const roleOf = async (id) => (await f.db.query('SELECT role FROM employees WHERE employee_id = ?', [id]))[0][0].role;
const idsFor = async (token) => (await app.api('/employees', { token })).body.employees.map((e) => e.id).sort((a, b) => a - b);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  hr = await app.login(code(f.hr));
  sys = await app.login(code(f.sysadmin));
  tokens = {
    manager: await app.login(code(f.manager1)),
    tl: await app.login(code(f.tlPiping)),
    head: await app.login(code(f.headPiping)),
    mgmt: await app.login(code(f.mgmt)),
    employee: await app.login(code(f.pipingA)),
    structEmployee: await app.login(code(f.structA)),
  };
});
after(() => app.close(f));

// ------------------------------------------------------------- the directory

test('HR/Admin sees everyone, most senior roles first, without secrets', async () => {
  const res = await app.api('/employees', { token: hr });
  assert.equal(res.status, 200);
  assert.equal(res.body.employees.length, 13);
  assert.equal(res.body.employees[0].role, 'management');
  assert.equal(JSON.stringify(res.body).includes('password'), false);
});

test('each person carries their reporting lines (SRS section 6)', async () => {
  const res = await app.api('/employees', { token: hr });
  const a = res.body.employees.find((e) => e.id === f.pipingA);
  assert.equal(a.team, 'Piping Team');
  assert.deepEqual(a.reportsToTeamLeader, { id: f.tlPiping, name: 'TL Piping' });
  assert.deepEqual(a.reportsToDepartmentHead, { id: f.headPiping, name: 'Head Piping' });
  assert.equal(a.roleLabel, 'Employee');

  // Nobody reports to themselves.
  const leader = res.body.employees.find((e) => e.id === f.tlPiping);
  assert.equal(leader.reportsToTeamLeader, null);
  assert.equal(leader.reportsToDepartmentHead.name, 'Head Piping');
  const head = res.body.employees.find((e) => e.id === f.headPiping);
  assert.equal(head.reportsToDepartmentHead, null);

  const pm = res.body.employees.find((e) => e.id === f.manager1);
  assert.equal(pm.reportsToTeamLeader, null);
  assert.equal(pm.roleLabel, 'Project Manager');
});

test('who can see which people', async () => {
  assert.equal((await app.api('/employees', { token: tokens.employee })).status, 403, 'employees cannot list people');

  const all = await idsFor(hr);
  assert.deepEqual(await idsFor(tokens.mgmt), all);
  assert.deepEqual(await idsFor(sys), all);

  // Team Leader: their team plus themselves
  assert.deepEqual(await idsFor(tokens.tl), [f.pipingA, f.pipingB, f.tlPiping].sort((a, b) => a - b));
  // Department Head: their whole department plus themselves
  assert.deepEqual(
    await idsFor(tokens.head),
    [f.pipingA, f.pipingB, f.inactive, f.tlPiping, f.headPiping].sort((a, b) => a - b)
  );
  // Project Manager: people in the departments of their projects, plus themselves
  const pmSees = await idsFor(tokens.manager);
  assert.ok(pmSees.includes(f.structA) && pmSees.includes(f.pipingA) && pmSees.includes(f.manager1));
  assert.ok(!pmSees.includes(f.hr) && !pmSees.includes(f.mgmt) && !pmSees.includes(f.manager2));
});

test('a single profile: yourself, or someone inside your scope', async () => {
  const get = (id, token) => app.api(`/employees/${id}`, { token });
  assert.equal((await get(f.pipingA, tokens.employee)).status, 200, 'yourself');
  assert.equal((await get(f.pipingB, tokens.employee)).status, 403, 'an employee cannot view colleagues');
  assert.equal((await get(f.pipingA, tokens.tl)).status, 200, 'team leader sees own team');
  assert.equal((await get(f.structA, tokens.tl)).status, 403, 'but not another team');
  assert.equal((await get(f.structA, tokens.head)).status, 403, 'department head: not another department');
  assert.equal((await get(f.structA, tokens.mgmt)).status, 200);
  assert.equal((await get(99999, tokens.mgmt)).status, 404);
  assert.equal((await get(99999, tokens.employee)).status, 404);
});

// ---------------------------------------------------------------- creating

test('only HR/Admin and the System Administrator can create accounts', async () => {
  for (const token of [tokens.manager, tokens.tl, tokens.head, tokens.mgmt, tokens.employee]) {
    assert.equal((await create(valid({ departmentId: f.piping }), token)).status, 403);
  }
});

test('create: required fields, role, email, dates, phone and password policy', async () => {
  const withDept = (over) => valid({ departmentId: f.piping, ...over });
  const cases = [
    [withDept({ name: undefined }), 'missing name'],
    [withDept({ email: undefined }), 'missing email'],
    [withDept({ email: 'not-an-email' }), 'bad email'],
    [withDept({ role: 'admin' }), 'unknown role'],
    [withDept({ password: 'short1' }), 'too short'],
    [withDept({ password: 'onlyletters' }), 'no digit'],
    [withDept({ password: '12345678' }), 'no letter'],
    [withDept({ password: `A1${'x'.repeat(80)}` }), 'longer than bcrypt can use'],
    [withDept({ dateOfJoining: '01/02/2026' }), 'bad date'],
    [withDept({ mobileNumber: 'call me' }), 'bad phone'],
    [valid(), 'employee without a department'],
    [withDept({ departmentId: 99999 }), 'unknown department'],
    [withDept({ teamId: f.structTeam }), 'team of another department'],
    [withDept({ teamId: 99999 }), 'unknown team'],
  ];
  for (const [body, label] of cases) {
    assert.equal((await create(body)).status, 400, label);
  }
});

test('create: HR can create operational roles, and the response shows the master record', async () => {
  const res = await create(valid({
    departmentId: f.piping, teamId: f.pipingTeam, dateOfJoining: '2026-03-01', mobileNumber: '+968 9123 4567', designation: 'Piping Engineer',
  }));
  assert.equal(res.status, 201);
  const e = res.body.employee;
  assert.equal(e.department, 'Piping');
  assert.equal(e.team, 'Piping Team');
  assert.equal(e.dateOfJoining, '2026-03-01');
  assert.equal(e.mobileNumber, '+968 9123 4567');
  assert.equal(e.reportsToTeamLeader.name, 'TL Piping');
  assert.equal(e.status, 'active');

  const loginRes = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(e.id), password: PASSWORD } });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.body.user.permissions.includes('my-work'));
  assert.equal(loginRes.body.user.landing, '/my-tasks');

  assert.equal((await create(valid({ departmentId: f.piping }))).status, 409, 'duplicate email');
});

test('create: HR may create Team Leader, Department Head and Project Manager accounts', async () => {
  const mk = (n, role, extra = {}) => create(valid({ email: `${n}@test.local`, role, ...extra }));
  assert.equal((await mk('newtl', 'team_leader', { departmentId: f.piping, teamId: f.pipingTeam })).status, 201);
  assert.equal((await mk('newhead', 'department_head', { departmentId: f.structural })).status, 201);
  assert.equal((await mk('newpm', 'project_manager')).status, 201);
});

test('create: the powerful roles are reserved for the System Administrator', async () => {
  for (const role of ['hr_admin', 'management', 'system_admin']) {
    const denied = await create(valid({ email: `${role}-hr@test.local`, role }));
    assert.equal(denied.status, 403, `HR creating ${role}`);
    assert.match(denied.body.error.message, /System Administrator/);

    const ok = await create(valid({ email: `${role}-sys@test.local`, role }), sys);
    assert.equal(ok.status, 201, `sysadmin creating ${role}`);
    assert.equal(ok.body.employee.role, role);
  }
});

test('create: roles without a discipline are stored without a department or team', async () => {
  const res = await create(valid({ email: 'nodept@test.local', role: 'project_manager', departmentId: f.piping, teamId: f.pipingTeam }));
  assert.equal(res.status, 201);
  assert.equal(res.body.employee.departmentId, null);
  assert.equal(res.body.employee.teamId, null);
});

// ---------------------------------------------------------------- updating

test('update: validation rules', async () => {
  assert.equal((await patch(f.pipingA, { status: 'bogus' })).status, 400);
  assert.equal((await patch(f.pipingA, { name: '  ' })).status, 400);
  assert.equal((await patch(f.pipingA, { email: 'nope' })).status, 400);
  assert.equal((await patch(f.pipingA, { email: 'pb@test.local' })).status, 409, 'duplicate email');
  assert.equal((await patch(99999, { name: 'x' })).status, 404);
  assert.equal((await patch(f.hr, { status: 'inactive' }, sys)).status, 200, 'sysadmin can deactivate HR');
  await patch(f.hr, { status: 'active' }, sys);
});

test('update: changes only the fields sent, including clearing optional ones', async () => {
  const first = await patch(f.structA, { designation: 'Senior Engineer', mobileNumber: '12345678', dateOfJoining: '2025-01-15' });
  assert.equal(first.status, 200);
  assert.equal(first.body.employee.designation, 'Senior Engineer');
  assert.equal(first.body.employee.name, 'Structural A');
  assert.equal(first.body.employee.department, 'Structural');
  assert.equal(first.body.employee.team, 'Structural Team');

  const cleared = await patch(f.structA, { mobileNumber: null, designation: '' });
  assert.equal(cleared.body.employee.mobileNumber, null);
  assert.equal(cleared.body.employee.designation, null);
  assert.equal(cleared.body.employee.dateOfJoining, '2025-01-15', 'untouched');
});

test('update: you cannot deactivate yourself or change your own role', async () => {
  assert.equal((await patch(f.sysadmin, { status: 'inactive' }, sys)).status, 400);
  assert.equal((await patch(f.sysadmin, { role: 'employee' }, sys)).status, 400);
});

test('update: HR/Admin cannot touch HR, Management or System Administrator accounts', async () => {
  for (const target of [f.hr, f.mgmt, f.sysadmin]) {
    assert.equal((await patch(target, { designation: 'Changed' })).status, 403);
  }
  assert.equal((await patch(f.mgmt, { designation: 'Chief' }, sys)).status, 200);
});

test('update: only the System Administrator can change a role', async () => {
  const id = (await create(valid({ email: 'promote@test.local', departmentId: f.piping }))).body.employee.id;
  assert.equal((await patch(id, { role: 'team_leader' })).status, 403, 'HR cannot');
  assert.equal(await roleOf(id), 'employee');

  assert.equal((await patch(id, { role: 'nonsense' }, sys)).status, 400);
  const ok = await patch(id, { role: 'team_leader' }, sys);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.employee.role, 'team_leader');
  assert.equal(ok.body.employee.roleLabel, 'Team Leader');
  assert.equal(ok.body.employee.department, 'Piping', 'keeps their discipline');
});

test('update: moving to a role with no discipline clears department and team', async () => {
  const id = (await create(valid({ email: 'tomgr@test.local', departmentId: f.piping, teamId: f.pipingTeam }))).body.employee.id;
  const res = await patch(id, { role: 'project_manager' }, sys);
  assert.equal(res.status, 200);
  assert.equal(res.body.employee.departmentId, null);
  assert.equal(res.body.employee.teamId, null);

  const back = await patch(id, { role: 'employee' }, sys);
  assert.equal(back.status, 400, 'an employee needs a department');
  assert.equal((await patch(id, { role: 'employee', departmentId: f.structural }, sys)).status, 200);
});

test('a System Administrator can deactivate another, but never themselves', async () => {
  const second = (await create(valid({ email: 'sys2@test.local', role: 'system_admin' }), sys)).body.employee.id;
  const sys2 = await app.login(code(second));

  assert.equal((await patch(second, { status: 'inactive' }, sys)).status, 200);
  assert.equal((await app.api('/auth/me', { token: sys2 })).status, 401, 'their session ends at once');
  assert.equal((await patch(second, { status: 'active' }, sys)).status, 200);

  assert.equal((await patch(f.sysadmin, { status: 'inactive' }, sys)).status, 400, 'cannot deactivate yourself');
  assert.equal(await roleOf(f.sysadmin), 'system_admin');
});

test('update: department and team rules', async () => {
  const mk = async (email, extra = {}) => (await create(valid({ email, departmentId: f.piping, ...extra }))).body.employee.id;

  const id = await mk('moves@test.local', { teamId: f.pipingTeam });
  assert.equal((await patch(id, { teamId: f.structTeam })).status, 400, 'team of another department');
  assert.equal((await patch(id, { teamId: null })).body.employee.team, null, 'team can be cleared');
  assert.equal((await patch(id, { teamId: f.pipingTeam })).body.employee.team, 'Piping Team');

  const moved = await patch(id, { departmentId: f.structural });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.employee.department, 'Structural');
  assert.equal(moved.body.employee.team, null, 'the old department\'s team no longer applies');

  assert.equal((await patch(id, { departmentId: 99999 })).status, 400);
});

test('update: someone with open work cannot change department or be deactivated', async () => {
  const id = (await create(valid({ email: 'busy@test.local', departmentId: f.piping }))).body.employee.id;
  const task = await f.addTask(f.project1, f.subInputStudy, id, 'Open work', 10, 'In Progress');

  const move = await patch(id, { departmentId: f.structural });
  assert.equal(move.status, 409);
  assert.match(move.body.error.message, /open task/);
  assert.equal((await patch(id, { status: 'inactive' })).status, 409);

  await f.db.query("UPDATE tasks SET status = 'Completed' WHERE task_id = ?", [task]);
  assert.equal((await patch(id, { status: 'inactive' })).status, 200, 'fine once the work is finished');
});

test('update: a project manager of active projects cannot be deactivated or demoted', async () => {
  const blocked = await patch(f.manager1, { status: 'inactive' });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /project manager of 2 active project/);
  assert.equal((await patch(f.manager1, { role: 'employee', departmentId: f.piping }, sys)).status, 409);

  assert.equal((await patch(f.manager2, { status: 'inactive' })).status, 200, 'manager2 manages nothing');
  await patch(f.manager2, { status: 'active' });
});

test('deactivating or re-roling a leader removes their leadership', async () => {
  const lead = (await create(valid({ email: 'lead@test.local', role: 'team_leader', departmentId: f.piping }))).body.employee.id;
  const team = (await f.db.query('INSERT INTO teams (name, department_id, leader_id) VALUES (?, ?, ?)', ['Temp Team', f.piping, lead]))[0].insertId;
  const leaderOf = async () => (await f.db.query('SELECT leader_id FROM teams WHERE team_id = ?', [team]))[0][0].leader_id;

  assert.equal(await leaderOf(), lead);
  assert.equal((await patch(lead, { status: 'inactive' })).status, 200);
  assert.equal(await leaderOf(), null);

  const head = (await create(valid({ email: 'head2@test.local', role: 'department_head', departmentId: f.structural }))).body.employee.id;
  await f.db.query('UPDATE departments SET head_id = ? WHERE department_id = ?', [head, f.structural]);
  await patch(head, { role: 'team_leader' }, sys);
  const headNow = (await f.db.query('SELECT head_id FROM departments WHERE department_id = ?', [f.structural]))[0][0].head_id;
  assert.equal(headNow, null);
  await f.db.query('UPDATE departments SET head_id = ? WHERE department_id = ?', [f.headStruct, f.structural]);
});

test('deactivate then reactivate an employee', async () => {
  const off = await patch(f.pipingB, { status: 'inactive' });
  assert.equal(off.status, 200);
  assert.equal(off.body.employee.status, 'inactive');
  const blocked = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingB), password: PASSWORD } });
  assert.equal(blocked.status, 403);

  await patch(f.pipingB, { status: 'active' });
  const back = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingB), password: PASSWORD } });
  assert.equal(back.status, 200);
});

// ---------------------------------------------------------- password reset

test('reset password: policy, then the new password works and the old one does not', async () => {
  assert.equal((await reset(f.pipingA, 'short')).status, 400);
  assert.equal((await reset(f.pipingA, 'noDigitsHere')).status, 400);
  assert.equal((await reset(99999, 'longenough1')).status, 404);
  assert.equal((await reset(f.pipingA, 'ResetPassw0rd')).status, 200);

  const oldPw = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: PASSWORD } });
  const newPw = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.pipingA), password: 'ResetPassw0rd' } });
  assert.equal(oldPw.status, 401);
  assert.equal(newPw.status, 200);
});

test('reset password: HR cannot reset a powerful account, the System Administrator can', async () => {
  for (const target of [f.hr, f.mgmt, f.sysadmin]) {
    assert.equal((await reset(target, 'Another1Pass')).status, 403);
  }
  assert.equal((await reset(f.mgmt, 'Another1Pass', sys)).status, 200);
  const login = await app.api('/auth/login', { method: 'POST', body: { employeeId: code(f.mgmt), password: 'Another1Pass' } });
  assert.equal(login.status, 200);
});

test('reset password: nobody else can', async () => {
  for (const token of [tokens.manager, tokens.tl, tokens.head, tokens.employee]) {
    assert.equal((await reset(f.pipingB, 'Another1Pass', token)).status, 403);
  }
});
