const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let t;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const call = (method, path, token, body) => app.api(path, { method, token, body });

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    hr: await app.login(code(f.hr)),
    sys: await app.login(code(f.sysadmin)),
    mgmt: await app.login(code(f.mgmt)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    head: await app.login(code(f.headPiping)),
    tl: await app.login(code(f.tlPiping)),
    tlStruct: await app.login(code(f.tlStruct)),
    employee: await app.login(code(f.pipingA)),
  };
});
after(() => app.close(f));

const MANAGERS = () => [t.hr, t.sys];
const OTHERS = () => [t.mgmt, t.pm, t.head, t.tl, t.employee];

// ================================================================ departments

test('everyone signed in can read the structure, with heads, teams and sub-departments', async () => {
  for (const token of Object.values(t)) {
    const res = await call('GET', '/departments', token);
    assert.equal(res.status, 200);
  }
  const res = await call('GET', '/departments', t.employee);
  const piping = res.body.departments.find((d) => d.name === 'Piping');
  assert.equal(piping.headId, f.headPiping);
  assert.equal(piping.headName, 'Head Piping');
  assert.deepEqual(piping.subDepartments.map((s) => s.name).sort(), ['Analysis', 'Input Study']);
  assert.equal(piping.teams.length, 1);
  assert.deepEqual(piping.teams[0], { id: f.pipingTeam, name: 'Piping Team', leaderId: f.tlPiping, leaderName: 'TL Piping', memberCount: 3 });
  assert.equal(piping.employeeCount, 4, "active people only");
  assert.equal(piping.department_id, f.piping, 'earlier screens still get department_id');
});

test('only HR/Admin and the System Administrator can change the structure', async () => {
  for (const token of OTHERS()) {
    assert.equal((await call('POST', '/departments', token, { name: 'Blocked' })).status, 403);
    assert.equal((await call('PATCH', `/departments/${f.piping}`, token, { name: 'Blocked' })).status, 403);
    assert.equal((await call('DELETE', `/departments/${f.piping}`, token)).status, 403);
    assert.equal((await call('POST', `/departments/${f.piping}/sub-departments`, token, { name: 'Blocked' })).status, 403);
    assert.equal((await call('PATCH', `/sub-departments/${f.subAnalysis}`, token, { name: 'Blocked' })).status, 403);
    assert.equal((await call('POST', '/teams', token, { name: 'Blocked', departmentId: f.piping })).status, 403);
    assert.equal((await call('PATCH', `/teams/${f.pipingTeam}`, token, { name: 'Blocked' })).status, 403);
    assert.equal((await call('DELETE', `/teams/${f.pipingTeam}`, token)).status, 403);
  }
});

test('create a department: trimmed name, required, unique', async () => {
  const ok = await call('POST', '/departments', t.hr, { name: '  CFD  ' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.department.name, 'CFD');
  assert.equal((await call('POST', '/departments', t.hr, { name: 'CFD' })).status, 409);
  assert.equal((await call('POST', '/departments', t.sys, { name: 'CAD / BIM' })).status, 201);
  for (const bad of [{}, { name: '   ' }, { name: 5 }, { name: 'x'.repeat(101) }]) {
    assert.equal((await call('POST', '/departments', t.hr, bad)).status, 400, JSON.stringify(bad));
  }
});

test('rename a department and assign or clear its head', async () => {
  const id = (await call('POST', '/departments', t.hr, { name: 'Acoustics' })).body.department.id;

  assert.equal((await call('PATCH', `/departments/${id}`, t.hr, { name: 'Acoustic Studies' })).status, 200);
  assert.equal((await call('PATCH', `/departments/${id}`, t.hr, { name: 'Piping' })).status, 409, 'name taken');
  assert.equal((await call('PATCH', '/departments/99999', t.hr, { name: 'x' })).status, 404);

  for (const headId of [f.pipingA, f.tlPiping, f.manager1, f.inactive, 99999]) {
    assert.equal((await call('PATCH', `/departments/${id}`, t.hr, { headId })).status, 400, `head ${headId}`);
  }
  assert.equal((await call('PATCH', `/departments/${id}`, t.hr, { headId: f.headStruct })).status, 200);
  const named = (await call('GET', '/departments', t.hr)).body.departments.find((d) => d.department_id === id);
  assert.equal(named.headName, 'Head Structural');
  assert.equal((await call('PATCH', `/departments/${id}`, t.hr, { headId: null })).status, 200);
});

test('a department can be removed only while it is empty', async () => {
  const empty = (await call('POST', '/departments', t.hr, { name: 'Temporary' })).body.department.id;
  await call('POST', `/departments/${empty}/sub-departments`, t.hr, { name: 'Anything' });
  assert.equal((await call('DELETE', `/departments/${empty}`, t.hr)).status, 200, 'sub-departments go with it');

  const blocked = await call('DELETE', `/departments/${f.piping}`, t.hr);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error.message, /people/);
  assert.equal((await call('DELETE', '/departments/99999', t.hr)).status, 404);
});

// ============================================================= sub-departments

test('sub-departments: add, rename, no duplicates, remove only when unused', async () => {
  const add = await call('POST', `/departments/${f.piping}/sub-departments`, t.hr, { name: ' Documentation ' });
  assert.equal(add.status, 201);
  assert.equal(add.body.subDepartment.name, 'Documentation');
  assert.equal((await call('POST', `/departments/${f.piping}/sub-departments`, t.hr, { name: 'Documentation' })).status, 409);
  assert.equal((await call('POST', `/departments/${f.structural}/sub-departments`, t.hr, { name: 'Documentation' })).status, 201, 'same name in another department');
  assert.equal((await call('POST', '/departments/99999/sub-departments', t.hr, { name: 'x' })).status, 404);

  const id = add.body.subDepartment.id;
  assert.equal((await call('PATCH', `/sub-departments/${id}`, t.hr, { name: 'Analysis' })).status, 409);
  assert.equal((await call('PATCH', `/sub-departments/${id}`, t.hr, { name: 'Reports' })).status, 200);
  assert.equal((await call('PATCH', '/sub-departments/99999', t.hr, { name: 'x' })).status, 404);

  assert.equal((await call('DELETE', `/sub-departments/${id}`, t.hr)).status, 200);
  await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Uses Analysis');
  const used = await call('DELETE', `/sub-departments/${f.subAnalysis}`, t.hr);
  assert.equal(used.status, 409);
  assert.match(used.body.error.message, /task/);
});

// ====================================================================== teams

test('team list: each role sees only the teams it should', async () => {
  const names = async (token) => (await call('GET', '/teams', token)).body.teams.map((x) => x.name).sort();
  assert.deepEqual(await names(t.hr), ['Piping Team', 'Structural Team']);
  assert.deepEqual(await names(t.mgmt), ['Piping Team', 'Structural Team']);
  assert.deepEqual(await names(t.head), ['Piping Team'], 'department head: their department');
  assert.deepEqual(await names(t.tl), ['Piping Team'], 'team leader: their own team');
  assert.deepEqual(await names(t.tlStruct), ['Structural Team']);
  assert.deepEqual(await names(t.pm), ['Piping Team', 'Structural Team'], 'project manager: the departments of their projects');
  assert.deepEqual(await names(t.pm2), [], 'a manager with no projects');
  assert.equal((await call('GET', '/teams', t.employee)).status, 403);
});

test('create a team: department, unique name, and a valid leader', async () => {
  const mk = (body, token = t.hr) => call('POST', '/teams', token, body);

  assert.equal((await mk({ departmentId: f.piping })).status, 400, 'name required');
  assert.equal((await mk({ name: 'X', departmentId: 99999 })).status, 400, 'unknown department');
  assert.equal((await mk({ name: 'Piping Team', departmentId: f.piping })).status, 409, 'duplicate in the department');
  assert.equal((await mk({ name: 'Piping Team', departmentId: f.structural })).status, 201, 'same name elsewhere is fine');

  // The leader must be an active Team Leader of the same department.
  assert.equal((await mk({ name: 'Night shift', departmentId: f.piping, leaderId: f.pipingA })).status, 400, 'an employee, not a team leader');
  assert.equal((await mk({ name: 'Night shift', departmentId: f.piping, leaderId: f.tlStruct })).status, 400, 'a leader of another department');
  assert.equal((await mk({ name: 'Night shift', departmentId: f.piping, leaderId: 99999 })).status, 400);

  const ok = await mk({ name: 'Night shift', departmentId: f.piping, leaderId: f.tlPiping }, t.sys);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.team.leaderName, 'TL Piping');
  assert.equal(ok.body.team.departmentName, 'Piping');
  assert.equal(ok.body.team.memberCount, 0);
});

test('change a team: rename, leader, clear leader', async () => {
  const id = (await call('POST', '/teams', t.hr, { name: 'Review team', departmentId: f.structural })).body.team.id;
  assert.equal((await call('PATCH', `/teams/${id}`, t.hr, { name: 'Structural Team' })).status, 409);
  assert.equal((await call('PATCH', `/teams/${id}`, t.hr, { name: 'Review board' })).body.team.name, 'Review board');
  assert.equal((await call('PATCH', `/teams/${id}`, t.hr, { leaderId: f.tlPiping })).status, 400, 'wrong department');
  assert.equal((await call('PATCH', `/teams/${id}`, t.hr, { leaderId: f.tlStruct })).body.team.leaderName, 'TL Structural');
  assert.equal((await call('PATCH', `/teams/${id}`, t.hr, { leaderId: null })).body.team.leaderId, null);
  assert.equal((await call('PATCH', '/teams/99999', t.hr, { name: 'x' })).status, 404);
});

test('giving a team leader a team gives them that team\'s people and work', async () => {
  const team = (await call('POST', '/teams', t.hr, { name: 'Second Piping Team', departmentId: f.piping })).body.team.id;
  const newTl = (await call('POST', '/employees', t.hr, {
    name: 'New Leader', email: 'newleader@test.local', password: 'Passw0rd!', role: 'team_leader', departmentId: f.piping,
  })).body.employee.id;
  const member = (await call('POST', '/employees', t.hr, {
    name: 'New Member', email: 'newmember@test.local', password: 'Passw0rd!', role: 'employee', departmentId: f.piping, teamId: team,
  })).body.employee.id;
  const token = await app.login(code(newTl));

  const before = await call('GET', '/employees', token);
  assert.ok(!before.body.employees.some((e) => e.id === member), 'no team yet, so nobody to see');

  assert.equal((await call('PATCH', `/teams/${team}`, t.hr, { leaderId: newTl })).status, 200);
  const after = await call('GET', '/employees', token);
  assert.ok(after.body.employees.some((e) => e.id === member), 'now leads the team');
});

test('removing a team un-assigns its members and keeps them and their work', async () => {
  const team = (await call('POST', '/teams', t.hr, { name: 'Disposable', departmentId: f.piping })).body.team.id;
  const member = (await call('POST', '/employees', t.hr, {
    name: 'Floating', email: 'floating@test.local', password: 'Passw0rd!', role: 'employee', departmentId: f.piping, teamId: team,
  })).body.employee.id;
  await f.addTask(f.project1, f.subInputStudy, member, 'Keeps its work');

  assert.equal((await call('DELETE', `/teams/${team}`, t.hr)).status, 200);
  const person = (await call('GET', `/employees/${member}`, t.hr)).body.employee;
  assert.equal(person.teamId, null);
  assert.equal(person.status, 'active');
  assert.equal((await call('DELETE', `/teams/${team}`, t.hr)).status, 404);
  assert.equal(MANAGERS().length, 2);
});
