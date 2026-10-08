import { get, all, run } from './db.js';

export const DEFAULTS = {
  site_name: 'AmoreChat',
  // open | invite | closed
  registration_mode: 'invite',
  // Can regular users create groups and channels?
  allow_user_groups: '1',
  max_upload_mb: '100',
  // Total upload quota per user in MB; 0 = unlimited.
  user_quota_mb: '0',
};

let cache = null;

function load() {
  cache = { ...DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) cache[r.key] = r.value;
}

export function getSetting(key) {
  if (!cache) load();
  return cache[key];
}

export function getAllSettings() {
  if (!cache) load();
  return { ...cache };
}

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error('unknown setting ' + key);
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  load();
}

export const settingNumber = (key) => Number(getSetting(key)) || 0;

// Used for invites and similar: a single row lookup is cheap, so no cache needed.
export const hasAnyUser = () => !!get('SELECT 1 FROM users LIMIT 1');
