import fs from 'node:fs';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { db, DATA_DIR } from './db.js';

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);
const DAY = 24 * 3600 * 1000;

// Online snapshot of the database (safe while the server is running).
// Uploaded files are not copied; they live in DATA_DIR/uploads and never change once written.
export async function backupNow() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const file = path.join(BACKUP_DIR, `amorechat-${stamp}.db`);
  await backup(db, file);
  const old = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^amorechat-\d+\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  return file;
}

export function scheduleBackups(log) {
  const latest = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).sort().at(-1) : null;
  const latestAge = latest ? Date.now() - fs.statSync(path.join(BACKUP_DIR, latest)).mtimeMs : Infinity;
  const run = () =>
    backupNow()
      .then((f) => log.info(`backup written: ${f}`))
      .catch((e) => log.error(e, 'backup failed'));
  setTimeout(
    () => {
      run();
      setInterval(run, DAY).unref();
    },
    Math.max(60_000, DAY - latestAge),
  ).unref();
}
