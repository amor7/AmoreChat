import { memo, useRef } from 'react';
import { fileUrl } from '../api';
import { useStore } from '../store';
import { formatTime, formatSize, messagePreview } from '../util';
import Avatar from './Avatar';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"،؛])/g;

function Linkify({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" dir="ltr">
        {p}
      </a>
    ) : (
      p
    ),
  );
}

function Media({ m }) {
  const f = m.file;
  const openModal = useStore((s) => s.openModal);
  if (!f) return null;
  const ratio = f.width && f.height ? `${f.width} / ${f.height}` : undefined;
  if (m.type === 'image') {
    return (
      <button className="media" style={{ aspectRatio: ratio }} onClick={() => openModal('image', { fileId: f.id })}>
        <img src={fileUrl(f.id)} alt="" loading="lazy" />
      </button>
    );
  }
  if (m.type === 'video') {
    return <video className="media" style={{ aspectRatio: ratio }} src={fileUrl(f.id)} controls preload="metadata" playsInline />;
  }
  if (m.type === 'voice') {
    return <audio className="voice" src={fileUrl(f.id)} controls preload="metadata" />;
  }
  return (
    <a className="file-card" href={fileUrl(f.id, true)} download={f.name}>
      <span className="file-icon">📄</span>
      <span>
        <span className="file-name" dir="auto">
          {f.name}
        </span>
        <small>{formatSize(f.size)}</small>
      </span>
    </a>
  );
}

function Message({ m, chat, mine, grouped, onJump, onMenu }) {
  const press = useRef(null);

  if (m.type === 'system') {
    return (
      <div className="system-msg" id={`msg-${m.id}`}>
        <span>{m.text}</span>
      </div>
    );
  }

  const showSender = !mine && chat.type === 'group' && !grouped;
  const showAvatar = !mine && chat.type === 'group';
  const ticks = mine && chat.type !== 'saved' && chat.type !== 'channel' ? (chat.othersRead >= m.id ? '✓✓' : '✓') : '';

  const openMenu = (e) => {
    e.preventDefault();
    const p = e.touches?.[0] || e;
    onMenu(p.clientX, p.clientY);
  };
  // Long-press for touch screens.
  const touchStart = (e) => {
    const t = e.touches[0];
    press.current = setTimeout(() => onMenu(t.clientX, t.clientY), 500);
  };
  const touchEnd = () => clearTimeout(press.current);

  return (
    <div className={`msg-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`} id={`msg-${m.id}`}>
      {showAvatar && <div className="msg-avatar">{!grouped && <Avatar id={m.sender?.id} name={m.sender?.displayName} file={m.sender?.avatar} size={34} />}</div>}
      <div
        className={`bubble ${m.type === 'deleted' ? 'deleted' : ''} ${m.type === 'image' || m.type === 'video' ? 'has-media' : ''}`}
        onContextMenu={openMenu}
        onTouchStart={touchStart}
        onTouchEnd={touchEnd}
        onTouchMove={touchEnd}
        onDoubleClick={() => m.type !== 'deleted' && useStore.setState({ replyTo: m, editing: null })}
      >
        {showSender && <div className="sender">{m.sender?.displayName}</div>}
        {m.replyTo && (
          <button className="reply-quote" onClick={() => onJump(m.replyTo.id)}>
            <b>{m.replyTo.sender || 'پیام'}</b>
            <span>{messagePreview(m.replyTo)}</span>
          </button>
        )}
        {m.type === 'deleted' ? <i>این پیام حذف شد</i> : <Media m={m} />}
        {m.text && (
          <div className="text" dir="auto">
            <Linkify text={m.text} />
          </div>
        )}
        <div className="meta">
          {m.pinned && <span>📌</span>}
          {m.editedAt && <span>ویرایش‌شده</span>}
          <span>{formatTime(m.createdAt)}</span>
          {ticks && <span className={`ticks ${ticks === '✓✓' ? 'read' : ''}`}>{ticks}</span>}
        </div>
        <button className="msg-more" aria-label="گزینه‌ها" onClick={openMenu}>
          ⋮
        </button>
      </div>
    </div>
  );
}

export default memo(Message);
