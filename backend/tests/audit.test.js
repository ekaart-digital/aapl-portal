const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp, PASSWORD } = require('./helpers');

// The audit trail (SRS §35): every important change is recorded with who made
// it, and each role may read only its own part of the trail.
let f; let app; let t;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const post = (path, body, token) => app.api(path, { method: 'POST', token, body });
const patch = (path, body, token) => app.api(path, { method: 'PATCH', token, body });
const sql = (q, p) => f.db.query(q, p);
const trail = async (token, query = '') => (await get(`/audit${query}`, token)).body;
const actions = async (token, query = '') => (await trail(token, query)).entries.map((e) => e.action);
const clear = () => sql('DELETE FROM audit_log');

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    tl: await app.login(code(f.tlPiping)),
    head: await app.login(code(f.headPiping)),
    pm: await app.login(code(f.manager1)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };
  await clear();
});
after(() => app.close(f));

// ===================================================================== access
test('only HR, Management and the System Administrator can open the audit trail', async () => {
  for (const [who, expected] of [['hr', 200], ['mgmt', 200], ['sys', 200], ['a', 403], ['tl', 403], ['head', 403], ['pm', 403]]) {
    assert.equal((await get('/audit', t[who])).status, expected, who);
  }
  assert.equal((await app.api('/audit')).status, 401);
});

// ===================================================================== what is recorded
test('creating and changing a person is recorded with the old and new values', async () => {
  await clear();
  const created = await post('/employees', {
    name: 'New Engineer', email: 'new.engineer@test.local', password: 'Str0ng!Pass1', role: 'employee', departmentId: f.piping,
  }, t.hr);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.employee.id;

  await patch(`/employees/${id}`, { designation: 'Piping Engineer', mobileNumber: '+968 9000 0000' }, t.hr);
  await patch(`/employees/${id}`, { status: 'inactive' }, t.hr);

  const entries = (await trail(t.hr, '?entityType=employee')).entries;
  assert.deepEqual(entries.map((e) => e.action), ['employee.deactivate', 'employee.update', 'employee.update', 'employee.create']);
  const update = entries.find((e) => e.action === 'employee.update' && e.details.designation);
  assert.deepEqual(update.details.designation, { from: null, to: 'Piping Engineer' });
  assert.equal(update.actorName, 'HR Admin');
  assert.equal(update.actorRole, 'hr_admin');
  assert.equal(update.entityId, id);
  assert.match(update.summary, /New Engineer/);
});

test('a role change is recorded separately so it can be found on its own', async () => {
  await clear();
  await patch(`/employees/${f.pipingB}`, { role: 'team_leader' }, t.sys);
  const changed = (await trail(t.sys, '?action=employee.role-change')).entries;
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0].details, { from: 'employee', to: 'team_leader' });
  assert.match(changed[0].summary, /Piping B/);
  await patch(`/employees/${f.pipingB}`, { role: 'employee' }, t.sys);
});

test('password resets and changes are recorded, never the password itself', async () => {
  await clear();
  await patch(`/employees/${f.pipingA}/password`, { password: 'Another!Pass2' }, t.hr);
  const entries = (await trail(t.mgmt)).entries;
  assert.ok(entries.some((e) => e.action === 'employee.password-reset' && e.entityId === f.pipingA));
  assert.ok(!JSON.stringify(entries).includes('Another!Pass2'));
  await patch(`/employees/${f.pipingA}/password`, { password: PASSWORD }, t.hr);
});

test('sign-ins, failed sign-ins and password changes are recorded', async () => {
  await clear();
  await app.login(code(f.pipingA));
  const bad = await post('/auth/login', { employeeId: code(f.pipingA), password: 'wrong-password' });
  assert.equal(bad.status, 401);
  await post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Changed!Pass3' }, t.a);
  await post('/auth/change-password', { currentPassword: 'Changed!Pass3', newPassword: PASSWORD }, t.a);

  const list = await actions(t.sys, '?entityType=auth');
  for (const action of ['auth.login', 'auth.login-failed', 'auth.password-change']) assert.ok(list.includes(action), action);
  const failed = (await trail(t.sys, '?action=auth.login-failed')).entries[0];
  assert.match(failed.summary, /Piping A/);
  assert.ok(!JSON.stringify(failed).includes('wrong-password'));
});

test('structure changes are recorded', async () => {
  await clear();
  const dept = await post('/departments', { name: 'Audit Dept' }, t.hr);
  const id = dept.body.department.id;
  await patch(`/departments/${id}`, { name: 'Audit Dept 2' }, t.hr);
  const team = await post('/teams', { name: 'Audit Team', departmentId: id }, t.hr);
  await patch(`/teams/${team.body.team.id}`, { name: 'Audit Team 2' }, t.hr);
  await post(`/departments/${id}/sub-departments`, { name: 'Audit Sub' }, t.hr);
  await app.api(`/teams/${team.body.team.id}`, { method: 'DELETE', token: t.hr });

  const list = await actions(t.mgmt);
  for (const action of ['department.create', 'department.rename', 'team.create', 'team.rename', 'sub-department.create', 'team.delete']) {
    assert.ok(list.includes(action), action);
  }
  const rename = (await trail(t.mgmt, '?action=department.rename')).entries[0];
  assert.deepEqual(rename.details, { from: 'Audit Dept', to: 'Audit Dept 2' });
});

test('project, task and hour changes are recorded', async () => {
  await clear();
  const created = await post('/projects', {
    name: 'Audited Project', jobCode: 'AUD-1', clientName: 'Client', estimatedManHours: 80, departmentIds: [f.piping],
  }, t.pm);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const projectId = created.body.project.id;
  await patch(`/projects/${projectId}`, { estimatedManHours: 120, status: 'In Progress' }, t.pm);

  const assigned = await post(`/projects/${projectId}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Audited task', employeeId: f.pipingA, allocatedHours: 8 }, t.pm);
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const taskId = assigned.body.task.id;
  await patch(`/tasks/${taskId}`, { status: 'In Progress' }, t.a);
  await patch(`/tasks/${taskId}`, { allocatedHours: 12 }, t.pm);
  const log = await f.addLog(taskId, f.pipingA, 300, 1);
  await app.api(`/time-logs/${log}`, { method: 'PATCH', token: t.pm, body: { durationMinutes: 240, note: 'Trimmed after review' } });

  const list = await actions(t.mgmt);
  for (const action of ['project.create', 'project.update', 'task.assign', 'task.status', 'task.update', 'time-log.adjust']) {
    assert.ok(list.includes(action), action);
  }
  const update = (await trail(t.mgmt, '?action=project.update')).entries[0];
  assert.deepEqual(update.details.estimated_man_hours, { from: '80', to: '120' });
  assert.deepEqual(update.details.status, { from: 'Planning', to: 'In Progress' });

  const adjust = (await trail(t.mgmt, '?action=time-log.adjust')).entries[0];
  assert.equal(adjust.details.from, 300);
  assert.equal(adjust.details.to, 240);
  assert.equal(adjust.details.note, 'Trimmed after review');
  assert.equal(adjust.actorName, 'Manager One');

  const status = (await trail(t.mgmt, '?action=task.status')).entries[0];
  assert.equal(status.actorName, 'Piping A');
  assert.match(status.summary, /In Progress/);
});

test('a change that changes nothing is not recorded', async () => {
  const [[task]] = await sql('SELECT task_id FROM tasks ORDER BY task_id DESC LIMIT 1');
  await clear();
  await patch(`/tasks/${task.task_id}`, { status: 'In Progress' }, t.a);
  assert.deepEqual(await actions(t.mgmt), []);
});

test('a manager-changing project edit is recorded as such', async () => {
  await clear();
  await patch(`/projects/${f.project2}`, { projectManagerId: f.manager2 }, t.pm);
  const list = await actions(t.mgmt);
  assert.deepEqual(list, ['project.manager-change']);
  await patch(`/projects/${f.project2}`, { projectManagerId: f.manager1 }, await app.login(code(f.manager2)));
});

test('an automatic stop is recorded against the System', async () => {
  await clear();
  const taskId = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Left running', 5);
  await sql("INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW() - INTERVAL 20 HOUR, CURDATE())", [taskId, f.pipingA]);
  await get('/dashboard/exceptions', t.pm); // any request runs the sweep
  const entry = (await trail(t.mgmt, '?action=time-log.auto-stop')).entries[0];
  assert.ok(entry, 'auto-stop entry');
  assert.equal(entry.actorName, 'System');
  assert.equal(entry.actorId, null);
  assert.equal(entry.details.creditedMinutes, 720);
});

// ===================================================================== reading
test('each role sees only its own part of the trail', async () => {
  await clear();
  await post('/departments', { name: 'Scope Dept' }, t.hr); // structure: HR, SysAdmin, Management
  await patch(`/tasks/${(await sql('SELECT task_id FROM tasks LIMIT 1'))[0][0].task_id}`, { remarks: 'a note' }, t.pm); // task: Management only
  await app.login(code(f.pipingA)); // auth: SysAdmin, Management

  const types = async (who) => [...new Set((await trail(t[who])).entries.map((e) => e.entityType))].sort();
  assert.deepEqual(await types('mgmt'), ['auth', 'department', 'task']);
  assert.deepEqual(await types('hr'), ['department']);
  assert.deepEqual(await types('sys'), ['auth', 'department']);

  assert.deepEqual((await trail(t.hr)).entityTypes, ['employee', 'department', 'sub-department', 'team']);
  // Asking for a type outside your part returns nothing rather than leaking it.
  assert.deepEqual((await trail(t.hr, '?entityType=task')).entries, []);
});

test('the trail can be filtered by action, person, text and date, and is paged newest first', async () => {
  await clear();
  for (let i = 0; i < 5; i++) await post('/departments', { name: `Paged ${i}` }, t.hr);
  const all = await trail(t.mgmt, '?limit=2');
  assert.equal(all.total, 5);
  assert.equal(all.entries.length, 2);
  assert.match(all.entries[0].summary, /Paged 4/); // newest first
  const next = await trail(t.mgmt, '?limit=2&offset=2');
  assert.match(next.entries[0].summary, /Paged 2/);

  assert.equal((await trail(t.mgmt, '?q=Paged 3')).entries.length, 1);
  assert.equal((await trail(t.mgmt, `?actorId=${f.hr}`)).total, 5);
  assert.equal((await trail(t.mgmt, `?actorId=${f.mgmt}`)).total, 0);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await trail(t.mgmt, `?from=${today}&to=${today}`)).total, 5);
  assert.equal((await trail(t.mgmt, '?from=2001-01-01&to=2001-01-02')).total, 0);
  assert.equal((await trail(t.mgmt, '?action=department.')).total, 5);
});

test('bad filters are rejected, and wildcard characters are not interpreted', async () => {
  assert.equal((await get('/audit?from=yesterday', t.mgmt)).status, 400);
  assert.equal((await get('/audit?entityType=nonsense', t.mgmt)).status, 400);
  assert.equal((await get('/audit?actorId=abc', t.mgmt)).status, 400);
  assert.equal((await trail(t.mgmt, '?q=%25')).total, 0); // a literal % is not "match everything"
  assert.ok((await trail(t.mgmt, '?limit=100000')).entries.length <= 200);
});
