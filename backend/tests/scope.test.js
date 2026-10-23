const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

// What each role can see and do with projects, tasks and time (SRS section 34).
//
//   project1 (Piping + Structural), project2 (Piping only) — both managed by manager1
//   pipingA, pipingB are in Piping Team (leader tlPiping); structA in Structural Team (tlStruct)
let f; let app; let t; let task; let projectOnlyForStruct; let manager2Project;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const ids = (res, key = 'projects') => res.body[key].map((x) => x.id).sort((a, b) => a - b);
const assign = (projectId, body, token) => app.api(`/projects/${projectId}/tasks`, { method: 'POST', token, body });
const edit = (id, body, token) => app.api(`/tasks/${id}`, { method: 'PATCH', token, body });

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    employee: await app.login(code(f.pipingA)),
    employeeB: await app.login(code(f.pipingB)),
    structEmployee: await app.login(code(f.structA)),
    tl: await app.login(code(f.tlPiping)),
    tlStruct: await app.login(code(f.tlStruct)),
    head: await app.login(code(f.headPiping)),
    headStruct: await app.login(code(f.headStruct)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };

  task = {
    a: await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Task of A', 10),
    b: await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'Task of B', 10),
    s: await f.addTask(f.project1, f.subModelling, f.structA, 'Task of Struct', 10),
  };

  // A project that includes only Structural, managed by manager2.
  manager2Project = (await f.db.query(
    `INSERT INTO projects (job_code, name, client_name, project_manager_id, estimated_man_hours, status)
     VALUES ('T-M2', 'Manager Two Project', 'C', ?, 40, 'In Progress')`, [f.manager2]
  ))[0].insertId;
  await f.db.query('INSERT INTO project_departments (project_id, department_id) VALUES (?, ?)', [manager2Project, f.structural]);
  projectOnlyForStruct = manager2Project;
});
after(() => app.close(f));

// ===================================================================== projects

test('project list: each role sees exactly its own slice', async () => {
  const all = [f.project1, f.project2, manager2Project].sort((a, b) => a - b);

  assert.deepEqual(ids(await get('/projects', t.mgmt)), all, 'Management: everything');
  assert.deepEqual(ids(await get('/projects', t.pm)), [f.project1, f.project2].sort((a, b) => a - b), 'PM: the projects they manage');
  assert.deepEqual(ids(await get('/projects', t.pm2)), [manager2Project], 'another PM: only theirs');

  // Department heads and team leaders see the projects that include their department.
  assert.deepEqual(ids(await get('/projects', t.head)), [f.project1, f.project2].sort((a, b) => a - b));
  assert.deepEqual(ids(await get('/projects', t.headStruct)), [f.project1, manager2Project].sort((a, b) => a - b));
  assert.deepEqual(ids(await get('/projects', t.tl)), [f.project1, f.project2].sort((a, b) => a - b));
  assert.deepEqual(ids(await get('/projects', t.tlStruct)), [f.project1, manager2Project].sort((a, b) => a - b));

  // An employee: only projects they have a task in.
  assert.deepEqual(ids(await get('/projects', t.employee)), [f.project1]);
  assert.deepEqual(ids(await get('/projects', t.structEmployee)), [f.project1]);

  // HR/Admin and System Administrator hold no project data at all.
  assert.equal((await get('/projects', t.hr)).status, 403);
  assert.equal((await get('/projects', t.sys)).status, 403);
});

test('project detail: allowed inside your scope, refused outside it, 404 when it does not exist', async () => {
  const canOpen = (project, token) => get(`/projects/${project}`, token).then((r) => r.status);
  assert.equal(await canOpen(f.project1, t.pm), 200);
  assert.equal(await canOpen(manager2Project, t.pm), 403, 'someone else\'s project');
  assert.equal(await canOpen(f.project2, t.employee), 403, 'a project the employee has no task in');
  assert.equal(await canOpen(manager2Project, t.head), 403, 'a department head: not their department');
  assert.equal(await canOpen(manager2Project, t.headStruct), 200);
  assert.equal(await canOpen(manager2Project, t.mgmt), 200);
  assert.equal(await canOpen(99999, t.pm), 404);
});

test('project detail tells each person what they may do with it', async () => {
  const perms = async (project, token) => (await get(`/projects/${project}`, token)).body.project.permissions;
  assert.deepEqual(await perms(f.project1, t.pm), { edit: true, allocate: true });
  assert.deepEqual(await perms(f.project1, t.head), { edit: true, allocate: true }, 'department head of a department on it');
  assert.deepEqual(await perms(f.project1, t.tl), { edit: false, allocate: true }, 'team leader allocates but does not edit');
  assert.deepEqual(await perms(f.project1, t.mgmt), { edit: false, allocate: false }, 'Management: view only');
  assert.deepEqual(await perms(f.project1, t.employee), { edit: false, allocate: false });
});

test('project totals are visible to everyone who can open the project', async () => {
  await f.addLog(task.a, f.pipingA, 120);
  const mine = await get(`/projects/${f.project1}`, t.employee);
  assert.ok(mine.body.project.completedManHours >= 2, 'an employee sees how much of the budget is used');
});

// ======================================================================== tasks

test('project task list: employees see their own, leaders their people, managers all', async () => {
  const names = async (token) => (await get(`/projects/${f.project1}/tasks`, token)).body.tasks.map((x) => x.taskName).sort();
  assert.deepEqual(await names(t.employee), ['Task of A']);
  assert.deepEqual(await names(t.employeeB), ['Task of B']);
  assert.deepEqual(await names(t.tl), ['Task of A', 'Task of B'], 'team leader: the whole team');
  assert.deepEqual(await names(t.tlStruct), ['Task of Struct']);
  assert.deepEqual(await names(t.head), ['Task of A', 'Task of B'], 'department head: the department');
  assert.deepEqual(await names(t.headStruct), ['Task of Struct']);
  assert.deepEqual(await names(t.pm), ['Task of A', 'Task of B', 'Task of Struct']);
  assert.deepEqual(await names(t.mgmt), ['Task of A', 'Task of B', 'Task of Struct']);
});

test('single task: visible to the same people, 403 to others, 404 when missing', async () => {
  const status = (id, token) => get(`/tasks/${id}`, token).then((r) => r.status);
  assert.equal(await status(task.a, t.employee), 200);
  assert.equal(await status(task.b, t.employee), 403);
  assert.equal(await status(task.a, t.tl), 200);
  assert.equal(await status(task.s, t.tl), 403, 'another team');
  assert.equal(await status(task.s, t.tlStruct), 200);
  assert.equal(await status(task.s, t.head), 403, 'another department');
  assert.equal(await status(task.a, t.head), 200);
  assert.equal(await status(task.a, t.pm), 200);
  assert.equal(await status(task.a, t.pm2), 403, 'a manager of other projects');
  assert.equal(await status(task.a, t.mgmt), 200);
  assert.equal(await status(task.a, t.hr), 403);
  assert.equal(await status(99999, t.pm), 404);
});

test('time logged on a task is visible to whoever may see the task', async () => {
  const status = (id, token) => get(`/tasks/${id}/time-logs`, token).then((r) => r.status);
  assert.equal(await status(task.a, t.employee), 200);
  assert.equal(await status(task.a, t.employeeB), 403);
  assert.equal(await status(task.a, t.tl), 200);
  assert.equal(await status(task.a, t.tlStruct), 403);
  assert.equal(await status(task.a, t.head), 200);
  assert.equal(await status(task.a, t.mgmt), 200);
  assert.equal(await status(task.a, t.sys), 403);
  assert.equal(await status(99999, t.pm), 404);
});

// ================================================================== allocating

const newTask = (over = {}) => ({ subDepartmentId: f.subInputStudy, taskName: 'New work', employeeId: f.pipingA, allocatedHours: 5, ...over });

test('a project manager allocates on their own projects, any department of the project', async () => {
  assert.equal((await assign(f.project1, newTask({ taskName: 'PM piping' }), t.pm)).status, 201);
  assert.equal((await assign(f.project1, newTask({ subDepartmentId: f.subModelling, employeeId: f.structA, taskName: 'PM struct' }), t.pm)).status, 201);
});

test('a project manager cannot allocate on someone else\'s project', async () => {
  const res = await assign(manager2Project, newTask({ subDepartmentId: f.subModelling, employeeId: f.structA }), t.pm);
  assert.equal(res.status, 403);
  assert.equal((await assign(manager2Project, newTask({ subDepartmentId: f.subModelling, employeeId: f.structA, taskName: 'By owner' }), t.pm2)).status, 201);
});

test('a department head allocates to their own department\'s people', async () => {
  assert.equal((await assign(f.project1, newTask({ taskName: 'Head to piping' }), t.head)).status, 201);
  const other = await assign(f.project1, newTask({ subDepartmentId: f.subModelling, employeeId: f.structA, taskName: 'Head to struct' }), t.head);
  assert.equal(other.status, 403, 'not people of another department');
});

test('a team leader allocates to their own team only, and only on projects of their department', async () => {
  const ok = await assign(f.project1, newTask({ employeeId: f.pipingB, taskName: 'Daily task for B' }), t.tl);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.task.employeeName, 'Piping B');

  assert.equal((await assign(f.project1, newTask({ subDepartmentId: f.subModelling, employeeId: f.structA, taskName: 'Cross team' }), t.tl)).status, 403);
  assert.equal((await assign(f.project1, newTask({ employeeId: f.tlPiping, taskName: 'Own work' }), t.tl)).status, 201, 'a team leader can plan their own work');
});

test('a team leader cannot allocate on a project that does not involve their department', async () => {
  const res = await assign(projectOnlyForStruct, newTask({ taskName: 'Wrong department' }), t.tl);
  assert.ok([400, 403].includes(res.status), `got ${res.status}`);
});

test('Management, an employee, HR and the System Administrator cannot allocate work', async () => {
  for (const token of [t.mgmt, t.employee, t.hr, t.sys]) {
    assert.equal((await assign(f.project1, newTask(), token)).status, 403);
  }
});

test('work can be given to a team leader as well as to employees, but not to other roles', async () => {
  assert.equal((await assign(f.project1, newTask({ employeeId: f.tlPiping, taskName: 'For the TL' }), t.pm)).status, 201);
  for (const target of [f.headPiping, f.manager2, f.hr, f.mgmt, f.sysadmin]) {
    assert.equal((await assign(f.project1, newTask({ employeeId: target }), t.pm)).status, 400, `employee ${target}`);
  }
});

// =================================================================== editing tasks

test('the person doing a task changes its status and remarks, never its scope', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Mine to progress', 10);
  const res = await edit(id, { status: 'In Progress', remarks: 'Started', allocatedHours: 999, taskName: 'Renamed' }, t.employee);
  assert.equal(res.status, 200);
  assert.equal(res.body.task.status, 'In Progress');
  assert.equal(res.body.task.remarks, 'Started');
  assert.equal(res.body.task.allocatedHours, 10, 'hours are not theirs to change');
  assert.equal(res.body.task.taskName, 'Mine to progress');
});

test('whoever allocates the work can change its scope', async () => {
  for (const [token, label] of [[t.pm, 'project manager'], [t.head, 'department head'], [t.tl, 'team leader']]) {
    const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, `Edited by ${label}`, 10);
    const res = await edit(id, { allocatedHours: 25, dueDate: '2031-05-05' }, token);
    assert.equal(res.status, 200, label);
    assert.equal(res.body.task.allocatedHours, 25, label);
    assert.equal(res.body.task.dueDate, '2031-05-05', label);
  }
});

test('nobody sets the scope of their own work, not even a team leader', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.tlPiping, 'The leader\'s own task', 10);
  const res = await edit(id, { allocatedHours: 99, status: 'In Progress' }, t.tl);
  assert.equal(res.status, 200);
  assert.equal(res.body.task.allocatedHours, 10, 'hours unchanged');
  assert.equal(res.body.task.status, 'In Progress', 'status is theirs to update');
});

test('people outside the chain cannot change a task', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Guarded task', 10);
  for (const [token, label] of [
    [t.employeeB, 'a colleague'], [t.tlStruct, 'another team\'s leader'], [t.headStruct, 'another department\'s head'],
    [t.pm2, 'another project manager'], [t.mgmt, 'Management'], [t.hr, 'HR'], [t.sys, 'system administrator'],
  ]) {
    assert.equal((await edit(id, { remarks: 'x' }, token)).status, 403, label);
  }
});

test('reassigning: only within the allocator\'s own reach', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'To move', 10);
  assert.equal((await edit(id, { employeeId: f.pipingB }, t.tl)).status, 200, 'team leader within their team');
  assert.equal((await edit(id, { employeeId: f.pipingA }, t.head)).status, 200, 'department head within the department');
  assert.equal((await edit(id, { employeeId: f.pipingB }, t.employee)).status, 403, 'the doer cannot hand it on');

  // A team leader cannot hand work to someone outside their team.
  await f.db.query('UPDATE employees SET team_id = NULL WHERE employee_id = ?', [f.pipingB]);
  assert.equal((await edit(id, { employeeId: f.pipingB }, t.tl)).status, 403);
  await f.db.query('UPDATE employees SET team_id = ? WHERE employee_id = ?', [f.pipingTeam, f.pipingB]);
});

// =================================================================== reviewing time

test('time review: who may adjust whose sessions', async () => {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Reviewed work', 10);
  const log = await f.addLog(id, f.pipingA, 600);
  const body = { durationMinutes: 480, note: 'Reviewed' };
  const adjust = (token) => app.api(`/time-logs/${log}`, { method: 'PATCH', token, body });

  assert.equal((await adjust(t.tlStruct)).status, 403, 'another team\'s leader');
  assert.equal((await adjust(t.headStruct)).status, 403, 'another department\'s head');
  assert.equal((await adjust(t.pm2)).status, 403, 'another project manager');
  assert.equal((await adjust(t.employee)).status, 403, 'capability required');
  assert.equal((await adjust(t.mgmt)).status, 403, 'Management only views');

  assert.equal((await adjust(t.tl)).status, 200, 'their team leader');
  assert.equal((await adjust(t.head)).status, 200, 'their department head');
  assert.equal((await adjust(t.pm)).status, 200, 'the project manager');
});

test('review queue: each reviewer sees only the people they answer for', async () => {
  const mkStale = async (taskId, employeeId) => {
    const log = await f.addOpenLog(taskId, employeeId);
    await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 20 HOUR WHERE log_id = ?', [log]);
    return log;
  };
  const piping = await mkStale(await f.addTask(f.project2, f.subInputStudy, f.pipingB, 'Stale piping'), f.pipingB);
  const struct = await mkStale(await f.addTask(manager2Project, f.subModelling, f.structA, 'Stale struct'), f.structA);

  const flagged = async (token) => (await get('/time-logs/flagged', token)).body.timeLogs.map((l) => l.id);
  const has = (list, ...wanted) => wanted.every((id) => list.includes(id));

  const tl = await flagged(t.tl);
  assert.ok(has(tl, piping) && !tl.includes(struct), 'team leader: their team only');
  const tlS = await flagged(t.tlStruct);
  assert.ok(has(tlS, struct) && !tlS.includes(piping));
  const head = await flagged(t.head);
  assert.ok(has(head, piping) && !head.includes(struct));
  const pm = await flagged(t.pm);
  assert.ok(has(pm, piping) && !pm.includes(struct), 'project manager: their projects only');
  const pm2 = await flagged(t.pm2);
  assert.ok(has(pm2, struct) && !pm2.includes(piping));
});

// ======================================================================== reports

test('reports are limited to what the viewer may see', async () => {
  const projects = async (token) => (await get('/reports/projects', token)).body.projects.map((p) => p.id).sort((a, b) => a - b);
  assert.deepEqual(await projects(t.pm), [f.project1, f.project2].sort((a, b) => a - b));
  assert.deepEqual(await projects(t.pm2), [manager2Project]);
  assert.equal((await projects(t.mgmt)).length, 3);

  const people = async (token) => (await get('/reports/employee-work-time', token)).body.employees.map((e) => e.employeeId);
  const tlPeople = await people(t.tl);
  assert.ok(tlPeople.every((id) => [f.pipingA, f.pipingB, f.tlPiping].includes(id)), 'team leader: own team');
  const headPeople = await people(t.head);
  assert.ok(headPeople.every((id) => [f.pipingA, f.pipingB, f.tlPiping].includes(id)), 'department head: own department');
  assert.ok(!headPeople.includes(f.structA));
  assert.ok((await people(t.mgmt)).includes(f.structA));
});

test('a project manager\'s employee report counts only work on their own projects', async () => {
  // structA has hours on a project manager two project; manager one must not see them
  const id = await f.addTask(manager2Project, f.subModelling, f.structA, 'Hidden hours', 50);
  await f.addLog(id, f.structA, 600);

  const read = async (token) => (await get('/reports/employee-work-time', token)).body.employees.find((e) => e.employeeId === f.structA);
  const pmOne = await read(t.pm);
  const pmTwo = await read(t.pm2);
  const mgmt = await read(t.mgmt);
  assert.ok(!pmOne || pmOne.totalHours < pmTwo.totalHours, 'manager one does not see manager two\'s hours');
  assert.ok(pmTwo.totalHours >= 10);
  assert.ok(mgmt.totalHours >= pmTwo.totalHours);
});

// ================================================================ pickers

test('assignee picker: each person is offered exactly who they could assign work to', async () => {
  const names = async (project, token) => (await get(`/projects/${project}/assignees`, token)).body.assignees.map((a) => a.name).sort();

  assert.deepEqual(await names(f.project1, t.pm), ['Piping A', 'Piping B', 'Structural A', 'TL Piping', 'TL Structural']);
  assert.deepEqual(await names(f.project1, t.head), ['Piping A', 'Piping B', 'TL Piping'], 'department head: own department only');
  assert.deepEqual(await names(f.project1, t.tl), ['Piping A', 'Piping B', 'TL Piping'], 'team leader: own team, including themselves');
  assert.deepEqual(await names(f.project1, t.tlStruct), ['Structural A', 'TL Structural']);
  assert.deepEqual(await names(f.project2, t.pm), ['Piping A', 'Piping B', 'TL Piping'], 'only the departments of that project');
});

test('assignee picker: never offers inactive people, managers or other roles', async () => {
  const all = (await get(`/projects/${f.project1}/assignees`, t.pm)).body.assignees.map((a) => a.id);
  for (const excluded of [f.inactive, f.headPiping, f.manager1, f.hr, f.mgmt, f.sysadmin]) {
    assert.ok(!all.includes(excluded), `employee ${excluded}`);
  }
});

test('assignee picker: refused outside your scope, and by roles that cannot allocate', async () => {
  const status = (project, token) => get(`/projects/${project}/assignees`, token).then((r) => r.status);
  assert.equal(await status(f.project1, t.pm2), 403, 'someone else\'s project');
  assert.equal(await status(f.project1, t.mgmt), 403);
  assert.equal(await status(f.project1, t.employee), 403);
  assert.equal(await status(f.project1, t.hr), 403);
  assert.equal(await status(99999, t.pm), 404);
});

test('assignee picker agrees with what assigning actually allows', async () => {
  for (const [token, label] of [[t.pm, 'pm'], [t.head, 'head'], [t.tl, 'tl'], [t.tlStruct, 'tlStruct']]) {
    const offered = (await get(`/projects/${f.project1}/assignees`, token)).body.assignees;
    for (const person of offered) {
      const sub = person.departmentId === f.piping ? f.subInputStudy : f.subModelling;
      const res = await assign(f.project1, { subDepartmentId: sub, taskName: `picker ${label}`, employeeId: person.id, allocatedHours: 1 }, token);
      assert.equal(res.status, 201, `${label} offered ${person.name} but could not assign`);
    }
  }
});

test('project managers list: those who can create projects see the eligible people', async () => {
  const res = await get('/projects/project-managers', t.pm);
  assert.equal(res.status, 200);
  const names = res.body.managers.map((m) => m.name).sort();
  assert.deepEqual(names, ['Head Piping', 'Head Structural', 'Manager One', 'Manager Two']);

  assert.equal((await get('/projects/project-managers', t.head)).status, 200);
  for (const token of [t.tl, t.employee, t.mgmt, t.hr, t.sys]) {
    assert.equal((await get('/projects/project-managers', token)).status, 403);
  }
});
