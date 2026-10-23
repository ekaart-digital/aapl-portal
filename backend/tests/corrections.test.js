const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');

// Employee correction requests (a time correction an employee asks for and
// the people responsible for their time decide on) and the rule that nobody
// signs off their own time.
//
//   pipingA, pipingB, tlPiping are in the Piping team (leader tlPiping, head headPiping).
//   project1 is managed by manager1.
let f; let app; let t; let task;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const get = (path, token) => app.api(path, { token });
const post = (path, body, token) => app.api(path, { method: 'POST', token, body });
const sql = (q, p) => f.db.query(q, p);
const request = (logId, durationMinutes, reason, token) => post('/corrections', { logId, durationMinutes, reason }, token);

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
    headStruct: await app.login(code(f.headStruct)),
    pm: await app.login(code(f.manager1)),
    pm2: await app.login(code(f.manager2)),
    hr: await app.login(code(f.hr)),
    mgmt: await app.login(code(f.mgmt)),
  };
  task = {
    a: await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Task of A', 20),
    tl: await f.addTask(f.project1, f.subAnalysis, f.tlPiping, 'Task of the TL', 20),
  };
});
after(() => app.close(f));

const newLog = async (taskId, employeeId, minutes = 120, daysAgo = 1) => f.addLog(taskId, employeeId, minutes, daysAgo);
const reset = async () => { await sql('DELETE FROM correction_requests'); await sql('DELETE FROM notifications'); };

// ===================================================================== asking
test('an employee asks to change one of their own finished sessions', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const res = await request(log, 360, 'Forgot to stop for lunch', t.a);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const r = res.body.request;
  assert.equal(r.status, 'pending');
  assert.equal(r.originalMinutes, 480);
  assert.equal(r.requestedMinutes, 360);
  assert.equal(r.reason, 'Forgot to stop for lunch');
  // The hours do not change until it is approved.
  const [[row]] = await sql('SELECT duration_minutes FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(row.duration_minutes, 480);
  await reset();
});

test('the people who can decide are told; the employee is not', async () => {
  await reset();
  const log = await newLog(task.a, f.pipingA, 480);
  await request(log, 360, 'Forgot to stop for lunch', t.a);
  const [rows] = await sql("SELECT recipient_id FROM notifications WHERE type = 'correction-requested'");
  const who = rows.map((r) => r.recipient_id).sort();
  assert.deepEqual(who, [f.tlPiping, f.headPiping, f.manager1].sort((a, b) => a - b));
  await reset();
});

test('requests are validated', async () => {
  const log = await newLog(task.a, f.pipingA, 120);
  assert.equal((await request(log, 60, 'x', t.a)).status, 400, 'reason too short');
  assert.equal((await request(log, -5, 'Valid reason', t.a)).status, 400, 'negative');
  assert.equal((await request(log, 99999, 'Valid reason', t.a)).status, 400, 'too long');
  assert.equal((await request(log, 12.5, 'Valid reason', t.a)).status, 400, 'not whole');
  assert.equal((await request(log, 120, 'Valid reason', t.a)).status, 400, 'unchanged');
  assert.equal((await request('abc', 60, 'Valid reason', t.a)).status, 400, 'bad id');
  assert.equal((await request(999999, 60, 'Valid reason', t.a)).status, 404);
  await reset();
});

test('only the owner can ask, and only for a finished session inside the window', async () => {
  const log = await newLog(task.a, f.pipingA, 120);
  assert.equal((await request(log, 60, 'Not my session', t.b)).status, 403);

  const open = await f.addOpenLog(task.a, f.pipingA);
  assert.equal((await request(open, 60, 'Still running', t.a)).status, 409);
  await sql('DELETE FROM time_logs WHERE log_id = ?', [open]);

  const old = await newLog(task.a, f.pipingA, 120, 30);
  const res = await request(old, 60, 'Too long ago', t.a);
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /14 days/);
  await reset();
});

test('a session can have only one pending request, and may be asked about again after a decision', async () => {
  const log = await newLog(task.a, f.pipingA, 300);
  const first = await request(log, 200, 'First attempt', t.a);
  assert.equal(first.status, 201);
  assert.equal((await request(log, 100, 'Second attempt', t.a)).status, 409);

  await post(`/corrections/${first.body.request.id}/reject`, { note: 'Please give the exact times' }, t.tl);
  assert.equal((await request(log, 250, 'Second attempt with detail', t.a)).status, 201);
  await reset();
});

test('roles that do not log time cannot ask', async () => {
  const log = await newLog(task.a, f.pipingA, 120);
  for (const who of ['pm', 'head', 'hr', 'mgmt']) {
    assert.equal((await request(log, 60, 'Trying anyway', t[who])).status, 403, who);
  }
  assert.equal((await app.api('/corrections', { method: 'POST', body: {} })).status, 401);
  await reset();
});

// ===================================================================== lists
test('my sessions list shows the last two weeks with the state of any request', async () => {
  await sql('DELETE FROM time_logs');
  const recent = await newLog(task.a, f.pipingA, 90, 2);
  await newLog(task.a, f.pipingA, 60, 30); // outside the window
  await request(recent, 60, 'Left it running', t.a);
  const res = await get('/corrections/sessions', t.a);
  assert.equal(res.status, 200);
  assert.equal(res.body.windowDays, 14);
  assert.equal(res.body.sessions.length, 1);
  assert.equal(res.body.sessions[0].id, recent);
  assert.equal(res.body.sessions[0].requestStatus, 'pending');
  assert.equal(res.body.sessions[0].taskName, 'Task of A');
  // Nobody else's sessions.
  assert.equal((await get('/corrections/sessions', t.b)).body.sessions.length, 0);
  await reset();
});

test('mine lists my own requests only', async () => {
  const log = await newLog(task.a, f.pipingA, 300);
  await request(log, 200, 'A reason', t.a);
  assert.equal((await get('/corrections/mine', t.a)).body.requests.length, 1);
  assert.equal((await get('/corrections/mine', t.b)).body.requests.length, 0);
  assert.equal((await get('/corrections/mine', t.pm)).status, 403);
  await reset();
});

test('the review queue shows only requests from people the viewer is responsible for', async () => {
  const logA = await newLog(task.a, f.pipingA, 300);
  const structTask = await f.addTask(f.project1, f.subModelling, f.structA, 'Struct task', 10);
  const logS = await newLog(structTask, f.structA, 300);
  await request(logA, 200, 'Piping reason', t.a);
  await request(logS, 200, 'Structural reason', t.structA);

  const names = async (who) => (await get('/corrections', t[who])).body.requests.map((r) => r.employeeName).sort();
  assert.deepEqual(await names('tl'), ['Piping A']);
  assert.deepEqual(await names('tlStruct'), ['Structural A']);
  assert.deepEqual(await names('head'), ['Piping A']);
  assert.deepEqual(await names('headStruct'), ['Structural A']);
  assert.deepEqual(await names('pm'), ['Piping A', 'Structural A']); // manager of the project
  assert.deepEqual(await names('pm2'), []);
  assert.equal((await get('/corrections', t.mgmt)).status, 403);
  assert.equal((await get('/corrections', t.a)).status, 403);
  await reset();
});

// ===================================================================== deciding
test('approving applies the new time, keeps the who/when/why trail and tells the employee', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const id = (await request(log, 360, 'Forgot to stop for lunch', t.a)).body.request.id;
  await sql('DELETE FROM notifications');

  const res = await post(`/corrections/${id}/approve`, { note: 'Agreed' }, t.tl);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.request.status, 'approved');
  assert.equal(res.body.request.reviewerName, 'TL Piping');

  const [[row]] = await sql('SELECT duration_minutes, edited_by, edited_at, note FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(row.duration_minutes, 360);
  assert.equal(row.edited_by, f.tlPiping);
  assert.ok(row.edited_at);
  assert.match(row.note, /Forgot to stop for lunch/);

  const [notes] = await sql("SELECT recipient_id, title FROM notifications WHERE type = 'correction-approved'");
  assert.deepEqual(notes.map((n) => n.recipient_id), [f.pipingA]);

  const [[audit]] = await sql("SELECT * FROM audit_log WHERE action = 'correction.approve'");
  assert.equal(audit.actor_id, f.tlPiping);
  await reset();
});

test('approved hours flow into the task and project totals', async () => {
  await sql('DELETE FROM time_logs');
  const log = await newLog(task.a, f.pipingA, 600); // 10h
  const id = (await request(log, 120, 'Mistake', t.a)).body.request.id; // 2h
  await post(`/corrections/${id}/approve`, {}, t.pm);
  const tasks = (await get(`/projects/${f.project1}/tasks`, t.pm)).body.tasks;
  assert.equal(tasks.find((x) => x.id === task.a).completedHours, 2);
  await reset();
});

test('rejecting needs an explanation, leaves the hours alone and tells the employee', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const id = (await request(log, 100, 'I want less time', t.a)).body.request.id;

  assert.equal((await post(`/corrections/${id}/reject`, {}, t.tl)).status, 400);
  assert.equal((await post(`/corrections/${id}/reject`, { note: 'no' }, t.tl)).status, 400);

  const res = await post(`/corrections/${id}/reject`, { note: 'The timer shows you were working' }, t.tl);
  assert.equal(res.status, 200);
  assert.equal(res.body.request.status, 'rejected');
  assert.equal(res.body.request.reviewNote, 'The timer shows you were working');
  const [[row]] = await sql('SELECT duration_minutes, edited_by FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(row.duration_minutes, 480);
  assert.equal(row.edited_by, null);
  const [notes] = await sql("SELECT recipient_id FROM notifications WHERE type = 'correction-rejected'");
  assert.deepEqual(notes.map((n) => n.recipient_id), [f.pipingA]);
  await reset();
});

test('a request can be decided only once', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const id = (await request(log, 100, 'Reason here', t.a)).body.request.id;
  assert.equal((await post(`/corrections/${id}/approve`, {}, t.tl)).status, 200);
  assert.equal((await post(`/corrections/${id}/approve`, {}, t.pm)).status, 409);
  assert.equal((await post(`/corrections/${id}/reject`, { note: 'Too late now' }, t.pm)).status, 409);
  await reset();
});

test('only someone responsible for that person may decide', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const id = (await request(log, 100, 'Reason here', t.a)).body.request.id;
  for (const who of ['tlStruct', 'headStruct', 'pm2']) {
    assert.equal((await post(`/corrections/${id}/approve`, {}, t[who])).status, 403, who);
  }
  for (const who of ['a', 'b', 'hr', 'mgmt']) {
    assert.equal((await post(`/corrections/${id}/approve`, {}, t[who])).status, 403, who);
  }
  assert.equal((await post('/corrections/999999/approve', {}, t.tl)).status, 404);
  const [[row]] = await sql('SELECT duration_minutes FROM time_logs WHERE log_id = ?', [log]);
  assert.equal(row.duration_minutes, 480);
  await reset();
});

test('a team leader’s own request is decided by someone else, never by themselves', async () => {
  const log = await newLog(task.tl, f.tlPiping, 480);
  const res = await request(log, 300, 'My own forgotten timer', t.tl);
  assert.equal(res.status, 201);
  const id = res.body.request.id;

  const own = await post(`/corrections/${id}/approve`, {}, t.tl);
  assert.equal(own.status, 403);
  assert.match(own.body.error.message, /your own/);
  assert.deepEqual((await get('/corrections', t.tl)).body.requests, []); // not in their own queue

  // The request goes to the department head and the project manager, not the team leader.
  const [rows] = await sql("SELECT recipient_id FROM notifications WHERE type = 'correction-requested'");
  assert.ok(!rows.some((r) => r.recipient_id === f.tlPiping));
  assert.ok(rows.some((r) => r.recipient_id === f.headPiping));

  assert.equal((await post(`/corrections/${id}/approve`, {}, t.head)).status, 200);
  await reset();
});

test('approval is refused if the session changed after the request', async () => {
  const log = await newLog(task.a, f.pipingA, 480);
  const id = (await request(log, 100, 'Reason here', t.a)).body.request.id;
  // A manager corrects it directly in the meantime.
  assert.equal((await app.api(`/time-logs/${log}`, { method: 'PATCH', token: t.pm, body: { durationMinutes: 400, note: 'Direct fix' } })).status, 200);
  const res = await post(`/corrections/${id}/approve`, {}, t.tl);
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /changed after/);
  await reset();
});

// ===================================================================== self review
test('nobody can adjust, or see for review, their own time', async () => {
  const log = await newLog(task.tl, f.tlPiping, 480);
  await sql('UPDATE time_logs SET auto_stopped = 1 WHERE log_id = ?', [log]);

  const own = await app.api(`/time-logs/${log}`, { method: 'PATCH', token: t.tl, body: { durationMinutes: 10, note: 'Cutting my own hours' } });
  assert.equal(own.status, 403);

  const flaggedFor = async (who) => (await get('/time-logs/flagged', t[who])).body.timeLogs.map((l) => l.id);
  assert.ok(!(await flaggedFor('tl')).includes(log), 'the team leader must not review their own session');
  assert.ok((await flaggedFor('head')).includes(log), 'but their department head can');
  assert.ok((await flaggedFor('pm')).includes(log), 'and so can the project manager');

  // A direct correction by someone responsible works.
  assert.equal((await app.api(`/time-logs/${log}`, { method: 'PATCH', token: t.head, body: { durationMinutes: 300, note: 'Reviewed' } })).status, 200);
  await sql('DELETE FROM time_logs');
  await reset();
});
