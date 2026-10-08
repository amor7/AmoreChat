import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api, fileUrl } from '../api';
import { toFa } from '../util';
import Avatar from './Avatar';
import NewChat from './NewChat';
import Profile from './Profile';
import ChatInfo from './ChatInfo';
import Admin from './Admin';

export function Modal({ title, onClose, children, size = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${size}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="بستن" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Debounced user search with a result list; used for DMs, group creation and adding members.
export function UserSearch({ onPick, exclude = [], placeholder = 'جستجوی نام یا نام کاربری' }) {
  const me = useStore((s) => s.me);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (!q.trim()) return setUsers([]);
    const t = setTimeout(() => {
      api('GET', `/users/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => setUsers(r.users))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = users.filter((u) => u.id !== me.id && !exclude.includes(u.id));
  return (
    <div className="user-search">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus />
      <ul className="user-list">
        {shown.map((u) => (
          <li key={u.id}>
            <button onClick={() => onPick(u)}>
              <Avatar id={u.id} name={u.displayName} file={u.avatar} size={36} online={u.online} />
              <span>
                <b>{u.displayName}</b>
                <small dir="ltr">@{u.username}</small>
              </span>
            </button>
          </li>
        ))}
        {q.trim() && !shown.length && <li className="muted pad">کاربری پیدا نشد</li>}
      </ul>
    </div>
  );
}

function Discover({ onClose }) {
  const [chats, setChats] = useState(null);
  const st = useStore.getState;
  useEffect(() => {
    api('GET', '/chats/discover')
      .then((r) => setChats(r.chats))
      .catch((e) => st().showToast(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(id) {
    try {
      const { chat } = await api('POST', `/chats/${id}/join`);
      st().upsertChat(chat);
      onClose();
      location.hash = `#/chat/${id}`;
    } catch (e) {
      st().showToast(e.message);
    }
  }

  return (
    <Modal title="کاوش گروه‌ها و کانال‌های عمومی" onClose={onClose}>
      {!chats && <p className="muted">…</p>}
      {chats?.length === 0 && <p className="muted">گروه یا کانال عمومی دیگری وجود ندارد.</p>}
      <ul className="user-list">
        {chats?.map((c) => (
          <li key={c.id} className="row-item">
            <Avatar id={c.id} name={c.title} file={c.avatar} size={40} />
            <span className="grow">
              <b>
                {c.type === 'channel' ? '📢 ' : '👥 '}
                {c.title}
              </b>
              <small>
                {toFa(c.memberCount)} عضو {c.description && `— ${c.description}`}
              </small>
            </span>
            <button className="btn primary sm" onClick={() => join(c.id)}>
              عضویت
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function JoinInvite({ code, onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const st = useStore.getState;

  useEffect(() => {
    api('GET', `/join/${encodeURIComponent(code)}`)
      .then((r) => setInfo(r.chat))
      .catch((e) => setError(e.message));
  }, [code]);

  const close = () => {
    history.replaceState(null, '', '/');
    onClose();
  };

  async function join() {
    try {
      const { chat } = await api('POST', `/join/${encodeURIComponent(code)}`);
      st().upsertChat(chat);
      onClose();
      location.hash = `#/chat/${chat.id}`;
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Modal title="دعوت به گفتگو" onClose={close} size="small">
      {error && <div className="error">{error}</div>}
      {info && (
        <div className="center">
          <Avatar id={info.id} name={info.title} file={info.avatar} size={72} />
          <h3>{info.title}</h3>
          <p className="muted">
            {info.type === 'channel' ? 'کانال' : 'گروه'} · {toFa(info.memberCount)} عضو
          </p>
          {info.description && <p>{info.description}</p>}
          {info.isMember ? (
            <a className="btn primary" href={`#/chat/${info.id}`} onClick={onClose}>
              باز کردن
            </a>
          ) : (
            <button className="btn primary" onClick={join}>
              عضویت
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function ImageViewer({ fileId, onClose }) {
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={fileUrl(fileId)} alt="" />
      <a className="btn lightbox-dl" href={fileUrl(fileId, true)} onClick={(e) => e.stopPropagation()}>
        ⬇ دانلود
      </a>
    </div>
  );
}

export default function Modals() {
  const modal = useStore((s) => s.modal);
  const close = useStore((s) => s.closeModal);
  if (!modal) return null;
  switch (modal.type) {
    case 'newChat':
      return <NewChat onClose={close} />;
    case 'discover':
      return <Discover onClose={close} />;
    case 'join':
      return <JoinInvite code={modal.code} onClose={close} />;
    case 'profile':
      return <Profile onClose={close} />;
    case 'chatInfo':
      return <ChatInfo chatId={modal.chatId} onClose={close} />;
    case 'admin':
      return <Admin onClose={close} />;
    case 'image':
      return <ImageViewer fileId={modal.fileId} onClose={close} />;
    default:
      return null;
  }
}
