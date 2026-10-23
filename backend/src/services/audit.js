// The audit trail (SRS §35): who changed what, and when. Every change to
// people, structure, projects, tasks, logged hours and settings is recorded
// here, with the old and new values where there are any.
//
// A failure to write the trail is logged loudly but never undoes the change
// itself, the same rule notifications follow.

const pool = require('../config/db');
const { ROLES } = require('../auth/permissions');

// What each role may read. null means everything.
const ENTITY_TYPES = ['auth', 'employee', 'department', 'sub-department', 'team', 'project', 'task', 'time-log', 'correction', 'settings'];
const AUDIT_ACCESS = {
  [ROLES.MANAGEMENT]: null,
  [ROLES.HR_ADMIN]: ['employee', 'department', 'sub-department', 'team'],
  [ROLES.SYSTEM_ADMIN]: ['auth', 'employee', 'department', 'sub-department', 'team', 'settings'],
};

const SYSTEM_ACTOR = { id: null, name: 'System', role: null };

// record(req.user, { action: 'project.update', entityType: 'project', entityId, summary, details })
async function record(actor, { action, entityType, entityId = null, summary, details = null }) {
  const who = actor || SYSTEM_ACTOR;
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [who.id, String(who.name).slice(0, 100), who.role, action, entityType, entityId, String(summary).slice(0, 300), details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error(`AUDIT WRITE FAILED for "${action}" (${summary}):`, err.message);
  }
}

// The fields that really changed, as { field: { from, to } }. Dates and
// numbers are compared as text so 10 and "10.00" are the same value.
function changes(before, after, fields) {
  // mysql2 hands DATE columns back as local-midnight Date objects.
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // DECIMAL columns come back as "80.00"; show them as 80.
  const norm = (v) => {
    if (v == null) return null;
    if (v instanceof Date) return day(v);
    return typeof v === 'string' && /^-?\d+\.\d+$/.test(v) ? String(Number(v)) : String(v);
  };
  const result = {};
  for (const field of fields) {
    if (!(field in after)) continue;
    const from = norm(before[field]);
    const to = norm(after[field]);
    if (from !== to) result[field] = { from, to };
  }
  return result;
}

module.exports = { record, changes, ENTITY_TYPES, AUDIT_ACCESS, SYSTEM_ACTOR };
