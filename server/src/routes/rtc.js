import { get, all, now } from '../db.js';
import { settingNumber } from '../settings.js';
import { hasSitePerm, hasChatPerm } from '../perms.js';
import { effectiveLimits } from '../limits.js';
import { toUser } from '../realtime.js';
import { fail, getChat, getMember, addMember, audit } from '../chats.js';
import { rtcEnabled, accessToken, verifyWebhook, removeParticipant, muteSources, deleteRoom, userIdOf } from '../livekit.js';
import { applyWebhook, chatRoom, chatIdOfRoom, roomParticipants, activeRooms } from '../voice.js';
import { startCall, acceptCall, endCall, getCall, userCall, callRoom, listCalls } from '../calls.js';

const ROOM_TYPES = ['group', 'channel', 'voice'];
const STREAM_SOURCES = ['camera', 'screen_share', 'screen_share_audio'];

function needRtc() {
  if (!rtcEnabled) fail(503, 'تماس و ویس‌چت روی این سرور فعال نیست');
}

function sourcesFor(user) {
  return ['microphone', ...(effectiveLimits(user).canStream ? STREAM_SOURCES : [])];
}

// Who may speak in a chat's voice room (listeners can always join).
function canSpeak(user, chat, member) {
  if (!member) return hasSitePerm(user, 'manage_chats');
  if (member.muted_until && member.muted_until > now()) return false;
  if (chat.is_emergency) return member.role === 'owner' || hasSitePerm(user, 'broadcast');
  if (chat.type === 'channel') return hasChatPerm(user, member, 'post_messages');
  const staff = member.role === 'owner' || member.role === 'admin' || hasSitePerm(user, 'manage_chats');
  return staff || !chat.locked;
}

// Can `actor` act on `targetId` in this chat (mirrors the text-chat moderation rules)?
function canModerate(actor, actorMember, chatId, targetId, perm) {
  if (!hasChatPerm(actor, actorMember, perm)) return false;
  const target = getMember(chatId, targetId);
  if (!target) return true;
  if (target.role === 'owner') return actor.role === 'owner';
  if (target.role === 'admin') return actorMember?.role === 'owner' || hasSitePerm(actor, 'manage_chats');
  return true;
}

// In a 1:1 call the camera is part of calling; screen sharing still needs stream permission.
const callTokenFor = (user, call) =>
  accessToken({
    user,
    room: callRoom(call.id),
    canPublish: true,
    sources: ['microphone', 'camera', ...(effectiveLimits(user).canStream ? ['screen_share', 'screen_share_audio'] : [])],
  });

export default async function rtcRoutes(app) {
  // ---------- Voice rooms (voice channels and group voice chats) ----------
  app.get('/api/rtc/voice-channels', async (req) => ({
    channels: all(
      `SELECT c.id, c.title, c.description, c.avatar_file_id AS avatar, c.is_public AS isPublic,
         EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id = c.id AND m.user_id = ?) AS isMember
       FROM chats c WHERE c.type = 'voice' AND (c.is_public = 1 OR EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id = c.id AND m.user_id = ?))
       ORDER BY c.id`,
      req.user.id,
      req.user.id,
    ).map((c) => ({ ...c, isPublic: !!c.isPublic, isMember: !!c.isMember, participants: roomParticipants(chatRoom(c.id)) })),
  }));

  // Current participants of every room this user can see (initial load / reconnect).
  app.get('/api/rtc/state', async (req) => {
    const visible = new Set(
      all(
        `SELECT c.id FROM chats c WHERE (c.type = 'voice' AND c.is_public = 1)
           OR EXISTS (SELECT 1 FROM chat_members m WHERE m.chat_id = c.id AND m.user_id = ?)`,
        req.user.id,
      ).map((r) => r.id),
    );
    return {
      rooms: activeRooms()
        .map((r) => ({ chatId: chatIdOfRoom(r.room), participants: r.participants }))
        .filter((r) => r.chatId && visible.has(r.chatId)),
      call: userCall(req.user.id) ? callInfo(req.user) : null,
    };
  });

  app.post('/api/rtc/join', async (req) => {
    needRtc();
    const chat = getChat(Number(req.body?.chatId));
    if (!chat || !ROOM_TYPES.includes(chat.type)) fail(404, 'گفتگو پیدا نشد');
    let member = getMember(chat.id, req.user.id);
    if (!member && chat.type === 'voice' && chat.is_public) {
      if (get('SELECT 1 FROM chat_bans WHERE chat_id = ? AND user_id = ?', chat.id, req.user.id)) fail(403, 'شما از این کانال مسدود شده‌اید');
      addMember(chat.id, req.user.id);
      member = getMember(chat.id, req.user.id);
    }
    if (!member && !hasSitePerm(req.user, 'manage_chats')) fail(403, 'شما عضو این گفتگو نیستید');
    const speak = canSpeak(req.user, chat, member);
    const limits = effectiveLimits(req.user);
    return {
      room: chatRoom(chat.id),
      token: accessToken({ user: req.user, room: chatRoom(chat.id), canPublish: speak, sources: sourcesFor(req.user) }),
      canSpeak: speak,
      canStream: speak && limits.canStream,
      streamQuality: limits.streamQuality,
      maxStreams: settingNumber('max_streams_per_room'),
    };
  });

  app.post('/api/rtc/:chatId/moderate', async (req) => {
    needRtc();
    const chat = getChat(Number(req.params.chatId));
    if (!chat) fail(404, 'گفتگو پیدا نشد');
    const member = getMember(chat.id, req.user.id);
    const targetId = Number(req.body?.userId);
    const action = req.body?.action;
    const perm = action === 'kick' ? 'ban_members' : 'mute_members';
    if (!['mute', 'stop_stream', 'kick'].includes(action)) fail(400, 'عملیات نامعتبر');
    if (!canModerate(req.user, member, chat.id, targetId, perm)) fail(403, 'دسترسی ندارید');
    const room = chatRoom(chat.id);
    if (action === 'kick') await removeParticipant(room, targetId);
    if (action === 'mute') await muteSources(room, targetId, ['MICROPHONE']);
    if (action === 'stop_stream') await muteSources(room, targetId, ['SCREEN_SHARE', 'SCREEN_SHARE_AUDIO', 'CAMERA']);
    const notice = { mute: 'یک مدیر میکروفون شما را بست', stop_stream: 'یک مدیر استریم شما را متوقف کرد', kick: 'یک مدیر شما را از ویس‌چت بیرون کرد' }[action];
    toUser(targetId, 'rtc:notice', { chatId: chat.id, action, text: notice });
    audit(req.user.id, `voice.${action}`, `${chat.id}:${targetId}`);
    return { ok: true };
  });

  // ---------- One-to-one calls ----------
  function callInfo(user) {
    const call = userCall(user.id);
    if (!call) return null;
    const info = listCalls().find((c) => c.id === call.id);
    // Callers get a token right away (they wait in the room); callees only once they accept.
    const mayJoin = call.callerId === user.id || call.state === 'active';
    return { ...info, token: mayJoin ? callTokenFor(user, call) : null, role: call.callerId === user.id ? 'caller' : 'callee' };
  }

  app.post('/api/calls', async (req) => {
    needRtc();
    const calleeId = Number(req.body?.userId);
    if (calleeId === req.user.id) fail(400, 'نامعتبر');
    if (!effectiveLimits(req.user).canCall) fail(403, 'امکان تماس برای حساب شما فعال نیست');
    const callee = get('SELECT * FROM users WHERE id = ? AND banned = 0', calleeId);
    if (!callee) fail(404, 'کاربر پیدا نشد');
    if (!effectiveLimits(callee).canCall) fail(403, 'امکان تماس برای این کاربر فعال نیست');
    if (userCall(req.user.id)) fail(409, 'شما در حال حاضر در تماس هستید');
    if (userCall(calleeId)) fail(409, 'مخاطب در تماس دیگری است');
    startCall(req.user.id, calleeId, !!req.body?.video);
    return { call: callInfo(req.user) };
  });

  function myCall(req, role) {
    const call = getCall(req.params.id);
    if (!call) fail(404, 'تماس تمام شده است');
    if (role === 'callee' && call.calleeId !== req.user.id) fail(403, 'نامعتبر');
    if (call.callerId !== req.user.id && call.calleeId !== req.user.id) fail(403, 'نامعتبر');
    return call;
  }

  app.post('/api/calls/:id/accept', async (req) => {
    const call = myCall(req, 'callee');
    if (call.state !== 'ringing') fail(409, 'این تماس قبلاً پاسخ داده شده');
    acceptCall(call);
    return { call: callInfo(req.user) };
  });

  app.post('/api/calls/:id/decline', async (req) => {
    const call = myCall(req, 'callee');
    endCall(call.id, 'declined');
    return { ok: true };
  });

  app.post('/api/calls/:id/end', async (req) => {
    const call = myCall(req);
    endCall(call.id, call.state === 'ringing' ? (call.callerId === req.user.id ? 'cancelled' : 'declined') : 'ended');
    return { ok: true };
  });

  // ---------- LiveKit webhook ----------
  app.post('/api/livekit/webhook', { config: { public: true, noCsrf: true } }, async (req, reply) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    if (!verifyWebhook(raw, req.headers.authorization)) return reply.code(401).send({ error: 'bad signature' });
    const evt = JSON.parse(raw);
    applyWebhook(evt);
    enforceStreamLimit(evt).catch((e) => req.log.warn(e.message));
    return { ok: true };
  });

  async function enforceStreamLimit(evt) {
    if (evt.event !== 'track_published') return;
    const source = String(evt.track?.source);
    if (source !== 'SCREEN_SHARE' && source !== 'CAMERA') return;
    const room = evt.room?.name;
    const max = settingNumber('max_streams_per_room');
    if (!max || !chatIdOfRoom(room)) return;
    const streams = roomParticipants(room).reduce((n, p) => n + (p.screen ? 1 : 0) + (p.camera ? 1 : 0), 0);
    if (streams <= max) return;
    const userId = userIdOf(evt.participant?.identity);
    await muteSources(room, userId, [source]);
    toUser(userId, 'rtc:notice', { chatId: chatIdOfRoom(room), action: 'limit', text: `حداکثر ${max} استریم همزمان در این اتاق مجاز است` });
  }

  // ---------- Admin: everything live right now ----------
  app.get('/api/admin/live', async (req) => {
    if (!hasSitePerm(req.user, 'manage_chats') && !hasSitePerm(req.user, 'view_audit')) fail(403, 'دسترسی ندارید');
    return {
      enabled: rtcEnabled,
      rooms: activeRooms()
        .filter((r) => chatIdOfRoom(r.room))
        .map((r) => {
          const c = getChat(chatIdOfRoom(r.room));
          return { chatId: c?.id, title: c?.title, type: c?.type, participants: r.participants };
        }),
      calls: listCalls(),
    };
  });

  app.post('/api/admin/live/end', async (req) => {
    if (!hasSitePerm(req.user, 'manage_chats')) fail(403, 'دسترسی ندارید');
    if (req.body?.callId) endCall(String(req.body.callId), 'ended');
    if (req.body?.chatId) await deleteRoom(chatRoom(Number(req.body.chatId)));
    audit(req.user.id, 'voice.end', req.body?.chatId || req.body?.callId || '');
    return { ok: true };
  });
}
