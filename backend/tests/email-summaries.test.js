const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { seedFixtures, startApp } = require('./helpers');
const email = require('../src/services/email');
const settings = require('../src/services/settings');
const { generateSummaryNotifications } = require('../src/services/notifications');

// Email copies of notifications (SRS section 47) and the daily and weekly
// summary notifications (sections 31 and 32). No real mail is ever sent: a
// stand-in transport records what would have been sent.
let f; let app; let t; let sent; let failWith;
const code = (id) => `EMP-${String(id).padStart(3, '0')}`;
const patch = (path, body, token) => app.api(path, { method: 'PATCH', token, body });
const sql = (q, p) => f.db.query(q, p);
const setLevel = (level, token = t.sys) => patch('/system/settings', { emailMinSeverity: level }, token);

before(async () => {
  f = await seedFixtures();
  app = await startApp();
  t = {
    a: await app.login(code(f.pipingA)),
    tl: await app.login(code(f.tlPiping)),
    pm: await app.login(code(f.manager1)),
    sys: await app.login(code(f.sysadmin)),
  };
  email.setTransport({
    sendMail: async (message) => {
      if (failWith) throw new Error(failWith);
      sent.push(message);
    },
  });
});
after(() => { email.setTransport(null); return app.close(f); });
beforeEach(async () => {
  sent = [];
  failWith = null;
  settings.resetCache();
  await sql('DELETE FROM notifications');
  await sql('DELETE FROM system_settings');
  await sql('DELETE FROM tasks');
});

const recipients = () => sent.map((m) => m.to).sort();

// An employee putting a task on hold: an "attention" notification for the project manager and team leader.
async function putOnHold() {
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Held task', 5, 'In Progress');
  const res = await patch(`/tasks/${id}`, { status: 'On Hold', remarks: 'Waiting for the client' }, t.a);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await email.flush();
  return id;
}

// ===================================================================== email
test('nothing is sent when no mail server is set up', async () => {
  email.setTransport(null);
  delete process.env.SMTP_HOST;
  assert.equal(email.isConfigured(), false);
  await patch(`/tasks/${await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'x', 5, 'In Progress')}`, { status: 'On Hold' }, t.a);
  await email.flush();
  assert.equal(sent.length, 0);
  email.setTransport({ sendMail: async (m) => { sent.push(m); } });
});

test('attention notifications are emailed by default, with the title, the detail and who it is for', async () => {
  await putOnHold();
  assert.deepEqual(recipients(), ['m1@test.local', 'tlp@test.local']);
  const mail = sent.find((m) => m.to === 'm1@test.local');
  assert.equal(mail.subject, '[AAPL] A task was put on hold');
  assert.match(mail.text, /Piping A put "Held task"/);
  assert.match(mail.text, /Waiting for the client/);
  assert.match(mail.text, /Hello Manager One/);
  assert.match(mail.from, /AAPL Platform/);
});

test('the in-app notification is created whether or not it is emailed', async () => {
  await putOnHold();
  const [rows] = await sql("SELECT recipient_id FROM notifications WHERE type = 'task-on-hold'");
  assert.equal(rows.length, 2);
});

test('the level decides which severities are emailed', async () => {
  // 3: critical only, so an attention notification is not emailed.
  await setLevel(3);
  await putOnHold();
  assert.equal(sent.length, 0);

  // 2 is the default, tested above. 1: everything, including plain information such as an assignment.
  await setLevel(1);
  await sql('DELETE FROM tasks');
  const assigned = await app.api(`/projects/${f.project1}/tasks`, { method: 'POST', token: t.pm, body: { subDepartmentId: f.subInputStudy, taskName: 'Brand new', employeeId: f.pipingA, allocatedHours: 4 } });
  assert.equal(assigned.status, 201);
  await email.flush();
  assert.deepEqual(recipients(), ['pa@test.local']);
  assert.equal(sent[0].subject, '[AAPL] New task assigned');

  // 2 does not email information.
  sent = [];
  await setLevel(2);
  await app.api(`/projects/${f.project1}/tasks`, { method: 'POST', token: t.pm, body: { subDepartmentId: f.subInputStudy, taskName: 'Another', employeeId: f.pipingA, allocatedHours: 4 } });
  await email.flush();
  assert.equal(sent.length, 0);
});

test('level 0 switches email off completely', async () => {
  await setLevel(0);
  await putOnHold();
  assert.equal(sent.length, 0);
});

test('people who are no longer active are not emailed', async () => {
  await sql("UPDATE employees SET status = 'inactive' WHERE employee_id = ?", [f.tlPiping]);
  await putOnHold();
  assert.deepEqual(recipients(), ['m1@test.local']);
  await sql("UPDATE employees SET status = 'active' WHERE employee_id = ?", [f.tlPiping]);
});

test('a repeated event is not emailed twice', async () => {
  // Due-date style events carry a dedupe key; creating the same notification again inserts nothing.
  const { notify } = require('../src/services/notifications');
  const event = { recipientIds: f.manager1, type: 'budget-warning', severity: 'attention', title: 'Nearly there', body: 'x', dedupeKey: 'dup:1' };
  await notify(event);
  await notify(event);
  await email.flush();
  assert.equal(sent.length, 1);
});

test('a mail failure never breaks the action that caused it', async () => {
  failWith = 'SMTP is down';
  const id = await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Held task', 5, 'In Progress');
  const res = await patch(`/tasks/${id}`, { status: 'On Hold' }, t.a);
  assert.equal(res.status, 200);
  await email.flush();
  const [rows] = await sql("SELECT 1 FROM notifications WHERE type = 'task-on-hold'");
  assert.equal(rows.length, 2, 'the in-app notifications still exist');
});

test('the severity rule', () => {
  assert.equal(email.shouldEmail('critical', 3), true);
  assert.equal(email.shouldEmail('attention', 3), false);
  assert.equal(email.shouldEmail('attention', 2), true);
  assert.equal(email.shouldEmail('info', 2), false);
  assert.equal(email.shouldEmail('info', 1), true);
  assert.equal(email.shouldEmail('critical', 0), false);
  assert.equal(email.shouldEmail('whatever', 1), true); // unknown counts as information
});

test('the email level and summary hour are settings with ranges', async () => {
  assert.equal((await setLevel(4)).status, 400);
  assert.equal((await setLevel(-1)).status, 400);
  assert.equal((await patch('/system/settings', { dailySummaryHour: 24 }, t.sys)).status, 400);
  const ok = await patch('/system/settings', { dailySummaryHour: 17, emailMinSeverity: 3 }, t.sys);
  assert.equal(ok.status, 200);
  const list = ok.body.settings;
  assert.equal(list.find((s) => s.key === 'dailySummaryHour').value, 17);
  assert.equal(list.find((s) => s.key === 'emailMinSeverity').value, 3);
});

// ===================================================================== summaries
// Friday 9 October 2026 at 19:00, local time.
const FRIDAY_EVENING = new Date(2026, 9, 9, 19, 0, 0);
const THURSDAY_EVENING = new Date(2026, 9, 8, 19, 0, 0);
const FRIDAY_MORNING = new Date(2026, 9, 9, 9, 0, 0);

const inbox = async (employeeId, type) => (await sql('SELECT * FROM notifications WHERE recipient_id = ? AND type = ?', [employeeId, type]))[0];

test('the end-of-day summary goes to team leaders, department heads and management, once', async () => {
  await generateSummaryNotifications(THURSDAY_EVENING);
  for (const id of [f.tlPiping, f.tlStruct, f.headPiping, f.headStruct, f.mgmt]) {
    assert.equal((await inbox(id, 'daily-summary')).length, 1, `person ${id}`);
  }
  for (const id of [f.pipingA, f.manager1, f.hr, f.sysadmin]) {
    assert.equal((await inbox(id, 'daily-summary')).length, 0, `person ${id}`);
  }
  await generateSummaryNotifications(THURSDAY_EVENING); // an hour later
  assert.equal((await inbox(f.mgmt, 'daily-summary')).length, 1, 'not repeated');
});

test('the summary describes the person’s own scope', async () => {
  await f.addLog(await f.addTask(f.project1, f.subInputStudy, f.pipingA, 'Worked', 10), f.pipingA, 150, 0);
  await generateSummaryNotifications(THURSDAY_EVENING);
  const team = (await sql('SELECT title, body, link, severity FROM notifications WHERE recipient_id = ? AND type = ?', [f.tlPiping, 'daily-summary']))[0][0];
  assert.equal(team.title, 'End-of-day summary');
  assert.match(team.body, /^Piping Team: 2\.5h logged today by 1 of 3 people/);
  assert.equal(team.link, '/team');
  const company = (await sql('SELECT body, link FROM notifications WHERE recipient_id = ? AND type = ?', [f.mgmt, 'daily-summary']))[0][0];
  assert.match(company.body, /^Whole company: 2\.5h logged today/);
  assert.equal(company.link, '/dashboard');
});

test('nothing is sent before the summary hour', async () => {
  await generateSummaryNotifications(new Date(2026, 9, 8, 17, 59, 0));
  assert.equal((await sql('SELECT 1 FROM notifications'))[0].length, 0);
  await patch('/system/settings', { dailySummaryHour: 9 }, t.sys);
  await generateSummaryNotifications(new Date(2026, 9, 8, 9, 30, 0));
  assert.ok((await sql('SELECT 1 FROM notifications'))[0].length > 0, 'the hour is a setting');
});

test('the weekly summary is sent on Fridays to department heads and management only', async () => {
  await generateSummaryNotifications(THURSDAY_EVENING);
  assert.equal((await inbox(f.headPiping, 'weekly-summary')).length, 0, 'not on a Thursday');

  await generateSummaryNotifications(FRIDAY_EVENING);
  assert.equal((await inbox(f.headPiping, 'weekly-summary')).length, 1);
  assert.equal((await inbox(f.mgmt, 'weekly-summary')).length, 1);
  assert.equal((await inbox(f.tlPiping, 'weekly-summary')).length, 0, 'team leaders get the daily one only');
  const weekly = (await sql('SELECT body FROM notifications WHERE recipient_id = ? AND type = ?', [f.mgmt, 'weekly-summary']))[0][0];
  assert.match(weekly.body, /logged this week/);

  await generateSummaryNotifications(FRIDAY_EVENING);
  assert.equal((await inbox(f.mgmt, 'weekly-summary')).length, 1, 'once per week');
  // Both summaries on Friday, a daily one for each day.
  assert.equal((await inbox(f.mgmt, 'daily-summary')).length, 2);
});

test('nothing on a Friday morning, before the hour', async () => {
  await generateSummaryNotifications(FRIDAY_MORNING);
  assert.equal((await sql('SELECT 1 FROM notifications'))[0].length, 0);
});

test('inactive people get no summary, and summaries follow the email level', async () => {
  await sql("UPDATE employees SET status = 'inactive' WHERE employee_id = ?", [f.mgmt]);
  await setLevel(1);
  await generateSummaryNotifications(THURSDAY_EVENING);
  await email.flush();
  assert.equal((await inbox(f.mgmt, 'daily-summary')).length, 0);
  assert.ok(recipients().includes('hp@test.local'), 'emailed at level 1');
  assert.ok(!recipients().includes('mg@test.local'));
  await sql("UPDATE employees SET status = 'active' WHERE employee_id = ?", [f.mgmt]);
});
