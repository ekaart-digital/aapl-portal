const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

let f; let app; let mgr; let pipingA; let pipingB; let structA;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const start = (taskId, token) => app.api(`/tasks/${taskId}/time-logs/start`, { method: 'POST', token });
const stop = (taskId, logId, token) => app.api(`/tasks/${taskId}/time-logs/${logId}/stop`, { method: 'POST', token });
const adjust = (logId, body, token = mgr) => app.api(`/time-logs/${logId}`, { method: 'PATCH', token, body });
const CAP = 720;

// An open session that began `minutes` ago.
async function openSessionStartedAgo(taskId, employeeId, minutes) {
  const log = await f.addOpenLog(taskId, employeeId);
  await f.db.query('UPDATE time_logs SET start_time = NOW() - INTERVAL ? MINUTE WHERE log_id = ?', [minutes, log]);
  return log;
}

const row = async (logId) => (await f.db.query('SELECT * FROM time_logs WHERE log_id = ?', [logId]))[0][0];

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  mgr = await app.login(code(f.manager1));
  pipingA = await app.login(code(f.pipingA));
  pipingB = await app.login(code(f.pipingB));
  structA = await app.login(code(f.structA));
});
after(() => app.close(f));

// ---------------------------------------------------------------- stopping

test('stop: a normal session is not flagged', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Normal');
  const log = await openSessionStartedAgo(task, f.pipingA, 90);
  const res = await stop(task, log, pipingA);
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.durationMinutes, 90);
  assert.equal(res.body.timeLog.autoStopped, false);
  assert.equal(res.body.timeLog.needsReview, false);
  assert.equal(res.body.maxSessionMinutes, CAP);
});

test('stop: just under the limit is credited in full', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Edge');
  const log = await openSessionStartedAgo(task, f.pipingA, CAP - 1);
  const res = await stop(task, log, pipingA);
  assert.equal(res.body.timeLog.durationMinutes, CAP - 1);
  assert.equal(res.body.timeLog.autoStopped, false);
});

test('stop: a session left running past 12 hours is capped at 12 hours and flagged', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Forgotten');
  const log = await openSessionStartedAgo(task, f.pipingA, 30 * 60); // 30 hours
  const res = await stop(task, log, pipingA);
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.durationMinutes, CAP);
  assert.equal(res.body.timeLog.autoStopped, true);
  assert.equal(res.body.timeLog.needsReview, true);

  const t = await app.api(`/tasks/${task}`, { token: pipingA });
  assert.equal(t.body.task.completedHours, 12);

  const saved = await row(log);
  const gap = await f.db.query('SELECT TIMESTAMPDIFF(MINUTE, start_time, end_time) AS m FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(gap[0][0].m, CAP, 'end time is start + 12h, not now');
  assert.equal(saved.auto_stopped, 1);
});

test('the limit can be changed with MAX_SESSION_HOURS', async () => {
  process.env.MAX_SESSION_HOURS = '2';
  try {
    const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Short cap');
    const log = await openSessionStartedAgo(task, f.pipingA, 3 * 60);
    const res = await stop(task, log, pipingA);
    assert.equal(res.body.timeLog.durationMinutes, 120);
    assert.equal(res.body.maxSessionMinutes, 120);
  } finally {
    delete process.env.MAX_SESSION_HOURS;
  }
});

// ---------------------------------------------------------------- sweeping

test('starting a new timer is not blocked by a forgotten one', async () => {
  const forgotten = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Left running overnight');
  const next = await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'Next morning');
  const log = await openSessionStartedAgo(forgotten, f.pipingB, 20 * 60);

  const res = await start(next, pipingB);
  assert.equal(res.status, 201, 'new timer starts');

  const closed = await row(log);
  assert.equal(closed.duration_minutes, CAP);
  assert.equal(closed.auto_stopped, 1);
  assert.ok(closed.end_time);
  await stop(next, res.body.timeLog.id, pipingB);
});

test('a timer still within the limit does block starting another (rule unchanged)', async () => {
  const a = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Running legitimately');
  const b = await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'Cannot start');
  const log = await openSessionStartedAgo(a, f.pipingB, 3 * 60);
  assert.equal((await start(b, pipingB)).status, 409);
  assert.equal((await row(log)).end_time, null);
  await stop(a, log, pipingB);
});

test('my-open-session closes a stale session and tells the employee', async () => {
  // structA has no other flagged sessions, so the notice must be this one.
  const task = await f.addTask(f.project1, f.subModelling, f.structA, 'Stale for notice');
  const log = await openSessionStartedAgo(task, f.structA, 15 * 60);

  const res = await app.api('/tasks/my-open-session', { token: structA });
  assert.equal(res.body.openSession, null);
  assert.equal(res.body.autoStoppedSession.id, log);
  assert.equal(res.body.autoStoppedSession.taskName, 'Stale for notice');
  assert.equal(res.body.autoStoppedSession.durationMinutes, CAP);
  assert.equal(res.body.maxSessionMinutes, CAP);

  await adjust(log, { durationMinutes: CAP, note: 'Reviewed, kept' });
  const after = await app.api('/tasks/my-open-session', { token: structA });
  assert.equal(after.body.autoStoppedSession, null, 'notice goes away once a manager reviews it');
});

test('my-open-session leaves a running timer within the limit alone', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Still fine');
  const log = await openSessionStartedAgo(task, f.pipingB, 5 * 60);
  const res = await app.api('/tasks/my-open-session', { token: pipingB });
  assert.equal(res.body.openSession.id, log);
  assert.ok(res.body.openSession.elapsedSeconds >= 5 * 60 * 60);
  await stop(task, log, pipingB);
});

test('the scheduled sweep closes every stale session, and only those', async () => {
  const { autoStopStaleSessions } = require('../src/services/timerSweep');
  const t1 = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Sweep A');
  const t2 = await f.addTask(f.project1, f.subAnalysis, f.pipingB, 'Sweep B');
  const t3 = await f.addTask(f.project1, f.subModelling, f.structA, 'Sweep fresh');
  const staleA = await openSessionStartedAgo(t1, f.pipingA, 14 * 60);
  const staleB = await openSessionStartedAgo(t2, f.pipingB, 40 * 60);
  const fresh = await openSessionStartedAgo(t3, f.structA, 60);
  const finished = await f.addLog(t3, f.structA, 45, 3);

  assert.equal(await autoStopStaleSessions(), 2);
  assert.equal((await row(staleA)).duration_minutes, CAP);
  assert.equal((await row(staleB)).duration_minutes, CAP);
  assert.equal((await row(fresh)).end_time, null, 'fresh session untouched');
  assert.equal((await row(finished)).auto_stopped, 0, 'finished session untouched');
  assert.equal(await autoStopStaleSessions(), 0, 'running it again changes nothing');

  await f.db.query('UPDATE time_logs SET end_time = NOW(), duration_minutes = 60 WHERE log_id = ?', [fresh]);
});

test('reports count a stale session at the cap, not zero', async () => {
  const task = await f.addTask(f.project2, f.subInputStudy, f.pipingA, 'Report sweep');
  await openSessionStartedAgo(task, f.pipingA, 25 * 60);

  const projects = await app.api('/reports/projects', { token: mgr });
  const p2 = projects.body.projects.find((p) => p.id === f.project2);
  assert.ok(p2.completedManHours >= 12);
});

// ----------------------------------------------------------- review queue

test('review queue: managers only, lists unreviewed auto-stopped sessions with context', async () => {
  assert.equal((await app.api('/time-logs/flagged', { token: pipingA })).status, 403);
  assert.equal((await app.api('/time-logs/flagged')).status, 401);

  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Queue me');
  const log = await openSessionStartedAgo(task, f.pipingA, 16 * 60);

  const res = await app.api('/time-logs/flagged', { token: mgr });
  assert.equal(res.status, 200);
  const item = res.body.timeLogs.find((l) => l.id === log);
  assert.ok(item);
  assert.equal(item.taskName, 'Queue me');
  assert.equal(item.projectName, 'Project One');
  assert.equal(item.projectJobCode, 'T-001');
  assert.equal(item.employeeName, 'Piping A');
  assert.equal(item.durationMinutes, CAP);
  assert.equal(item.needsReview, true);
  assert.equal(res.body.maxSessionMinutes, CAP);
});

test('review queue: a reviewed session leaves the queue', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Review then gone');
  const log = await openSessionStartedAgo(task, f.pipingB, 18 * 60);
  const before = await app.api('/time-logs/flagged', { token: mgr });
  assert.ok(before.body.timeLogs.some((l) => l.id === log));

  assert.equal((await adjust(log, { durationMinutes: 300, note: 'Left at 5pm' })).status, 200);
  const afterReview = await app.api('/time-logs/flagged', { token: mgr });
  assert.ok(!afterReview.body.timeLogs.some((l) => l.id === log));
});

// -------------------------------------------------------- manager correction

test('adjust: managers only', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Auth');
  const log = await f.addLog(task, f.pipingA, 60);
  assert.equal((await adjust(log, { durationMinutes: 30, note: 'nope' }, pipingA)).status, 403);
  assert.equal((await app.api(`/time-logs/${log}`, { method: 'PATCH', body: { durationMinutes: 30, note: 'nope' } })).status, 401);
  assert.equal((await row(log)).duration_minutes, 60, 'unchanged');
});

test('adjust: validates the duration and requires an explanatory note', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Validation');
  const log = await f.addLog(task, f.pipingA, 60);
  const bad = [
    [{ note: 'No duration' }, 'missing duration'],
    [{ durationMinutes: '30', note: 'string duration' }, 'string duration'],
    [{ durationMinutes: 30.5, note: 'fractional' }, 'fractional'],
    [{ durationMinutes: -1, note: 'negative' }, 'negative'],
    [{ durationMinutes: 24 * 60 + 1, note: 'too long' }, 'over 24h'],
    [{ durationMinutes: 30 }, 'missing note'],
    [{ durationMinutes: 30, note: '  ' }, 'blank note'],
    [{ durationMinutes: 30, note: 'ab' }, 'note too short'],
    [{ durationMinutes: 30, note: 'x'.repeat(501) }, 'note too long'],
    [{ durationMinutes: 30, note: 12345 }, 'non-string note'],
  ];
  for (const [body, label] of bad) {
    assert.equal((await adjust(log, body)).status, 400, label);
  }
  assert.equal((await row(log)).duration_minutes, 60, 'nothing changed');
  assert.equal((await adjust(99999, { durationMinutes: 10, note: 'missing log' })).status, 404);
});

test('adjust: a running session cannot be corrected', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Running');
  const log = await f.addOpenLog(task, f.pipingA);
  assert.equal((await adjust(log, { durationMinutes: 10, note: 'still running' })).status, 409);
  await f.db.query('UPDATE time_logs SET end_time = NOW(), duration_minutes = 1 WHERE log_id = ?', [log]);
});

test('adjust: sets the new length, records who/when/why, and changes the totals', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Correct me', 20);
  const log = await openSessionStartedAgo(task, f.pipingA, 40 * 60);
  await app.api('/tasks/my-open-session', { token: pipingA }); // sweep closes it at 12h
  assert.equal((await app.api(`/tasks/${task}`, { token: pipingA })).body.task.completedHours, 12);

  const res = await adjust(log, { durationMinutes: 450, note: '  Left at 5:30pm, confirmed with employee  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.durationMinutes, 450);
  assert.equal(res.body.timeLog.needsReview, false);
  assert.equal(res.body.timeLog.autoStopped, true, 'history of the auto-stop is kept');
  assert.equal(res.body.timeLog.note, 'Left at 5:30pm, confirmed with employee');
  assert.equal(res.body.timeLog.editedByName, 'Manager One');
  assert.ok(res.body.timeLog.editedAt);

  const saved = await row(log);
  assert.equal(saved.edited_by, f.manager1);
  const gap = await f.db.query('SELECT TIMESTAMPDIFF(MINUTE, start_time, end_time) AS m FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(gap[0][0].m, 450, 'end time follows the corrected length');
  assert.equal((await app.api(`/tasks/${task}`, { token: pipingA })).body.task.completedHours, 7.5);
});

test('adjust: 0 minutes voids a session but keeps the record', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Void me');
  const log = await f.addLog(task, f.pipingA, 600);
  const res = await adjust(log, { durationMinutes: 0, note: 'Timer left on while away, no work done' });
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.durationMinutes, 0);
  assert.equal((await app.api(`/tasks/${task}`, { token: pipingA })).body.task.completedHours, 0);
  const history = await app.api(`/tasks/${task}/time-logs`, { token: mgr });
  assert.equal(history.body.timeLogs.length, 1);
});

test('adjust: approving a flagged session as it is clears the flag without changing hours', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingB, 'Approve');
  const log = await openSessionStartedAgo(task, f.pipingB, 13 * 60);
  await app.api('/tasks/my-open-session', { token: pipingB });
  const res = await adjust(log, { durationMinutes: CAP, note: 'Reviewed, full day confirmed' });
  assert.equal(res.body.timeLog.durationMinutes, CAP);
  assert.equal(res.body.timeLog.needsReview, false);
});

test('adjust: a manager may credit more than the cap (up to 24h) when it is genuinely correct', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Long shift');
  const log = await f.addLog(task, f.pipingA, 100);
  const res = await adjust(log, { durationMinutes: 14 * 60, note: 'Site visit, confirmed by client' });
  assert.equal(res.status, 200);
  assert.equal(res.body.timeLog.durationMinutes, 840);
});

test('session history shows the auto-stop flag, note and editor to managers and owners', async () => {
  const task = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'History detail');
  const log = await openSessionStartedAgo(task, f.pipingA, 22 * 60);
  await app.api('/tasks/my-open-session', { token: pipingA });
  await adjust(log, { durationMinutes: 400, note: 'Corrected after check' });

  for (const token of [mgr, pipingA]) {
    const res = await app.api(`/tasks/${task}/time-logs`, { token });
    const entry = res.body.timeLogs.find((l) => l.id === log);
    assert.equal(entry.autoStopped, true);
    assert.equal(entry.note, 'Corrected after check');
    assert.equal(entry.editedByName, 'Manager One');
  }
});
