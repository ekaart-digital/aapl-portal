// Demo accounts for the roles beyond Project Manager and Employee (SRS §34),
// plus one team per department. Safe to run more than once: anything that
// already exists (matched by email or team name) is reused.

const NAMES = {
  heads: {
    'Piping': ['Khalid Al-Rawahi', 'Head of Piping'],
    'Structural': ['Maryam Al-Balushi', 'Head of Structural'],
    'Hydraulics/Surge': ['Yusuf Al-Hinai', 'Head of Hydraulics/Surge'],
    'Acoustics': ['Aisha Al-Kindi', 'Head of Acoustics'],
    'ESP': ['Said Al-Mamari', 'Head of ESP'],
  },
  leaders: {
    'Piping': ['Hilal Al-Siyabi', 'Team Leader - Piping'],
    'Structural': ['Noora Al-Farsi', 'Team Leader - Structural'],
    'Hydraulics/Surge': ['Sultan Al-Lawati', 'Team Leader - Hydraulics/Surge'],
    'Acoustics': ['Zainab Al-Habsi', 'Team Leader - Acoustics'],
    'ESP': ['Mohammed Al-Ghafri', 'Team Leader - ESP'],
  },
  hr: ['Layan Al-Mahrouqi', 'HR / Admin Officer'],
  management: ['Hamad Al-Said', 'Managing Director'],
  sysadmin: ['Platform Administrator', 'System Administrator'],
};

function emailFor(name) {
  const [first, ...rest] = name.toLowerCase().split(' ');
  return `${first}.${rest[rest.length - 1]}@aaplconsulting.com`;
}

async function ensureAccount(pool, passwordHash, { name, designation, role, departmentId = null }) {
  const email = emailFor(name);
  const [existing] = await pool.query('SELECT employee_id FROM employees WHERE email = ?', [email]);
  if (existing.length) return { id: existing[0].employee_id, created: false, name, role, email };

  const [result] = await pool.query(
    `INSERT INTO employees (name, email, password_hash, department_id, designation, role, status, date_of_joining)
     VALUES (?, ?, ?, ?, ?, ?, 'active', '2019-06-01')`,
    [name, email, passwordHash, departmentId, designation, role]
  );
  return { id: result.insertId, created: true, name, role, email };
}

async function seedOrganisation(pool, passwordHash) {
  const accounts = [];
  const [departments] = await pool.query('SELECT department_id, name FROM departments ORDER BY department_id');

  for (const dept of departments) {
    const headSpec = NAMES.heads[dept.name];
    const leaderSpec = NAMES.leaders[dept.name];
    if (!headSpec || !leaderSpec) continue; // a department added later by the client: nothing to demo

    const head = await ensureAccount(pool, passwordHash, { name: headSpec[0], designation: headSpec[1], role: 'department_head', departmentId: dept.department_id });
    const leader = await ensureAccount(pool, passwordHash, { name: leaderSpec[0], designation: leaderSpec[1], role: 'team_leader', departmentId: dept.department_id });
    accounts.push(head, leader);

    await pool.query('UPDATE departments SET head_id = ? WHERE department_id = ? AND head_id IS NULL', [head.id, dept.department_id]);

    const teamName = `${dept.name} Team A`;
    let [team] = await pool.query('SELECT team_id FROM teams WHERE department_id = ? AND name = ?', [dept.department_id, teamName]);
    if (!team.length) {
      await pool.query('INSERT INTO teams (name, department_id, leader_id) VALUES (?, ?, ?)', [teamName, dept.department_id, leader.id]);
      [team] = await pool.query('SELECT team_id FROM teams WHERE department_id = ? AND name = ?', [dept.department_id, teamName]);
    }
    await pool.query(
      "UPDATE employees SET team_id = ? WHERE department_id = ? AND role IN ('employee','team_leader') AND team_id IS NULL",
      [team[0].team_id, dept.department_id]
    );
  }

  accounts.push(
    await ensureAccount(pool, passwordHash, { name: NAMES.hr[0], designation: NAMES.hr[1], role: 'hr_admin' }),
    await ensureAccount(pool, passwordHash, { name: NAMES.management[0], designation: NAMES.management[1], role: 'management' }),
    await ensureAccount(pool, passwordHash, { name: NAMES.sysadmin[0], designation: NAMES.sysadmin[1], role: 'system_admin' }),
  );

  // Joining dates for the people who have none (a stable spread, for demo).
  await pool.query("UPDATE employees SET date_of_joining = DATE_ADD('2020-01-01', INTERVAL (employee_id * 37) DAY) WHERE date_of_joining IS NULL");

  return accounts;
}

module.exports = { seedOrganisation, emailFor };
