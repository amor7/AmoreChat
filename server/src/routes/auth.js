import { get, all, run, now, tx } from '../db.js';
import { getSetting, hasAnyUser } from '../settings.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  cookieOptions,
  SESSION_COOKIE,
  USERNAME_RE,
  selfUser,
  publicUser,
} from '../auth.js';
import { fail, addMember, ensureEmergencyChannel, ensureSavedChat, audit } from '../chats.js';
import { isOnline } from '../realtime.js';

const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function checkInvite(code) {
  const inv = get('SELECT * FROM invites WHERE code = ?', String(code || '').trim());
  if (!inv) return null;
  if (inv.max_uses != null && inv.uses >= inv.max_uses) return null;
  if (inv.expires_at != null && inv.expires_at < now()) return null;
  return inv;
}

export default async function authRoutes(app) {
  app.get('/api/config', { config: { public: true } }, async () => ({
    siteName: getSetting('site_name'),
    registrationMode: getSetting('registration_mode'),
    allowUserGroups: getSetting('allow_user_groups') === '1',
    needsSetup: !hasAnyUser(),
  }));

  app.get('/api/invites/:code/check', { config: { public: true, ...authLimit } }, async (req) => ({
    valid: !!checkInvite(req.params.code),
  }));

  app.post('/api/auth/register', { config: { public: true, ...authLimit } }, async (req, reply) => {
    const { username, password, displayName, invite } = req.body || {};
    const firstUser = !hasAnyUser();
    const mode = getSetting('registration_mode');

    if (!firstUser && mode === 'closed') fail(403, 'ثبت‌نام در حال حاضر بسته است');
    if (!USERNAME_RE.test(username || '')) fail(400, 'نام کاربری باید ۳ تا ۳۲ حرف انگلیسی، عدد یا _ باشد و با حرف شروع شود');
    if (typeof password !== 'string' || password.length < 8) fail(400, 'رمز عبور باید حداقل ۸ کاراکتر باشد');
    const name = String(displayName || '').trim().slice(0, 64);
    if (!name) fail(400, 'نام نمایشی را وارد کنید');

    let inv = null;
    if (firstUser || mode === 'invite') {
      inv = checkInvite(invite);
      if (!inv) fail(403, firstUser ? 'کد راه‌اندازی نامعتبر است (در لاگ سرور چاپ شده)' : 'کد دعوت نامعتبر یا منقضی است');
    }
    if (get('SELECT 1 FROM users WHERE username = ?', username)) fail(409, 'این نام کاربری قبلاً گرفته شده');

    const hash = await hashPassword(password);
    const userId = tx(() => {
      if (inv) run('UPDATE invites SET uses = uses + 1 WHERE id = ?', inv.id);
      const r = run(
        'INSERT INTO users (username, display_name, password_hash, role, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)',
        username,
        name,
        hash,
        firstUser ? 'owner' : 'user',
        now(),
        now(),
      );
      return Number(r.lastInsertRowid);
    });

    ensureSavedChat(userId);
    addMember(ensureEmergencyChannel(), userId, firstUser ? 'owner' : 'member', { silent: true });
    audit(userId, 'user.register', userId, inv ? { invite: inv.code } : '');

    reply.setCookie(SESSION_COOKIE, createSession(userId, req.headers['user-agent']), cookieOptions(req));
    return { user: selfUser(get('SELECT * FROM users WHERE id = ?', userId)) };
  });

  app.post('/api/auth/login', { config: { public: true, ...authLimit } }, async (req, reply) => {
    const { username, password } = req.body || {};
    const user = get('SELECT * FROM users WHERE username = ?', String(username || ''));
    if (!user || !(await verifyPassword(String(password || ''), user.password_hash))) {
      fail(401, 'نام کاربری یا رمز عبور اشتباه است');
    }
    if (user.banned) fail(403, 'حساب شما مسدود شده است');
    reply.setCookie(SESSION_COOKIE, createSession(user.id, req.headers['user-agent']), cookieOptions(req));
    return { user: selfUser(user) };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: selfUser(req.user) }));

  app.post('/api/auth/password', async (req) => {
    const { current, next } = req.body || {};
    if (!(await verifyPassword(String(current || ''), req.user.password_hash))) fail(400, 'رمز فعلی اشتباه است');
    if (typeof next !== 'string' || next.length < 8) fail(400, 'رمز جدید باید حداقل ۸ کاراکتر باشد');
    run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
    return { ok: true };
  });

  app.patch('/api/me', async (req) => {
    const { displayName, bio, avatar } = req.body || {};
    const u = req.user;
    if (displayName !== undefined) {
      const name = String(displayName).trim().slice(0, 64);
      if (!name) fail(400, 'نام نمایشی خالی است');
      run('UPDATE users SET display_name = ? WHERE id = ?', name, u.id);
    }
    if (bio !== undefined) run('UPDATE users SET bio = ? WHERE id = ?', String(bio).slice(0, 300), u.id);
    if (avatar !== undefined) {
      if (avatar !== null) {
        const f = get("SELECT * FROM files WHERE id = ? AND owner_id = ? AND kind = 'image'", avatar, u.id);
        if (!f) fail(400, 'تصویر نامعتبر است');
      }
      run('UPDATE users SET avatar_file_id = ? WHERE id = ?', avatar, u.id);
    }
    return { user: selfUser(get('SELECT * FROM users WHERE id = ?', u.id)) };
  });

  app.get('/api/users/search', async (req) => {
    const q = String(req.query.q || '').trim();
    if (!q) return { users: [] };
    const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const users = all(
      `SELECT * FROM users WHERE banned = 0 AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
       ORDER BY username LIMIT 20`,
      like,
      like,
    );
    return { users: users.map((u) => ({ ...publicUser(u), online: isOnline(u.id) })) };
  });

  app.get('/api/users/:id', async (req) => {
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'کاربر پیدا نشد');
    return { user: { ...publicUser(u), online: isOnline(u.id), banned: !!u.banned } };
  });
}
