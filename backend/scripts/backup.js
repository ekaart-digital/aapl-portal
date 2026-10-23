// Daily database backup (SRS section 39 and 49): a compressed mysqldump of the
// application database, with old backups removed after BACKUP_RETENTION_DAYS.
//
//   npm run backup
//
// Schedule it once a day (cron on Linux, Task Scheduler on Windows). Requires
// the `mysqldump` command (part of the MySQL client tools) on the PATH.
// Managed MySQL services also keep their own backups; this is an additional,
// portable copy you control. To restore, see the "Backups" section of README.md.
//
// Environment: the normal DB_* settings, plus
//   BACKUP_DIR              where files go (default ./backups)
//   BACKUP_RETENTION_DAYS   how long to keep them (default 30)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16); // 2026-10-12-18-00
const file = path.join(dir, `${process.env.DB_NAME}-${stamp}.sql.gz`);

function dump() {
  return new Promise((resolve, reject) => {
    const args = [
      `--host=${process.env.DB_HOST || 'localhost'}`,
      `--port=${process.env.DB_PORT || 3306}`,
      `--user=${process.env.DB_USER}`,
      '--single-transaction', '--routines', '--no-tablespaces', '--set-gtid-purged=OFF',
      ...(process.env.DB_SSL === 'false' ? [] : ['--ssl-mode=REQUIRED']),
      process.env.DB_NAME,
    ];
    // The password goes in the environment, never on the command line.
    const child = spawn('mysqldump', args, { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = fs.createWriteStream(file);
    let errors = '';
    let exitCode = null;
    let written = false;
    const settle = () => {
      if (exitCode === null || !written) return; // wait for both the command and the file
      if (exitCode === 0) resolve();
      else reject(new Error(errors.trim() || `mysqldump failed (exit ${exitCode})`));
    };
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', (err) => reject(err.code === 'ENOENT' ? new Error('mysqldump was not found. Install the MySQL client tools and make sure it is on the PATH.') : err));
    child.on('close', (code) => { exitCode = code; settle(); });
    out.on('finish', () => { written = true; settle(); });
    child.stdout.pipe(zlib.createGzip()).pipe(out);
  });
}

function removeOldBackups() {
  const cutoff = Date.now() - retentionDays * 86400000;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(`${process.env.DB_NAME}-`) || !name.endsWith('.sql.gz')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed += 1; }
  }
  return removed;
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  try {
    await dump();
  } catch (err) {
    if (fs.existsSync(file)) fs.unlinkSync(file); // never leave a half-written backup behind
    throw err;
  }
  const size = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`Backup written: ${file} (${size} KB)`);
  const removed = removeOldBackups();
  if (removed) console.log(`Removed ${removed} backup(s) older than ${retentionDays} days.`);
})().catch((err) => {
  console.error('BACKUP FAILED:', err.message);
  process.exit(1);
});
