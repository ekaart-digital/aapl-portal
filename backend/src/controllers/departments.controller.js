const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { record } = require('../services/audit');

const NAME_MAX = 100;

function cleanName(raw, label = 'name') {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) throw ApiError.badRequest(`${label} is required.`);
  if (name.length > NAME_MAX) throw ApiError.badRequest(`${label} must be at most ${NAME_MAX} characters.`);
  return name;
}

// Everyone signed in can read the structure (forms need it). Keys that earlier
// screens rely on (department_id, name, subDepartments) are kept.
const listDepartments = asyncHandler(async (req, res) => {
  const [departments] = await pool.query(
    `SELECT d.department_id, d.name, d.head_id, h.name AS head_name,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.department_id AND e.status = 'active') AS employee_count
       FROM departments d LEFT JOIN employees h ON h.employee_id = d.head_id
      ORDER BY d.name`
  );
  const [subDepts] = await pool.query('SELECT sub_department_id, department_id, name FROM sub_departments ORDER BY name');
  const [teams] = await pool.query(
    `SELECT t.team_id, t.department_id, t.name, t.leader_id, l.name AS leader_name,
            (SELECT COUNT(*) FROM employees e WHERE e.team_id = t.team_id AND e.status = 'active') AS member_count
       FROM teams t LEFT JOIN employees l ON l.employee_id = t.leader_id
      ORDER BY t.name`
  );

  const byDept = new Map(departments.map((d) => [d.department_id, {
    department_id: d.department_id,
    name: d.name,
    headId: d.head_id,
    headName: d.head_name || null,
    employeeCount: Number(d.employee_count),
    subDepartments: [],
    teams: [],
  }]));
  subDepts.forEach((s) => byDept.get(s.department_id)?.subDepartments.push({ id: s.sub_department_id, name: s.name }));
  teams.forEach((t) => byDept.get(t.department_id)?.teams.push({
    id: t.team_id, name: t.name, leaderId: t.leader_id, leaderName: t.leader_name || null, memberCount: Number(t.member_count),
  }));

  res.json({ departments: Array.from(byDept.values()) });
});

async function fetchDepartment(id) {
  const [rows] = await pool.query('SELECT * FROM departments WHERE department_id = ?', [id]);
  return rows[0] || null;
}

async function assertNameFree(table, scopeColumn, scopeValue, name, exceptIdColumn, exceptId) {
  const [dupe] = await pool.query(
    `SELECT 1 FROM ${table} WHERE ${scopeColumn} = ? AND name = ? ${exceptId ? `AND ${exceptIdColumn} <> ?` : ''}`,
    exceptId ? [scopeValue, name, exceptId] : [scopeValue, name]
  );
  if (dupe.length) throw ApiError.conflict(`"${name}" already exists here.`);
}

const createDepartment = asyncHandler(async (req, res) => {
  const name = cleanName(req.body.name);
  const [dupe] = await pool.query('SELECT 1 FROM departments WHERE name = ?', [name]);
  if (dupe.length) throw ApiError.conflict(`A department named "${name}" already exists.`);
  const [result] = await pool.query('INSERT INTO departments (name) VALUES (?)', [name]);
  await record(req.user, { action: 'department.create', entityType: 'department', entityId: result.insertId, summary: `Created department ${name}` });
  res.status(201).json({ department: { id: result.insertId, name } });
});

const updateDepartment = asyncHandler(async (req, res) => {
  const dept = await fetchDepartment(req.params.id);
  if (!dept) throw ApiError.notFound('Department not found.');
  const sets = [];
  const params = [];

  if (req.body.name !== undefined) {
    const name = cleanName(req.body.name);
    const [dupe] = await pool.query('SELECT 1 FROM departments WHERE name = ? AND department_id <> ?', [name, dept.department_id]);
    if (dupe.length) throw ApiError.conflict(`A department named "${name}" already exists.`);
    sets.push('name = ?'); params.push(name);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'headId')) {
    if (req.body.headId !== null) {
      const [head] = await pool.query(
        "SELECT employee_id FROM employees WHERE employee_id = ? AND role = 'department_head' AND status = 'active'",
        [req.body.headId]
      );
      if (!head.length) throw ApiError.badRequest('headId must be an active Department Head.');
    }
    sets.push('head_id = ?'); params.push(req.body.headId);
  }

  if (sets.length) await pool.query(`UPDATE departments SET ${sets.join(', ')} WHERE department_id = ?`, [...params, dept.department_id]);
  const entity = { entityType: 'department', entityId: dept.department_id };
  if (req.body.name !== undefined && String(req.body.name).trim() !== dept.name) {
    await record(req.user, { ...entity, action: 'department.rename', summary: `Renamed department ${dept.name} to ${String(req.body.name).trim()}`, details: { from: dept.name, to: String(req.body.name).trim() } });
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'headId') && (req.body.headId ?? null) !== (dept.head_id ?? null)) {
    await record(req.user, { ...entity, action: 'department.head-change', summary: `Changed the head of ${dept.name}`, details: { from: dept.head_id ?? null, to: req.body.headId ?? null } });
  }
  res.json({ ok: true });
});

const deleteDepartment = asyncHandler(async (req, res) => {
  const dept = await fetchDepartment(req.params.id);
  if (!dept) throw ApiError.notFound('Department not found.');

  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM employees WHERE department_id = ?) AS people,
            (SELECT COUNT(*) FROM teams WHERE department_id = ?) AS teams,
            (SELECT COUNT(*) FROM tasks t JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id WHERE sd.department_id = ?) AS tasks`,
    [dept.department_id, dept.department_id, dept.department_id]
  );
  if (Number(counts.people) || Number(counts.teams) || Number(counts.tasks)) {
    throw ApiError.conflict(`${dept.name} still has ${counts.people} people, ${counts.teams} teams and ${counts.tasks} tasks. Move or remove them first.`);
  }
  await pool.query('DELETE FROM departments WHERE department_id = ?', [dept.department_id]);
  await record(req.user, { action: 'department.delete', entityType: 'department', entityId: dept.department_id, summary: `Removed department ${dept.name}` });
  res.json({ ok: true });
});

const createSubDepartment = asyncHandler(async (req, res) => {
  const dept = await fetchDepartment(req.params.id);
  if (!dept) throw ApiError.notFound('Department not found.');
  const name = cleanName(req.body.name);
  await assertNameFree('sub_departments', 'department_id', dept.department_id, name);
  const [result] = await pool.query('INSERT INTO sub_departments (department_id, name) VALUES (?, ?)', [dept.department_id, name]);
  await record(req.user, { action: 'sub-department.create', entityType: 'sub-department', entityId: result.insertId, summary: `Added sub-discipline ${name} to ${dept.name}` });
  res.status(201).json({ subDepartment: { id: result.insertId, name } });
});

const updateSubDepartment = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sub_departments WHERE sub_department_id = ?', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Sub-department not found.');
  const name = cleanName(req.body.name);
  await assertNameFree('sub_departments', 'department_id', rows[0].department_id, name, 'sub_department_id', rows[0].sub_department_id);
  await pool.query('UPDATE sub_departments SET name = ? WHERE sub_department_id = ?', [name, rows[0].sub_department_id]);
  if (name !== rows[0].name) {
    await record(req.user, { action: 'sub-department.rename', entityType: 'sub-department', entityId: rows[0].sub_department_id, summary: `Renamed sub-discipline ${rows[0].name} to ${name}`, details: { from: rows[0].name, to: name } });
  }
  res.json({ ok: true });
});

const deleteSubDepartment = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sub_departments WHERE sub_department_id = ?', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('Sub-department not found.');
  const [[used]] = await pool.query('SELECT COUNT(*) AS n FROM tasks WHERE sub_department_id = ?', [req.params.id]);
  if (Number(used.n)) throw ApiError.conflict(`"${rows[0].name}" is used by ${used.n} task(s) and cannot be removed.`);
  await pool.query('DELETE FROM sub_departments WHERE sub_department_id = ?', [req.params.id]);
  await record(req.user, { action: 'sub-department.delete', entityType: 'sub-department', entityId: rows[0].sub_department_id, summary: `Removed sub-discipline ${rows[0].name}` });
  res.json({ ok: true });
});

module.exports = {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  createSubDepartment, updateSubDepartment, deleteSubDepartment,
};
