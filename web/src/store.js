import { create } from 'zustand';
import { api } from './api';

const PAGE = 50;

const replaceIn = (list, m) => list?.map((x) => (x.id === m.id ? m : x));

export const useStore = create((set, get) => ({
  me: null,
  config: null,
  chats: {}, // id -> chat summary
  messages: {}, // chatId -> messages, oldest first
  hasMore: {}, // chatId -> bool
  chatVersion: {}, // chatId -> counter bumped on chat:changed so open panels refetch
  activeChatId: null,
  typing: {}, // chatId -> { userId: { name, until } }
  online: {}, // userId -> bool
  modal: null, // { type, ...props }
  emergency: null,
  toast: null,
  connected: true,
  replyTo: null,
  editing: null,

  openModal: (type, props = {}) => set({ modal: { type, ...props } }),
  closeModal: () => set({ modal: null }),
  showToast(text) {
    const id = Date.now();
    set({ toast: { text, id } });
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 3500);
  },

  async loadChats() {
    const { chats } = await api('GET', '/chats');
    set({ chats: Object.fromEntries(chats.map((c) => [c.id, c])) });
  },
  upsertChat(c) {
    if (c?.id) set((s) => ({ chats: { ...s.chats, [c.id]: { ...s.chats[c.id], ...c } } }));
  },
  async refreshChat(id) {
    set((s) => ({ chatVersion: { ...s.chatVersion, [id]: (s.chatVersion[id] || 0) + 1 } }));
    if (!get().chats[id]) return;
    try {
      const { chat } = await api('GET', `/chats/${id}`);
      if (chat.myRole) get().upsertChat(chat);
    } catch {
      /* removed meanwhile */
    }
  },
  removeChat(id) {
    set((s) => {
      const chats = { ...s.chats };
      delete chats[id];
      const messages = { ...s.messages };
      delete messages[id];
      return { chats, messages };
    });
    if (get().activeChatId === id) location.hash = '';
  },

  async loadMessages(chatId, older = false) {
    const cur = get().messages[chatId];
    if (older && (!cur?.length || get().hasMore[chatId] === false)) return 0;
    const before = older ? `&before=${cur[0].id}` : '';
    const { messages } = await api('GET', `/chats/${chatId}/messages?limit=${PAGE}${before}`);
    set((s) => ({
      messages: { ...s.messages, [chatId]: older ? [...messages, ...(s.messages[chatId] || [])] : messages },
      hasMore: { ...s.hasMore, [chatId]: messages.length === PAGE },
    }));
    return messages.length;
  },

  addMessage(m) {
    set((s) => {
      const list = s.messages[m.chatId];
      const exists = list?.some((x) => x.id === m.id);
      const messages = list && !exists ? { ...s.messages, [m.chatId]: [...list, m] } : s.messages;
      const chat = s.chats[m.chatId];
      if (!chat || exists) return { messages };
      const mine = m.sender?.id === s.me?.id;
      const typing = { ...s.typing };
      if (m.sender && typing[m.chatId]) {
        typing[m.chatId] = { ...typing[m.chatId] };
        delete typing[m.chatId][m.sender.id];
      }
      return {
        messages,
        typing,
        chats: {
          ...s.chats,
          [m.chatId]: {
            ...chat,
            lastMessage: m,
            unread: mine || m.type === 'system' ? chat.unread : chat.unread + 1,
            lastRead: mine ? m.id : chat.lastRead,
          },
        },
      };
    });
  },
  updateMessage(m) {
    set((s) => {
      const chat = s.chats[m.chatId];
      return {
        messages: s.messages[m.chatId] ? { ...s.messages, [m.chatId]: replaceIn(s.messages[m.chatId], m) } : s.messages,
        chats: chat?.lastMessage?.id === m.id ? { ...s.chats, [m.chatId]: { ...chat, lastMessage: m } } : s.chats,
      };
    });
  },
  markDeleted({ id, chatId }) {
    const list = get().messages[chatId];
    const m = list?.find((x) => x.id === id) || get().chats[chatId]?.lastMessage;
    if (m?.id === id) get().updateMessage({ ...m, type: 'deleted', text: '', file: null, pinned: false });
  },

  markRead(chatId) {
    const s = get();
    const chat = s.chats[chatId];
    const list = s.messages[chatId];
    const last = list?.[list.length - 1];
    if (!chat || !last || (last.id <= chat.lastRead && !chat.unread)) return;
    set({ chats: { ...s.chats, [chatId]: { ...chat, lastRead: Math.max(last.id, chat.lastRead), unread: 0 } } });
    api('POST', `/chats/${chatId}/read`, { messageId: last.id }).catch(() => {});
  },
  onRead({ chatId, userId, messageId }) {
    const s = get();
    const chat = s.chats[chatId];
    if (!chat || userId === s.me?.id || messageId <= chat.othersRead) return;
    set({ chats: { ...s.chats, [chatId]: { ...chat, othersRead: messageId } } });
  },

  setTyping({ chatId, userId, name }) {
    set((s) => ({ typing: { ...s.typing, [chatId]: { ...s.typing[chatId], [userId]: { name, until: Date.now() + 4000 } } } }));
  },
  setPresence({ userId, online, lastSeen }) {
    set((s) => {
      const chats = { ...s.chats };
      for (const c of Object.values(chats)) {
        if (c.peer?.id === userId) chats[c.id] = { ...c, peer: { ...c.peer, online, lastSeen: lastSeen ?? c.peer.lastSeen } };
      }
      return { online: { ...s.online, [userId]: online }, chats };
    });
  },
}));

export const isUserOnline = (s, user) => s.online[user?.id] ?? user?.online ?? false;
