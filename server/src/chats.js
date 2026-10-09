import { get, all, run, now, tx, parseJSON } from './db.js';
import { toChat, toUser, joinChat, leaveChat, isOnline } from './realtime.js';

export function fail(statusCode, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  throw e;
}

export const getChat = (chatId) => get('SELECT * FROM chats WHERE id = ?', chatId);
export const getMember = (chatId, userId) =>
  get('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, userId);

const MSG_SELECT = `
  SELECT m.*,
    u.display_name AS sender_name, u.username AS sender_username, u.avatar_file_id AS sender_avatar,
    f.mime AS f_mime, f.size AS f_size, f.name AS f_name, f.kind AS f_kind,
    f.width AS f_w, f.height AS f_h, f.duration AS f_dur, f.status AS f_status,
    f.variants AS f_variants, f.thumb AS f_thumb, f.waveform AS f_wave, f.purged AS f_purged,
    r.text AS r_text, r.type AS r_type, r.deleted AS r_deleted, ru.display_name AS r_sender
  FROM messages m
  LEFT JOIN users u ON u.id = m.sender_id
  LEFT JOIN files f ON f.id = m.file_id
  LEFT JOIN messages r ON r.id = m.reply_to
  LEFT JOIN users ru ON ru.id = r.sender_id`;

// Reactions grouped per emoji: [{ emoji, users: [userId, ...] }]
function reactionsFor(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = all(
    'SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY created_at',
    JSON.stringify(ids),
  );
  for (const r of rows) {
    if (!out.has(r.message_id)) out.set(r.message_id, new Map());
    const byEmoji = out.get(r.message_id);
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(r.user_id);
  }
  return new Map([...out].map(([id, m]) => [id, [...m].map(([emoji, users]) => ({ emoji, users }))]));
}

function withReactions(rows) {
  const reactions = reactionsFor(rows.filter((m) => !m.deleted).map((m) => m.id));
  return rows.map((m) => serializeMessage(m, reactions.get(m.id)));
}

export function serializeMessage(m, reactions = []) {
  if (!m) return null;
  const deleted = !!m.deleted;
  return {
    id: m.id,
    chatId: m.chat_id,
    type: deleted ? 'deleted' : m.type,
    text: deleted ? '' : m.text,
    sender: m.sender_id
      ? { id: m.sender_id, displayName: m.sender_name, username: m.sender_username, avatar: m.sender_avatar }
      : null,
    file:
      !deleted && m.file_id
        ? {
            id: m.file_id,
            mime: m.f_mime,
            size: m.f_size,
            name: m.f_name,
            kind: m.f_kind,
            width: m.f_w,
            height: m.f_h,
            duration: m.f_dur,
            status: m.f_status,
            purged: !!m.f_purged,
            thumb: !!m.f_thumb,
            waveform: m.f_wave,
            variants: parseJSON(m.f_variants, []).map((v) => ({ q: v.q, size: v.size })),
          }
        : null,
    reactions: deleted ? [] : reactions,
    forwardedFrom: m.forwarded_from,
    expiresAt: m.expires_at,
    replyTo: m.reply_to
      ? {
          id: m.reply_to,
          text: m.r_deleted ? '' : m.r_text,
          type: m.r_deleted ? 'deleted' : m.r_type,
          sender: m.r_sender,
        }
      : null,
    editedAt: m.edited_at,
    pinned: !!m.pinned,
    createdAt: m.created_at,
  };
}

export function loadMessage(id) {
  const row = get(`${MSG_SELECT} WHERE m.id = ?`, id);
  return row ? withReactions([row])[0] : null;
}

// Pages of a chat's history. `before`: older than id; `after`: newer than id; `around`: centred on id.
export function loadMessages(chatId, { before, after, around, limit }) {
  let rows;
  if (around) {
    const half = Math.floor(limit / 2);
    const older = all(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id <= ? ORDER BY m.id DESC LIMIT ?`, chatId, around, half + 1);
    const newer = all(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`, chatId, around, half);
    rows = [...older.reverse(), ...newer];
  } else if (after) {
    rows = all(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`, chatId, after, limit);
  } else if (before) {
    rows = all(`${MSG_SELECT} WHERE m.chat_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`, chatId, before, limit).reverse();
  } else {
    rows = all(`${MSG_SELECT} WHERE m.chat_id = ? ORDER BY m.id DESC LIMIT ?`, chatId, limit).reverse();
  }
  return withReactions(rows);
}

export const loadMessagesByIds = (ids) =>
  ids.length ? withReactions(all(`${MSG_SELECT} WHERE m.id IN (SELECT value FROM json_each(?)) ORDER BY m.id DESC`, JSON.stringify(ids))) : [];

const SUMMARY_SELECT = `
  SELECT c.*, cm.role AS my_role, cm.perms AS my_perms, cm.last_read, cm.muted_until,
    (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id = c.id) AS member_count,
    (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.id > cm.last_read
       AND m.deleted = 0 AND m.type != 'system' AND IFNULL(m.sender_id, 0) != cm.user_id) AS unread,
    (SELECT MAX(id) FROM messages m WHERE m.chat_id = c.id) AS last_msg_id,
    (SELECT MAX(o.last_read) FROM chat_members o WHERE o.chat_id = c.id AND o.user_id != cm.user_id) AS others_read
  FROM chats c JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = ?`;

function formatSummary(c, userId) {
  const out = {
    id: c.id,
    type: c.type,
    title: c.title,
    description: c.description,
    avatar: c.avatar_file_id,
    isPublic: !!c.is_public,
    isEmergency: !!c.is_emergency,
    slowMode: c.slow_mode,
    locked: !!c.locked,
    autoDelete: c.auto_delete,
    memberCount: c.member_count,
    myRole: c.my_role,
    myPerms: parseJSON(c.my_perms, []),
    mutedUntil: c.muted_until,
    lastRead: c.last_read,
    othersRead: c.others_read || 0,
    unread: c.unread,
    lastMessage: c.last_msg_id ? loadMessage(c.last_msg_id) : null,
    createdAt: c.created_at,
    peer: null,
  };
  if (c.type === 'dm') {
    const p = get(
      `SELECT u.id, u.username, u.display_name, u.avatar_file_id, u.last_seen
       FROM chat_members cm JOIN users u ON u.id = cm.user_id
       WHERE cm.chat_id = ? AND cm.user_id != ?`,
      c.id,
      userId,
    );
    if (p) {
      out.peer = { id: p.id, username: p.username, displayName: p.display_name, avatar: p.avatar_file_id, lastSeen: p.last_seen, online: isOnline(p.id) };
      out.title = p.display_name;
      out.avatar = p.avatar_file_id;
    }
  }
  if (c.type === 'saved') out.title = 'پیام‌های ذخیره‌شده';
  return out;
}

export function chatSummary(chatId, userId) {
  const c = get(`${SUMMARY_SELECT} WHERE c.id = ?`, userId, chatId);
  return c ? formatSummary(c, userId) : null;
}

export function listChats(userId) {
  return all(SUMMARY_SELECT, userId).map((c) => formatSummary(c, userId));
}

export function postMessage({ chatId, senderId = null, type = 'text', text = '', fileId = null, replyTo = null, forwardedFrom = null }) {
  const t = now();
  const autoDelete = type === 'system' ? 0 : get('SELECT auto_delete FROM chats WHERE id = ?', chatId)?.auto_delete;
  const id = tx(() => {
    const r = run(
      'INSERT INTO messages (chat_id, sender_id, type, text, file_id, reply_to, forwarded_from, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      chatId,
      senderId,
      type,
      text,
      fileId,
      replyTo,
      forwardedFrom,
      autoDelete ? t + autoDelete * 1000 : null,
      t,
    );
    const msgId = Number(r.lastInsertRowid);
    if (senderId) {
      run('UPDATE chat_members SET last_post_at = ?, last_read = ? WHERE chat_id = ? AND user_id = ?', t, msgId, chatId, senderId);
    }
    return msgId;
  });
  const msg = loadMessage(id);
  toChat(chatId, 'message:new', msg);
  return msg;
}

export const systemMessage = (chatId, text) => postMessage({ chatId, type: 'system', text });

export function addMember(chatId, userId, role = 'member', { silent = false } = {}) {
  const r = run(
    'INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at, last_read) VALUES (?, ?, ?, ?, (SELECT IFNULL(MAX(id), 0) FROM messages WHERE chat_id = ?))',
    chatId,
    userId,
    role,
    now(),
    chatId,
  );
  if (!r.changes) return false;
  joinChat(userId, chatId);
  const chat = getChat(chatId);
  if (!silent && chat.type === 'group') {
    const u = get('SELECT display_name FROM users WHERE id = ?', userId);
    systemMessage(chatId, `${u.display_name} به گروه پیوست`);
  }
  toUser(userId, 'chat:new', chatSummary(chatId, userId));
  toChat(chatId, 'chat:changed', { chatId });
  return true;
}

export function removeMember(chatId, userId, reason = 'left') {
  const r = run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', chatId, userId);
  if (!r.changes) return false;
  leaveChat(userId, chatId);
  toUser(userId, 'chat:removed', { chatId, reason });
  const chat = getChat(chatId);
  if (chat.type === 'group') {
    const u = get('SELECT display_name FROM users WHERE id = ?', userId);
    systemMessage(chatId, reason === 'left' ? `${u.display_name} گروه را ترک کرد` : `${u.display_name} از گروه حذف شد`);
  }
  toChat(chatId, 'chat:changed', { chatId });
  return true;
}

export function createChat({ type, title = '', description = '', createdBy = null, isPublic = false, isEmergency = false, dmKey = null }) {
  const r = run(
    'INSERT INTO chats (type, title, description, is_public, is_emergency, dm_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    type,
    title,
    description,
    isPublic ? 1 : 0,
    isEmergency ? 1 : 0,
    dmKey,
    createdBy,
    now(),
  );
  return Number(r.lastInsertRowid);
}

export function getOrCreateDm(a, b) {
  const key = `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
  const c = get('SELECT id FROM chats WHERE dm_key = ?', key);
  if (c) return c.id;
  const id = createChat({ type: 'dm', dmKey: key, createdBy: a });
  addMember(id, a, 'member', { silent: true });
  addMember(id, b, 'member', { silent: true });
  return id;
}

export function ensureEmergencyChannel() {
  const c = get('SELECT id FROM chats WHERE is_emergency = 1');
  if (c) return c.id;
  return createChat({
    type: 'channel',
    title: '📢 اطلاع‌رسانی',
    description: 'کانال اطلاع‌رسانی رسمی. همه کاربران عضو آن هستند.',
    isEmergency: true,
  });
}

export function ensureSavedChat(userId) {
  const key = `saved:${userId}`;
  const c = get('SELECT id FROM chats WHERE dm_key = ?', key);
  if (c) return c.id;
  const id = createChat({ type: 'saved', dmKey: key, createdBy: userId });
  addMember(id, userId, 'owner', { silent: true });
  return id;
}

export function audit(actorId, action, target = '', details = '') {
  run(
    'INSERT INTO audit_log (actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?)',
    actorId,
    action,
    String(target),
    typeof details === 'string' ? details : JSON.stringify(details),
    now(),
  );
}
