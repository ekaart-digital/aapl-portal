const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');
const { periodRange } = require('../src/services/periods');

// The employee daily/weekly/monthly report (SRS section 28), the day/week/month
// summary (sections 31 to 33) and the team filter on the work-time report.
//
// Dates are fixed in the past so the tests do not depend on today's date:
//   Wed 2025-03-12 .. a week Mon 2025-03-10 to Sun 2025-03-16, and March 2025.
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const sql = (q, p) => f.db.query(q, p);

const logOn = (taskId, employeeId, date, minutes) => sql(
  `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date)
   VALUES (?, ?, ?, ? + INTERVAL ? MINUTE, ?, ?)`,
  [taskId, employeeId, `${date} 09:00:00`, `${date} 09:00:00`, minutes, minutes, date]
);
const report = (id, period, date, token) => get(`/reports/employee/${id}?period=${period}&date=${date}`, token);
const summary = (period, date, token) => get(`/reports/summary?period=${period}&date=${date}`, token);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    b: await app.login(code(f.pipingB)),
    structA: await app.login(code(f.structA)),
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
    calc: await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Calc task', 30),
    review: await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Review task', 30),
    p2: await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Project two task', 30),
    b: await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'B task', 30),
    s: await f.addTask(f.project1, f.subModelling, f.structA, 'Struct task', 30),
  };
  await sql("UPDATE tasks SET category = 'Calculation' WHERE task_id = ?", [task.calc]);
  await sql("UPDATE tasks SET category = 'Review' WHERE task_id = ?", [task.review]);
  await sql("UPDATE tasks SET status = 'In Progress' WHERE task_id = ?", [task.calc]);
  await sql("UPDATE tasks SET status = 'Completed', completed_at = '2025-03-13 16:00:00' WHERE task_id = ?", [task.p2]);

  await logOn(task.calc, f.pipingA, '2025-03-10', 120); // Mon: 2h calc
  await logOn(task.calc, f.pipingA, '2025-03-12', 180); // Wed: 3h calc
  await logOn(task.review, f.pipingA, '2025-03-12', 60); // Wed: 1h review
  await logOn(task.p2, f.pipingA, '2025-03-14', 30); // Fri: 0.5h project two
  await logOn(task.b, f.pipingB, '2025-03-12', 240); // Wed: B 4h
  await logOn(task.s, f.structA, '2025-03-12', 300); // Wed: structural 5h
  await logOn(task.calc, f.pipingA, '2025-03-20', 600); // later in March, another week
  await logOn(task.calc, f.pipingA, '2025-04-02', 600); // April
});
after(() => app.close(f));

// ===================================================================== period ranges
test('periods: a day is itself, a week runs Monday to Sunday, a month is the calendar month', () => {
  assert.deepEqual([periodRange('day', '2025-03-12').from, periodRange('day', '2025-03-12').to], ['2025-03-12', '2025-03-12']);
  const week = periodRange('week', '2025-03-12');
  assert.deepEqual([week.from, week.to, week.days.length], ['2025-03-10', '2025-03-16', 7]);
  assert.equal(periodRange('week', '2025-03-16').from, '2025-03-10'); // Sunday belongs to the week before
  assert.equal(periodRange('week', '2025-03-17').from, '2025-03-17');
  const month = periodRange('month', '2025-02-10');
  assert.deepEqual([month.from, month.to, month.days.length], ['2025-02-01', '2025-02-28', 28]);
  assert.equal(periodRange('month', '2024-02-10').days.length, 29); // leap year
  assert.equal(periodRange('week', '2025-12-31').to, '2026-01-04'); // across the new year
});

test('periods: impossible dates and unknown periods are refused', () => {
  assert.ok(periodRange('day', '2025-02-30').error);
  assert.ok(periodRange('day', '12/03/2025').error);
  assert.ok(periodRange('year', '2025-03-12').error);
  assert.equal(periodRange().period, 'day'); // defaults to today
});

// ===================================================================== employee report
test('a week report totals hours, days, projects, categories and a daily series', async () => {
  const res = await report(f.pipingA, 'week', '2025-03-12', t.a);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = res.body;
  assert.equal(r.employee.name, 'Piping A');
  assert.deepEqual([r.from, r.to], ['2025-03-10', '2025-03-16']);
  assert.equal(r.totalHours, 6.5);
  assert.equal(r.sessionCount, 4);
  assert.equal(r.daysWorked, 3);
  assert.equal(r.averageHoursPerDayWorked, 2.2); // 6.5 / 3, one decimal
  assert.deepEqual(r.byProject.map((p) => [p.name, p.jobCode, p.hours]), [['Project One', 'T-001', 6], ['Project Two', 'T-002', 0.5]]);
  assert.deepEqual(r.byCategory.map((c) => [c.name, c.hours]), [['Calculation', 5], ['Review', 1], ['Uncategorised', 0.5]]);
  assert.deepEqual(r.daily.map((d) => d.hours), [2, 0, 4, 0, 0.5, 0, 0]);
  assert.equal(r.daily[0].date, '2025-03-10');
});

test('a day and a month report cover exactly their own dates', async () => {
  const day = (await report(f.pipingA, 'day', '2025-03-12', t.a)).body;
  assert.equal(day.totalHours, 4);
  assert.equal(day.daily.length, 1);
  const month = (await report(f.pipingA, 'month', '2025-03-01', t.a)).body;
  assert.equal(month.totalHours, 16.5); // the 20th adds 10h
  assert.equal(month.daily.length, 31);
  assert.equal((await report(f.pipingA, 'month', '2025-04-15', t.a)).body.totalHours, 10);
  assert.equal((await report(f.pipingA, 'day', '2025-03-11', t.a)).body.totalHours, 0);
});

test('task status, planned hours and tasks finished in the period are included', async () => {
  const mar = (await report(f.pipingA, 'week', '2025-03-13', t.a)).body;
  assert.equal(mar.tasksCompletedInPeriod, 1); // project two's task, finished on the 13th
  assert.equal((await report(f.pipingA, 'week', '2025-03-24', t.a)).body.tasksCompletedInPeriod, 0);
  assert.deepEqual(mar.taskStatus, { 'In Progress': 1, 'Not Started': 1, Completed: 1 });
  assert.equal(mar.openPlannedHours, 60); // the two open tasks, 30h each
});

test('a running session is not counted', async () => {
  await sql("INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW(), '2025-03-12')", [task.calc, f.pipingA]);
  assert.equal((await report(f.pipingA, 'day', '2025-03-12', t.a)).body.totalHours, 4);
  await sql('DELETE FROM time_logs WHERE end_time IS NULL');
});

test('who may open whose report', async () => {
  const status = async (who, id) => (await report(id, 'week', '2025-03-12', t[who])).status;
  assert.equal(await status('a', f.pipingA), 200); // yourself
  assert.equal(await status('b', f.pipingA), 403); // another employee
  assert.equal(await status('tl', f.pipingA), 200); // their team leader
  assert.equal(await status('tlStruct', f.pipingA), 403); // another team's leader
  assert.equal(await status('head', f.pipingA), 200);
  assert.equal(await status('pm', f.pipingA), 200);
  assert.equal(await status('mgmt', f.pipingA), 200);
  assert.equal(await status('tl', f.tlPiping), 200); // a team leader's own
  assert.equal(await status('hr', f.pipingA), 403); // no time data
  assert.equal(await status('sys', f.pipingA), 403);
  assert.equal((await app.api(`/reports/employee/${f.pipingA}`)).status, 401);
});

test('a manager sees only the work they may see in someone’s report', async () => {
  await sql('UPDATE projects SET project_manager_id = ? WHERE project_id = ?', [f.manager2, f.project2]);
  const pm2 = await app.login(code(f.manager2));
  // manager2 now manages only project two; manager1 only project one.
  const forPm2 = (await report(f.pipingA, 'week', '2025-03-12', pm2)).body;
  assert.deepEqual(forPm2.byProject.map((p) => p.name), ['Project Two']);
  assert.equal(forPm2.totalHours, 0.5);
  const forPm1 = (await report(f.pipingA, 'week', '2025-03-12', t.pm)).body;
  assert.deepEqual(forPm1.byProject.map((p) => p.name), ['Project One']);
  // The person themselves always sees everything they logged.
  assert.equal((await report(f.pipingA, 'week', '2025-03-12', t.a)).body.totalHours, 6.5);
  await sql('UPDATE projects SET project_manager_id = ? WHERE project_id = ?', [f.manager1, f.project2]);
});

test('only people who log project work have a report, and bad requests are refused', async () => {
  assert.equal((await report(f.headPiping, 'week', '2025-03-12', t.mgmt)).status, 404); // a department head
  assert.equal((await report(999999, 'week', '2025-03-12', t.mgmt)).status, 404);
  assert.equal((await report(f.pipingA, 'year', '2025-03-12', t.a)).status, 400);
  assert.equal((await report(f.pipingA, 'week', '2025-13-45', t.a)).status, 400);
  const today = await get(`/reports/employee/${f.pipingA}`, t.a);
  assert.equal(today.status, 200);
  assert.equal(today.body.period, 'day'); // defaults
});

// ===================================================================== summary
test('a day summary totals everything in scope with the breakdowns', async () => {
  const res = await summary('day', '2025-03-12', t.mgmt);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const s = res.body;
  assert.equal(s.totalHours, 13); // 3 + 1 + 4 + 5
  assert.equal(s.sessionCount, 4);
  assert.equal(s.peopleWhoLogged, 3);
  assert.deepEqual(s.byDepartment.map((d) => [d.name, d.hours]), [['Piping', 8], ['Structural', 5]]);
  assert.deepEqual(s.byEmployee.map((e) => [e.name, e.hours]), [['Structural A', 5], ['Piping A', 4], ['Piping B', 4]]);
  assert.deepEqual(s.byCategory.map((c) => [c.name, c.hours]), [['Uncategorised', 9], ['Calculation', 3], ['Review', 1]]);
  assert.deepEqual(s.daily, [{ date: '2025-03-12', hours: 13 }]);
  assert.equal(s.topProjects[0].name, 'Project One');
});

test('a week summary has a seven day trend; a month summary one for every day', async () => {
  const week = (await summary('week', '2025-03-12', t.mgmt)).body;
  assert.equal(week.totalHours, 15.5); // adds Monday 2h and Friday 0.5h
  assert.deepEqual(week.daily.map((d) => d.hours), [2, 0, 13, 0, 0.5, 0, 0]);
  const month = (await summary('month', '2025-03-01', t.mgmt)).body;
  assert.equal(month.totalHours, 25.5);
  assert.equal(month.daily.length, 31);
});

test('tasks finished in the period and overdue tasks are counted', async () => {
  await sql("UPDATE tasks SET due_date = '2025-01-01' WHERE task_id = ?", [task.b]);
  const s = (await summary('week', '2025-03-13', t.mgmt)).body;
  assert.equal(s.tasksCompleted, 1);
  assert.ok(s.overdueTasks >= 1);
});

test('who logged no hours is reported for the roles that look after people', async () => {
  const day = (await summary('day', '2025-03-12', t.mgmt)).body.people;
  assert.deepEqual(day, { total: 5, withHours: 3, withoutHours: 2 }); // five task holders, two quiet (both team leaders)
  const team = (await summary('day', '2025-03-12', t.tl)).body.people;
  assert.deepEqual(team, { total: 3, withHours: 2, withoutHours: 1 }); // Piping A, Piping B and the leader
  assert.equal((await summary('day', '2025-03-12', t.pm)).body.people, null);
});

test('summaries are limited to each role’s scope', async () => {
  assert.equal((await summary('day', '2025-03-12', t.head)).body.totalHours, 8); // Piping only
  assert.equal((await summary('day', '2025-03-12', t.tl)).body.totalHours, 8);
  assert.equal((await summary('day', '2025-03-12', t.tlStruct)).body.totalHours, 5);
  assert.equal((await summary('day', '2025-03-12', t.pm)).body.totalHours, 13);
  assert.equal((await summary('day', '2025-03-12', t.pm2)).body.totalHours, 0);
  assert.equal((await summary('day', '2025-03-12', t.a)).status, 403);
  assert.equal((await summary('day', '2025-03-12', t.hr)).status, 403);
});

test('projects nearing their budget and major exceptions are listed', async () => {
  await sql('UPDATE projects SET estimated_man_hours = 20 WHERE project_id = ?', [f.project1]);
  const s = (await summary('day', '2025-03-12', t.mgmt)).body;
  const p = s.projectsNearingBudget.find((x) => x.name === 'Project One');
  assert.ok(p);
  assert.equal(p.risk, 'RED');
  assert.ok(s.majorExceptions.every((e) => e.severity === 'critical'));
  assert.ok(s.majorExceptions.length <= 8);
  await sql('UPDATE projects SET estimated_man_hours = 100 WHERE project_id = ?', [f.project1]);
});

test('summary requests are validated', async () => {
  assert.equal((await get('/reports/summary?period=century', t.mgmt)).status, 400);
  assert.equal((await get('/reports/summary?period=day&date=nope', t.mgmt)).status, 400);
  const d = await get('/reports/summary', t.mgmt);
  assert.equal(d.status, 200);
  assert.equal(d.body.period, 'day');
});

// ===================================================================== team filter
test('the work-time report can be filtered to a team', async () => {
  const all = (await get('/reports/employee-work-time', t.mgmt)).body.employees.map((e) => e.name).sort();
  assert.deepEqual(all, ['Piping A', 'Piping B', 'Structural A']);
  const team = (await get(`/reports/employee-work-time?teamId=${f.pipingTeam}`, t.mgmt)).body.employees.map((e) => e.name).sort();
  assert.deepEqual(team, ['Piping A', 'Piping B']);
  const other = (await get(`/reports/employee-work-time?teamId=${f.structTeam}`, t.mgmt)).body.employees.map((e) => e.name);
  assert.deepEqual(other, ['Structural A']);
  assert.equal((await get('/reports/employee-work-time?teamId=abc', t.mgmt)).status, 400);
});
