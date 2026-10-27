// Demo data for showing the platform to the client: an organisation, people in
// the four Version 1 / Batch 1 roles (Employee, Project Manager, HR / Admin),
// projects at different stages, tasks, logged hours, notifications and an audit
// trail. Nothing here needs a role that a later batch opens.
//
// Dates are worked out from the database's own "today", so due dates, overdue
// tasks and the recent hours always look current when the data is loaded.
//
// Everything this adds can be taken out again with clearDemo(); audit rows it
// writes carry { demo: true } in their details so the real trail is left alone.

const { checkProjectBudget, generateDueNotifications, notifyAutoStopped, notify } = require('../../src/services/notifications');
const { maxSessionMinutes } = require('../../src/config/timer');
const settings = require('../../src/services/settings');

const DEPARTMENTS = {
  'Piping': ['Input Study', 'Modelling', 'Analysis', 'SSD', 'Documentation', 'Q&C'],
  'Structural': ['Input Study', 'Modelling', 'Analysis', 'Drafting', 'Documentation', 'Q&C'],
  'Hydraulics/Surge': ['Input Study', 'Modelling', 'Analysis', 'Documentation', 'Q&C'],
  'Acoustics': ['Input Study', 'Calculations', 'Analysis', 'Documentation', 'Q&C'],
  'ESP': ['Input Study', 'Model extraction', 'Calculations', 'Documentation', 'Q&C'],
};

// [name, designation, joined]; the first two of each department are in Team A, the rest in Team B.
const STAFF = {
  'Piping': [['Ahmed Khalil', 'Sr. Piping Engineer', '2018-03-11'], ['Vivek Rao', 'Piping Engineer', '2020-08-02'], ['Noor Abdullah', 'Piping Engineer', '2021-01-17'], ['Karan Shah', 'Jr. Piping Engineer', '2024-02-05']],
  'Structural': [['Daniel Costa', 'Sr. Structural Engineer', '2017-09-24'], ['Sameer Qureshi', 'Structural Engineer', '2020-05-10'], ['Anita Joseph', 'Structural Engineer', '2021-11-14'], ['Hassan Ali', 'Jr. Structural Engineer', '2024-06-01']],
  'Hydraulics/Surge': [['Priya Menon', 'Sr. Hydraulics Engineer', '2018-10-07'], ['Omar Saleh', 'Hydraulics Engineer', '2020-12-13'], ['Divya Pillai', 'Hydraulics Engineer', '2022-03-20'], ['Bilal Anwar', 'Jr. Hydraulics Engineer', '2024-09-08']],
  'Acoustics': [['Meera Nair', 'Sr. Acoustic Engineer', '2019-01-06'], ['John Mathews', 'Acoustic Engineer', '2021-04-18'], ['Layla Hassan', 'Acoustic Engineer', '2022-07-03'], ['Arjun Nambiar', 'Jr. Acoustic Engineer', '2025-01-12']],
  'ESP': [['Omar Haddad', 'Sr. ESP Engineer', '2018-06-17'], ['Nisha Verma', 'ESP Engineer', '2020-10-25'], ['Tariq Nasser', 'ESP Engineer', '2022-02-13'], ['Sara Ibrahim', 'Jr. ESP Engineer', '2024-11-03']],
};

const HR = ['Layan Al-Mahrouqi', 'HR / Admin Officer', '2016-04-03'];
const MANAGERS = [
  ['Salim Al-Busaidi', 'Project Manager', '2015-02-01'],
  ['Christine Lobo', 'Project Manager', '2017-05-22'],
  ['Waleed Nasser', 'Project Manager', '2019-08-12'],
];

// Tasks are [department, sub-discipline, name, staff index, hours, status, share of the hours logged, due day relative to today, remark].
// The logged share is what makes a project look healthy, nearly used up or over budget.
const PROJECTS = [
  {
    jobCode: 'AAPL-26-0812', name: 'Saria Refinery Expansion', client: 'Saria Industrial Holdings', consultant: 'Meridian Engineering Consultants',
    contractor: 'Horizon Construction Co.', mapContractor: 'Bluewave MEP Contractors', pm: 'Christine Lobo', status: 'In Progress',
    start: '2026-04-06', target: '2026-12-18', priority: 'High', estimate: 640, created: -200,
    tasks: [
      ['Piping', 'Input Study', 'Piping input data review', 0, 40, 'Completed', 1, -60],
      ['Piping', 'Modelling', '3D piping model', 1, 80, 'Completed', 1, -30],
      ['Piping', 'Analysis', 'Pipe stress analysis', 2, 90, 'In Progress', 0.55, 14],
      ['Structural', 'Input Study', 'Structural loading input review', 0, 36, 'Completed', 1, -45],
      ['Structural', 'Modelling', 'Steel frame 3D model', 1, 84, 'In Progress', 0.7, 9],
      ['Structural', 'Analysis', 'Foundation load analysis', 2, 70, 'Not Started', 0, 35],
      ['Hydraulics/Surge', 'Input Study', 'Hydraulic network input review', 0, 40, 'Completed', 1, -40],
      ['Hydraulics/Surge', 'Modelling', 'Surge network model', 1, 90, 'In Progress', 0.4, 18],
      ['Hydraulics/Surge', 'Analysis', 'Transient surge analysis', 3, 100, 'Not Started', 0, 42],
    ],
  },
  {
    jobCode: 'AAPL-26-0745', name: 'Wynn Tower Development', client: 'Wynn Development Group', consultant: 'Northgate Design Partners',
    contractor: 'Summit Builders LLC', mapContractor: 'Coastal MEP Services', pm: 'Salim Al-Busaidi', status: 'In Progress',
    start: '2026-02-16', target: '2026-11-27', priority: 'Critical', estimate: 900, created: -250,
    tasks: [
      ['Structural', 'Input Study', 'Structural loading input review', 1, 60, 'Completed', 1, -120],
      ['Structural', 'Modelling', 'Steel frame 3D model', 2, 140, 'Completed', 1, -70],
      ['Structural', 'Analysis', 'Foundation load analysis', 3, 120, 'In Progress', 0.8, 6],
      ['Acoustics', 'Input Study', 'Acoustic site survey input', 0, 50, 'Completed', 1, -100],
      ['Acoustics', 'Calculations', 'Equipment noise calculations', 1, 130, 'Completed', 1, -50],
      ['Acoustics', 'Analysis', 'Noise impact analysis', 2, 110, 'Partially Completed', 0.75, 4],
      ['ESP', 'Input Study', 'ESP process input review', 0, 60, 'Completed', 1, -90],
      ['ESP', 'Model extraction', 'ESP model extraction', 1, 120, 'Completed', 1, -45],
      ['ESP', 'Calculations', 'ESP sizing calculations', 2, 110, 'In Progress', 0.5, 12],
    ],
  },
  {
    jobCode: 'AAPL-26-0791', name: 'Al Reem Hospital', client: 'Al Reem Healthcare Projects', consultant: 'Meridian Engineering Consultants',
    contractor: 'Vantage Construction Group', mapContractor: 'Bluewave MEP Contractors', pm: 'Salim Al-Busaidi', status: 'In Progress',
    start: '2026-03-02', target: '2027-01-29', priority: 'High', estimate: 1200, created: -230,
    tasks: [
      ['Piping', 'Input Study', 'Piping input data review', 3, 60, 'Completed', 1, -50],
      ['Piping', 'Modelling', '3D piping model', 2, 160, 'In Progress', 0.5, 20],
      ['Piping', 'Analysis', 'Pipe stress analysis', 1, 180, 'Not Started', 0, 50],
      ['Hydraulics/Surge', 'Input Study', 'Hydraulic network input review', 2, 70, 'Completed', 1, -35],
      ['Hydraulics/Surge', 'Modelling', 'Surge network model', 3, 170, 'In Progress', 0.35, 25],
      ['Hydraulics/Surge', 'Analysis', 'Transient surge analysis', 0, 190, 'Awaiting Input', 0.1, 30, 'Waiting for the pump curves from the client.'],
      ['ESP', 'Input Study', 'ESP process input review', 3, 60, 'Completed', 1, -28],
      ['ESP', 'Model extraction', 'ESP model extraction', 3, 150, 'On Hold', 0.15, 40, 'Client is revising the process scope.'],
      ['ESP', 'Calculations', 'ESP sizing calculations', 1, 160, 'Not Started', 0, 55],
    ],
  },
  {
    jobCode: 'AAPL-26-0688', name: 'Marbella Coastal Residences', client: 'Marbella Coastal Developers', consultant: 'Northgate Design Partners',
    contractor: 'Summit Builders LLC', mapContractor: 'Coastal MEP Services', pm: 'Waleed Nasser', status: 'In Progress',
    start: '2026-05-11', target: '2026-11-13', priority: 'Medium', estimate: 480, created: -170,
    tasks: [
      ['Structural', 'Input Study', 'Structural loading input review', 0, 40, 'Completed', 1.1, -80],
      ['Structural', 'Modelling', 'Steel frame 3D model', 1, 100, 'Completed', 1.15, -40],
      ['Structural', 'Analysis', 'Foundation load analysis', 2, 110, 'In Progress', 1.05, -2],
      ['Acoustics', 'Input Study', 'Acoustic site survey input', 3, 40, 'Completed', 1, -70],
      ['Acoustics', 'Calculations', 'Equipment noise calculations', 1, 90, 'Completed', 1.2, -20],
      ['Acoustics', 'Analysis', 'Noise impact analysis', 2, 100, 'In Progress', 0.65, 1],
    ],
  },
  {
    jobCode: 'AAPL-26-0830', name: 'Duqm Port Pipeline', client: 'Duqm Port Authority', consultant: 'Gulf Infrastructure Advisors',
    contractor: 'Horizon Construction Co.', mapContractor: null, pm: 'Christine Lobo', status: 'Planning',
    start: '2026-11-09', target: '2027-03-26', priority: 'Medium', estimate: 360, created: -6,
    tasks: [
      ['Piping', 'Input Study', 'Piping input data review', 3, 40, 'Not Started', 0, 20],
      ['Hydraulics/Surge', 'Input Study', 'Hydraulic network input review', 1, 40, 'Not Started', 0, 24],
    ],
  },
  {
    jobCode: 'AAPL-26-0702', name: 'Sohar Data Centre Cooling', client: 'Sohar Digital Infrastructure', consultant: 'Gulf Infrastructure Advisors',
    contractor: 'Vantage Construction Group', mapContractor: 'Bluewave MEP Contractors', pm: 'Waleed Nasser', status: 'Completed',
    start: '2026-03-23', target: '2026-09-30', completed: '2026-09-30', priority: 'High', estimate: 420, created: -220,
    tasks: [
      ['ESP', 'Input Study', 'ESP process input review', 2, 50, 'Completed', 1, -60],
      ['ESP', 'Model extraction', 'ESP model extraction', 3, 90, 'Completed', 1, -45],
      ['ESP', 'Calculations', 'ESP sizing calculations', 0, 100, 'Completed', 1.05, -30],
      ['Piping', 'Input Study', 'Piping input data review', 1, 40, 'Completed', 1, -62],
      ['Piping', 'Modelling', '3D piping model', 3, 80, 'Completed', 1, -42],
      ['Piping', 'Analysis', 'Pipe stress analysis', 0, 60, 'Completed', 1, -30],
    ],
  },
];

const SESSION_LENGTHS = [180, 150, 210, 120, 240, 90, 180]; // minutes, rotated so days differ
const DAY_START = 8 * 60; // working day: 08:00 ...
const DAY_END = 17 * 60 + 30; // ... to 17:30

const emailFor = (name) => {
  const [first, ...rest] = name.toLowerCase().split(' ');
  return `${first}.${rest[rest.length - 1]}@aaplconsulting.com`;
};
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;

// Dates as 'YYYY-MM-DD' strings, shifted in whole days without time-zone surprises.
const shift = (day, days) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
// Oman's working week is Sunday to Thursday.
const isWorkingDay = (day) => ![5, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());

async function demoDataPresent(pool) {
  const [[row]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM departments) AS departments, (SELECT COUNT(*) FROM projects) AS projects,
            (SELECT COUNT(*) FROM employees WHERE role <> 'system_admin') AS people`
  );
  return Number(row.departments) + Number(row.projects) + Number(row.people) > 0;
}

// Loads the demo data. `passwordHash` is shared by every demo account.
async function seedDemo(pool, passwordHash) {
  if (await demoDataPresent(pool)) throw new Error('The database already has departments, projects or people. Demo data is only loaded into an empty one.');

  await settings.load();
  const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
  const rel = (days) => shift(today, days);
  const audit = [];
  const note = (actor, daysAgo, action, entityType, entityId, summary, details = {}) => audit[audit.push([actor.id, actor.name, actor.role, action, entityType, entityId, summary, JSON.stringify({ ...details, demo: true }), `${rel(-daysAgo)} ${hhmm(9 * 60 + (entityId * 7) % 300)}`]) - 1];

  const insert = async (sql, params) => (await pool.query(sql, params))[0].insertId;
  const admin = { id: null, name: 'Layan Al-Mahrouqi', role: 'hr_admin' };

  // ---- people: HR first, so the structure can be recorded as theirs
  const hrId = await insert(
    `INSERT INTO employees (name, email, password_hash, designation, role, status, date_of_joining, mobile_number)
     VALUES (?, ?, ?, ?, 'hr_admin', 'active', ?, '+968 9000 0001')`,
    [HR[0], emailFor(HR[0]), passwordHash, HR[1], HR[2]]
  );
  admin.id = hrId;

  const managerId = {};
  let phone = 2;
  for (const [name, designation, joined] of MANAGERS) {
    managerId[name] = await insert(
      `INSERT INTO employees (name, email, password_hash, designation, role, status, date_of_joining, mobile_number)
       VALUES (?, ?, ?, ?, 'project_manager', 'active', ?, ?)`,
      [name, emailFor(name), passwordHash, designation, joined, `+968 9000 ${String(phone).padStart(4, '0')}`]
    );
    phone += 1;
    note(admin, 310, 'employee.create', 'employee', managerId[name], `Created Project Manager account for ${name}`, { role: 'project_manager' });
  }

  // ---- structure and staff
  const dept = {}; const sub = {}; const staff = {};
  let deptDay = 300;
  for (const [name, subs] of Object.entries(DEPARTMENTS)) {
    dept[name] = await insert('INSERT INTO departments (name) VALUES (?)', [name]);
    note(admin, deptDay, 'department.create', 'department', dept[name], `Created department ${name}`);
    for (const s of subs) {
      sub[`${name}::${s}`] = await insert('INSERT INTO sub_departments (department_id, name) VALUES (?, ?)', [dept[name], s]);
      note(admin, deptDay, 'sub-department.create', 'sub-department', sub[`${name}::${s}`], `Added sub-discipline ${s} to ${name}`);
    }
    const teams = [];
    for (const letter of ['A', 'B']) {
      const teamId = await insert('INSERT INTO teams (name, department_id) VALUES (?, ?)', [`${name} Team ${letter}`, dept[name]]);
      teams.push(teamId);
      note(admin, deptDay - 1, 'team.create', 'team', teamId, `Created team ${name} Team ${letter}`, { departmentId: dept[name] });
    }
    staff[name] = [];
    for (const [i, [person, designation, joined]] of STAFF[name].entries()) {
      const id = await insert(
        `INSERT INTO employees (name, email, password_hash, department_id, team_id, designation, role, status, date_of_joining, mobile_number)
         VALUES (?, ?, ?, ?, ?, ?, 'employee', 'active', ?, ?)`,
        [person, emailFor(person), passwordHash, dept[name], teams[i < 2 ? 0 : 1], designation, joined, `+968 9000 ${String(phone).padStart(4, '0')}`]
      );
      phone += 1;
      staff[name].push({ id, name: person });
      note(admin, deptDay - 3 - i, 'employee.create', 'employee', id, `Created Employee account for ${person}`, { role: 'employee', departmentId: dept[name], email: emailFor(person) });
    }
    deptDay -= 2;
  }
  // A couple of later edits, so the trail shows more than creations.
  note(admin, 21, 'employee.update', 'employee', staff['Piping'][1].id, `Updated ${staff['Piping'][1].name}: designation`, { designation: { from: 'Jr. Piping Engineer', to: 'Piping Engineer' } });

  // ---- projects, tasks and hours
  const used = new Map(); // `${employee}|${day}` -> minutes already booked that day
  const book = (employeeId, day, minutes) => used.set(`${employeeId}|${day}`, (used.get(`${employeeId}|${day}`) || 0) + minutes);
  const booked = (employeeId, day) => used.get(`${employeeId}|${day}`) || 0;

  // One timer that was left running: it is credited the longest allowed session and flagged for review.
  const forgotten = { project: 'AAPL-26-0688', task: 'Foundation load analysis', daysAgo: 4 };
  const forgottenCap = maxSessionMinutes();

  const created = {}; // job code -> { id, tasks: [{id, ...}] }
  let rotate = 0;
  for (const p of PROJECTS) {
    const pmId = managerId[p.pm];
    const projectId = await insert(
      `INSERT INTO projects (job_code, name, client_name, consultant_name, main_contractor_name, map_contractor_name,
                             project_manager_id, start_date, target_date, actual_completion_date, priority, estimated_man_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.jobCode, p.name, p.client, p.consultant, p.contractor, p.mapContractor, pmId, p.start, p.target, p.completed || null, p.priority, p.estimate, p.status]
    );
    const departments = [...new Set(p.tasks.map((t) => t[0]))];
    for (const d of departments) await pool.query('INSERT INTO project_departments (project_id, department_id) VALUES (?, ?)', [projectId, dept[d]]);
    const pm = { id: pmId, name: p.pm, role: 'project_manager' };
    note(pm, -p.created, 'project.create', 'project', projectId, `Created project ${p.name} (${p.jobCode})`, { jobCode: p.jobCode, estimatedManHours: p.estimate });
    created[p.jobCode] = { id: projectId, name: p.name, pmId, tasks: [] };

    for (const [d, s, taskName, who, hours, status, share, dueIn, remarks] of p.tasks) {
      const person = staff[d][who];
      const taskId = await insert(
        `INSERT INTO tasks (project_id, sub_department_id, employee_id, task_name, allocated_hours, due_date, status, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [projectId, sub[`${d}::${s}`], person.id, taskName, hours, rel(dueIn), status, remarks || null]
      );
      note(pm, -p.created, 'task.assign', 'task', taskId, `Assigned "${taskName}" (${p.name}) to ${person.name}, ${hours}h`, { projectId, employeeId: person.id, allocatedHours: hours });
      created[p.jobCode].tasks.push({ id: taskId, employeeId: person.id, employeeName: person.name, taskName, hours, status, share, dueIn });
    }
  }

  // Reserve the day of the forgotten timer so ordinary sessions do not overlap it.
  const stuck = created[forgotten.project].tasks.find((t) => t.taskName === forgotten.task);
  const stuckDay = (() => { let d = rel(-forgotten.daysAgo); while (!isWorkingDay(d)) d = shift(d, -1); return d; })();
  book(stuck.employeeId, stuckDay, DAY_END - DAY_START);

  // Sessions, newest first, each on a working day with room left for that person.
  const logs = []; // [taskId, employeeId, day, startMinute, minutes]
  for (const p of PROJECTS) {
    for (const t of created[p.jobCode].tasks) {
      let remaining = Math.round(t.hours * 60 * t.share);
      if (remaining <= 0) continue;
      // Finished work ended before its due date; work in progress was last touched recently.
      let day = rel(t.status === 'Completed' ? Math.min(t.dueIn, -1) : -1 - (rotate % 3));
      rotate += 1;
      let n = 0;
      while (remaining > 0) {
        let minutes = Math.min(remaining, SESSION_LENGTHS[(rotate + n) % SESSION_LENGTHS.length]);
        if (remaining - minutes < 30) minutes = remaining;
        n += 1;
        while (!isWorkingDay(day) || booked(t.employeeId, day) + minutes > DAY_END - DAY_START) day = shift(day, -1);
        const start = DAY_START + booked(t.employeeId, day);
        logs.push([t.id, t.employeeId, day, start, minutes]);
        book(t.employeeId, day, minutes);
        remaining -= minutes;
        day = shift(day, -1);
      }
    }
  }
  for (const [taskId, employeeId, day, start, minutes] of logs) {
    await pool.query(
      `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date) VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, employeeId, `${day} ${hhmm(start)}`, `${day} ${hhmm(start + minutes)}`, minutes, day]
    );
  }

  // The forgotten timer, closed by the system.
  const stuckStart = 6 * 60 + 30;
  const stuckLog = await insert(
    `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date, auto_stopped)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [stuck.id, stuck.employeeId, `${stuckDay} ${hhmm(stuckStart)}`, `${stuckDay} ${hhmm(stuckStart + forgottenCap)}`, forgottenCap, stuckDay]
  );
  note({ id: null, name: 'System', role: null }, 0, 'time-log.auto-stop', 'time-log', stuckLog,
    `Stopped ${stuck.employeeName}'s timer on "${stuck.taskName}" (${created[forgotten.project].name}) at the ${Math.round(forgottenCap / 60)}-hour limit`,
    { employeeId: stuck.employeeId, creditedMinutes: forgottenCap, projectId: created[forgotten.project].id })[8] = `${stuckDay} ${hhmm(stuckStart + forgottenCap)}`;

  // One session a manager shortened after checking it.
  const adjusted = created['AAPL-26-0812'].tasks.find((t) => t.taskName === 'Pipe stress analysis');
  const [[firstLog]] = await pool.query('SELECT log_id, log_date, start_time, duration_minutes FROM time_logs WHERE task_id = ? ORDER BY log_date, log_id LIMIT 1', [adjusted.id]);
  const newMinutes = Number(firstLog.duration_minutes) - 30;
  const adjuster = { id: managerId['Christine Lobo'], name: 'Christine Lobo', role: 'project_manager' };
  await pool.query(
    `UPDATE time_logs SET duration_minutes = ?, end_time = DATE_ADD(start_time, INTERVAL ? MINUTE), edited_by = ?, edited_at = ?, note = ? WHERE log_id = ?`,
    [newMinutes, newMinutes, adjuster.id, `${firstLog.log_date} 18:00:00`, 'Lunch break taken off after checking with the engineer.', firstLog.log_id]
  );
  const fmt = (m) => `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
  note(adjuster, 0, 'time-log.adjust', 'time-log', firstLog.log_id,
    `Changed ${adjusted.employeeName}'s session on "${adjusted.taskName}" (Saria Refinery Expansion) from ${fmt(Number(firstLog.duration_minutes))} to ${fmt(newMinutes)}`,
    { from: Number(firstLog.duration_minutes), to: newMinutes, via: 'project' })[8] = `${firstLog.log_date} 18:05:00`;

  // Finished tasks get their completion time from their last session.
  await pool.query(
    `UPDATE tasks t SET completed_at = (SELECT MAX(end_time) FROM time_logs WHERE task_id = t.task_id)
      WHERE t.status = 'Completed'`
  );

  // ---- notifications: the ones the platform would have produced by now
  for (const jobCode of Object.keys(created)) await checkProjectBudget(created[jobCode].id);
  await generateDueNotifications();
  await notifyAutoStopped([{
    log_id: stuckLog, employee_id: stuck.employeeId, task_name: stuck.taskName, project_manager_id: created[forgotten.project].pmId,
    employee_name: stuck.employeeName, project_name: created[forgotten.project].name, project_id: created[forgotten.project].id,
  }]);
  // A few allocations, so every employee opens the app to something.
  for (const jobCode of ['AAPL-26-0812', 'AAPL-26-0745', 'AAPL-26-0830']) {
    const c = created[jobCode];
    for (const t of c.tasks.filter((x) => x.status === 'Not Started' || x.status === 'In Progress').slice(0, 3)) {
      await notify({
        recipientIds: t.employeeId, type: 'task-assigned', title: 'A task was assigned to you',
        body: `"${t.taskName}" (${c.name}) was assigned to you, ${t.hours}h.`, link: '/my-tasks', dedupeKey: `demo-assigned:${t.id}`,
      });
    }
  }
  // Older notifications read, newer unread.
  await pool.query("UPDATE notifications SET is_read = 1, read_at = NOW() WHERE type = 'task-assigned' AND notification_id % 2 = 0");

  // ---- audit trail, oldest first
  audit.sort((a, b) => String(a[8]).localeCompare(String(b[8])));
  for (const row of audit) {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row
    );
  }

  const accounts = [
    { role: 'HR / Admin', id: hrId, name: HR[0] },
    ...MANAGERS.map(([name]) => ({ role: 'Project Manager', id: managerId[name], name })),
    ...Object.values(staff).flat().map((s) => ({ role: 'Employee', id: s.id, name: s.name })),
  ];
  return {
    accounts,
    counts: { departments: Object.keys(DEPARTMENTS).length, teams: Object.keys(DEPARTMENTS).length * 2, people: accounts.length, projects: PROJECTS.length },
  };
}

// Removes everything seedDemo() added, plus anything entered since: all
// departments, teams, people (except System Administrators), projects, tasks,
// hours and notifications. The real audit trail is kept.
async function clearDemo(pool) {
  const run = (sql) => pool.query(sql);
  await run('DELETE FROM notifications');
  await run('DELETE FROM correction_requests');
  await run('DELETE FROM time_logs');
  await run('DELETE FROM tasks');
  await run('DELETE FROM project_departments');
  await run('DELETE FROM projects');
  await run('UPDATE departments SET head_id = NULL');
  await run('UPDATE teams SET leader_id = NULL');
  await run("DELETE FROM employees WHERE role <> 'system_admin'");
  await run('DELETE FROM teams');
  await run('DELETE FROM sub_departments');
  await run('DELETE FROM departments');
  await run("DELETE FROM audit_log WHERE JSON_EXTRACT(details, '$.demo') = TRUE");
}

module.exports = { seedDemo, clearDemo, demoDataPresent, PROJECTS };
