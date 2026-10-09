import { get, parseJSON } from './db.js';
import { toAll, toChat } from './realtime.js';
import { rtcEnabled, listRooms, listParticipants, userIdOf } from './livekit.js';

// Who is in which LiveKit room, kept current from webhooks (and a periodic resync).
// roomName -> Map(userId -> { userId, name, avatar, joinedAt, camera, screen })
const rooms = new Map();
const listeners = [];
export const onParticipantLeft = (fn) => listeners.push(fn);

export const chatRoom = (chatId) => `chat-${chatId}`;
export const chatIdOfRoom = (room) => (/^chat-\d+$/.test(room || '') ? Number(room.slice(5)) : null);

export function roomParticipants(room) {
  return [...(rooms.get(room)?.values() || [])];
}

// Public voice channels are visible to everyone; other rooms only to chat members.
function broadcast(room) {
  const chatId = chatIdOfRoom(room);
  if (!chatId) return;
  const chat = get('SELECT type, is_public FROM chats WHERE id = ?', chatId);
  if (!chat) return;
  const payload = { chatId, participants: roomParticipants(room) };
  if (chat.type === 'voice' && chat.is_public) toAll('voice:state', payload);
  else toChat(chatId, 'voice:state', payload);
}

function fromParticipant(p) {
  const userId = userIdOf(p.identity);
  if (!userId) return null;
  const meta = parseJSON(p.metadata || '{}', {});
  const tracks = p.tracks || [];
  return {
    userId,
    name: p.name || '',
    avatar: meta.avatar || null,
    joinedAt: Number(p.joined_at ?? p.joinedAt ?? 0) * 1000 || Date.now(),
    camera: tracks.some((t) => String(t.source) === 'CAMERA' && !t.muted),
    screen: tracks.some((t) => String(t.source) === 'SCREEN_SHARE' && !t.muted),
  };
}

export function applyWebhook(evt) {
  const room = evt.room?.name;
  if (!room) return;
  const p = evt.participant ? fromParticipant(evt.participant) : null;
  switch (evt.event) {
    case 'participant_joined':
      if (!p) return;
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room).set(p.userId, p);
      break;
    case 'participant_left':
      if (!p) return;
      rooms.get(room)?.delete(p.userId);
      if (!rooms.get(room)?.size) rooms.delete(room);
      for (const fn of listeners) fn(room, p.userId);
      break;
    case 'track_published':
    case 'track_unpublished': {
      const entry = p && rooms.get(room)?.get(p.userId);
      if (!entry) return;
      const on = evt.event === 'track_published';
      const source = String(evt.track?.source);
      if (source === 'CAMERA') entry.camera = on;
      if (source === 'SCREEN_SHARE') entry.screen = on;
      break;
    }
    case 'room_finished':
      rooms.delete(room);
      break;
    default:
      return;
  }
  broadcast(room);
}

// Rebuild state from LiveKit itself: covers server restarts and missed webhooks.
export async function syncRooms(log) {
  if (!rtcEnabled) return;
  try {
    const live = await listRooms();
    const seen = new Set();
    for (const r of live) {
      seen.add(r.name);
      const map = new Map();
      for (const p of await listParticipants(r.name)) {
        const entry = fromParticipant(p);
        if (entry) map.set(entry.userId, entry);
      }
      const before = JSON.stringify(roomParticipants(r.name));
      if (map.size) rooms.set(r.name, map);
      else rooms.delete(r.name);
      if (before !== JSON.stringify(roomParticipants(r.name))) broadcast(r.name);
    }
    for (const name of [...rooms.keys()]) {
      if (!seen.has(name)) {
        rooms.delete(name);
        broadcast(name);
      }
    }
  } catch (e) {
    log?.warn(`livekit sync failed: ${e.message}`);
  }
}

export function startVoiceSync(log) {
  if (!rtcEnabled) return;
  syncRooms(log);
  setInterval(() => syncRooms(log), 60_000).unref();
}

export const activeRooms = () => [...rooms.entries()].map(([room, m]) => ({ room, participants: [...m.values()] }));
