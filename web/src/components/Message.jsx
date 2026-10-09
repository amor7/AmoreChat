import { memo, useRef } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { formatTime, messagePreview, toFa, callSummary } from '../util';
import { startCall } from '../rtc';
import { EmojiImg, RichText, isBigEmoji } from './Emoji';
import PreviewIcon from './PreviewIcon';
import { Hourglass, Forward, Timer, Pin, Check, CheckCheck, EllipsisVertical, PhoneMissed, PhoneOutgoing, PhoneIncoming, Phone, Video } from 'lucide-react';
import Avatar from './Avatar';
import { VoicePlayer, ImageMessage, VideoMessage, FileCard } from './Media';

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"،؛])/g;

// Links become anchors; emoji become Fluent images (large when the message is only 1-3 emoji).
function Linkify({ text, big }) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" dir="ltr">
        {p}
      </a>
    ) : (
      <RichText key={i} text={p} size={22} big={big} />
    ),
  );
}

function Content({ m, mine }) {
  const f = m.file;
  if (!f) return null;
  if (f.purged)
    return (
      <div className="expired">
        <Hourglass size={16} /> این فایل منقضی و از سرور حذف شده است
      </div>
    );
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
          <EmojiImg ch={r.emoji} size={19} />
          <span>{toFa(r.users.length)}</span>
        </button>
      ))}
    </div>
  );
}

function Message({ m, chat, mine, grouped, onJump, onMenu }) {
  const meId = useStore((s) => s.me.id);
  const press = useRef(null);

  if (m.type === 'call') return <CallLog m={m} mine={mine} chat={chat} />;

  if (m.type === 'system') {
    return (
      <div className="system-msg" id={`msg-${m.id}`}>
        <span>{m.text}</span>
      </div>
    );
  }

  const showSender = !mine && chat.type === 'group' && !grouped;
  const showAvatar = !mine && chat.type === 'group';
  const ticks = mine && chat.type !== 'saved' && chat.type !== 'channel' ? (chat.othersRead >= m.id ? 'read' : 'sent') : '';
  const visual = (m.type === 'image' || m.type === 'video') && !m.file?.purged;
  const bigEmoji = m.type === 'text' && !m.replyTo && !m.forwardedFrom && isBigEmoji(m.text);

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
          className={`bubble ${m.type === 'deleted' ? 'deleted' : ''} ${visual ? 'has-media' : ''} ${bigEmoji ? 'big-emoji' : ''}`}
          onContextMenu={openMenu}
          onTouchStart={touchStart}
          onTouchEnd={touchEnd}
          onTouchMove={touchEnd}
          onDoubleClick={() => m.type !== 'deleted' && useStore.setState({ replyTo: m, editing: null })}
        >
          {showSender && <div className="sender">{m.sender?.displayName}</div>}
          {m.forwardedFrom && (
            <div className="forwarded">
              <Forward size={13} /> فوروارد از {m.forwardedFrom}
            </div>
          )}
          {m.replyTo && (
            <button className="reply-quote" onClick={() => onJump(m.replyTo.id)}>
              <b>{m.replyTo.sender || 'پیام'}</b>
              <span>
                <PreviewIcon m={m.replyTo} />
                <RichText text={messagePreview(m.replyTo)} size={16} />
              </span>
            </button>
          )}
          {m.type === 'deleted' ? <i>این پیام حذف شد</i> : <Content m={m} mine={mine} />}
          {m.text && (
            <div className="text" dir="auto">
              <Linkify text={m.text} big={bigEmoji} />
            </div>
          )}
          <div className="meta">
            {m.expiresAt && <Timer size={12} aria-label="حذف خودکار" />}
            {m.pinned && <Pin size={12} />}
            {m.editedAt && <span>ویرایش‌شده</span>}
            <span>{formatTime(m.createdAt)}</span>
            {ticks && <span className={`ticks ${ticks}`}>{ticks === 'read' ? <CheckCheck size={15} /> : <Check size={15} />}</span>}
          </div>
          <button className="msg-more" aria-label="گزینه‌ها" onClick={openMenu}>
            <EllipsisVertical size={18} />
          </button>
        </div>
        <Reactions m={m} meId={meId} />
      </div>
    </div>
  );
}

function CallLog({ m, mine, chat }) {
  const s = callSummary(m);
  const showToast = useStore((st) => st.showToast);
  return (
    <div className={`msg-row ${mine ? 'mine' : ''}`} id={`msg-${m.id}`}>
      <div className={`bubble call-log ${s.failed && !mine ? 'missed' : ''}`}>
        <span className="call-icon">{s.failed && !mine ? <PhoneMissed size={20} /> : mine ? <PhoneOutgoing size={20} /> : <PhoneIncoming size={20} />}</span>
        <span className="grow">
          <b>{s.label}</b>
          <small>{formatTime(m.createdAt)}</small>
        </span>
        {chat.peer && (
          <button className="icon-btn" title="تماس دوباره" onClick={() => startCall(chat.peer, !!s.video).catch((e) => showToast(e.message))}>
            {s.video ? <Video size={20} /> : <Phone size={20} />}
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(Message);
