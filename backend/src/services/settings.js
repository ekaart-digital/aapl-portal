// Settings the System Administrator can change without a deployment (SRS §39
// and §26 thresholds). Every setting has a definition (label, range, default),
// so a value can never be saved that the rest of the system cannot cope with.
//
// A saved value wins; otherwise an environment variable (where one exists),
// otherwise the default. Values are cached, and refreshed on every save and
// on the regular sweep, so reads are cheap and synchronous.

const pool = require('../config/db');
const { featureOn } = require('../config/rollout');

const DEFINITIONS = {
  maxSessionHours: {
    label: 'Longest timer session',
    description: 'A timer left running longer than this is stopped automatically and credited only this much, then flagged for review.',
    unit: 'hours', min: 1, max: 24, step: 1, default: 12, env: 'MAX_SESSION_HOURS',
  },
  budgetWarnPercent: {
    label: 'Man-hour warning level',
    description: 'A project that has used this share of its estimated man-hours turns Amber and its manager is warned.',
    unit: '%', min: 50, max: 99, step: 1, default: 80,
  },
  budgetCriticalPercent: {
    label: 'Man-hour limit',
    description: 'A project that has used this share of its estimated man-hours turns Red and managers are alerted.',
    unit: '%', min: 90, max: 200, step: 1, default: 100,
  },
  correctionWindowDays: {
    label: 'Correction request window',
    description: 'How many days back an employee may ask for a logged session to be corrected. Older sessions are corrected by a manager.',
    unit: 'days', min: 1, max: 90, step: 1, default: 14, feature: 'corrections',
  },
  emailMinSeverity: {
    label: 'Email notifications',
    description: 'Which notifications are also sent by email (when email is set up): 0 = none, 1 = all, 2 = attention and critical, 3 = critical only.',
    unit: 'level', min: 0, max: 3, step: 1, default: 2, feature: 'email',
  },
  dailySummaryHour: {
    label: 'Daily summary time',
    description: 'From this hour of the day the daily summary is sent to Team Leaders, Department Heads and Management, and on Fridays the weekly summary.',
    unit: 'hour (0-23)', min: 0, max: 23, step: 1, default: 18, feature: 'summaries',
  },
  sessionTimeoutMinutes: {
    label: 'Idle sign-out',
    description: 'Managers and administrators are signed out after this long without activity. Employees keep working timers, so they are never signed out while one is running.',
    unit: 'minutes', min: 5, max: 480, step: 5, default: 60,
  },
};

const KEYS = Object.keys(DEFINITIONS);

// A setting for a feature that is not open yet is neither shown nor accepted.
const isAvailable = (key) => Boolean(DEFINITIONS[key]) && (!DEFINITIONS[key].feature || featureOn(DEFINITIONS[key].feature));
const availableKeys = () => KEYS.filter(isAvailable);
let cache = new Map();

function envValue(def) {
  if (!def.env || process.env[def.env] == null || process.env[def.env] === '') return null;
  const n = Number(process.env[def.env]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The current value of a setting.
function get(key) {
  const def = DEFINITIONS[key];
  if (!def) throw new Error(`Unknown setting: ${key}`);
  if (cache.has(key)) return cache.get(key);
  const fromEnv = envValue(def);
  return fromEnv != null ? fromEnv : def.default;
}

// Reads the saved values from the database. Safe to call when the table does
// not exist yet (before the migration), in which case defaults apply.
async function load() {
  try {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const next = new Map();
    for (const r of rows) {
      if (DEFINITIONS[r.setting_key] && Number.isFinite(Number(r.setting_value))) next.set(r.setting_key, Number(r.setting_value));
    }
    cache = next;
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Could not load settings:', err.message);
  }
}

// Checks one value against its definition; returns the number or throws a message.
function validate(key, raw) {
  const def = DEFINITIONS[key];
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { error: `${def.label} must be a whole number.` };
  if (n < def.min || n > def.max) return { error: `${def.label} must be between ${def.min} and ${def.max} ${def.unit}.` };
  return { value: n };
}

async function describeAll() {
  const [rows] = await pool.query(
    `SELECT s.setting_key, s.updated_at, e.name AS updated_by_name
       FROM system_settings s LEFT JOIN employees e ON e.employee_id = s.updated_by`
  );
  const meta = new Map(rows.map((r) => [r.setting_key, r]));
  return availableKeys().map((key) => {
    const def = DEFINITIONS[key];
    const row = meta.get(key);
    return {
      key,
      label: def.label,
      description: def.description,
      unit: def.unit,
      min: def.min,
      max: def.max,
      step: def.step,
      default: def.default,
      value: get(key),
      isDefault: !cache.has(key),
      updatedAt: row ? row.updated_at : null,
      updatedByName: row ? row.updated_by_name : null,
    };
  });
}

async function save(key, value, actorId) {
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [key, String(value), actorId]
  );
  cache.set(key, value);
}

// Forget saved values (used by tests, and to return to the defaults).
function resetCache() { cache = new Map(); }

module.exports = { DEFINITIONS, KEYS, availableKeys, isAvailable, get, load, validate, describeAll, save, resetCache };
