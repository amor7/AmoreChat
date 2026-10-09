import { useEffect, useMemo, useState } from 'react';
import { MessageResults, openMessage } from './Modals';
import { VoiceChannels } from './Voice';
import { RichText } from './Emoji';
import PreviewIcon from './PreviewIcon';
import { Menu, SquarePen, UserRound, Compass, Shield, LogOut, Users, Megaphone, Volume2 } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../api';
import { disconnectSocket } from '../socket';
import { formatListTime, messagePreview, toFa, hasSitePerm } from '../util';
import Avatar from './Avatar';

const TYPE_ICON = { group: Users, channel: Megaphone, voice: Volume2 };

function TypeIcon({ type }) {
  const Icon = TYPE_ICON[type];
  return Icon ? <Icon size={15} className="type-icon" /> : null;
}

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
      .filter((c) => c.type !== 'voice' || q)
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
          <Menu size={22} />
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
              {item(<><UserRound size={18} /> پروفایل و تنظیمات</>, () => openModal('profile'))}
              {item(<><SquarePen size={18} /> گفتگوی جدید</>, () => openModal('newChat'))}
              {item(<><Compass size={18} /> کاوش گروه‌ها و کانال‌ها</>, () => openModal('discover'))}
              {isAdmin && hasAnyAdminPerm(me) && item(<><Shield size={18} /> پنل مدیریت</>, () => openModal('admin'))}
              {item(<><LogOut size={18} /> خروج</>, logout)}
            </div>
          </>
        )}
      </header>
      <div className="site-name">{siteName}</div>
      <ul className="chat-list">
        {!query && (
          <li>
            <VoiceChannels />
          </li>
        )}
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
                      <TypeIcon type={c.type} />
                      {c.title}
                    </span>
                    {last && <span className="time">{formatListTime(last.createdAt)}</span>}
                  </div>
                  <div className="row">
                    <span className="preview">
                      {sender}
                      <PreviewIcon m={last} />
                      <RichText text={messagePreview(last)} size={16} />
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
        <SquarePen size={24} />
      </button>
    </aside>
  );
}

const hasAnyAdminPerm = (me) =>
  ['manage_users', 'manage_invites', 'manage_settings', 'manage_chats', 'view_audit', 'handle_reports'].some((p) => hasSitePerm(me, p));
