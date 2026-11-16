// Gets the system ready for a client to test: removes every employee and
// everything that depends on them (projects, tasks, logged hours, notifications,
// the audit trail, teams), keeps the departments and their sub-disciplines, and
// creates one test account for each of the seven roles.
//
// Usage:
//   TEST_PASSWORD='...' node scripts/reset-test-accounts.js --yes
//
// The accounts are numbered from EMP-001 again. Every account shares TEST_PASSWORD.
// This is destructive and cannot be undone: --yes is required.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { assertStrongPassword } = require('../src/utils/password');

// In this order, so the System Administrator is EMP-001.
const ACCOUNTS = [
  { name: 'testsystemadministrator', role: 'system_admin', designation: 'System Administrator' },
  { name: 'testhradmin', role: 'hr_admin', designation: 'HR / Admin' },
  { name: 'testmanagement', role: 'management', designation: 'Management' },
  { name: 'testprojectmanager', role: 'project_manager', designation: 'Project Manager' },
  { name: 'testdepartmenthead', role: 'department_head', designation: 'Department Head', inDepartment: true },
  { name: 'testteamleader', role: 'team_leader', designation: 'Team Leader', inDepartment: true, inTeam: true },
  { name: 'testemployee', role: 'employee', designation: 'Employee', inDepartment: true, inTeam: true },
];

const LABELS = {
  system_admin: 'System Administrator', hr_admin: 'HR / Admin', management: 'Management', project_manager: 'Project Manager',
  department_head: 'Department Head', team_leader: 'Team Leader', employee: 'Employee',
};

(async () => {
  if (!process.argv.includes('--yes')) throw new Error('This removes every employee, project, task, logged hour, notification and audit entry. Add --yes to go ahead.');
  const password = process.env.TEST_PASSWORD;
  if (!password) throw new Error('Set TEST_PASSWORD.');
  assertStrongPassword(password, 'TEST_PASSWORD');
  const hash = await bcrypt.hash(password, 10);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of ['notifications', 'correction_requests', 'time_logs', 'tasks', 'project_departments', 'projects']) await conn.query(`DELETE FROM ${table}`);
    await conn.query('UPDATE departments SET head_id = NULL');
    await conn.query('UPDATE teams SET leader_id = NULL');
    await conn.query('DELETE FROM employees');
    await conn.query('DELETE FROM teams');
    await conn.query('DELETE FROM audit_log');
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await pool.query('ALTER TABLE employees AUTO_INCREMENT = 1');

  // The test accounts that work in a department share the first one, and a team inside it.
  const [[department]] = await pool.query('SELECT department_id FROM departments ORDER BY department_id LIMIT 1');
  const departmentId = department ? department.department_id : null;
  let teamId = null;
  if (departmentId) teamId = (await pool.query('INSERT INTO teams (name, department_id) VALUES (?, ?)', ['Test Team', departmentId]))[0].insertId;

  const created = [];
  for (const a of ACCOUNTS) {
    const [result] = await pool.query(
      `INSERT INTO employees (name, email, password_hash, department_id, team_id, designation, role, status, date_of_joining)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURDATE())`,
      [a.name, `${a.name}@aaplconsulting.com`, hash, a.inDepartment ? departmentId : null, a.inTeam ? teamId : null, a.designation, a.role]
    );
    created.push({ ...a, id: result.insertId });
  }
  const idOf = (role) => created.find((a) => a.role === role).id;
  if (departmentId) {
    await pool.query('UPDATE departments SET head_id = ? WHERE department_id = ?', [idOf('department_head'), departmentId]);
    await pool.query('UPDATE teams SET leader_id = ? WHERE team_id = ?', [idOf('team_leader'), teamId]);
  }

  console.log('Removed all earlier people and project data. Created one account per role (same password for all):\n');
  for (const a of created) console.log(`  EMP-${String(a.id).padStart(3, '0')}  ${LABELS[a.role].padEnd(20)} ${a.name}`);
})().then(() => pool.end(), async (err) => {
  console.error('FAILED:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
