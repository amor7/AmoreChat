import { useRef, useState } from 'react';
import { api, upload } from '../api';
import { useStore } from '../store';
import { compressImage, ROLE_LABELS } from '../util';
import { Modal } from './Modals';
import Avatar from './Avatar';

export default function Profile({ onClose }) {
  const me = useStore((s) => s.me);
  const showToast = useStore((s) => s.showToast);
  const [form, setForm] = useState({ displayName: me.displayName, bio: me.bio || '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [notif, setNotif] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fileRef = useRef(null);

  async function save(body) {
    try {
      const { user } = await api('PATCH', '/me', body);
      useStore.setState({ me: user });
      showToast('ذخیره شد');
    } catch (e) {
      showToast(e.message);
    }
  }

  async function onAvatar(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { blob } = await compressImage(f, 512, 0.85);
      const file = await upload(blob, { name: 'avatar.jpg' });
      await save({ avatar: file.id });
    } catch (err) {
      showToast(err.message);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    try {
      await api('POST', '/auth/password', pw);
      setPw({ current: '', next: '' });
      showToast('رمز عبور تغییر کرد');
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <Modal title="پروفایل و تنظیمات" onClose={onClose}>
      <div className="profile-head">
        <button className="avatar-edit" onClick={() => fileRef.current.click()} aria-label="تغییر عکس">
          <Avatar id={me.id} name={me.displayName} file={me.avatar} size={80} />
          <span>📷</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatar} />
        <div>
          <b>{me.displayName}</b>
          <div className="muted" dir="ltr">
            @{me.username}
          </div>
          <span className="role-badge">{ROLE_LABELS[me.role]}</span>
        </div>
      </div>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(form);
        }}
      >
        <label>
          نام نمایشی
          <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={64} required />
        </label>
        <label>
          درباره من
          <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={300} rows={2} />
        </label>
        <button className="btn primary">ذخیره</button>
      </form>

      <h4>اعلان‌ها</h4>
      {notif === 'granted' && <p className="muted">اعلان‌ها فعال هستند (وقتی برنامه باز یا در پس‌زمینه است).</p>}
      {notif === 'default' && (
        <button className="btn" onClick={async () => setNotif(await Notification.requestPermission())}>
          🔔 فعال کردن اعلان‌ها
        </button>
      )}
      {notif === 'denied' && <p className="muted">اعلان‌ها در تنظیمات مرورگر مسدود شده‌اند.</p>}
      {notif === 'unsupported' && <p className="muted">این مرورگر از اعلان پشتیبانی نمی‌کند. برنامه را نصب کنید (افزودن به صفحه اصلی).</p>}

      <h4>تغییر رمز عبور</h4>
      <form className="form" onSubmit={changePassword}>
        <input type="password" placeholder="رمز فعلی" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required dir="ltr" autoComplete="current-password" />
        <input type="password" placeholder="رمز جدید (حداقل ۸ کاراکتر)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={8} dir="ltr" autoComplete="new-password" />
        <button className="btn">تغییر رمز</button>
      </form>
    </Modal>
  );
}
