const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let mgr2; let pipingA; let pipingB;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const svc = () => require('../src/services/notifications');
const sweep = () => require('../src/services/timerSweep').autoStopStaleSessions;

// Notifications stored for one person (optionally of one type), oldest first.
async function stored(recipientId, type) {
  const [rows] = await f.db.query(
    `SELECT * FROM notifications WHERE recipient_id = ? ${type ? 'AND type = ?' : ''} ORDER BY notification_id`,
    type ? [recipientId, type] : [recipientId]
  );
  return rows;
}
const clearAll = () => f.db.query('DELETE FROM notifications');
const inbox = (token, query = '') => app.api(`/notifications${query}`, { token });
const patchTask = (id, body, token = mgr) => app.api(`/tasks/${id}`, { method: 'PATCH', token, body });
const adjust = (logId, body) => app.api(`/time-logs/${logId}`, { method: 'PATCH', token: mgr, body });

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  mgr2 = await app.login(code(f.manager2));
  pipingA = await app.login(code(f.pipingA));
  pipingB = await app.login(code(f.pipingB));
});
after(() => app.close(f));

// ================================================================== the inbox API

test('every notification endpoint requires a signed-in user', async () => {
  assert.equal((await app.api('/notifications')).status, 401);
  assert.equal((await app.api('/notifications/unread-count')).status, 401);
  assert.equal((await app.api('/notifications/read-all', { method: 'POST' })).status, 401);
  assert.equal((await app.api('/notifications/1/read', { method: 'PATCH' })).status, 401);
});

test('inbox: lists only my notifications, newest first, with an unread count', async () => {
  await clearAll();
  const { notify } = svc();
  await notify({ recipientIds: f.pipingA, type: 't', title: 'First', body: 'one', link: '/my-tasks' });
  await notify({ recipientIds: f.pipingA, type: 't', severity: 'critical', title: 'Second', body: 'two' });
  await notify({ recipientIds: f.pipingB, type: 't', title: 'Not yours' });

  const res = await inbox(pipingA);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.notifications.map((n) => n.title), ['Second', 'First']);
  assert.equal(res.body.unreadCount, 2);
  assert.equal(res.body.hasMore, false);

  const first = res.body.notifications[1];
  assert.deepEqual(Object.keys(first).sort(), ['ageSeconds', 'body', 'id', 'link', 'read', 'severity', 'title', 'type']);
  assert.equal(first.link, '/my-tasks');
  assert.equal(first.read, false);
  assert.ok(first.ageSeconds >= 0 && first.ageSeconds < 60);
  assert.equal(res.body.notifications[0].severity, 'critical');

  assert.deepEqual((await inbox(pipingB)).body.notifications.map((n) => n.title), ['Not yours']);
  assert.deepEqual((await inbox(mgr)).body.notifications, []);
});

test('inbox: paging with limit and before, and the unread filter', async () => {
  await clearAll();
  const { notify } = svc();
  for (let i = 1; i <= 5; i += 1) await notify({ recipientIds: f.pipingA, type: 't', title: `N${i}` });

  const page1 = await inbox(pipingA, '?limit=2');
  assert.deepEqual(page1.body.notifications.map((n) => n.title), ['N5', 'N4']);
  assert.equal(page1.body.hasMore, true);

  const page2 = await inbox(pipingA, `?limit=2&before=${page1.body.notifications[1].id}`);
  assert.deepEqual(page2.body.notifications.map((n) => n.title), ['N3', 'N2']);
  assert.equal(page2.body.hasMore, true);

  const page3 = await inbox(pipingA, `?limit=2&before=${page2.body.notifications[1].id}`);
  assert.deepEqual(page3.body.notifications.map((n) => n.title), ['N1']);
  assert.equal(page3.body.hasMore, false);

  await app.api(`/notifications/${page1.body.notifications[0].id}/read`, { method: 'PATCH', token: pipingA });
  const unread = await inbox(pipingA, '?unread=1');
  assert.deepEqual(unread.body.notifications.map((n) => n.title), ['N4', 'N3', 'N2', 'N1']);
  assert.equal(unread.body.unreadCount, 4);
});

test('inbox: limit is clamped and a bad cursor is rejected', async () => {
  assert.equal((await inbox(pipingA, '?before=abc')).status, 400);
  assert.equal((await inbox(pipingA, '?before=1;DROP')).status, 400);
  assert.equal((await inbox(pipingA, '?limit=100000')).status, 200);
  assert.equal((await inbox(pipingA, '?limit=-5')).status, 200);
});

test('mark read: marks one of mine, is repeatable, and updates the count', async () => {
  await clearAll();
  const { notify } = svc();
  await notify({ recipientIds: f.pipingA, type: 't', title: 'A' });
  await notify({ recipientIds: f.pipingA, type: 't', title: 'B' });
  const [a, b] = (await inbox(pipingA)).body.notifications;

  const res = await app.api(`/notifications/${a.id}/read`, { method: 'PATCH', token: pipingA });
  assert.equal(res.status, 200);
  assert.equal(res.body.unreadCount, 1);
  const again = await app.api(`/notifications/${a.id}/read`, { method: 'PATCH', token: pipingA });
  assert.equal(again.status, 200, 'marking it read twice is fine');
  assert.equal(again.body.unreadCount, 1);

  const row = (await stored(f.pipingA)).find((r) => r.notification_id === a.id);
  assert.equal(row.is_read, 1);
  assert.ok(row.read_at);
  assert.equal((await stored(f.pipingA)).find((r) => r.notification_id === b.id).is_read, 0);
  assert.equal((await app.api('/notifications/unread-count', { token: pipingA })).body.unreadCount, 1);
});

test('mark read: someone else’s or an unknown notification is a 404 and stays unread', async () => {
  await clearAll();
  await svc().notify({ recipientIds: f.pipingB, type: 't', title: 'B only' });
  const id = (await inbox(pipingB)).body.notifications[0].id;

  assert.equal((await app.api(`/notifications/${id}/read`, { method: 'PATCH', token: pipingA })).status, 404);
  assert.equal((await app.api('/notifications/99999/read', { method: 'PATCH', token: pipingA })).status, 404);
  assert.equal((await stored(f.pipingB))[0].is_read, 0);
});

test('mark all read: clears only my own', async () => {
  await clearAll();
  const { notify } = svc();
  await notify({ recipientIds: [f.pipingA, f.pipingB], type: 't', title: 'Both' });
  await notify({ recipientIds: f.pipingA, type: 't', title: 'Only A' });

  const res = await app.api('/notifications/read-all', { method: 'POST', token: pipingA });
  assert.equal(res.status, 200);
  assert.equal(res.body.unreadCount, 0);
  assert.equal((await inbox(pipingA)).body.unreadCount, 0);
  assert.equal((await inbox(pipingB)).body.unreadCount, 1, 'B is unaffected');
});

// ============================================================== the service itself

test('a repeated event with the same key notifies each person once', async () => {
  await clearAll();
  const { notify } = svc();
  for (let i = 0; i < 3; i += 1) {
    await notify({ recipientIds: [f.pipingA, f.pipingB], type: 't', title: 'Once', dedupeKey: 'same-event' });
  }
  assert.equal((await stored(f.pipingA)).length, 1);
  assert.equal((await stored(f.pipingB)).length, 1);

  await notify({ recipientIds: f.pipingA, type: 't', title: 'No key 1' });
  await notify({ recipientIds: f.pipingA, type: 't', title: 'No key 2' });
  assert.equal((await stored(f.pipingA)).length, 3, 'events without a key are never merged');
});

test('a failed notification never throws into the caller', async () => {
  const { notify } = svc();
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(notify({ recipientIds: 99999, type: 't', title: 'Nobody' }));
  } finally {
    console.error = originalError;
  }
});

test('long text is trimmed to fit instead of failing', async () => {
  await clearAll();
  await svc().notify({ recipientIds: f.pipingA, type: 't', title: 'T'.repeat(500), body: 'B'.repeat(900) });
  const [row] = await stored(f.pipingA);
  assert.equal(row.title.length, 200);
  assert.equal(row.body.length, 500);
});

// ======================================================================== task events

test('assigning a task notifies the employee (not the manager who did it)', async () => {
  await clearAll();
  const res = await app.api(`/projects/${f.project1}/tasks`, {
    method: 'POST', token: mgr,
    body: { subDepartmentId: f.subInputStudy, taskName: 'Review loads', employeeId: f.pipingA, allocatedHours: 8, dueDate: '2031-03-04' },
  });
  assert.equal(res.status, 201);

  const [n] = await stored(f.pipingA, 'task-assigned');
  assert.ok(n);
  assert.equal(n.severity, 'info');
  assert.equal(n.link, '/my-tasks');
  assert.match(n.body, /Review loads/);
  assert.match(n.body, /Project One/);
  assert.match(n.body, /2031-03-04/);
  assert.equal((await stored(f.manager1)).length, 0);
});

test('a failed assignment creates no notification', async () => {
  await clearAll();
  await app.api(`/projects/${f.project1}/tasks`, {
    method: 'POST', token: mgr,
    body: { subDepartmentId: f.subInputStudy, taskName: 'Wrong person', employeeId: f.structA, allocatedHours: 8 },
  });
  assert.equal((await stored(f.structA)).length, 0);
});

test('reassigning notifies the new assignee and the previous one, nobody else', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Handover');
  assert.equal((await patchTask(id, { employeeId: f.pipingB })).status, 200);

  const toNew = await stored(f.pipingB, 'task-assigned');
  const toOld = await stored(f.pipingA, 'task-reassigned');
  assert.equal(toNew.length, 1);
  assert.equal(toOld.length, 1);
  assert.match(toNew[0].body, /Handover/);
  assert.match(toOld[0].body, /Piping B/);
  assert.match(toOld[0].body, /already logged/i);
  assert.equal((await stored(f.manager1)).length, 0);
  assert.equal((await stored(f.structA)).length, 0);
});

test('an employee putting a task on hold alerts the project manager, with the remarks', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Blocked task', 10, 'In Progress');
  const res = await patchTask(id, { status: 'On Hold', remarks: 'Waiting for client data' }, pipingA);
  assert.equal(res.status, 200);

  const [n] = await stored(f.manager1, 'task-on-hold');
  assert.ok(n);
  assert.equal(n.severity, 'attention');
  assert.equal(n.link, `/projects/${f.project1}`);
  assert.match(n.body, /Piping A/);
  assert.match(n.body, /Blocked task/);
  assert.match(n.body, /Waiting for client data/);
  assert.equal((await stored(f.pipingA)).length, 0, 'the employee is not told about their own action');
  assert.equal((await stored(f.manager2)).length, 0, 'only the project manager is told');
});

test('an employee completing a task tells the project manager', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Finish me', 10, 'In Progress');
  await patchTask(id, { status: 'Completed' }, pipingA);
  const [n] = await stored(f.manager1, 'task-completed');
  assert.ok(n);
  assert.equal(n.severity, 'info');
  assert.match(n.body, /Finish me/);
});

test('other status changes, and saving the same status again, notify nobody', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Quiet task');
  await patchTask(id, { status: 'In Progress' }, pipingA);
  await patchTask(id, { status: 'In Progress', remarks: 'note' }, pipingA);
  await patchTask(id, { status: 'On Hold' }, pipingA);
  await clearAll();
  await patchTask(id, { status: 'On Hold', remarks: 'still on hold' }, pipingA);
  assert.equal((await stored(f.manager1)).length, 0, 'no repeat alert for an unchanged status');
});

test('a manager changing a task’s status tells the assignee', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Reopened', 10, 'Completed');
  await patchTask(id, { status: 'In Progress' });
  const [n] = await stored(f.pipingA, 'task-status-changed');
  assert.ok(n);
  assert.match(n.title, /In Progress/);
  assert.equal((await stored(f.manager1)).length, 0);
});

test('reassigning and changing status together sends only the assignment notices', async () => {
  await clearAll();
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Both at once', 10, 'In Progress');
  await patchTask(id, { employeeId: f.pipingB, status: 'On Hold' });
  assert.equal((await stored(f.pipingB, 'task-assigned')).length, 1);
  assert.equal((await stored(f.pipingB, 'task-status-changed')).length, 0);
});

// =================================================================== project events

test('creating a project with another manager as PM notifies them; as yourself, nobody', async () => {
  await clearAll();
  const base = { name: 'PM test', clientName: 'C', estimatedManHours: 10, departmentIds: [f.piping] };
  await app.api('/projects', { method: 'POST', token: mgr, body: { ...base, jobCode: 'N-1', projectManagerId: f.manager2 } });
  const [n] = await stored(f.manager2, 'project-assigned');
  assert.ok(n);
  assert.match(n.body, /PM test/);

  await clearAll();
  await app.api('/projects', { method: 'POST', token: mgr, body: { ...base, jobCode: 'N-2', projectManagerId: f.manager1 } });
  assert.equal((await stored(f.manager1)).length, 0);
});

test('changing the project manager notifies the new one and the previous one', async () => {
  await clearAll();
  const res = await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr, body: { projectManagerId: f.manager2 } });
  assert.equal(res.status, 200);
  assert.equal((await stored(f.manager2, 'project-assigned')).length, 1);
  assert.equal((await stored(f.manager1, 'project-manager-changed')).length, 1);

  await clearAll();
  // manager2 now manages the project, so manager2 is the one who can edit it
  await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr2, body: { projectManagerId: f.manager2, priority: 'High' } });
  assert.equal((await stored(f.manager2)).length, 0, 'not repeated when the manager is unchanged');
  await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr2, body: { projectManagerId: f.manager1 } });
});

// =================================================================== budget alerts

test('budget: warns the PM at 80% and again at 100%, each only once', async () => {
  await clearAll();
  await f.db.query('UPDATE projects SET estimated_man_hours = 10 WHERE project_id = ?', [f.project2]);
  const task = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Budget task', 50);
  const log = await f.addLog(task, f.pipingA, 60);

  await adjust(log, { durationMinutes: 7 * 60, note: 'Seventy percent' });
  assert.equal((await stored(f.manager1)).filter((n) => n.type.startsWith('budget')).length, 0, '70% is quiet');

  await adjust(log, { durationMinutes: 8.5 * 60, note: 'Eighty five percent' });
  const warn = await stored(f.manager1, 'budget-warning');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, 'attention');
  assert.match(warn[0].body, /85%/);
  assert.equal(warn[0].link, `/projects/${f.project2}`);

  await adjust(log, { durationMinutes: 9 * 60, note: 'Ninety percent' });
  assert.equal((await stored(f.manager1, 'budget-warning')).length, 1, 'no second 80% warning');

  await adjust(log, { durationMinutes: 10.5 * 60, note: 'Over the estimate' });
  const over = await stored(f.manager1, 'budget-exceeded');
  assert.equal(over.length, 1);
  assert.equal(over[0].severity, 'critical');

  await adjust(log, { durationMinutes: 11 * 60, note: 'Still over' });
  assert.equal((await stored(f.manager1, 'budget-exceeded')).length, 1, 'no second 100% alert');
});

test('budget: changing the estimate re-checks straight away and re-arms the alerts', async () => {
  const warnings = async () => (await stored(f.manager1, 'budget-warning')).length;
  const before = await warnings();

  // 11h are logged against a 10h estimate. Raising it to 12h makes that 92%: a fresh warning.
  await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr, body: { estimatedManHours: 12 } });
  assert.equal(await warnings(), before + 1);
  const latest = (await stored(f.manager1, 'budget-warning')).pop();
  assert.match(latest.body, /12 estimated man-hours/);

  // Saving the same estimate again does not repeat it.
  await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr, body: { estimatedManHours: 12, priority: 'High' } });
  assert.equal(await warnings(), before + 1);

  // A generous estimate (11h of 100h) is quiet.
  await app.api(`/projects/${f.project2}`, { method: 'PATCH', token: mgr, body: { estimatedManHours: 100 } });
  assert.equal(await warnings(), before + 1);
});

test('budget: editing the estimate down below current use alerts immediately', async () => {
  await clearAll();
  await f.db.query('UPDATE projects SET estimated_man_hours = 100, status = ? WHERE project_id = ?', ['In Progress', f.project1]);
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Big job', 200);
  await f.addLog(task, f.pipingA, 60 * 30);
  await app.api(`/projects/${f.project1}`, { method: 'PATCH', token: mgr, body: { estimatedManHours: 20 } });
  assert.equal((await stored(f.manager1, 'budget-exceeded')).length, 1);
});

test('budget: a completed project raises no alerts', async () => {
  await clearAll();
  await f.db.query("UPDATE projects SET status = 'Completed', estimated_man_hours = 1 WHERE project_id = ?", [f.project2]);
  const task = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'After completion');
  const log = await f.addLog(task, f.pipingA, 600);
  await adjust(log, { durationMinutes: 700, note: 'Late entry' });
  assert.equal((await stored(f.manager1)).filter((n) => n.type.startsWith('budget')).length, 0);
  await f.db.query("UPDATE projects SET status = 'In Progress', estimated_man_hours = 50 WHERE project_id = ?", [f.project2]);
});

// ============================================================== timer & sessions

test('a forgotten timer notifies the employee and the project manager, once', async () => {
  await clearAll();
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Left running', 20);
  const log = await f.addOpenLog(task, f.pipingA);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 16 HOUR WHERE log_id = ?', [log]);

  assert.equal(await sweep()(), 1);
  assert.equal(await sweep()(), 0);
  await sweep()(f.pipingA);

  const mine = await stored(f.pipingA, 'timer-auto-stopped');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].severity, 'attention');
  assert.match(mine[0].body, /Left running/);
  assert.match(mine[0].body, /12h 00m/);
  assert.equal(mine[0].link, '/my-tasks');

  const theirs = await stored(f.manager1, 'session-needs-review');
  assert.equal(theirs.length, 1);
  assert.match(theirs[0].body, /Piping A/);
  assert.match(theirs[0].body, /Left running/);
  assert.equal(theirs[0].link, '/reports?tab=review');
});

test('stopping a timer that ran past the limit also notifies', async () => {
  await clearAll();
  const task = await f.addTask(f.project1, f.subModelling, f.structA, 'Overnight', 20);
  const log = await f.addOpenLog(task, f.structA);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 14 HOUR WHERE log_id = ?', [log]);
  const structToken = await app.login(code(f.structA));

  const res = await app.api(`/tasks/${task}/time-logs/${log}/stop`, { method: 'POST', token: structToken });
  assert.equal(res.body.timeLog.autoStopped, true);
  assert.equal((await stored(f.structA, 'timer-auto-stopped')).length, 1);
  assert.equal((await stored(f.manager1, 'session-needs-review')).length, 1);
});

test('a normal stop creates no timer notification', async () => {
  await clearAll();
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Normal day', 20);
  const log = await f.addOpenLog(task, f.pipingB);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 3 HOUR WHERE log_id = ?', [log]);
  await app.api(`/tasks/${task}/time-logs/${log}/stop`, { method: 'POST', token: pipingB });
  assert.equal((await stored(f.pipingB)).filter((n) => n.type === 'timer-auto-stopped').length, 0);
  assert.equal((await stored(f.manager1)).filter((n) => n.type === 'session-needs-review').length, 0);
});

test('adjusting a session tells the employee what changed and why', async () => {
  await clearAll();
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Corrected work', 20);
  const log = await f.addLog(task, f.pipingA, 12 * 60);
  await adjust(log, { durationMinutes: 8 * 60 + 30, note: 'Stopped at 5:30pm' });

  const [n] = await stored(f.pipingA, 'session-adjusted');
  assert.ok(n);
  assert.match(n.body, /Corrected work/);
  assert.match(n.body, /12h 00m/);
  assert.match(n.body, /8h 30m/);
  assert.match(n.body, /Stopped at 5:30pm/);
  assert.equal((await stored(f.manager1, 'session-adjusted')).length, 0);
});

test('a rejected adjustment creates no notification', async () => {
  await clearAll();
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Bad adjust', 20);
  const log = await f.addLog(task, f.pipingA, 60);
  await adjust(log, { durationMinutes: 30 });
  assert.equal((await stored(f.pipingA)).length, 0);
});

// ====================================================================== due dates

test('due dates: due-soon for the employee, recent overdue for the employee and the PM, once each', async () => {
  await clearAll();
  const { generateDueNotifications } = svc();
  const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const mk = async (name, due, status = 'In Progress') => {
    const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, name, 5, status);
    await f.db.query('UPDATE tasks SET due_date = ? WHERE task_id = ?', [due, id]);
    return id;
  };
  await mk('Due today', daysFromNow(0));
  await mk('Due in two days', daysFromNow(2));
  await mk('Due in five days', daysFromNow(5));
  await mk('Two days late', daysFromNow(-2));
  await mk('Long overdue', daysFromNow(-10));
  await mk('Done and late', daysFromNow(-3), 'Completed');
  await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'No due date');

  await generateDueNotifications();
  await generateDueNotifications();

  const soon = await stored(f.pipingA, 'task-due-soon');
  assert.equal(soon.length, 2);
  assert.ok(soon.some((n) => /Due today/.test(n.body) && /today/.test(n.body)));
  assert.ok(soon.some((n) => /Due in two days/.test(n.body) && /in 2 days/.test(n.body)));

  const late = await stored(f.pipingA, 'task-overdue');
  assert.equal(late.length, 1);
  assert.match(late[0].body, /Two days late/);
  assert.match(late[0].body, /2 days overdue/);
  assert.equal(late[0].severity, 'attention');

  const pm = await stored(f.manager1, 'task-overdue');
  assert.equal(pm.length, 1);
  assert.equal(pm[0].severity, 'critical');
  assert.match(pm[0].body, /Piping A/);
  assert.equal(pm[0].link, `/projects/${f.project1}`);

  const everything = (await stored(f.pipingA)).map((n) => n.body).join(' ');
  assert.ok(!/Due in five days|Done and late|No due date|Long overdue/.test(everything), 'no alert for far-off, finished, undated or long-overdue tasks');
});

test('due dates: moving the due date later re-arms the alert', async () => {
  await clearAll();
  const { generateDueNotifications } = svc();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Moves', 5, 'In Progress');
  await f.db.query('UPDATE tasks SET due_date = ? WHERE task_id = ?', [tomorrow, id]);
  await generateDueNotifications();
  await f.db.query('UPDATE tasks SET due_date = ? WHERE task_id = ?', [dayAfter, id]);
  await generateDueNotifications();
  assert.equal((await stored(f.pipingB, 'task-due-soon')).length, 2);
});

test('due dates: nothing for tasks of a completed project', async () => {
  await clearAll();
  await f.db.query("UPDATE projects SET status = 'Completed' WHERE project_id = ?", [f.project2]);
  const id = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Closed project task', 5, 'In Progress');
  await f.db.query('UPDATE tasks SET due_date = CURDATE() - INTERVAL 2 DAY WHERE task_id = ?', [id]);
  await svc().generateDueNotifications();
  assert.equal((await stored(f.pipingA)).filter((n) => /Closed project task/.test(n.body)).length, 0);
  await f.db.query("UPDATE projects SET status = 'In Progress' WHERE project_id = ?", [f.project2]);
});

// ========================================================================= cleanup

test('purge: old read notifications go, unread and recent ones stay', async () => {
  await clearAll();
  const { notify, purgeOldNotifications } = svc();
  await notify({ recipientIds: f.pipingA, type: 't', title: 'Old read' });
  await notify({ recipientIds: f.pipingA, type: 't', title: 'Old unread' });
  await notify({ recipientIds: f.pipingA, type: 't', title: 'Recent read' });
  await f.db.query("UPDATE notifications SET created_at = NOW() - INTERVAL 120 DAY WHERE title IN ('Old read', 'Old unread')");
  await f.db.query("UPDATE notifications SET is_read = 1 WHERE title IN ('Old read', 'Recent read')");

  assert.equal(await purgeOldNotifications(), 1);
  assert.deepEqual((await stored(f.pipingA)).map((n) => n.title).sort(), ['Old unread', 'Recent read']);
});

test('deleting an employee removes their notifications', async () => {
  await clearAll();
  const [res] = await f.db.query(
    "INSERT INTO employees (name, email, password_hash, department_id, role) VALUES ('Temp', 'temp@test.local', 'x', ?, 'employee')",
    [f.piping]
  );
  await svc().notify({ recipientIds: res.insertId, type: 't', title: 'Temp note' });
  assert.equal((await stored(res.insertId)).length, 1);
  await f.db.query('DELETE FROM employees WHERE employee_id = ?', [res.insertId]);
  assert.equal((await stored(res.insertId)).length, 0);
});

test('due dates: a backlog of old overdue tasks does not flood anyone', async () => {
  await clearAll();
  for (let i = 0; i < 12; i += 1) {
    const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, `Old backlog ${i}`, 5, 'In Progress');
    await f.db.query('UPDATE tasks SET due_date = CURDATE() - INTERVAL ? DAY WHERE task_id = ?', [20 + i, id]);
  }
  await svc().generateDueNotifications();
  assert.equal((await stored(f.pipingA)).filter((n) => /Old backlog/.test(n.body)).length, 0);
  assert.equal((await stored(f.manager1)).filter((n) => /Old backlog/.test(n.body)).length, 0);
});
