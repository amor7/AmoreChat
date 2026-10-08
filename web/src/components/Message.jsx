import { memo, useRef } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { formatTime, messagePreview, toFa } from '../util';
import Avatar from './Avatar';
import { VoicePlayer, ImageMessage, VideoMessage, FileCard } from './Media';

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

function Content({ m, mine }) {
  const f = m.file;
  if (!f) return null;
  if (f.purged) return <div className="expired">⌛ این فایل منقضی و از سرور حذف شده است</div>;
  if (m.type === 'image') return <ImageMessage file={f} />;
  if (m.type === 'video') return <VideoMessage file={f} />;
  if (m.type === 'voice') return <VoicePlayer file={f} mine={mine} />;
  return <FileCard file={f} />;
}

function Reactions({ m, meId }) {
  const showToast = useStore((s) => s.showToast);
  if (!m.reactions?.length) return null;
  const toggle = (emoji) => api('POST', `/messages/${m.id}/react`, { emoji }).catch((e) => showToast(e.message));
  return (
    <div className="reactions">
      {m.reactions.map((r) => (
        <button key={r.emoji} className={`reaction ${r.users.includes(meId) ? 'mine' : ''}`} onClick={() => toggle(r.emoji)}>
          <span>{r.emoji}</span>
          <span>{toFa(r.users.length)}</span>
        </button>
      ))}
    </div>
  );
}

function Message({ m, chat, mine, grouped, onJump, onMenu }) {
  const meId = useStore((s) => s.me.id);
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
  const visual = (m.type === 'image' || m.type === 'video') && !m.file?.purged;

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
      <div className="bubble-col">
        <div
          className={`bubble ${m.type === 'deleted' ? 'deleted' : ''} ${visual ? 'has-media' : ''}`}
          onContextMenu={openMenu}
          onTouchStart={touchStart}
          onTouchEnd={touchEnd}
          onTouchMove={touchEnd}
          onDoubleClick={() => m.type !== 'deleted' && useStore.setState({ replyTo: m, editing: null })}
        >
          {showSender && <div className="sender">{m.sender?.displayName}</div>}
          {m.forwardedFrom && <div className="forwarded">↪ فوروارد از {m.forwardedFrom}</div>}
          {m.replyTo && (
            <button className="reply-quote" onClick={() => onJump(m.replyTo.id)}>
              <b>{m.replyTo.sender || 'پیام'}</b>
              <span>{messagePreview(m.replyTo)}</span>
            </button>
          )}
          {m.type === 'deleted' ? <i>این پیام حذف شد</i> : <Content m={m} mine={mine} />}
          {m.text && (
            <div className="text" dir="auto">
              <Linkify text={m.text} />
            </div>
          )}
          <div className="meta">
            {m.expiresAt && <span title="حذف خودکار">⏱</span>}
            {m.pinned && <span>📌</span>}
            {m.editedAt && <span>ویرایش‌شده</span>}
            <span>{formatTime(m.createdAt)}</span>
            {ticks && <span className={`ticks ${ticks === '✓✓' ? 'read' : ''}`}>{ticks}</span>}
          </div>
          <button className="msg-more" aria-label="گزینه‌ها" onClick={openMenu}>
            ⋮
          </button>
        </div>
        <Reactions m={m} meId={meId} />
      </div>
    </div>
  );
}

export default memo(Message);
