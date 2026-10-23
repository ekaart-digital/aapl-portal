const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let pipingA; let pipingB;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const start = (taskId, token) => app.api(`/tasks/${taskId}/time-logs/start`, { method: 'POST', token });
const stop = (taskId, logId, token) => app.api(`/tasks/${taskId}/time-logs/${logId}/stop`, { method: 'POST', token });

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  pipingA = await app.login(code(f.pipingA));
  pipingB = await app.login(code(f.pipingB));
});
after(() => app.close(f));

test('start: creates an open session and moves a Not Started task to In Progress', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Start me');
  const res = await start(task, pipingA);
  assert.equal(res.status, 201);
  assert.equal(res.body.timeLog.isOpen, true);
  assert.equal(res.body.timeLog.endTime, null);
  assert.equal(res.body.timeLog.durationMinutes, null);
  assert.equal(res.body.timeLog.taskId, task);

  const t = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(t.body.task.status, 'In Progress');
  await stop(task, res.body.timeLog.id, pipingA);
});

test('start: only one open timer per employee', async () => {
  const t1 = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'First');
  const t2 = await f.addTask(f.project1, f.subAnalysis, f.pipingA, 'Second');
  const first = await start(t1, pipingA);
  assert.equal(first.status, 201);

  const second = await start(t2, pipingA);
  assert.equal(second.status, 409);
  const sameTask = await start(t1, pipingA);
  assert.equal(sameTask.status, 409);

  const open = await f.db.query('SELECT COUNT(*) AS n FROM time_logs WHERE employee_id = ? AND end_time IS NULL', [f.pipingA]);
  assert.equal(open[0][0].n, 1);

  await stop(t1, first.body.timeLog.id, pipingA);
  const afterStop = await start(t2, pipingA);
  assert.equal(afterStop.status, 201, 'can start another once the first is stopped');
  await stop(t2, afterStop.body.timeLog.id, pipingA);
});

test('start: two different employees can run timers at the same time', async () => {
  const a = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'A runs');
  const b = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'B runs');
  const ra = await start(a, pipingA);
  const rb = await start(b, pipingB);
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201);
  await stop(a, ra.body.timeLog.id, pipingA);
  await stop(b, rb.body.timeLog.id, pipingB);
});

test('start: only the task owner can start it; unknown task is 404', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Owned by A');
  assert.equal((await start(task, pipingB)).status, 403);
  assert.equal((await start(task, mgr)).status, 403);
  assert.equal((await start(99999, pipingA)).status, 404);
});

test('start: a completed task cannot be started', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Done task', 10, 'Completed');
  assert.equal((await start(task, pipingA)).status, 409);
});

test('start: an On Hold task keeps its status when a session starts', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Held', 10, 'On Hold');
  const res = await start(task, pipingA);
  assert.equal(res.status, 201);
  const t = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(t.body.task.status, 'On Hold');
  await stop(task, res.body.timeLog.id, pipingA);
});

test('stop: closes the session, records at least 1 minute, and adds to task hours', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Stop me');
  const started = await start(task, pipingA);
  const res = await stop(task, started.body.timeLog.id, pipingA);
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.isOpen, false);
  assert.ok(res.body.timeLog.endTime);
  assert.equal(res.body.timeLog.durationMinutes, 1);

  const t = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(t.body.task.completedHours, 0);
});

test('stop: duration reflects real elapsed minutes', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Long session');
  const log = await f.addOpenLog(task, f.pipingA);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 125 MINUTE WHERE log_id = ?', [log]);
  const res = await stop(task, log, pipingA);
  assert.equal(res.body.timeLog.durationMinutes, 125);

  const t = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(t.body.task.completedHours, 2.1);
});

test('stop: cannot stop twice, cannot stop someone else’s session, unknown log is 404', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Stop rules');
  const started = await start(task, pipingA);
  const logId = started.body.timeLog.id;

  assert.equal((await stop(task, logId, pipingB)).status, 403);
  assert.equal((await stop(task, 99999, pipingA)).status, 404);
  assert.equal((await stop(task, logId, pipingA)).status, 200);
  assert.equal((await stop(task, logId, pipingA)).status, 409);
});

test('my-open-session: returns the running session, then null after stop', async () => {
  const none = await app.api('/tasks/my-open-session', { token: pipingB });
  assert.equal(none.body.openSession, null);

  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Restore me');
  const started = await start(task, pipingB);
  const open = await app.api('/tasks/my-open-session', { token: pipingB });
  assert.equal(open.body.openSession.id, started.body.timeLog.id);
  assert.equal(open.body.openSession.taskId, task);

  await stop(task, started.body.timeLog.id, pipingB);
  const closed = await app.api('/tasks/my-open-session', { token: pipingB });
  assert.equal(closed.body.openSession, null);
});

test('a running session contributes 0 hours until stopped', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Zero until stop');
  await f.addLog(task, f.pipingA, 60);
  const started = await start(task, pipingA);

  const running = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(running.body.task.completedHours, 1);
  await stop(task, started.body.timeLog.id, pipingA);
});

test('session history: owner and manager can read it, other employees cannot', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'History');
  await f.addLog(task, f.pipingA, 30, 2);
  await f.addLog(task, f.pipingA, 15, 1);

  const own = await app.api(`/tasks/${task}/time-logs`, { token: pipingA });
  assert.equal(own.status, 200);
  assert.equal(own.body.timeLogs.length, 2);
  assert.ok(own.body.timeLogs[0].startTime >= own.body.timeLogs[1].startTime, 'newest first');

  assert.equal((await app.api(`/tasks/${task}/time-logs`, { token: mgr })).status, 200);
  assert.equal((await app.api(`/tasks/${task}/time-logs`, { token: pipingB })).status, 403);
  assert.equal((await app.api('/tasks/99999/time-logs', { token: mgr })).status, 404);
});

test('open sessions report elapsedSeconds from the database clock', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Elapsed');
  const log = await f.addOpenLog(task, f.pipingA);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL 90 SECOND WHERE log_id = ?', [log]);

  const open = await app.api('/tasks/my-open-session', { token: pipingA });
  assert.ok(open.body.openSession.elapsedSeconds >= 90 && open.body.openSession.elapsedSeconds < 95);

  const stopped = await stop(task, log, pipingA);
  assert.equal(stopped.body.timeLog.elapsedSeconds, null);

  const fresh = await start(task, pipingA);
  assert.ok(fresh.body.timeLog.elapsedSeconds <= 2);
  await stop(task, fresh.body.timeLog.id, pipingA);
});
