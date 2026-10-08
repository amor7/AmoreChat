import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Modal, UserSearch } from './Modals';

export default function NewChat({ onClose }) {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const st = useStore.getState;
  const canCreate = me.role !== 'user' || config.allowUserGroups !== false;
  const [tab, setTab] = useState('dm');
  const [form, setForm] = useState({ title: '', description: '', isPublic: false });
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function openDm(u) {
    try {
      const { chat } = await api('POST', '/chats/dm', { userId: u.id });
      st().upsertChat(chat);
      onClose();
      location.hash = `#/chat/${chat.id}`;
    } catch (e) {
      setError(e.message);
    }
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { chat } = await api('POST', '/chats', { type: tab, ...form, memberIds: members.map((m) => m.id) });
      st().upsertChat(chat);
      onClose();
      location.hash = `#/chat/${chat.id}`;
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <Modal title="گفتگوی جدید" onClose={onClose}>
      <div className="tabs">
        <button className={tab === 'dm' ? 'active' : ''} onClick={() => setTab('dm')}>
          پیام خصوصی
        </button>
        {canCreate && (
          <>
            <button className={tab === 'group' ? 'active' : ''} onClick={() => setTab('group')}>
              گروه
            </button>
            <button className={tab === 'channel' ? 'active' : ''} onClick={() => setTab('channel')}>
              کانال
            </button>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {tab === 'dm' ? (
        <UserSearch onPick={openDm} />
      ) : (
        <form className="form" onSubmit={create}>
          <label>
            عنوان {tab === 'group' ? 'گروه' : 'کانال'}
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={100} autoFocus />
          </label>
          <label>
            توضیحات
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} rows={2} />
          </label>
          <label className="check">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            عمومی (همه می‌توانند پیدا کنند و عضو شوند)
          </label>
          <div className="chips">
            {members.map((m) => (
              <span key={m.id} className="chip">
                {m.displayName}
                <button type="button" onClick={() => setMembers(members.filter((x) => x.id !== m.id))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <UserSearch
            placeholder="افزودن عضو…"
            exclude={members.map((m) => m.id)}
            onPick={(u) => setMembers([...members, u])}
          />
          <button className="btn primary" disabled={busy}>
            ساخت {tab === 'group' ? 'گروه' : 'کانال'}
          </button>
        </form>
      )}
      {!canCreate && (
        <p className="hint">ساخت گروه و کانال توسط مدیر سرور غیرفعال شده است.</p>
      )}
    </Modal>
  );
}
