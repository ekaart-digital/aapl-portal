const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { record } = require('../services/audit');
const { ROLES } = require('../auth/permissions');

const NAME_MAX = 100;

async function assertLeader(leaderId, departmentId) {
  const [rows] = await pool.query(
    "SELECT employee_id, department_id FROM employees WHERE employee_id = ? AND role = 'team_leader' AND status = 'active'",
    [leaderId]
  );
  if (!rows.length) throw ApiError.badRequest('leaderId must be an active Team Leader.');
  if (rows[0].department_id !== departmentId) throw ApiError.badRequest('A team leader must belong to the same department as the team.');
}

function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw ApiError.badRequest('name is required.');
  if (name.length > NAME_MAX) throw ApiError.badRequest(`name must be at most ${NAME_MAX} characters.`);
  return name;
}

function toPublic(row) {
  return {
    id: row.team_id,
    name: row.name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    leaderId: row.leader_id,
    leaderName: row.leader_name || null,
    memberCount: Number(row.member_count || 0),
  };
}

const TEAM_SELECT = `
  SELECT t.*, d.name AS department_name, l.name AS leader_name,
         (SELECT COUNT(*) FROM employees e WHERE e.team_id = t.team_id AND e.status = 'active') AS member_count
    FROM teams t
    JOIN departments d ON d.department_id = t.department_id
    LEFT JOIN employees l ON l.employee_id = t.leader_id
`;

// HR/Admin, Management and the System Administrator see every team; a
// Department Head their departments' teams; a Team Leader their own.
const listTeams = asyncHandler(async (req, res) => {
  let where = '1 = 1';
  const params = [];
  if (req.user.role === ROLES.DEPARTMENT_HEAD) {
    where = req.user.scopeDepartmentIds.length ? 't.department_id IN (?)' : '1 = 0';
    if (req.user.scopeDepartmentIds.length) params.push(req.user.scopeDepartmentIds);
  } else if (req.user.role === ROLES.TEAM_LEADER) {
    where = req.user.teamIds.length ? 't.team_id IN (?)' : '1 = 0';
    if (req.user.teamIds.length) params.push(req.user.teamIds);
  } else if (req.user.role === ROLES.PROJECT_MANAGER) {
    // Teams of the departments taking part in the projects they manage.
    where = `t.department_id IN (SELECT pd.department_id FROM project_departments pd
                                  JOIN projects p ON p.project_id = pd.project_id WHERE p.project_manager_id = ?)`;
    params.push(req.user.id);
  }
  const [rows] = await pool.query(`${TEAM_SELECT} WHERE ${where} ORDER BY d.name, t.name`, params);
  res.json({ teams: rows.map(toPublic) });
});

async function fetchTeam(id) {
  const [rows] = await pool.query(`${TEAM_SELECT} WHERE t.team_id = ?`, [id]);
  return rows[0] || null;
}

const createTeam = asyncHandler(async (req, res) => {
  const name = cleanName(req.body.name);
  const departmentId = Number(req.body.departmentId);
  const [dept] = await pool.query('SELECT department_id FROM departments WHERE department_id = ?', [departmentId]);
  if (!dept.length) throw ApiError.badRequest('departmentId must be an existing department.');

  const [dupe] = await pool.query('SELECT 1 FROM teams WHERE department_id = ? AND name = ?', [departmentId, name]);
  if (dupe.length) throw ApiError.conflict(`A team named "${name}" already exists in this department.`);

  const leaderId = req.body.leaderId == null ? null : Number(req.body.leaderId);
  if (leaderId) await assertLeader(leaderId, departmentId);

  const [result] = await pool.query('INSERT INTO teams (name, department_id, leader_id) VALUES (?, ?, ?)', [name, departmentId, leaderId]);
  await record(req.user, { action: 'team.create', entityType: 'team', entityId: result.insertId, summary: `Created team ${name}`, details: { departmentId, leaderId } });
  res.status(201).json({ team: toPublic(await fetchTeam(result.insertId)) });
});

const updateTeam = asyncHandler(async (req, res) => {
  const team = await fetchTeam(req.params.id);
  if (!team) throw ApiError.notFound('Team not found.');
  const sets = [];
  const params = [];

  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    const [dupe] = await pool.query('SELECT 1 FROM teams WHERE department_id = ? AND name = ? AND team_id <> ?', [team.department_id, name, team.team_id]);
    if (dupe.length) throw ApiError.conflict(`A team named "${name}" already exists in this department.`);
    sets.push('name = ?'); params.push(name);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'leaderId')) {
    if (req.body.leaderId !== null) await assertLeader(Number(req.body.leaderId), team.department_id);
    sets.push('leader_id = ?'); params.push(req.body.leaderId);
  }
  if (sets.length) await pool.query(`UPDATE teams SET ${sets.join(', ')} WHERE team_id = ?`, [...params, team.team_id]);
  const entity = { entityType: 'team', entityId: team.team_id };
  if (req.body.name !== undefined && String(req.body.name).trim() !== team.name) {
    await record(req.user, { ...entity, action: 'team.rename', summary: `Renamed team ${team.name} to ${String(req.body.name).trim()}`, details: { from: team.name, to: String(req.body.name).trim() } });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'leaderId') && (req.body.leaderId ?? null) !== (team.leader_id ?? null)) {
    await record(req.user, { ...entity, action: 'team.leader-change', summary: `Changed the leader of ${team.name}`, details: { from: team.leader_id ?? null, to: req.body.leaderId ?? null } });
  }
  res.json({ team: toPublic(await fetchTeam(team.team_id)) });
});

// Removing a team just un-assigns its members; nobody loses their account or work.
const deleteTeam = asyncHandler(async (req, res) => {
  const team = await fetchTeam(req.params.id);
  if (!team) throw ApiError.notFound('Team not found.');
  await pool.query('UPDATE employees SET team_id = NULL WHERE team_id = ?', [team.team_id]);
  await pool.query('DELETE FROM teams WHERE team_id = ?', [team.team_id]);
  await record(req.user, { action: 'team.delete', entityType: 'team', entityId: team.team_id, summary: `Removed team ${team.name}` });
  res.json({ ok: true });
});

module.exports = { listTeams, createTeam, updateTeam, deleteTeam };
