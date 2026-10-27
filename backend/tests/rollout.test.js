const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp, PASSWORD } = require('./helpers');
const rollout = require('../src/config/rollout');
const email = require('../src/services/email');
const { generateSummaryNotifications } = require('../src/services/notifications');

// The rollout setting (ROLLOUT_BATCH): what each batch opens, and that anything
// still closed is refused by the server, not just hidden from the screens.
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const post = (path, body, token) => app.api(path, { method: 'POST', token, body });
const patch = (path, body, token) => app.api(path, { method: 'PATCH', token, body });
const put = (path, body, token) => app.api(path, { method: 'PUT', token, body });
const sql = (q, p) => f.db.query(q, p);
const setBatch = (n) => { if (n === undefined) delete process.env.ROLLOUT_BATCH; else process.env.ROLLOUT_BATCH = String(n); };
const login = (id, password = PASSWORD) => app.api('/auth/login', { method: 'POST', body: { employeeId: code(id), password } });

before(async () => {
  setBatch(undefined);
  f = await seedFixtures();
  app = await startApp();
  // Everyone signs in while everything is open; the tests then close batches under them.
  t = {
    a: await app.login(code(f.pipingA)),
    tl: await app.login(code(f.tlPiping)),
    head: await app.login(code(f.headPiping)),
    pm: await app.login(code(f.manager1)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };
  task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Rollout task', 10);
});
after(() => { setBatch(undefined); return app.close(f); });
beforeEach(() => setBatch(undefined));

// ===================================================================== the setting itself
test('with nothing set, everything is on', () => {
  assert.equal(rollout.currentBatch(), 5);
  assert.deepEqual(rollout.enabledRoles().sort(), ['department_head', 'employee', 'hr_admin', 'management', 'project_manager', 'system_admin', 'team_leader']);
  assert.ok(Object.values(rollout.rolloutInfo().features).every(Boolean));
});

test('a value that is set but not valid opens batch 1 only, so a typo never opens more', () => {
  for (const bad of ['abc', '0', '9', '-1', '2.5', ' ']) {
    setBatch(bad);
    assert.equal(rollout.currentBatch(), 1, `"${bad}"`);
  }
  setBatch('');
  assert.equal(rollout.currentBatch(), 5, 'empty means not set');
});

test('each batch includes the batches before it', () => {
  const caps = (n) => { setBatch(n); return Object.keys(rollout.CAPABILITY_BATCH).filter(rollout.isCapabilityEnabled); };
  for (let n = 2; n <= 5; n += 1) {
    const before = caps(n - 1);
    const now = caps(n);
    assert.ok(before.every((c) => now.includes(c)), `batch ${n} keeps batch ${n - 1}`);
    assert.ok(now.length >= before.length);
  }
});

test('a role or capability that is not defined is never open', () => {
  assert.equal(rollout.isRoleEnabled('wizard'), false);
  assert.equal(rollout.isCapabilityEnabled('anything.at.all'), false);
  assert.equal(rollout.featureOn('nonsense'), false);
});

// ===================================================================== batch 1
test('batch 1: only Employee, Project Manager, HR / Admin and System Administrator can sign in', async () => {
  setBatch(1);
  for (const id of [f.pipingA, f.manager1, f.hr, f.sysadmin]) assert.equal((await login(id)).status, 200, code(id));
  for (const id of [f.tlPiping, f.headPiping, f.mgmt]) {
    const res = await login(id);
    assert.equal(res.status, 403, code(id));
    assert.match(res.body.error.message, /not available yet/);
  }
  // A wrong password is still refused the usual way, for everyone.
  assert.equal((await login(f.tlPiping, 'wrong')).status, 401);
});

test('batch 1: someone already signed in with a role that is not open is turned away', async () => {
  setBatch(1);
  for (const who of ['tl', 'head', 'mgmt']) {
    const res = await get('/projects', t[who]);
    assert.equal(res.status, 403, who);
    assert.match(res.body.error.message, /not available yet/);
  }
  assert.equal((await get('/projects', t.pm)).status, 200);
});

test('batch 1: the browser is told what is open', async () => {
  setBatch(1);
  const me = (await get('/auth/me', t.pm)).body.user;
  assert.equal(me.rollout.batch, 1);
  assert.deepEqual(me.rollout.roles.sort(), ['employee', 'hr_admin', 'project_manager', 'system_admin']);
  assert.ok(Object.values(me.rollout.features).every((on) => on === false));
  assert.deepEqual(me.permissions.sort(), ['employees.view', 'projects.create', 'projects.edit', 'projects.view', 'sessions.review', 'tasks.allocate']);
  assert.deepEqual((await get('/auth/me', t.a)).body.user.permissions.sort(), ['my-work', 'projects.view']);
  assert.deepEqual((await get('/auth/me', t.hr)).body.user.permissions.sort(), ['audit.view', 'employees.manage', 'employees.view', 'structure.manage']);
  assert.deepEqual((await get('/auth/me', t.sys)).body.user.permissions.sort(), ['audit.view', 'employees.manage', 'employees.view', 'roles.assign', 'settings.manage', 'structure.manage', 'system.health']);
});

test('batch 1: later-batch screens and calls are refused by the server', async () => {
  setBatch(1);
  const closed = [
    ['/dashboard', 'pm'], ['/dashboard/projects', 'pm'], [`/dashboard/projects/${f.project1}`, 'pm'], ['/dashboard/exceptions', 'pm'],
    ['/reports/projects', 'pm'], ['/reports/summary', 'pm'], ['/reports/monthly', 'pm'], ['/reports/employee-work-time', 'pm'],
    [`/reports/employee/${f.pipingA}`, 'a'], [`/reports/employee/${f.pipingA}`, 'pm'],
    ['/corrections/sessions', 'a'], ['/corrections/mine', 'a'], ['/corrections', 'pm'],
  ];
  for (const [path, who] of closed) assert.equal((await get(path, t[who])).status, 403, `${who} ${path}`);
  assert.equal((await post('/corrections', { logId: 1, durationMinutes: 5, reason: 'x' }, t.a)).status, 403);
});

test('batch 1: the daily work the client will see still works end to end', async () => {
  setBatch(1);
  assert.equal((await get('/projects', t.pm)).status, 200);
  assert.equal((await get('/tasks/mine', t.a)).status, 200);
  const assigned = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Batch one task', employeeId: f.pipingA, allocatedHours: 4 }, t.pm);
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  const start = await post(`/tasks/${assigned.body.task.id}/time-logs/start`, undefined, t.a);
  assert.equal(start.status, 201);
  assert.equal((await post(`/tasks/${assigned.body.task.id}/time-logs/${start.body.timeLog.id}/stop`, undefined, t.a)).status, 200);
  // A manager can correct hours directly, and HR and the System Administrator keep the audit trail.
  const log = await f.addLog(task, f.pipingA, 120, 1);
  assert.equal((await patch(`/time-logs/${log}`, { durationMinutes: 90, note: 'Corrected' }, t.pm)).status, 200);
  assert.equal((await get('/audit', t.hr)).status, 200);
  assert.equal((await get('/audit', t.sys)).status, 200);
  assert.equal((await get('/system/health', t.sys)).status, 200);
});

test('batch 1: only the open roles can be created or assigned', async () => {
  setBatch(1);
  const make = (role, n) => post('/employees', { name: `Person ${n}`, email: `p${n}@rollout.local`, password: 'Passw0rd!x', role, departmentId: f.piping }, t.sys);
  for (const role of ['team_leader', 'department_head']) {
    const res = await make(role, role);
    assert.equal(res.status, 400, role);
    assert.match(res.body.error.message, /not available yet/);
  }
  assert.equal((await post('/employees', { name: 'Mgmt', email: 'm@rollout.local', password: 'Passw0rd!x', role: 'management' }, t.sys)).status, 400);
  assert.equal((await make('employee', 'e1')).status, 201);
  assert.equal((await post('/employees', { name: 'New PM', email: 'pm@rollout.local', password: 'Passw0rd!x', role: 'project_manager' }, t.sys)).status, 201);
  // Changing someone into a closed role is refused too.
  assert.equal((await patch(`/employees/${f.pipingB}`, { role: 'team_leader' }, t.sys)).status, 400);
});

test('batch 1: a department head cannot be named project manager', async () => {
  setBatch(1);
  const managers = (await get('/projects/project-managers', t.pm)).body.managers.map((m) => m.role);
  assert.ok(managers.length > 0 && managers.every((r) => r === 'project_manager'));
  const res = await post('/projects', { name: 'X', jobCode: 'RO-1', clientName: 'C', estimatedManHours: 10, departmentIds: [f.piping], projectManagerId: f.headPiping }, t.pm);
  assert.equal(res.status, 400);
});

test('batch 1: task categories, project extras and employee extras are hidden and refused', async () => {
  setBatch(1);
  assert.deepEqual((await get('/tasks/categories', t.pm)).body.categories, []);
  const withCat = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Cat', employeeId: f.pipingA, allocatedHours: 2, category: 'Review' }, t.pm);
  assert.equal(withCat.status, 400);
  assert.match(withCat.body.error.message, /not available yet/);
  assert.equal((await patch(`/tasks/${task}`, { category: 'Review' }, t.pm)).status, 400);
  const tasks = (await get(`/projects/${f.project1}/tasks`, t.pm)).body.tasks;
  assert.ok(tasks.every((x) => !('category' in x)));

  const project = (await get(`/projects/${f.project1}`, t.pm)).body.project;
  for (const key of ['teamLeaderId', 'teamLeaderName', 'agreedFee', 'completionOverridePercent', 'completionPercent', 'projectedFinalManHours', 'risk']) {
    assert.ok(!(key in project), `project must not carry ${key}`);
  }
  assert.ok(Array.isArray(project.assignedEmployees), 'the project\'s own hours and allocation stay');
  assert.equal(typeof project.estimatedManHours, 'number');
  for (const body of [{ teamLeaderId: f.tlPiping }, { agreedFee: 5 }, { completionOverridePercent: 10 }]) {
    assert.equal((await patch(`/projects/${f.project1}`, body, t.pm)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await get('/projects/team-leaders', t.pm)).body.teamLeaders, []);

  const people = (await get('/employees', t.hr)).body.employees;
  assert.ok(people.every((e) => !('overtimeEligible' in e) && !('hasPhoto' in e) && !('currentProjects' in e)));
  assert.equal((await patch(`/employees/${f.pipingA}`, { overtimeEligible: true }, t.hr)).status, 400);
  assert.equal((await post('/employees', { name: 'OT', email: 'ot@rollout.local', password: 'Passw0rd!x', role: 'employee', departmentId: f.piping, overtimeEligible: true }, t.hr)).status, 400);
  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.hr)).status, 404);
  assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo: null }, t.hr)).status, 404);
});

test('batch 1: settings for closed features are not shown or accepted', async () => {
  setBatch(1);
  const keys = (await get('/system/settings', t.sys)).body.settings.map((s) => s.key);
  assert.deepEqual(keys, ['maxSessionHours', 'budgetWarnPercent', 'budgetCriticalPercent', 'sessionTimeoutMinutes']);
  assert.equal((await patch('/system/settings', { correctionWindowDays: 7 }, t.sys)).status, 400, 'corrections are batch 3');
  assert.equal((await patch('/system/settings', { emailMinSeverity: 1 }, t.sys)).status, 400);
  assert.equal((await patch('/system/settings', { dailySummaryHour: 9 }, t.sys)).status, 400);
  assert.equal((await patch('/system/settings', { maxSessionHours: 10 }, t.sys)).status, 200);
  await patch('/system/settings', { maxSessionHours: 12 }, t.sys);
});

test('batch 1: no summary notifications and no email are produced', async () => {
  setBatch(1);
  await sql('DELETE FROM notifications');
  await generateSummaryNotifications(new Date(2026, 9, 8, 19, 0, 0));
  assert.equal((await sql('SELECT 1 FROM notifications'))[0].length, 0);

  const sent = [];
  email.setTransport({ sendMail: async (m) => { sent.push(m); } });
  const held = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Held', 5, 'In Progress');
  await patch(`/tasks/${held}`, { status: 'On Hold' }, t.a);
  await email.flush();
  email.setTransport(null);
  assert.equal(sent.length, 0);
  assert.ok((await sql("SELECT 1 FROM notifications WHERE type = 'task-on-hold'"))[0].length > 0, 'the in-app notification is still created');
});

// ===================================================================== batch 2
test('batch 2: team leaders and department heads arrive with their dashboards, man-hours and exceptions', async () => {
  setBatch(2);
  assert.equal((await login(f.tlPiping)).status, 200);
  assert.equal((await login(f.headPiping)).status, 200);
  assert.equal((await login(f.mgmt)).status, 403, 'management is a later batch');

  assert.equal((await get('/dashboard', t.tl)).status, 200);
  assert.equal((await get('/dashboard', t.head)).status, 200);
  assert.equal((await get('/dashboard/exceptions', t.pm)).status, 200);
  assert.equal((await get('/dashboard/projects', t.tl)).status, 200);
  assert.equal((await get('/dashboard', t.mgmt)).status, 403);

  const project = (await get(`/projects/${f.project1}`, t.pm)).body.project;
  assert.equal(typeof project.completionPercent, 'number', 'man-hours detail is open');
  assert.ok(!('teamLeaderId' in project), 'project extras are not');
  assert.ok(['RED', 'AMBER', 'GREEN'].includes(project.risk));

  for (const [path, who] of [['/reports/projects', 'tl'], ['/reports/summary', 'head'], ['/corrections', 'tl'], ['/corrections/sessions', 'a']]) {
    assert.equal((await get(path, t[who])).status, 403, `${who} ${path}`);
  }
});

test('batch 2: a team leader can give work to the team, and a department head can create a project', async () => {
  setBatch(2);
  const give = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'From the leader', employeeId: f.pipingB, allocatedHours: 3 }, t.tl);
  assert.equal(give.status, 201, JSON.stringify(give.body));
  const created = await post('/projects', { name: 'Head project', jobCode: 'RO-H', clientName: 'C', estimatedManHours: 20, departmentIds: [f.piping], projectManagerId: f.headPiping }, t.head);
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

test('batch 2: a department head can be named project manager', async () => {
  setBatch(2);
  const roles = (await get('/projects/project-managers', t.pm)).body.managers.map((m) => m.role);
  assert.ok(roles.includes('department_head'));
});

// ===================================================================== batch 3
test('batch 3: employees can ask for corrections and the people responsible can decide', async () => {
  setBatch(3);
  const log = await f.addLog(task, f.pipingA, 480, 1);
  const asked = await post('/corrections', { logId: log, durationMinutes: 300, reason: 'Forgot to stop' }, t.a);
  assert.equal(asked.status, 201, JSON.stringify(asked.body));
  assert.equal((await get('/corrections', t.tl)).body.requests.length >= 1, true);
  assert.equal((await post(`/corrections/${asked.body.request.id}/approve`, {}, t.tl)).status, 200);
  assert.equal((await get('/corrections/sessions', t.a)).status, 200);
  assert.equal((await get('/reports/summary', t.pm)).status, 403, 'reports are batch 4');
  assert.equal((await login(f.mgmt)).status, 403);
  assert.ok((await get('/system/settings', t.sys)).body.settings.some((s) => s.key === 'correctionWindowDays'), 'its setting is shown now');
});

// ===================================================================== batch 4
test('batch 4: management and reporting open, refinements stay closed', async () => {
  setBatch(4);
  assert.equal((await login(f.mgmt)).status, 200);
  assert.equal((await get('/dashboard', t.mgmt)).status, 200);
  assert.equal((await get('/reports/projects', t.mgmt)).status, 200);
  assert.equal((await get('/reports/summary', t.pm)).status, 200);
  assert.equal((await get(`/reports/employee/${f.pipingA}`, t.a)).status, 200, 'employees open their own report');
  assert.equal((await get(`/reports/employee/${f.pipingB}`, t.a)).status, 403);
  assert.equal((await get('/audit', t.mgmt)).status, 200);

  const keys = (await get('/system/settings', t.sys)).body.settings.map((s) => s.key);
  assert.ok(keys.includes('dailySummaryHour'), 'summaries are batch 4');
  assert.ok(!keys.includes('emailMinSeverity'), 'email is batch 5');
  assert.deepEqual((await get('/tasks/categories', t.pm)).body.categories, []);

  await sql('DELETE FROM notifications');
  await generateSummaryNotifications(new Date(2026, 9, 8, 19, 0, 0));
  assert.ok((await sql("SELECT 1 FROM notifications WHERE type = 'daily-summary'"))[0].length > 0);
});

// ===================================================================== batch 5
test('batch 5: the refinements open', async () => {
  setBatch(5);
  assert.equal((await get('/tasks/categories', t.pm)).body.categories.length, 12);
  const cat = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Categorised', employeeId: f.pipingA, allocatedHours: 2, category: 'Review' }, t.pm);
  assert.equal(cat.status, 201);
  assert.equal(cat.body.task.category, 'Review');
  assert.equal((await patch(`/projects/${f.project1}`, { teamLeaderId: f.tlPiping, agreedFee: 1000, completionOverridePercent: 20 }, t.pm)).status, 200);
  assert.equal((await patch(`/employees/${f.pipingA}`, { overtimeEligible: true }, t.hr)).status, 200);
  const keys = (await get('/system/settings', t.sys)).body.settings.map((s) => s.key);
  assert.ok(keys.includes('emailMinSeverity') && keys.includes('dailySummaryHour'));
  const me = (await get('/auth/me', t.pm)).body.user;
  assert.equal(me.rollout.batch, 5);
  assert.ok(Object.values(me.rollout.features).every(Boolean));
});

test('closing a batch again hides it again', async () => {
  setBatch(5);
  assert.equal((await get('/dashboard', t.tl)).status, 200);
  setBatch(1);
  assert.equal((await get('/dashboard', t.tl)).status, 403);
  assert.equal((await login(f.tlPiping)).status, 403);
  setBatch(2);
  assert.equal((await get('/dashboard', t.tl)).status, 200);
});
