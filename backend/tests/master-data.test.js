const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

// Task categories, the extra project and employee master fields, and the
// "no allocation" exception (SRS sections 6, 13, 14, 25, 29).
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const post = (path, body, token) => app.api(path, { method: 'POST', token, body });
const patch = (path, body, token) => app.api(path, { method: 'PATCH', token, body });
const put = (path, body, token) => app.api(path, { method: 'PUT', token, body });
const sql = (q, p) => f.db.query(q, p);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    b: await app.login(code(f.pipingB)),
    tl: await app.login(code(f.tlPiping)),
    tlStruct: await app.login(code(f.tlStruct)),
    head: await app.login(code(f.headPiping)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };
  task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Categorised task', 10);
});
after(() => app.close(f));

// ===================================================================== task categories
test('the categories from the requirements document are available to anyone who sees projects', async () => {
  const res = await get('/tasks/categories', t.a);
  assert.equal(res.status, 200);
  assert.equal(res.body.categories.length, 12);
  for (const name of ['Calculation', 'Modelling', 'Drawing', 'Report preparation', 'Review', 'Quality Control / QC', 'Coordination', 'Client meeting', 'Internal meeting', 'Research', 'Site work', 'Administration']) {
    assert.ok(res.body.categories.includes(name), name);
  }
  assert.equal((await get('/tasks/categories', t.hr)).status, 403); // no project data
});

test('a task can be given a category when it is assigned, and none is fine too', async () => {
  const withCat = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Stress calc', employeeId: f.pipingA, allocatedHours: 5, category: 'Calculation' }, t.pm);
  assert.equal(withCat.status, 201, JSON.stringify(withCat.body));
  assert.equal(withCat.body.task.category, 'Calculation');
  const without = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Uncategorised', employeeId: f.pipingA, allocatedHours: 5 }, t.pm);
  assert.equal(without.body.task.category, null);
  const blank = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Blank category', employeeId: f.pipingA, allocatedHours: 5, category: '' }, t.pm);
  assert.equal(blank.body.task.category, null);
});

test('an unknown category is refused', async () => {
  const res = await post(`/projects/${f.project1}/tasks`, { subDepartmentId: f.subInputStudy, taskName: 'Bad', employeeId: f.pipingA, allocatedHours: 5, category: 'Dancing' }, t.pm);
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /category must be one of/);
});

test('whoever allocates the work can change its category or clear it, the owner cannot', async () => {
  assert.equal((await patch(`/tasks/${task}`, { category: 'Drawing' }, t.pm)).body.task.category, 'Drawing');
  assert.equal((await patch(`/tasks/${task}`, { category: null }, t.tl)).body.task.category, null);
  const own = await patch(`/tasks/${task}`, { category: 'Review' }, t.a);
  assert.equal(own.status, 403);
  assert.equal((await patch(`/tasks/${task}`, { category: 'Nonsense' }, t.pm)).status, 400);
  // Changing other things leaves it alone.
  await patch(`/tasks/${task}`, { category: 'Modelling' }, t.pm);
  await patch(`/tasks/${task}`, { remarks: 'note' }, t.a);
  assert.equal((await get(`/tasks/${task}`, t.a)).body.task.category, 'Modelling');
});

test('a category change is in the audit trail', async () => {
  await patch(`/tasks/${task}`, { category: 'Research' }, t.pm);
  const [rows] = await sql("SELECT details FROM audit_log WHERE action = 'task.update' ORDER BY audit_id DESC LIMIT 1");
  const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
  assert.deepEqual(details.category, { from: 'Modelling', to: 'Research' });
});

test('hours by category appear in the project man-hour breakdown', async () => {
  await sql('DELETE FROM time_logs');
  await f.addLog(task, f.pipingA, 120, 1); // Research, 2h
  const other = await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'No category', 10);
  await f.addLog(other, f.pipingB, 60, 1);
  const p = (await get(`/dashboard/projects/${f.project1}`, t.pm)).body.project;
  assert.deepEqual(p.byCategory.map((r) => [r.name, r.hours]), [['Research', 2], ['Uncategorised', 1]]);
});

// ===================================================================== completed_at
test('finishing a task records when, and reopening it clears that', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Finish me', 5);
  const completedAt = async () => (await sql('SELECT completed_at FROM tasks WHERE task_id = ?', [id]))[0][0].completed_at;
  assert.equal(await completedAt(), null);
  await patch(`/tasks/${id}`, { status: 'Completed' }, t.a);
  const first = await completedAt();
  assert.ok(first);
  await patch(`/tasks/${id}`, { remarks: 'still done' }, t.a); // editing a finished task keeps the date
  assert.equal(String(await completedAt()), String(first));
  await patch(`/tasks/${id}`, { status: 'In Progress' }, t.pm);
  assert.equal(await completedAt(), null);
});

// ===================================================================== project master
test('a project can name a team leader, an agreed fee and its own completion figure', async () => {
  const res = await patch(`/projects/${f.project1}`, { teamLeaderId: f.tlPiping, agreedFee: 125000.5, completionOverridePercent: 40 }, t.pm);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = res.body.project;
  assert.equal(p.teamLeaderId, f.tlPiping);
  assert.equal(p.teamLeaderName, 'TL Piping');
  assert.equal(p.agreedFee, 125000.5);
  assert.equal(p.completionOverridePercent, 40);
});

test('the team leader must be an active Team Leader', async () => {
  for (const bad of [f.pipingA, f.headPiping, 999999]) {
    assert.equal((await patch(`/projects/${f.project1}`, { teamLeaderId: bad }, t.pm)).status, 400, String(bad));
  }
  await sql("UPDATE employees SET status = 'inactive' WHERE employee_id = ?", [f.tlStruct]);
  assert.equal((await patch(`/projects/${f.project1}`, { teamLeaderId: f.tlStruct }, t.pm)).status, 400);
  await sql("UPDATE employees SET status = 'active' WHERE employee_id = ?", [f.tlStruct]);
});

test('fee and completion figure are validated, and each can be cleared with null', async () => {
  for (const body of [{ agreedFee: -1 }, { agreedFee: 'lots' }, { completionOverridePercent: 101 }, { completionOverridePercent: -1 }, { completionOverridePercent: 12.5 }]) {
    assert.equal((await patch(`/projects/${f.project1}`, body, t.pm)).status, 400, JSON.stringify(body));
  }
  const cleared = (await patch(`/projects/${f.project1}`, { teamLeaderId: null, agreedFee: null, completionOverridePercent: null }, t.pm)).body.project;
  assert.equal(cleared.teamLeaderId, null);
  assert.equal(cleared.agreedFee, null);
  assert.equal(cleared.completionOverridePercent, null);
  await patch(`/projects/${f.project1}`, { teamLeaderId: f.tlPiping, agreedFee: 90000, completionOverridePercent: 40 }, t.pm);
});

test('the master fields can be set when creating a project', async () => {
  const res = await post('/projects', {
    name: 'Full master', jobCode: 'FM-1', clientName: 'C', estimatedManHours: 80, departmentIds: [f.piping],
    teamLeaderId: f.tlPiping, agreedFee: 50000, completionOverridePercent: 10,
  }, t.pm);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const [[row]] = await sql('SELECT team_leader_id, agreed_fee, completion_override_percent FROM projects WHERE job_code = ?', ['FM-1']);
  assert.equal(row.team_leader_id, f.tlPiping);
  assert.equal(Number(row.agreed_fee), 50000);
  assert.equal(row.completion_override_percent, 10);
  const bad = await post('/projects', { name: 'x', jobCode: 'FM-2', clientName: 'C', estimatedManHours: 80, departmentIds: [f.piping], teamLeaderId: f.pipingA }, t.pm);
  assert.equal(bad.status, 400);
});

test('the agreed fee is commercial: only project managers, department heads and management see it', async () => {
  const fee = async (who) => (await get(`/projects/${f.project1}`, t[who])).body.project.agreedFee;
  assert.equal(await fee('pm'), 90000);
  assert.equal(await fee('head'), 90000);
  assert.equal(await fee('mgmt'), 90000);
  assert.equal(await fee('tl'), undefined);
  assert.equal(await fee('a'), undefined);
  const list = (await get('/projects', t.a)).body.projects;
  assert.ok(list.every((p) => !('agreedFee' in p)));
  assert.equal((await get('/projects', t.pm)).body.projects.find((p) => p.id === f.project1).agreedFee, 90000);
});

test('the manager’s own completion figure replaces the calculated one, and clearing it brings the calculation back', async () => {
  const health = async () => (await get('/dashboard/projects', t.pm)).body.projects.find((p) => p.id === f.project1);
  const manual = await health();
  assert.equal(manual.completionPercent, 40);
  assert.equal(manual.completionIsManual, true);
  await patch(`/projects/${f.project1}`, { completionOverridePercent: null }, t.pm);
  const calculated = await health();
  assert.equal(calculated.completionIsManual, false);
  assert.notEqual(calculated.completionPercent, 40);
  await patch(`/projects/${f.project1}`, { completionOverridePercent: 40 }, t.pm);
});

test('a team leader named on a project can see it even with no work on it', async () => {
  // tlStruct has no tasks on project2, which is Piping only.
  assert.ok(!(await get('/projects', t.tlStruct)).body.projects.some((p) => p.id === f.project2));
  await patch(`/projects/${f.project2}`, { teamLeaderId: f.tlStruct }, t.pm);
  assert.ok((await get('/projects', t.tlStruct)).body.projects.some((p) => p.id === f.project2));
  assert.equal((await get(`/projects/${f.project2}`, t.tlStruct)).status, 200);
  await patch(`/projects/${f.project2}`, { teamLeaderId: null }, t.pm);
});

test('master field changes are in the audit trail', async () => {
  await patch(`/projects/${f.project1}`, { agreedFee: 95000 }, t.pm);
  const [[row]] = await sql("SELECT details FROM audit_log WHERE action = 'project.update' ORDER BY audit_id DESC LIMIT 1");
  const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
  assert.deepEqual(details.agreed_fee, { from: '90000', to: '95000' });
  await patch(`/projects/${f.project1}`, { agreedFee: 90000 }, t.pm);
});

test('a project lists who has been given work, with planned and used hours, within the viewer’s scope', async () => {
  await sql('DELETE FROM time_logs');
  await f.addLog(task, f.pipingA, 90, 1);
  const people = (await get(`/projects/${f.project1}`, t.pm)).body.project.assignedEmployees;
  const a = people.find((p) => p.name === 'Piping A');
  assert.ok(a.taskCount >= 1);
  assert.ok(a.plannedHours >= 10);
  assert.equal(a.consumedHours, 1.5);
  assert.ok(people.some((p) => p.name === 'Piping B'));
  // An employee sees only themselves.
  const own = (await get(`/projects/${f.project1}`, t.a)).body.project.assignedEmployees;
  assert.deepEqual(own.map((p) => p.name), ['Piping A']);
});

// ===================================================================== employee master
test('overtime eligibility can be set on creation and changed later', async () => {
  const created = await post('/employees', { name: 'Overtime Person', email: 'ot@test.local', password: 'Passw0rd!x', role: 'employee', departmentId: f.piping, overtimeEligible: true }, t.hr);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.employee.overtimeEligible, true);
  const id = created.body.employee.id;
  assert.equal((await patch(`/employees/${id}`, { overtimeEligible: false }, t.hr)).body.employee.overtimeEligible, false);
  const [[row]] = await sql("SELECT details FROM audit_log WHERE action = 'employee.update' ORDER BY audit_id DESC LIMIT 1");
  const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
  assert.deepEqual(details.overtime_eligible, { from: '1', to: '0' });
  const plain = await post('/employees', { name: 'Plain Person', email: 'plain@test.local', password: 'Passw0rd!x', role: 'employee', departmentId: f.piping }, t.hr);
  assert.equal(plain.body.employee.overtimeEligible, false);
});

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('a photograph can be set, fetched and removed, and is never in the lists', async () => {
  assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo: PIXEL }, t.hr)).status, 200);
  const list = (await get('/employees', t.hr)).body.employees;
  const a = list.find((e) => e.id === f.pipingA);
  assert.equal(a.hasPhoto, true);
  assert.equal(list.find((e) => e.id === f.pipingB).hasPhoto, false);
  assert.ok(!JSON.stringify(list).includes('base64'), 'photos must not travel in the list');

  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.hr)).body.photo, PIXEL);
  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.a)).body.photo, PIXEL); // yourself
  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.tl)).body.photo, PIXEL); // their team leader

  assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo: null }, t.hr)).status, 200);
  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.hr)).body.photo, null);
  assert.equal((await get('/employees', t.hr)).body.employees.find((e) => e.id === f.pipingA).hasPhoto, false);
});

test('only images of a sensible size are accepted', async () => {
  for (const photo of ['not an image', 'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + '!'.repeat(10), 42, undefined]) {
    assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo }, t.hr)).status, 400, String(photo).slice(0, 30));
  }
  const huge = `data:image/png;base64,${'A'.repeat(260000)}`;
  const res = await put(`/employees/${f.pipingA}/photo`, { photo: huge }, t.hr);
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /too large/);
});

test('photograph access follows the same rules as the rest of the master record', async () => {
  assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo: PIXEL }, t.a)).status, 403);
  assert.equal((await put(`/employees/${f.pipingA}/photo`, { photo: PIXEL }, t.pm)).status, 403);
  assert.equal((await get(`/employees/${f.pipingA}/photo`, t.b)).status, 404); // another employee: outside scope
  assert.equal((await get(`/employees/${f.structA}/photo`, t.tl)).status, 404); // another team
  // HR cannot change the photograph of a protected account; the System Administrator can.
  assert.equal((await put(`/employees/${f.mgmt}/photo`, { photo: PIXEL }, t.hr)).status, 403);
  assert.equal((await put(`/employees/${f.mgmt}/photo`, { photo: PIXEL }, t.sys)).status, 200);
  assert.equal((await put('/employees/999999/photo', { photo: PIXEL }, t.hr)).status, 404);
});

test('a photograph change is audited without storing the image', async () => {
  await sql('DELETE FROM audit_log');
  await put(`/employees/${f.pipingB}/photo`, { photo: PIXEL }, t.hr);
  const [[row]] = await sql("SELECT summary, details FROM audit_log WHERE action = 'employee.photo'");
  assert.match(row.summary, /Set the photograph of Piping B/);
  assert.ok(!JSON.stringify(row).includes('base64'));
});

test('current project allocation is shown to roles that see projects, not to HR', async () => {
  const names = async (who, id) => (await get('/employees', t[who])).body.employees.find((e) => e.id === id).currentProjects;
  assert.ok((await names('pm', f.pipingA)).includes('Project One'));
  assert.ok((await names('tl', f.pipingA)).includes('Project One'));
  assert.ok((await names('mgmt', f.pipingA)).includes('Project One'));
  assert.equal(await names('hr', f.pipingA), undefined);
  assert.equal(await names('sys', f.pipingA), undefined);
});

test('finished work and finished projects do not count as current allocation', async () => {
  const lone = await f.addTask(f.project2, f.subInputStudy, f.pipingB, 'Only task', 5);
  const has = async () => (await get('/employees', t.pm)).body.employees.find((e) => e.id === f.pipingB).currentProjects.includes('Project Two');
  assert.equal(await has(), true);
  await patch(`/tasks/${lone}`, { status: 'Completed' }, t.b);
  assert.equal(await has(), false);
});

// ===================================================================== no-allocation exception
test('people with nothing to do are flagged to the people who look after them', async () => {
  await sql("UPDATE tasks SET status = 'Completed' WHERE employee_id = ?", [f.pipingB]);
  const idle = async (who) => (await get('/dashboard/exceptions?type=no-allocation', t[who])).body.exceptions.map((e) => e.employeeName);
  assert.ok((await idle('tl')).includes('Piping B'));
  assert.ok((await idle('head')).includes('Piping B'));
  assert.ok((await idle('mgmt')).includes('Piping B'));
  assert.ok(!(await idle('tlStruct')).includes('Piping B'), 'another team leader does not see them');
  assert.deepEqual(await idle('pm'), []); // project managers do not manage people
  const item = (await get('/dashboard/exceptions?type=no-allocation', t.tl)).body.exceptions.find((e) => e.employeeName === 'Piping B');
  assert.equal(item.severity, 'attention');
  assert.equal(item.projectId, null);
  assert.match(item.detail, /no open work/);
});

test('someone with open work, or who is inactive, is not flagged', async () => {
  const idle = async () => (await get('/dashboard/exceptions?type=no-allocation', t.mgmt)).body.exceptions.map((e) => e.employeeName);
  assert.ok(!(await idle()).includes('Inactive Person'));
  await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'New work', 5);
  assert.ok(!(await idle()).includes('Piping B'));
});

test('the team dashboard shows allocated and logged hours and who has no allocation', async () => {
  await sql('DELETE FROM time_logs');
  await sql("UPDATE tasks SET status = 'Completed' WHERE employee_id = ?", [f.pipingA]);
  const open = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Fresh', 20);
  await f.addLog(open, f.pipingA, 150, 1);
  const stats = (await get('/dashboard', t.tl)).body.stats;
  assert.ok(stats.allocatedHours >= 20);
  assert.ok(stats.loggedHours >= 2.5);
  assert.equal(typeof stats.withoutAllocation, 'number');
});

test('the team leaders picker lists active team leaders, for people who create projects', async () => {
  const res = await get('/projects/team-leaders', t.pm);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.teamLeaders.map((x) => x.name), ['TL Piping', 'TL Structural']);
  assert.equal(res.body.teamLeaders[0].department, 'Piping');
  assert.equal((await get('/projects/team-leaders', t.head)).status, 200);
  for (const who of ['a', 'tl', 'hr', 'mgmt']) assert.equal((await get('/projects/team-leaders', t[who])).status, 403, who);
});
