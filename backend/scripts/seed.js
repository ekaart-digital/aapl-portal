// Populates an empty (schema-loaded) database with demo data matching the
// UI prototype, so the real backend and the earlier mock-data demo look
// the same to the client. Safe to re-run against a fresh database only —
// it does not clear existing data first.
//
// Usage: npm run seed   (reads .env for connection details)

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { seedOrganisation } = require('./lib/seedOrganisation');

const DEMO_PASSWORD = 'Passw0rd!'; // same password for every seeded account — demo only

const DEPARTMENTS = [
  { name: 'Piping', subDepartments: ['Input Study', 'Modelling', 'Analysis', 'SSD', 'Documentation', 'Q&C'] },
  { name: 'Structural', subDepartments: ['Input Study', 'Modelling', 'Analysis', 'Drafting', 'Documentation', 'Q&C'] },
  { name: 'Hydraulics/Surge', subDepartments: ['Input Study', 'Modelling', 'Analysis', 'Documentation', 'Q&C'] },
  { name: 'Acoustics', subDepartments: ['Input Study', 'Calculations', 'Analysis', 'Documentation', 'Q&C'] },
  { name: 'ESP', subDepartments: ['Input Study', 'Model extraction', 'Calculations', 'Documentation', 'Q&C'] },
];

const MANAGERS = ['Salim Al-Busaidi', 'Christine Lobo', 'Waleed Nasser'];

const STAFF_BY_DEPT = {
  'Piping': [
    ['Ahmed Khalil', 'Sr. Piping Engineer'], ['Vivek Rao', 'Piping Engineer'],
    ['Noor Abdullah', 'Piping Engineer'], ['Karan Shah', 'Jr. Piping Engineer'],
  ],
  'Structural': [
    ['Daniel Costa', 'Sr. Structural Engineer'], ['Sameer Qureshi', 'Structural Engineer'],
    ['Anita Joseph', 'Structural Engineer'], ['Hassan Ali', 'Jr. Structural Engineer'],
  ],
  'Hydraulics/Surge': [
    ['Priya Menon', 'Sr. Hydraulics Engineer'], ['Omar Saleh', 'Hydraulics Engineer'],
    ['Divya Pillai', 'Hydraulics Engineer'], ['Bilal Anwar', 'Jr. Hydraulics Engineer'],
  ],
  'Acoustics': [
    ['Meera Nair', 'Sr. Acoustic Engineer'], ['John Mathews', 'Acoustic Engineer'],
    ['Layla Hassan', 'Acoustic Engineer'], ['Arjun Nambiar', 'Jr. Acoustic Engineer'],
  ],
  'ESP': [
    ['Omar Haddad', 'Sr. ESP Engineer'], ['Nisha Verma', 'ESP Engineer'],
    ['Tariq Nasser', 'ESP Engineer'], ['Sara Ibrahim', 'Jr. ESP Engineer'],
  ],
};

const TASK_TEMPLATES = {
  'Piping': [
    { sub: 'Input Study', name: 'Piping input data review' },
    { sub: 'Modelling', name: '3D piping model' },
    { sub: 'Analysis', name: 'Pipe stress analysis' },
  ],
  'Structural': [
    { sub: 'Input Study', name: 'Structural loading input review' },
    { sub: 'Modelling', name: 'Steel frame 3D model' },
    { sub: 'Analysis', name: 'Foundation load analysis' },
  ],
  'Hydraulics/Surge': [
    { sub: 'Input Study', name: 'Hydraulic network input review' },
    { sub: 'Modelling', name: 'Surge network model' },
    { sub: 'Analysis', name: 'Transient surge analysis' },
  ],
  'Acoustics': [
    { sub: 'Input Study', name: 'Acoustic site survey input' },
    { sub: 'Calculations', name: 'Equipment noise calculations' },
    { sub: 'Analysis', name: 'Noise impact analysis' },
  ],
  'ESP': [
    { sub: 'Input Study', name: 'ESP process input review' },
    { sub: 'Model extraction', name: 'ESP model extraction' },
    { sub: 'Calculations', name: 'ESP sizing calculations' },
  ],
};

const PROJECTS = [
  {
    jobCode: 'AAPL-26-0812', name: 'Saria Refinery Expansion', clientName: 'Saria Industrial Holdings',
    consultantName: 'Meridian Engineering Consultants', mainContractorName: 'Horizon Construction Co.',
    mapContractorName: 'Bluewave MEP Contractors', pmName: 'Christine Lobo',
    departments: ['Piping', 'Structural', 'Hydraulics/Surge'],
    startDate: '2026-04-06', targetDate: '2026-10-30', priority: 'High', estimatedManHours: 640,
  },
  {
    jobCode: 'AAPL-26-0745', name: 'Wynn Tower Development', clientName: 'Wynn Development Group',
    consultantName: 'Northgate Design Partners', mainContractorName: 'Summit Builders LLC',
    mapContractorName: 'Coastal MEP Services', pmName: 'Salim Al-Busaidi',
    departments: ['Structural', 'Acoustics', 'ESP'],
    startDate: '2026-02-16', targetDate: '2026-09-25', priority: 'Critical', estimatedManHours: 900,
  },
  {
    jobCode: 'AAPL-26-0791', name: 'Al Reem Hospital', clientName: 'Al Reem Healthcare Projects',
    consultantName: 'Meridian Engineering Consultants', mainContractorName: 'Vantage Construction Group',
    mapContractorName: 'Bluewave MEP Contractors', pmName: 'Salim Al-Busaidi',
    departments: ['Piping', 'Hydraulics/Surge', 'ESP'],
    startDate: '2026-03-02', targetDate: '2026-12-18', priority: 'High', estimatedManHours: 1200,
  },
  {
    jobCode: 'AAPL-26-0688', name: 'Marbella Coastal Residences', clientName: 'Marbella Coastal Developers',
    consultantName: 'Northgate Design Partners', mainContractorName: 'Summit Builders LLC',
    mapContractorName: 'Coastal MEP Services', pmName: 'Waleed Nasser',
    departments: ['Structural', 'Acoustics'],
    startDate: '2026-05-11', targetDate: '2026-11-05', priority: 'Medium', estimatedManHours: 480,
  },
];

const STATUS_CYCLE = ['Completed', 'In Progress', 'In Progress', 'Not Started', 'On Hold'];

function emailFor(name) {
  const [first, ...rest] = name.toLowerCase().split(' ');
  return `${first}.${rest[rest.length - 1]}@aaplconsulting.com`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('Seeding AAPL Platform demo data...');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // 1. Departments + sub-departments
  const deptIdByName = {};
  const subDeptIdByKey = {}; // `${deptName}::${subName}` -> id
  for (const dept of DEPARTMENTS) {
    const [result] = await pool.query('INSERT INTO departments (name) VALUES (?)', [dept.name]);
    deptIdByName[dept.name] = result.insertId;
    for (const sub of dept.subDepartments) {
      const [subResult] = await pool.query(
        'INSERT INTO sub_departments (department_id, name) VALUES (?, ?)',
        [result.insertId, sub]
      );
      subDeptIdByKey[`${dept.name}::${sub}`] = subResult.insertId;
    }
  }
  console.log(`  departments: ${DEPARTMENTS.length}`);

  // 2. Employees (managers, then staff by department)
  const empIdByName = {};
  for (const name of MANAGERS) {
    const [result] = await pool.query(
      `INSERT INTO employees (name, email, password_hash, department_id, designation, role, status)
       VALUES (?, ?, ?, NULL, 'Project Manager', 'project_manager', 'active')`,
      [name, emailFor(name), passwordHash]
    );
    empIdByName[name] = result.insertId;
  }
  for (const [deptName, staffList] of Object.entries(STAFF_BY_DEPT)) {
    for (const [name, designation] of staffList) {
      const [result] = await pool.query(
        `INSERT INTO employees (name, email, password_hash, department_id, designation, role, status)
         VALUES (?, ?, ?, ?, ?, 'employee', 'active')`,
        [name, emailFor(name), passwordHash, deptIdByName[deptName], designation]
      );
      empIdByName[name] = result.insertId;
    }
  }
  console.log(`  employees: ${Object.keys(empIdByName).length}`);

  // 3. Projects + project_departments
  const projectIdByJobCode = {};
  for (const p of PROJECTS) {
    const [result] = await pool.query(
      `INSERT INTO projects
        (job_code, name, client_name, consultant_name, main_contractor_name, map_contractor_name,
         project_manager_id, start_date, target_date, priority, estimated_man_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress')`,
      [p.jobCode, p.name, p.clientName, p.consultantName, p.mainContractorName, p.mapContractorName,
        empIdByName[p.pmName], p.startDate, p.targetDate, p.priority, p.estimatedManHours]
    );
    projectIdByJobCode[p.jobCode] = result.insertId;
    for (const deptName of p.departments) {
      await pool.query('INSERT INTO project_departments (project_id, department_id) VALUES (?, ?)', [result.insertId, deptIdByName[deptName]]);
    }
  }
  console.log(`  projects: ${PROJECTS.length}`);

  // 4. Tasks — for each project, for each of its departments, up to 3 template tasks
  const createdTaskIds = [];
  let cycleIdx = 0;
  for (const p of PROJECTS) {
    const projectId = projectIdByJobCode[p.jobCode];
    let deptIdx = 0;
    for (const deptName of p.departments) {
      const staffList = STAFF_BY_DEPT[deptName];
      const templates = TASK_TEMPLATES[deptName];
      let tIdx = 0;
      for (const tpl of templates) {
        const [emp] = staffList[(deptIdx + tIdx) % staffList.length];
        const status = STATUS_CYCLE[cycleIdx % STATUS_CYCLE.length];
        const allocatedHours = [40, 60, 50, 35, 70][cycleIdx % 5];
        const subDeptId = subDeptIdByKey[`${deptName}::${tpl.sub}`];
        const [result] = await pool.query(
          `INSERT INTO tasks (project_id, sub_department_id, employee_id, task_name, allocated_hours, due_date, status, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId, subDeptId, empIdByName[emp], `${tpl.name} — ${p.name.split(' ')[0]}`,
            allocatedHours, addDays(p.startDate, 20 + tIdx * 25 + deptIdx * 10), status,
            status === 'On Hold' ? 'Awaiting client input before proceeding.' : null,
          ]
        );
        createdTaskIds.push({ taskId: result.insertId, employeeId: empIdByName[emp], allocatedHours, status });
        tIdx += 1;
        cycleIdx += 1;
      }
      deptIdx += 1;
    }
  }
  console.log(`  tasks: ${createdTaskIds.length}`);

  // 5. Time logs — a handful of Start/Stop sessions per task, roughly matching status
  let logCount = 0;
  let dayOffset = 0;
  for (const t of createdTaskIds) {
    const targetPct = { Completed: 1.05, 'In Progress': 0.45, 'On Hold': 0.18, 'Not Started': 0 }[t.status] ?? 0.3;
    const targetMinutes = Math.round(t.allocatedHours * 60 * targetPct);
    if (targetMinutes <= 0) { dayOffset += 1; continue; }

    const sessionCount = targetMinutes > 300 ? 4 : targetMinutes > 120 ? 3 : 2;
    let remaining = targetMinutes;
    for (let s = 0; s < sessionCount; s += 1) {
      const isLast = s === sessionCount - 1;
      const dur = isLast ? remaining : Math.round((remaining / (sessionCount - s)) * (0.8 + (s % 3) * 0.15));
      const duration = Math.max(30, dur);
      const logDate = addDays('2026-09-01', (dayOffset * 3 + s * 2) % 18);
      const startHour = 8 + (s % 3) * 2;
      const startTime = `${logDate} ${String(startHour).padStart(2, '0')}:00:00`;

      await pool.query(
        `INSERT INTO time_logs (task_id, employee_id, start_time, end_time, duration_minutes, log_date)
         VALUES (?, ?, ?, DATE_ADD(?, INTERVAL ? MINUTE), ?, ?)`,
        [t.taskId, t.employeeId, startTime, startTime, duration, duration, logDate]
      );
      remaining -= dur;
      logCount += 1;
    }
    dayOffset += 1;
  }
  console.log(`  time logs: ${logCount}`);

  // 6. Team Leaders, Department Heads, HR/Admin, Management, System Administrator
  const extra = await seedOrganisation(pool, passwordHash);
  console.log(`  role accounts: ${extra.length}`);

  console.log(`\nDone. Every seeded account uses the password: ${DEMO_PASSWORD}`);
  console.log('Sign in with the Employee ID (EMP-001 ...). Examples:');
  console.log(`  EMP-001  Project Manager  ${emailFor('Salim Al-Busaidi')}`);
  console.log(`  EMP-004  Employee         ${emailFor('Ahmed Khalil')}`);
  extra.forEach((a) => console.log(`  EMP-${String(a.id).padStart(3, '0')}  ${a.role.padEnd(16)} ${a.name}`));

  await pool.end();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await pool.end();
  process.exit(1);
});
