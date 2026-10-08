import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'amorechat.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

// Prepared statements are cached by SQL text.
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
export const get = (sql, ...p) => stmt(sql).get(...p);
export const all = (sql, ...p) => stmt(sql).all(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();

// Each entry runs once, in order; PRAGMA user_version tracks progress.
const migrations = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    admin_perms TEXT NOT NULL DEFAULT '[]',
    bio TEXT NOT NULL DEFAULT '',
    avatar_file_id INTEGER,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_by INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'file',
    width INTEGER,
    height INTEGER,
    duration REAL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX files_owner ON files(owner_id);
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    avatar_file_id INTEGER,
    is_public INTEGER NOT NULL DEFAULT 0,
    is_emergency INTEGER NOT NULL DEFAULT 0,
    slow_mode INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    dm_key TEXT UNIQUE,
    created_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chat_members (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    perms TEXT NOT NULL DEFAULT '[]',
    muted_until INTEGER,
    last_read INTEGER NOT NULL DEFAULT 0,
    last_post_at INTEGER,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE INDEX chat_members_user ON chat_members(user_id);
  CREATE TABLE chat_bans (
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    by_id INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );
  CREATE TABLE chat_invites (
    code TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    created_by INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_id INTEGER,
    type TEXT NOT NULL DEFAULT 'text',
    text TEXT NOT NULL DEFAULT '',
    file_id INTEGER,
    reply_to INTEGER,
    edited_at INTEGER,
    deleted INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX messages_chat ON messages(chat_id, id);
  CREATE INDEX messages_file ON messages(file_id);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  `,
];

const current = db.prepare('PRAGMA user_version').get().user_version;
for (let v = current; v < migrations.length; v++) {
  tx(() => {
    db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  });
}

export const parseJSON = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};
