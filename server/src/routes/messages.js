import { get, all, run, now } from '../db.js';
import { hasSitePerm, hasChatPerm } from '../perms.js';
import { toChat, toAll } from '../realtime.js';
import { fail, getMember, loadMessage, loadMessages, postMessage, systemMessage, audit } from '../chats.js';
import { requireChat } from './chats.js';

const MAX_TEXT = 4000;
// Which file kinds each message type accepts.
const TYPE_KINDS = { image: ['image'], video: ['video'], voice: ['audio'], file: null };

function assertCanPost(user, chat, member) {
  if (!member) fail(403, 'شما عضو این گفتگو نیستید');
  if (chat.is_emergency) {
    if (member.role !== 'owner' && !hasSitePerm(user, 'broadcast')) fail(403, 'فقط مدیران می‌توانند در این کانال پیام بگذارند');
    return;
  }
  if (chat.type === 'channel') {
    if (!hasChatPerm(user, member, 'post_messages')) fail(403, 'فقط مدیران کانال می‌توانند پیام بگذارند');
    return;
  }
  if (chat.type !== 'group') return;
  const isStaff = member.role === 'owner' || member.role === 'admin' || hasSitePerm(user, 'manage_chats');
  if (isStaff) return;
  if (chat.locked) fail(403, 'گروه قفل است؛ فقط مدیران می‌توانند پیام بدهند');
  if (member.muted_until && member.muted_until > now()) fail(403, 'شما در این گروه بی‌صدا هستید');
  if (chat.slow_mode && member.last_post_at) {
    const wait = Math.ceil((member.last_post_at + chat.slow_mode * 1000 - now()) / 1000);
    if (wait > 0) fail(429, `حالت آهسته فعال است؛ ${wait} ثانیه دیگر صبر کنید`);
  }
}

function requireMessage(req, id) {
  const m = get('SELECT * FROM messages WHERE id = ?', Number(id));
  if (!m || m.deleted) fail(404, 'پیام پیدا نشد');
  const { chat, member } = requireChat(req, m.chat_id, { allowModerator: true });
  return { m, chat, member };
}

export default async function messageRoutes(app) {
  app.get('/api/chats/:id/messages', async (req) => {
    const { chat } = requireChat(req, req.params.id, { allowModerator: true });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = Number(req.query.before) || null;
    return { messages: loadMessages(chat.id, before, limit) };
  });

  app.get('/api/chats/:id/pinned', async (req) => {
    const { chat } = requireChat(req, req.params.id, { allowModerator: true });
    const ids = all('SELECT id FROM messages WHERE chat_id = ? AND pinned = 1 AND deleted = 0 ORDER BY id DESC LIMIT 50', chat.id);
    return { messages: ids.map((r) => loadMessage(r.id)) };
  });

  app.post('/api/chats/:id/messages', async (req) => {
    const { chat, member } = requireChat(req, req.params.id);
    assertCanPost(req.user, chat, member);

    const b = req.body || {};
    const text = String(b.text || '').trim();
    if (text.length > MAX_TEXT) fail(400, `متن پیام حداکثر ${MAX_TEXT} کاراکتر است`);

    let type = 'text';
    let fileId = null;
    if (b.fileId) {
      const f = get('SELECT * FROM files WHERE id = ? AND owner_id = ?', Number(b.fileId), req.user.id);
      if (!f) fail(400, 'فایل نامعتبر است');
      type = b.type in TYPE_KINDS ? b.type : 'file';
      const kinds = TYPE_KINDS[type];
      if (kinds && !kinds.includes(f.kind)) type = 'file';
      fileId = f.id;
    } else if (!text) {
      fail(400, 'پیام خالی است');
    }

    let replyTo = null;
    if (b.replyTo) {
      const r = get('SELECT id FROM messages WHERE id = ? AND chat_id = ?', Number(b.replyTo), chat.id);
      if (r) replyTo = r.id;
    }

    const msg = postMessage({ chatId: chat.id, senderId: req.user.id, type, text, fileId, replyTo });
    if (chat.is_emergency) toAll('emergency', msg);
    return { message: msg };
  });

  app.patch('/api/messages/:id', async (req) => {
    const { m } = requireMessage(req, req.params.id);
    if (m.sender_id !== req.user.id) fail(403, 'فقط پیام‌های خودتان را می‌توانید ویرایش کنید');
    if (m.type === 'system') fail(400, 'نامعتبر');
    const text = String(req.body?.text || '').trim();
    if (!text && !m.file_id) fail(400, 'پیام خالی است');
    if (text.length > MAX_TEXT) fail(400, 'متن خیلی طولانی است');
    run('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?', text, now(), m.id);
    const msg = loadMessage(m.id);
    toChat(m.chat_id, 'message:edit', msg);
    return { message: msg };
  });

  app.delete('/api/messages/:id', async (req) => {
    const { m, chat, member } = requireMessage(req, req.params.id);
    const own = m.sender_id === req.user.id;
    if (!own && !hasChatPerm(req.user, member, 'delete_messages')) fail(403, 'دسترسی حذف این پیام را ندارید');
    run("UPDATE messages SET deleted = 1, text = '', pinned = 0 WHERE id = ?", m.id);
    if (!own) audit(req.user.id, 'message.delete', m.id, { chat: chat.id, sender: m.sender_id });
    toChat(m.chat_id, 'message:delete', { id: m.id, chatId: m.chat_id });
    return { ok: true };
  });

  app.post('/api/messages/:id/pin', async (req) => {
    const { m, chat, member } = requireMessage(req, req.params.id);
    const allowed = chat.type === 'dm' || chat.type === 'saved' || hasChatPerm(req.user, member, 'pin_messages');
    if (!allowed) fail(403, 'دسترسی سنجاق کردن ندارید');
    const pinned = req.body?.pinned !== false;
    run('UPDATE messages SET pinned = ? WHERE id = ?', pinned ? 1 : 0, m.id);
    toChat(m.chat_id, 'message:edit', loadMessage(m.id));
    if (pinned && chat.type === 'group') systemMessage(chat.id, `${req.user.display_name} پیامی را سنجاق کرد`);
    return { ok: true };
  });

  app.post('/api/chats/:id/read', async (req) => {
    const chatId = Number(req.params.id);
    const member = getMember(chatId, req.user.id);
    if (!member) fail(403, 'شما عضو این گفتگو نیستید');
    const messageId = Number(req.body?.messageId) || 0;
    if (messageId > member.last_read) {
      run('UPDATE chat_members SET last_read = ? WHERE chat_id = ? AND user_id = ?', messageId, chatId, req.user.id);
      toChat(chatId, 'read', { chatId, userId: req.user.id, messageId });
    }
    return { ok: true };
  });
}
