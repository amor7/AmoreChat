import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, isUserOnline } from '../store';
import { api } from '../api';
import { formatDay, formatLastSeen, sameDay, toFa, hasChatPerm, messagePreview, copyText } from '../util';
import Avatar from './Avatar';
import Message from './Message';
import Composer from './Composer';

export default function ChatView({ chatId }) {
  const chat = useStore((s) => s.chats[chatId]);
  const messages = useStore((s) => s.messages[chatId]);
  const hasMore = useStore((s) => s.hasMore[chatId]);
  const me = useStore((s) => s.me);
  const st = useStore.getState;
  const listRef = useRef(null);
  const atBottom = useRef(true);
  const olderAnchor = useRef(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [menu, setMenu] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFile, setDroppedFile] = useState(null);

  useEffect(() => {
    if (chat) st().loadMessages(chatId).catch((e) => st().showToast(e.message));
  }, [chatId, !!chat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep pinned to the bottom when new messages arrive, and keep position when older ones load.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (olderAnchor.current != null) {
      el.scrollTop = el.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const mark = () => !document.hidden && st().markRead(chatId);
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [chatId, messages?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onScroll() {
    const el = listRef.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 300 && hasMore && !loadingOlder) {
      setLoadingOlder(true);
      olderAnchor.current = el.scrollHeight - el.scrollTop;
      try {
        if (!(await st().loadMessages(chatId, true))) olderAnchor.current = null;
      } catch {
        olderAnchor.current = null;
      }
      setLoadingOlder(false);
    }
  }

  if (!chat) {
    return (
      <div className="empty-pane">
        <p>این گفتگو در دسترس نیست.</p>
        <a className="btn" href="#/">
          بازگشت
        </a>
      </div>
    );
  }

  function jumpTo(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return st().showToast('این پیام هنوز بارگذاری نشده');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  }

  async function act(action, m) {
    setMenu(null);
    try {
      if (action === 'reply') useStore.setState({ replyTo: m, editing: null });
      if (action === 'edit') useStore.setState({ editing: m, replyTo: null });
      if (action === 'copy') (await copyText(m.text)) && st().showToast('کپی شد');
      if (action === 'pin' || action === 'unpin') await api('POST', `/messages/${m.id}/pin`, { pinned: action === 'pin' });
      if (action === 'delete' && confirm('این پیام برای همه حذف شود؟')) await api('DELETE', `/messages/${m.id}`);
    } catch (e) {
      st().showToast(e.message);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setDroppedFile(f);
  }

  const canPin = chat.type === 'dm' || chat.type === 'saved' || hasChatPerm(me, chat, 'pin_messages');
  const canDeleteOthers = hasChatPerm(me, chat, 'delete_messages');

  return (
    <div
      className="chat-view"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <ChatHeader chat={chat} />
      <PinnedBar chat={chat} messages={messages} onJump={jumpTo} />
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {loadingOlder && <div className="muted center pad">…</div>}
        {!messages && <div className="muted center pad">در حال بارگذاری…</div>}
        {messages?.length === 0 && <div className="muted center pad">هنوز پیامی نیست. اولین پیام را بفرستید!</div>}
        {messages?.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const grouped = !newDay && prev && prev.type !== 'system' && prev.sender?.id === m.sender?.id && m.createdAt - prev.createdAt < 5 * 60000;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day-sep">{formatDay(m.createdAt)}</div>}
              <Message
                m={m}
                chat={chat}
                mine={m.sender?.id === me.id}
                grouped={grouped}
                onJump={jumpTo}
                onMenu={(x, y) => setMenu({ m, x, y })}
              />
            </Fragment>
          );
        })}
      </div>
      {menu && (
        <MessageMenu
          {...menu}
          mine={menu.m.sender?.id === me.id}
          canPin={canPin}
          canDelete={menu.m.sender?.id === me.id || canDeleteOthers}
          onAction={(a) => act(a, menu.m)}
          onClose={() => setMenu(null)}
        />
      )}
      <Composer chat={chat} droppedFile={droppedFile} onDroppedHandled={() => setDroppedFile(null)} />
      {dragOver && <div className="drop-overlay">فایل را اینجا رها کنید</div>}
    </div>
  );
}

function useTypers(chatId) {
  const typing = useStore((s) => s.typing[chatId]);
  const [, tick] = useState(0);
  const active = Object.values(typing || {}).filter((t) => t.until > Date.now());
  useEffect(() => {
    if (!active.length) return;
    const t = setTimeout(() => tick((n) => n + 1), 1000);
    return () => clearTimeout(t);
  });
  return active.map((t) => t.name);
}

function ChatHeader({ chat }) {
  const openModal = useStore((s) => s.openModal);
  const online = useStore((s) => isUserOnline(s, chat.peer));
  const typers = useTypers(chat.id);

  let subtitle = '';
  if (typers.length) subtitle = chat.type === 'dm' ? 'در حال نوشتن…' : `${typers.slice(0, 2).join('، ')} در حال نوشتن…`;
  else if (chat.type === 'dm') subtitle = online ? 'آنلاین' : formatLastSeen(chat.peer?.lastSeen);
  else if (chat.type === 'group' || chat.type === 'channel') subtitle = `${toFa(chat.memberCount)} عضو`;

  return (
    <header className="chat-head">
      <a className="icon-btn back" href="#/" aria-label="بازگشت">
        →
      </a>
      <button className="chat-head-info" onClick={() => chat.type !== 'saved' && openModal('chatInfo', { chatId: chat.id })}>
        <Avatar id={chat.id} name={chat.title} file={chat.avatar} saved={chat.type === 'saved'} size={40} />
        <div>
          <div className="title">{chat.title}</div>
          <div className={`subtitle ${typers.length || (chat.type === 'dm' && online) ? 'accent' : ''}`}>{subtitle}</div>
        </div>
      </button>
    </header>
  );
}

function PinnedBar({ chat, messages, onJump }) {
  const version = useStore((s) => s.chatVersion[chat.id]);
  const [serverPinned, setServerPinned] = useState([]);

  useEffect(() => {
    api('GET', `/chats/${chat.id}/pinned`)
      .then((r) => setServerPinned(r.messages))
      .catch(() => {});
  }, [chat.id, version]);

  // Loaded messages are fresher than the initial fetch (they receive edit/pin events).
  const pinned = useMemo(() => {
    const byId = new Map(serverPinned.map((m) => [m.id, m]));
    for (const m of messages || []) byId.set(m.id, m);
    return [...byId.values()].filter((m) => m.pinned).sort((a, b) => b.id - a.id);
  }, [serverPinned, messages]);

  if (!pinned.length) return null;
  const top = pinned[0];
  return (
    <button className="pinned-bar" onClick={() => onJump(top.id)}>
      <span className="pin-icon">📌</span>
      <span>
        <b>پیام سنجاق‌شده{pinned.length > 1 ? ` (${toFa(pinned.length)})` : ''}</b>
        <span className="preview">{messagePreview(top)}</span>
      </span>
    </button>
  );
}

function MessageMenu({ m, x, y, mine, canPin, canDelete, onAction, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  const deleted = m.type === 'deleted';
  return (
    <>
      <div className="menu-backdrop" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div className="menu floating" ref={ref} style={pos}>
        {!deleted && <button onClick={() => onAction('reply')}>↩️ پاسخ</button>}
        {!deleted && m.text && <button onClick={() => onAction('copy')}>📋 کپی متن</button>}
        {!deleted && mine && m.type !== 'system' && <button onClick={() => onAction('edit')}>✏️ ویرایش</button>}
        {!deleted && canPin && <button onClick={() => onAction(m.pinned ? 'unpin' : 'pin')}>📌 {m.pinned ? 'برداشتن سنجاق' : 'سنجاق کردن'}</button>}
        {!deleted && canDelete && (
          <button className="danger" onClick={() => onAction('delete')}>
            🗑 حذف
          </button>
        )}
      </div>
    </>
  );
}
