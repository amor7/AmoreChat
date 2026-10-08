import { useEffect, useMemo, useState } from 'react';
import { MessageResults, openMessage } from './Modals';
import { useStore } from '../store';
import { api } from '../api';
import { disconnectSocket } from '../socket';
import { formatListTime, messagePreview, toFa, hasSitePerm } from '../util';
import Avatar from './Avatar';

const TYPE_ICON = { group: '👥 ', channel: '📢 ' };

export default function Sidebar() {
  const chats = useStore((s) => s.chats);
  const me = useStore((s) => s.me);
  const siteName = useStore((s) => s.config.siteName);
  const activeChatId = useStore((s) => s.activeChatId);
  const openModal = useStore((s) => s.openModal);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [found, setFound] = useState(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound(null);
    const t = setTimeout(() => {
      api('GET', `/search?q=${encodeURIComponent(q)}`)
        .then((r) => setFound(r.messages))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(chats)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.peer?.username?.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;
        return (b.lastMessage?.createdAt || b.createdAt) - (a.lastMessage?.createdAt || a.createdAt);
      });
  }, [chats, query]);

  const isAdmin = me.role === 'owner' || me.role === 'admin';

  async function logout() {
    await api('POST', '/auth/logout').catch(() => {});
    disconnectSocket();
    location.hash = '';
    location.reload();
  }

  const item = (label, action) => (
    <button
      onClick={() => {
        setMenu(false);
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <button className="icon-btn" aria-label="منو" onClick={() => setMenu(!menu)}>
          ☰
        </button>
        <input className="search" placeholder="جستجو" value={query} onChange={(e) => setQuery(e.target.value)} />
        {menu && (
          <>
            <div className="menu-backdrop" onClick={() => setMenu(false)} />
            <div className="menu">
              <div className="menu-user">
                <Avatar id={me.id} name={me.displayName} file={me.avatar} size={40} />
                <div>
                  <b>{me.displayName}</b>
                  <small dir="ltr">@{me.username}</small>
                </div>
              </div>
              {item('👤 پروفایل و تنظیمات', () => openModal('profile'))}
              {item('✏️ گفتگوی جدید', () => openModal('newChat'))}
              {item('🔎 کاوش گروه‌ها و کانال‌ها', () => openModal('discover'))}
              {isAdmin && hasAnyAdminPerm(me) && item('🛡 پنل مدیریت', () => openModal('admin'))}
              {item('🚪 خروج', logout)}
            </div>
          </>
        )}
      </header>
      <div className="site-name">{siteName}</div>
      <ul className="chat-list">
        {list.map((c) => {
          const last = c.lastMessage;
          const sender = last?.sender && c.type === 'group' ? (last.sender.id === me.id ? 'شما: ' : last.sender.displayName + ': ') : '';
          return (
            <li key={c.id}>
              <a href={`#/chat/${c.id}`} className={`chat-item ${c.id === activeChatId ? 'active' : ''} ${c.isEmergency ? 'emergency' : ''}`}>
                <Avatar id={c.id} name={c.title} file={c.avatar} saved={c.type === 'saved'} online={c.peer?.online} />
                <div className="chat-item-body">
                  <div className="row">
                    <span className="title">
                      {TYPE_ICON[c.type] || ''}
                      {c.title}
                    </span>
                    {last && <span className="time">{formatListTime(last.createdAt)}</span>}
                  </div>
                  <div className="row">
                    <span className="preview">
                      {sender}
                      {messagePreview(last)}
                    </span>
                    {c.unread > 0 && <span className="badge">{toFa(c.unread)}</span>}
                  </div>
                </div>
              </a>
            </li>
          );
        })}
        {!list.length && !found?.length && <li className="muted center pad">گفتگویی پیدا نشد</li>}
        {found?.length > 0 && (
          <li>
            <div className="list-section">پیام‌ها</div>
            <MessageResults messages={found} onPick={openMessage} />
          </li>
        )}
      </ul>
      <button className="fab" aria-label="گفتگوی جدید" onClick={() => openModal('newChat')}>
        ✏️
      </button>
    </aside>
  );
}

const hasAnyAdminPerm = (me) =>
  ['manage_users', 'manage_invites', 'manage_settings', 'manage_chats', 'view_audit', 'handle_reports'].some((p) => hasSitePerm(me, p));
