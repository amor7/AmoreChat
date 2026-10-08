import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { get, run, now } from './db.js';

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'ac_session';
const SESSION_TTL = 90 * 24 * 3600 * 1000;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const hash = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomCode = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    now(),
    now() + SESSION_TTL,
    String(userAgent || '').slice(0, 200),
  );
  return token;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function userFromToken(token) {
  if (!token) return null;
  const user = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    now(),
  );
  if (!user || user.banned) return null;
  return user;
}

export const cookieOptions = (req) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : req.protocol === 'https',
  maxAge: SESSION_TTL / 1000,
});

export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    bio: u.bio,
    avatar: u.avatar_file_id,
    role: u.role,
    lastSeen: u.last_seen,
  };
}

export function selfUser(u) {
  return { ...publicUser(u), adminPerms: JSON.parse(u.admin_perms || '[]') };
}
