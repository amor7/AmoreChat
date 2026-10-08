import { io } from 'socket.io-client';
import { useStore } from './store';
import { api } from './api';
import { messagePreview } from './util';

let socket = null;

export function connectSocket() {
  if (socket) return;
  const st = useStore.getState;
  let connectedBefore = false;
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    useStore.setState({ connected: true });
    // After a reconnect, catch up on whatever we missed.
    if (connectedBefore) {
      st().loadChats().catch(() => {});
      const active = st().activeChatId;
      if (active) st().loadMessages(active).catch(() => {});
    }
    connectedBefore = true;
  });
  socket.on('disconnect', (reason) => {
    useStore.setState({ connected: false });
    // Server-side disconnect means we were banned or logged out elsewhere.
    if (reason === 'io server disconnect') checkSession();
  });
  socket.on('connect_error', (err) => {
    useStore.setState({ connected: false });
    if (err.message === 'unauthorized') checkSession();
  });

  socket.on('message:new', (m) => {
    st().addMessage(m);
    notify(m);
  });
  socket.on('message:edit', (m) => st().updateMessage(m));
  socket.on('message:delete', (d) => st().markDeleted(d));
  socket.on('chat:new', (c) => st().upsertChat(c));
  socket.on('chat:removed', ({ chatId, reason }) => {
    const title = st().chats[chatId]?.title;
    st().removeChat(chatId);
    if (title && reason !== 'left') st().showToast(reason === 'deleted' ? `«${title}» حذف شد` : `شما از «${title}» حذف شدید`);
  });
  socket.on('chat:changed', ({ chatId }) => st().refreshChat(chatId));
  socket.on('read', (d) => st().onRead(d));
  socket.on('typing', (d) => st().setTyping(d));
  socket.on('presence', (d) => st().setPresence(d));
  socket.on('emergency', (m) => m.sender?.id !== st().me?.id && useStore.setState({ emergency: m }));
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

let lastTyping = 0;
export function emitTyping(chatId) {
  if (Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  socket?.emit('typing', { chatId });
}

async function checkSession() {
  try {
    await api('GET', '/auth/me');
    setTimeout(() => socket?.connect(), 2000);
  } catch (e) {
    if (e.status === 401) location.reload();
  }
}

let audioCtx = null;
function beep() {
  try {
    audioCtx ||= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  } catch {
    /* audio not allowed yet */
  }
}

function notify(m) {
  const s = useStore.getState();
  if (!m.sender || m.sender.id === s.me?.id) return;
  if (!document.hidden && s.activeChatId === m.chatId) return;
  beep();
  if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const chat = s.chats[m.chatId];
  const title = chat?.type === 'dm' ? m.sender.displayName : `${chat?.title || ''} — ${m.sender.displayName}`;
  const opts = { body: messagePreview(m).slice(0, 120), tag: `chat-${m.chatId}`, icon: '/icon-192.png', data: { chatId: m.chatId } };
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(title, opts))
    .catch(() => new Notification(title, opts));
}
