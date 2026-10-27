const pool = require('../config/db');
const { maxSessionMinutes } = require('../config/timer');
const settings = require('./settings');
const email = require('./email');
const { periodRange } = require('./periods');
const { landingFor } = require('../auth/permissions');
const { featureOn } = require('../config/rollout');

const DUE_SOON_DAYS = 2;
// Only tasks that went overdue recently raise an alert. Without this limit,
// switching notifications on for a database with old overdue tasks would bury
// everyone in alerts for work that was already late long before.
const OVERDUE_NOTICE_DAYS = 3;
const RETENTION_DAYS = 90;

// Who is responsible for someone's work, beyond the project manager: their
// Team Leader and their Department Head (SRS §6 reporting lines).
async function reportingLinesOf(employeeId) {
  const [[row]] = await pool.query(
    `SELECT tm.leader_id AS team_leader_id, d.head_id AS department_head_id
       FROM employees e
       LEFT JOIN teams tm ON tm.team_id = e.team_id
       LEFT JOIN departments d ON d.department_id = e.department_id
      WHERE e.employee_id = ?`,
    [employeeId]
  );
  return { teamLeaderId: row ? row.team_leader_id : null, departmentHeadId: row ? row.department_head_id : null };
}

async function departmentHeadIdsOfProject(projectId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT d.head_id FROM project_departments pd
       JOIN departments d ON d.department_id = pd.department_id
      WHERE pd.project_id = ? AND d.head_id IS NOT NULL`,
    [projectId]
  );
  return rows.map((r) => r.head_id);
}

async function managementIds() {
  const [rows] = await pool.query("SELECT employee_id FROM employees WHERE role = 'management' AND status = 'active'");
  return rows.map((r) => r.employee_id);
}

function fmtMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// Creates one notification per recipient. A recipient who already has one with
// the same dedupeKey is skipped, which makes every event safe to fire twice.
// A failure here is logged and swallowed: a missed notification must never
// break the action that caused it.
async function notify({ recipientIds, type, severity = 'info', title, body = '', link = null, dedupeKey = null }) {
  const ids = [...new Set([].concat(recipientIds).filter(Boolean).map(Number))];
  const created = [];
  for (const recipientId of ids) {
    try {
      const [result] = await pool.query(
        `INSERT IGNORE INTO notifications (recipient_id, type, severity, title, body, link, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [recipientId, type, severity, String(title).slice(0, 200), String(body).slice(0, 500), link, dedupeKey]
      );
      if (result.affectedRows) created.push(recipientId);
    } catch (err) {
      console.error(`Could not create "${type}" notification for employee ${recipientId}:`, err.message);
    }
  }
  await emailCopies(created, { severity, title, body, link });
}

// Emails the new notifications to the people they are for, if email is set up
// and the severity is high enough. Never throws.
async function emailCopies(recipientIds, { severity, title, body, link }) {
  try {
    if (!featureOn('email') || !recipientIds.length || !email.isConfigured() || !email.shouldEmail(severity, settings.get('emailMinSeverity'))) return;
    const [people] = await pool.query("SELECT email, name FROM employees WHERE employee_id IN (?) AND status = 'active'", [recipientIds]);
    const base = (process.env.APP_URL || '').replace(/\/$/, '');
    for (const p of people) {
      email.send({
        to: p.email,
        subject: `[AAPL] ${title}`,
        text: `Hello ${p.name},

${title}
${body}
${link && base ? `
Open it: ${base}${link}
` : ''}
This message was sent by the AAPL Platform.`,
      });
    }
  } catch (err) {
    console.error('Could not email a notification:', err.message);
  }
}

// rows: sessions that were just closed for running too long.
async function notifyAutoStopped(rows) {
  const cap = fmtMinutes(maxSessionMinutes());
  for (const r of rows) {
    await notify({
      recipientIds: r.employee_id,
      type: 'timer-auto-stopped',
      severity: 'attention',
      title: 'Your timer was stopped automatically',
      body: `Your timer on "${r.task_name}" was left running, so it was stopped after ${cap}. Your manager will review the time recorded.`,
      link: '/my-tasks',
      dedupeKey: `autostop:${r.log_id}`,
    });
    // Whoever is responsible for reviewing this person's time: their project
    // manager, Team Leader and Department Head.
    const lines = await reportingLinesOf(r.employee_id);
    await notify({
      recipientIds: [r.project_manager_id, lines.teamLeaderId, lines.departmentHeadId],
      type: 'session-needs-review',
      severity: 'attention',
      title: 'A timer session needs review',
      body: `${r.employee_name} left a timer running on "${r.task_name}" (${r.project_name}). ${cap} was recorded; please confirm or correct it.`,
      link: `/projects/${r.project_id}`,
      dedupeKey: `autostop:${r.log_id}`,
    });
  }
}

// Warns the project manager at 80% and again at 100% of the estimated
// man-hours. The estimate is part of the key, so raising it re-arms the alerts.
async function checkProjectBudget(projectId) {
  try {
    const [[p]] = await pool.query(
      `SELECT p.project_id, p.name, p.status, p.estimated_man_hours, p.project_manager_id,
              COALESCE(SUM(tl.duration_minutes), 0) / 60 AS completed_hours
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.project_id
         LEFT JOIN time_logs tl ON tl.task_id = t.task_id
        WHERE p.project_id = ?
        GROUP BY p.project_id`,
      [projectId]
    );
    if (!p || p.status === 'Completed') return;

    const estimate = Number(p.estimated_man_hours);
    const completed = Number(p.completed_hours);
    if (!(estimate > 0)) return;
    const percent = (completed / estimate) * 100;
    const link = `/projects/${p.project_id}`;
    const figures = `${completed.toFixed(1)} of ${estimate} estimated man-hours`;

    if (percent >= settings.get('budgetCriticalPercent')) {
      // An overrun matters beyond the project: department heads and management are told too.
      await notify({
        recipientIds: [p.project_manager_id, ...(await departmentHeadIdsOfProject(p.project_id)), ...(await managementIds())],
        type: 'budget-exceeded',
        severity: 'critical',
        title: 'Project has used all its estimated man-hours',
        body: `${p.name} has now used ${figures}.`,
        link,
        dedupeKey: `budget-100:${p.project_id}:${estimate}`,
      });
    } else if (percent >= settings.get('budgetWarnPercent')) {
      await notify({
        recipientIds: p.project_manager_id,
        type: 'budget-warning',
        severity: 'attention',
        title: 'Project is nearing its estimated man-hours',
        body: `${p.name} has used ${figures} (${Math.round(percent)}%).`,
        link,
        dedupeKey: `budget-80:${p.project_id}:${estimate}`,
      });
    }
  } catch (err) {
    console.error('Budget check failed:', err.message);
  }
}

// Tasks due within two days, and tasks that became overdue in the last few days.
async function generateDueNotifications() {
  const [tasks] = await pool.query(
    `SELECT t.task_id, t.task_name, t.employee_id, DATE_FORMAT(t.due_date, '%Y-%m-%d') AS due,
            DATEDIFF(t.due_date, CURDATE()) AS days_left,
            p.project_id, p.name AS project_name, p.project_manager_id, e.name AS employee_name
       FROM tasks t
       JOIN projects p ON p.project_id = t.project_id
       JOIN employees e ON e.employee_id = t.employee_id
      WHERE t.status <> 'Completed' AND p.status <> 'Completed'
        AND t.due_date IS NOT NULL
        AND t.due_date <= CURDATE() + INTERVAL ? DAY
        AND t.due_date >= CURDATE() - INTERVAL ? DAY`,
    [DUE_SOON_DAYS, OVERDUE_NOTICE_DAYS]
  );

  for (const t of tasks) {
    const daysLeft = Number(t.days_left);
    if (daysLeft < 0) {
      const days = Math.abs(daysLeft);
      const late = `${days} day${days === 1 ? '' : 's'} overdue`;
      await notify({
        recipientIds: t.employee_id,
        type: 'task-overdue',
        severity: 'attention',
        title: 'A task is overdue',
        body: `"${t.task_name}" (${t.project_name}) was due on ${t.due} and is ${late}.`,
        link: '/my-tasks',
        dedupeKey: `overdue:${t.task_id}:${t.due}`,
      });
      const lines = await reportingLinesOf(t.employee_id);
      await notify({
        recipientIds: [t.project_manager_id, lines.teamLeaderId],
        type: 'task-overdue',
        severity: 'critical',
        title: 'A task is overdue',
        body: `"${t.task_name}" assigned to ${t.employee_name} (${t.project_name}) was due on ${t.due} and is ${late}.`,
        link: `/projects/${t.project_id}`,
        dedupeKey: `overdue:${t.task_id}:${t.due}`,
      });
    } else {
      const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
      await notify({
        recipientIds: t.employee_id,
        type: 'task-due-soon',
        severity: 'attention',
        title: 'A task is due soon',
        body: `"${t.task_name}" (${t.project_name}) is due ${when} (${t.due}).`,
        link: '/my-tasks',
        dedupeKey: `due-soon:${t.task_id}:${t.due}`,
      });
    }
  }
  return tasks.length;
}

// The end-of-day summary (SRS section 31) for Team Leaders, Department Heads and
// Management, and the weekly summary (section 32) on Fridays for Department
// Heads and Management. Sent once the daily summary hour has passed; the dedupe
// key makes it safe to run every hour. Returns how many people were considered.
async function generateSummaryNotifications(now = new Date()) {
  if (!featureOn('summaries') || now.getHours() < settings.get('dailySummaryHour')) return 0;
  // Required here, not at the top, because these modules also use this one.
  const { loadUserContext } = require('../middleware/auth');
  const { dashboardFor } = require('./insight');

  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const weekStart = periodRange('week', day).from;
  const friday = now.getDay() === 5;

  const [people] = await pool.query("SELECT employee_id, role FROM employees WHERE status = 'active' AND role IN ('team_leader', 'department_head', 'management')");
  for (const person of people) {
    try {
      const user = await loadUserContext(person.employee_id);
      if (!user) continue;
      const d = await dashboardFor(user);
      const s = d.stats;
      const loggedToday = d.people.filter((p) => p.hoursToday > 0).length;
      await notify({
        recipientIds: person.employee_id,
        type: 'daily-summary',
        severity: s.criticalExceptions ? 'attention' : 'info',
        title: 'End-of-day summary',
        body: `${d.scopeLabel}: ${s.hoursToday}h logged today by ${loggedToday} of ${s.people} people. ${s.overdueTasks} overdue task(s), ${s.atRiskProjects} project(s) at risk, ${s.exceptions} exception(s) (${s.criticalExceptions} critical).`,
        link: landingFor(person.role),
        dedupeKey: `daily-summary:${day}`,
      });
      if (friday && person.role !== 'team_leader') {
        await notify({
          recipientIds: person.employee_id,
          type: 'weekly-summary',
          severity: 'info',
          title: 'Weekly summary',
          body: `${d.scopeLabel}: ${s.hoursWeek}h logged this week by ${d.people.filter((p) => p.hoursWeek > 0).length} of ${s.people} people. ${s.atRiskProjects} of ${s.activeProjects} active project(s) at risk, ${s.openTasks} open task(s).`,
          link: landingFor(person.role),
          dedupeKey: `weekly-summary:${weekStart}`,
        });
      }
    } catch (err) {
      console.error(`Could not build the summary for employee ${person.employee_id}:`, err.message);
    }
  }
  return people.length;
}

async function purgeOldNotifications() {
  const [result] = await pool.query(
    'DELETE FROM notifications WHERE created_at < NOW() - INTERVAL ? DAY AND is_read = 1',
    [RETENTION_DAYS]
  );
  return result.affectedRows;
}

module.exports = {
  reportingLinesOf,
  notify,
  notifyAutoStopped,
  checkProjectBudget,
  generateDueNotifications,
  generateSummaryNotifications,
  purgeOldNotifications,
  fmtMinutes,
};
