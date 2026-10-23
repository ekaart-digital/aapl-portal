const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

// The role dashboards (SRS §25), the project man-hour health (§26) and the
// exception screen (§30), and the extra task statuses (§16).
//
//   project1: 100h estimate, Piping + Structural     project2: 50h estimate, Piping
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const edit = (id, body, token) => app.api(`/tasks/${id}`, { method: 'PATCH', token, body });
const sql = (q, p) => f.db.query(q, p);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    employee: await app.login(code(f.pipingA)),
    tl: await app.login(code(f.tlPiping)),
    tlStruct: await app.login(code(f.tlStruct)),
    head: await app.login(code(f.headPiping)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
    sys: await app.login(code(f.sysadmin)),
  };
  task = {
    done: await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Done task', 20, 'Completed'),
    open: await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'Open task', 10, 'In Progress'),
    struct: await f.addTask(f.project1, f.subModelling, f.structA, 'Struct task', 10),
    p2: await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Project two task', 10),
  };
  await f.addLog(task.done, f.pipingA, 20 * 60, 3); // 20h on the finished task
  await f.addLog(task.open, f.pipingB, 30 * 60, 2); // 30h on the open one (3x its allocation)
  await f.addLog(task.struct, f.structA, 5 * 60, 1);
  await sql('UPDATE tasks SET due_date = CURDATE() - INTERVAL 5 DAY WHERE task_id = ?', [task.open]); // 5 days late
});
after(() => app.close(f));

// ===================================================================== statuses
test('tasks accept Partially Completed and Awaiting Input, and reject unknown statuses', async () => {
  for (const status of ['Partially Completed', 'Awaiting Input']) {
    const res = await edit(task.p2, { status }, t.employee);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.task.status, status);
  }
  assert.equal((await edit(task.p2, { status: 'Dancing' }, t.employee)).status, 400);
  await sql("UPDATE tasks SET status = 'Not Started' WHERE task_id = ?", [task.p2]);
});

test('starting the timer on a task that is waiting or partly done resumes it', async () => {
  for (const status of ['Awaiting Input', 'Partially Completed']) {
    await sql('UPDATE tasks SET status = ? WHERE task_id = ?', [status, task.p2]);
    const start = await app.api(`/tasks/${task.p2}/time-logs/start`, { method: 'POST', token: t.employee });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal((await get(`/tasks/${task.p2}`, t.employee)).body.task.status, 'In Progress');
    const stop = await app.api(`/tasks/${task.p2}/time-logs/${start.body.timeLog.id}/stop`, { method: 'POST', token: t.employee });
    assert.equal(stop.status, 200, JSON.stringify(stop.body));
  }
  await sql("UPDATE tasks SET status = 'Not Started' WHERE task_id = ?", [task.p2]);
});

test('an employee marking a task Awaiting Input tells the Team Leader and the Project Manager', async () => {
  await edit(task.p2, { status: 'Awaiting Input', remarks: 'Need the P&ID' }, t.employee);
  const [rows] = await sql("SELECT recipient_id FROM notifications WHERE type = 'task-awaiting-input'");
  const who = rows.map((r) => r.recipient_id);
  assert.ok(who.includes(f.manager1));
  assert.ok(who.includes(f.tlPiping));
  assert.ok(!who.includes(f.pipingA));
  await sql("UPDATE tasks SET status = 'Not Started' WHERE task_id = ?", [task.p2]);
});

// ===================================================================== access
test('only Team Leader, Department Head and Management have a home dashboard', async () => {
  for (const [who, expected] of [['tl', 200], ['head', 200], ['mgmt', 200], ['employee', 403], ['pm', 403], ['hr', 403], ['sys', 403]]) {
    assert.equal((await get('/dashboard', t[who])).status, expected, who);
  }
  assert.equal((await app.api('/dashboard')).status, 401);
});

test('project health and exceptions are open to the roles that review work, not to HR, SysAdmin or Employees', async () => {
  for (const path of ['/dashboard/projects', '/dashboard/exceptions']) {
    for (const [who, expected] of [['tl', 200], ['head', 200], ['pm', 200], ['mgmt', 200], ['employee', 403], ['hr', 403], ['sys', 403]]) {
      assert.equal((await get(path, t[who])).status, expected, `${path} ${who}`);
    }
  }
});

// ===================================================================== dashboards
test('the Team Leader dashboard covers their own team only', async () => {
  const res = await get('/dashboard', t.tl);
  assert.equal(res.body.kind, 'team');
  assert.equal(res.body.scopeLabel, 'Piping Team');
  assert.deepEqual(res.body.people.map((p) => p.name).sort(), ['Piping A', 'Piping B', 'TL Piping']);
  // Task counts exclude the structural team's task.
  assert.equal(res.body.statusCounts['Not Started'] || 0, 1); // only project two's task
  assert.equal(res.body.stats.overdueTasks, 1);
  const b = res.body.people.find((p) => p.name === 'Piping B');
  assert.equal(b.openTasks, 1);
  assert.equal(b.overdueTasks, 1);
});

test('the other team leader sees none of the first team', async () => {
  const res = await get('/dashboard', t.tlStruct);
  assert.deepEqual(res.body.people.map((p) => p.name).sort(), ['Structural A', 'TL Structural']);
  assert.equal(res.body.stats.overdueTasks, 0);
});

test('the Department Head dashboard covers their department', async () => {
  const res = await get('/dashboard', t.head);
  assert.equal(res.body.kind, 'department');
  assert.equal(res.body.scopeLabel, 'Piping');
  assert.ok(res.body.people.every((p) => p.department === 'Piping'));
  assert.equal(res.body.stats.people, 3); // Piping A, Piping B and the team leader; the inactive person and the head are not counted
});

test('the Management dashboard covers everyone', async () => {
  const res = await get('/dashboard', t.mgmt);
  assert.equal(res.body.kind, 'company');
  assert.equal(res.body.stats.people, 5); // 3 piping, 2 structural; the inactive person is not counted
  assert.ok(res.body.stats.activeProjects >= 2);
});

test('a running timer shows on the dashboard', async () => {
  const log = await f.addOpenLog(task.open, f.pipingB);
  const res = await get('/dashboard', t.tl);
  assert.equal(res.body.people.find((p) => p.name === 'Piping B').runningTask, 'Open task');
  assert.equal(res.body.stats.runningNow, 1);
  await sql('DELETE FROM time_logs WHERE log_id = ?', [log]);
});

// ===================================================================== man-hour health
test('project health reports consumed, remaining and completion', async () => {
  const res = await get('/dashboard/projects', t.pm);
  const p1 = res.body.projects.find((p) => p.id === f.project1);
  assert.equal(p1.estimatedManHours, 100);
  assert.equal(p1.consumedManHours, 55);
  assert.equal(p1.remainingManHours, 45);
  assert.equal(p1.consumedPercent, 55);
  // 20h of the 40h allocated is finished.
  assert.equal(p1.completionPercent, 50);
  // 55h used for 50% done => on course for 110h against 100h.
  assert.equal(p1.projectedFinalManHours, 110);
  assert.equal(p1.risk, 'AMBER');
});

test('risk turns RED once the estimate is used up and GREEN when there is plenty left', async () => {
  const rows = (await get('/dashboard/projects', t.pm)).body.projects;
  assert.equal(rows.find((p) => p.id === f.project2).risk, 'GREEN');

  await f.addLog(task.p2, f.pipingA, 50 * 60, 1); // all 50h of project two
  const after = (await get('/dashboard/projects', t.pm)).body.projects;
  assert.equal(after.find((p) => p.id === f.project2).risk, 'RED');
  await sql('DELETE FROM time_logs WHERE task_id = ?', [task.p2]);
});

test('risk is RED for a project past its target date', async () => {
  await sql('UPDATE projects SET target_date = CURDATE() - INTERVAL 1 DAY WHERE project_id = ?', [f.project2]);
  const p2 = (await get('/dashboard/projects', t.pm)).body.projects.find((p) => p.id === f.project2);
  assert.equal(p2.overdue, true);
  assert.equal(p2.risk, 'RED');
  await sql('UPDATE projects SET target_date = NULL WHERE project_id = ?', [f.project2]);
});

test('project health respects scope: a Project Manager sees only their projects', async () => {
  assert.deepEqual((await get('/dashboard/projects', t.pm2)).body.projects, []);
  assert.ok((await get('/dashboard/projects', t.mgmt)).body.projects.length >= 2);
});

test('the man-hour breakdown splits hours by person, task type and department', async () => {
  const res = await get(`/dashboard/projects/${f.project1}`, t.pm);
  assert.equal(res.status, 200);
  const p = res.body.project;
  assert.deepEqual(p.byEmployee.map((x) => [x.name, x.hours]), [['Piping B', 30], ['Piping A', 20], ['Structural A', 5]]);
  assert.deepEqual(p.byDepartment.map((x) => [x.name, x.hours]), [['Piping', 50], ['Structural', 5]]);
  assert.deepEqual(p.byTaskType.map((x) => [x.name, x.hours]), [['Analysis', 30], ['Input Study', 20], ['Modelling', 5]]);
});

test('a Department Head’s breakdown is limited to their department’s tasks', async () => {
  const p = (await get(`/dashboard/projects/${f.project1}`, t.head)).body.project;
  assert.deepEqual(p.byDepartment.map((x) => x.name), ['Piping']);
  assert.ok(!p.byEmployee.some((x) => x.name === 'Structural A'));
});

test('a project the caller cannot see is not found', async () => {
  assert.equal((await get(`/dashboard/projects/${f.project1}`, t.pm2)).status, 404);
  assert.equal((await get('/dashboard/projects/999999', t.pm)).status, 404);
});

// ===================================================================== exceptions
test('exceptions list overdue and over-allocated tasks, most severe first', async () => {
  const res = await get('/dashboard/exceptions', t.pm);
  const types = res.body.exceptions.map((e) => e.type);
  assert.ok(types.includes('task-overdue'));
  assert.ok(types.includes('task-over-allocation'));
  const overdue = res.body.exceptions.find((e) => e.type === 'task-overdue');
  assert.equal(overdue.severity, 'critical'); // 5 days late
  assert.equal(overdue.employeeName, 'Piping B');
  // Critical items come before attention items.
  const order = res.body.exceptions.map((e) => e.severity);
  assert.deepEqual(order, [...order].sort((a, b) => (a === 'critical' ? 0 : 1) - (b === 'critical' ? 0 : 1)));
});

test('exceptions can be filtered by severity and type', async () => {
  const critical = (await get('/dashboard/exceptions?severity=critical', t.pm)).body.exceptions;
  assert.ok(critical.length && critical.every((e) => e.severity === 'critical'));
  const only = (await get('/dashboard/exceptions?type=task-overdue', t.pm)).body.exceptions;
  assert.ok(only.length && only.every((e) => e.type === 'task-overdue'));
});

test('waiting and held tasks are exceptions', async () => {
  await sql("UPDATE tasks SET status = 'Awaiting Input' WHERE task_id = ?", [task.p2]);
  const items = (await get('/dashboard/exceptions', t.pm)).body.exceptions;
  assert.ok(items.some((e) => e.type === 'task-awaiting-input' && e.taskId === task.p2));
  await sql("UPDATE tasks SET status = 'Not Started' WHERE task_id = ?", [task.p2]);
});

test('an auto-stopped session shows as a time-review exception to the people who can review it', async () => {
  const log = await f.addLog(task.struct, f.structA, 12 * 60, 1);
  await sql('UPDATE time_logs SET auto_stopped = 1 WHERE log_id = ?', [log]);
  const seen = async (who) => (await get('/dashboard/exceptions', t[who])).body.exceptions.some((e) => e.type === 'session-review');
  assert.equal(await seen('pm'), true);
  assert.equal(await seen('tlStruct'), true);
  assert.equal(await seen('tl'), false); // the other team's leader
  assert.equal(await seen('mgmt'), false); // management only watches
  await sql('DELETE FROM time_logs WHERE log_id = ?', [log]);
});

test('exceptions are scoped: another Project Manager sees none of this project’s', async () => {
  assert.deepEqual((await get('/dashboard/exceptions', t.pm2)).body.exceptions, []);
});

test('the Team Leader’s exceptions cover their team’s tasks, not other teams’', async () => {
  const tl = (await get('/dashboard/exceptions', t.tl)).body.exceptions;
  assert.ok(tl.some((e) => e.employeeName === 'Piping B'));
  const other = (await get('/dashboard/exceptions', t.tlStruct)).body.exceptions;
  assert.ok(!other.some((e) => e.employeeName === 'Piping B'));
});
