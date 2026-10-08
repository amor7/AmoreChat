import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { hasSitePerm, SITE_PERM_LABELS, ROLE_LABELS, formatDateTime, formatSize, formatLastSeen, toFa, copyText, messagePreview } from '../util';
import { Modal } from './Modals';
import Avatar from './Avatar';

const TABS = [
  ['stats', '📊 آمار', 'view_audit'],
  ['reports', '🚩 گزارش‌ها', 'handle_reports'],
  ['users', '👥 کاربران', 'manage_users'],
  ['invites', '🎟 کدهای دعوت', 'manage_invites'],
  ['chats', '💬 گروه‌ها', 'manage_chats'],
  ['settings', '⚙️ تنظیمات', 'manage_settings'],
  ['audit', '📜 گزارش فعالیت', 'view_audit'],
];

export default function Admin({ onClose }) {
  const me = useStore((s) => s.me);
  const tabs = TABS.filter(([, , perm]) => hasSitePerm(me, perm));
  const [tab, setTab] = useState(tabs[0]?.[0]);

  return (
    <Modal title="پنل مدیریت" onClose={onClose} size="large">
      <div className="tabs scroll">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'stats' && <Stats />}
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
      {tab === 'invites' && <Invites />}
      {tab === 'chats' && <Chats onClose={onClose} />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <Audit />}
    </Modal>
  );
}

function useLoad(url) {
  const showToast = useStore((s) => s.showToast);
  const [data, setData] = useState(null);
  const latest = useRef(url);
  latest.current = url;
  // Ignore responses for a URL we've since moved away from (fast tab/filter switching).
  const load = () =>
    api('GET', url)
      .then((d) => latest.current === url && setData(d))
      .catch((e) => showToast(e.message));
  useEffect(() => {
    load();
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, load];
}

function Stats() {
  const [s, load] = useLoad('/admin/stats');
  useEffect(() => {
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <p className="muted">…</p>;
  const memUsed = s.memory.total - s.memory.free;
  const cards = [
    ['کاربران', toFa(s.users)],
    ['آنلاین', toFa(s.online)],
    ['گروه و کانال', toFa(s.chats)],
    ['پیام‌ها', toFa(s.messages)],
    ['حجم فایل‌ها', formatSize(s.uploadsBytes)],
    ['حجم دیتابیس', formatSize(s.dbBytes)],
    ['دیسک آزاد', s.disk ? `${formatSize(s.disk.free)} از ${formatSize(s.disk.total)}` : '—'],
    ['رم سرور', `${formatSize(memUsed)} از ${formatSize(s.memory.total)}`],
    ['رم برنامه', formatSize(s.memory.process)],
    ['بار CPU', `${s.load.map((l) => l.toLocaleString('fa-IR', { maximumFractionDigits: 2 })).join(' / ')} (${toFa(s.cpus)} هسته)`],
    ['مدت روشن بودن', `${toFa(Math.floor(s.uptime / 3600))} ساعت`],
    ['پردازش ویدیو (ffmpeg)', s.ffmpeg ? '✅ فعال' : '❌ نصب نیست'],
    ['گزارش‌های باز', toFa(s.openReports)],
  ];
  const diskLow = s.disk && s.disk.free / s.disk.total < 0.1;
  return (
    <>
      {diskLow && <div className="error">⚠️ فضای دیسک کمتر از ۱۰٪ است!</div>}
      <div className="stat-grid">
        {cards.map(([label, value]) => (
          <div key={label} className="stat">
            <small>{label}</small>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </>
  );
}

function Users() {
  const me = useStore((s) => s.me);
  const showToast = useStore((s) => s.showToast);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, load] = useLoad(`/admin/users?q=${encodeURIComponent(query)}`);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const run = async (fn, ok) => {
    try {
      const r = await fn();
      if (ok) showToast(ok);
      load();
      return r;
    } catch (e) {
      showToast(e.message);
    }
  };

  return (
    <>
      <input placeholder="جستجوی کاربر…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="user-list">
        {data?.users.map((u) => (
          <li key={u.id} className="member">
            <button className="row-item" onClick={() => setOpen(open === u.id ? null : u.id)}>
              <Avatar id={u.id} name={u.displayName} file={u.avatar} size={38} online={u.online} />
              <span className="grow">
                <b>
                  {u.displayName} {u.banned && <span className="tag danger">مسدود</span>}
                </b>
                <small dir="ltr">@{u.username}</small>
              </span>
              {u.role !== 'user' && <span className="role-badge">{ROLE_LABELS[u.role]}</span>}
            </button>
            {open === u.id && <UserActions u={u} me={me} run={run} />}
          </li>
        ))}
      </ul>
    </>
  );
}

function UserActions({ u, me, run }) {
  const [perms, setPerms] = useState(u.adminPerms);
  const canManage = u.role === 'user' || (u.role === 'admin' && me.role === 'owner');
  const self = u.id === me.id;
  return (
    <div className="member-actions">
      <small className="muted">
        عضویت: {formatDateTime(u.createdAt)} · {u.online ? 'آنلاین' : formatLastSeen(u.lastSeen)}
      </small>
      {me.role === 'owner' && !self && (
        <div className="perm-box">
          <b>{u.role === 'admin' ? 'دسترسی‌های ادمین سرور' : 'ارتقا به ادمین سرور با دسترسی‌های:'}</b>
          {Object.entries(SITE_PERM_LABELS).map(([p, label]) => (
            <label key={p} className="check">
              <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
              {label}
            </label>
          ))}
          <div className="actions">
            <button className="btn primary sm" onClick={() => run(() => api('PATCH', `/admin/users/${u.id}`, { role: 'admin', adminPerms: perms }), 'ذخیره شد')}>
              {u.role === 'admin' ? 'ذخیره دسترسی‌ها' : 'ادمین کن'}
            </button>
            {u.role === 'admin' && (
              <button className="btn sm" onClick={() => run(() => api('PATCH', `/admin/users/${u.id}`, { role: 'user' }), 'برکنار شد')}>
                برکناری
              </button>
            )}
          </div>
        </div>
      )}
      {canManage && !self && (
        <div className="inline-form">
          <button
            className={`btn sm ${u.banned ? '' : 'danger'}`}
            onClick={() =>
              (u.banned || confirm(`${u.displayName} مسدود شود؟ فوراً از همه دستگاه‌ها خارج می‌شود.`)) &&
              run(() => api('POST', `/admin/users/${u.id}/ban`, { banned: !u.banned }), u.banned ? 'رفع مسدودیت شد' : 'مسدود شد')
            }
          >
            {u.banned ? 'رفع مسدودیت' : 'مسدود کردن'}
          </button>
          <button
            className="btn sm"
            onClick={async () => {
              if (!confirm('رمز عبور این کاربر بازنشانی شود؟')) return;
              const r = await run(() => api('POST', `/admin/users/${u.id}/reset-password`));
              if (r) prompt('رمز جدید (برای کاربر بفرستید):', r.password);
            }}
          >
            بازنشانی رمز
          </button>
        </div>
      )}
    </div>
  );
}

function Invites() {
  const showToast = useStore((s) => s.showToast);
  const [data, load] = useLoad('/admin/invites');
  const [f, setF] = useState({ maxUses: '1', expiresInHours: '72', note: '' });
  const link = (code) => `${location.origin}/#/invite/${code}`;

  async function create(e) {
    e.preventDefault();
    try {
      const { invite } = await api('POST', '/admin/invites', f);
      (await copyText(link(invite.code))) && showToast('لینک دعوت ساخته و کپی شد');
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <>
      <form className="inline-form boxed" onSubmit={create}>
        <input placeholder="یادداشت (مثلاً: برای علی)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <input type="number" min="0" placeholder="تعداد استفاده (۰=نامحدود)" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} />
        <input type="number" min="0" placeholder="اعتبار به ساعت (۰=همیشه)" value={f.expiresInHours} onChange={(e) => setF({ ...f, expiresInHours: e.target.value })} />
        <button className="btn primary sm">ساخت کد دعوت</button>
      </form>
      <ul className="user-list">
        {data?.invites.map((i) => {
          const expired = (i.expires_at && i.expires_at < Date.now()) || (i.max_uses && i.uses >= i.max_uses);
          return (
            <li key={i.id} className={`row-item ${expired ? 'faded' : ''}`}>
              <span className="grow">
                <code dir="ltr">{i.code}</code> {i.note && <b>{i.note}</b>}
                <small>
                  {toFa(i.uses)}
                  {i.max_uses ? `/${toFa(i.max_uses)}` : ''} استفاده
                  {i.expires_at ? ` · انقضا ${formatDateTime(i.expires_at)}` : ''}
                  {i.creator ? ` · ${i.creator}` : ''}
                </small>
              </span>
              {!expired && (
                <button className="btn sm" onClick={async () => (await copyText(link(i.code))) && showToast('کپی شد')}>
                  کپی لینک
                </button>
              )}
              <button className="btn sm danger" onClick={() => api('DELETE', `/admin/invites/${i.id}`).then(load)}>
                حذف
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Chats({ onClose }) {
  const showToast = useStore((s) => s.showToast);
  const [data, load] = useLoad('/admin/chats');
  return (
    <ul className="user-list">
      {data?.chats.map((c) => (
        <li key={c.id} className="row-item">
          <span className="grow">
            <b>
              {c.type === 'channel' ? '📢 ' : '👥 '}
              {c.title}
            </b>
            <small>
              {toFa(c.memberCount)} عضو · {toFa(c.messageCount)} پیام · {c.isPublic ? 'عمومی' : 'خصوصی'}
            </small>
          </span>
          <button
            className="btn sm"
            onClick={() => {
              onClose();
              useStore.getState().openModal('chatInfo', { chatId: c.id });
            }}
            disabled={!useStore.getState().chats[c.id]}
            title="فقط برای گفتگوهایی که عضو هستید"
          >
            مدیریت
          </button>
          {!c.isEmergency && (
            <button
              className="btn sm danger"
              onClick={() =>
                confirm(`«${c.title}» برای همه حذف شود؟`) &&
                api('DELETE', `/chats/${c.id}`)
                  .then(load)
                  .catch((e) => showToast(e.message))
              }
            >
              حذف
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Settings() {
  const showToast = useStore((s) => s.showToast);
  const [data] = useLoad('/admin/settings');
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data) setF(data.settings);
  }, [data]);
  if (!f) return <p className="muted">…</p>;

  async function save(e) {
    e.preventDefault();
    try {
      const { settings } = await api('PATCH', '/admin/settings', f);
      setF(settings);
      useStore.setState((s) => ({
        config: { ...s.config, siteName: settings.site_name, registrationMode: settings.registration_mode, allowUserGroups: settings.allow_user_groups === '1' },
      }));
      showToast('تنظیمات ذخیره شد');
    } catch (err) {
      showToast(err.message);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        نام سرور
        <input value={f.site_name} onChange={(e) => setF({ ...f, site_name: e.target.value })} maxLength={50} />
      </label>
      <label>
        ثبت‌نام
        <select value={f.registration_mode} onChange={(e) => setF({ ...f, registration_mode: e.target.value })}>
          <option value="open">آزاد (هر کس لینک سرور را دارد)</option>
          <option value="invite">فقط با کد دعوت</option>
          <option value="closed">بسته</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={f.allow_user_groups === '1'} onChange={(e) => setF({ ...f, allow_user_groups: e.target.checked ? '1' : '0' })} />
        کاربران عادی بتوانند گروه و کانال بسازند
      </label>
      <label>
        حداکثر حجم هر فایل (مگابایت)
        <input type="number" min="1" value={f.max_upload_mb} onChange={(e) => setF({ ...f, max_upload_mb: e.target.value })} />
      </label>
      <label>
        سهمیه فضای هر کاربر (مگابایت، ۰ = نامحدود)
        <input type="number" min="0" value={f.user_quota_mb} onChange={(e) => setF({ ...f, user_quota_mb: e.target.value })} />
      </label>
      <label>
        حذف خودکار عکس، ویدیو و فایل‌های قدیمی‌تر از (روز، ۰ = هرگز)
        <input type="number" min="0" value={f.media_retention_days} onChange={(e) => setF({ ...f, media_retention_days: e.target.value })} />
      </label>
      <p className="hint">برای وقتی دیسک سرور کوچک است. پیام‌ها می‌مانند، فقط فایل‌هایشان حذف می‌شود. عکس پروفایل‌ها حذف نمی‌شوند.</p>
      <button className="btn primary">ذخیره تنظیمات</button>
    </form>
  );
}

function Reports() {
  const showToast = useStore((s) => s.showToast);
  const [status, setStatus] = useState('open');
  const [data, load] = useLoad(`/admin/reports?status=${status}`);

  const act = (id, action) =>
    api('POST', `/admin/reports/${id}`, { action })
      .then(() => {
        showToast(action === 'delete' ? 'پیام حذف شد' : 'گزارش بسته شد');
        load();
      })
      .catch((e) => showToast(e.message));

  return (
    <>
      <div className="segmented">
        <button className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>
          باز
        </button>
        <button className={status === 'closed' ? 'active' : ''} onClick={() => setStatus('closed')}>
          بسته‌شده
        </button>
      </div>
      {data?.reports.length === 0 && <p className="muted pad">گزارشی وجود ندارد 🎉</p>}
      <ul className="audit">
        {data?.reports.map((r) => (
          <li key={r.id} className="report">
            <small>{formatDateTime(r.createdAt)}</small>
            <b>{r.reporter}</b> پیامی از <b>{r.message?.sender?.displayName || '?'}</b> در «{r.chat.title}» را گزارش کرد
            {r.reason && <div className="report-reason">دلیل: {r.reason}</div>}
            <blockquote className="report-msg" dir="auto">
              {r.message?.type === 'deleted' ? <i>پیام حذف شده</i> : messagePreview(r.message)}
            </blockquote>
            {status === 'open' ? (
              <div className="inline-form">
                {r.message?.type !== 'deleted' && (
                  <button className="btn sm danger" onClick={() => act(r.id, 'delete')}>
                    حذف پیام
                  </button>
                )}
                <button className="btn sm" onClick={() => act(r.id, 'dismiss')}>
                  رد گزارش
                </button>
              </div>
            ) : (
              <span className="tag">{r.status === 'deleted' ? 'پیام حذف شد' : 'رد شد'}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

const ACTION_LABELS = {
  'user.register': 'ثبت‌نام',
  'user.role': 'تغییر نقش کاربر',
  'user.ban': 'مسدود کردن کاربر',
  'user.unban': 'رفع مسدودیت کاربر',
  'user.reset_password': 'بازنشانی رمز',
  'invite.create': 'ساخت کد دعوت',
  'invite.delete': 'حذف کد دعوت',
  'settings.update': 'تغییر تنظیمات',
  'chat.edit': 'ویرایش گفتگو',
  'chat.delete': 'حذف گفتگو',
  'chat.member_role': 'تغییر نقش عضو',
  'chat.mute': 'بی‌صدا کردن',
  'chat.kick': 'حذف عضو',
  'chat.ban': 'مسدود کردن عضو',
  'chat.unban': 'رفع مسدودیت عضو',
  'message.delete': 'حذف پیام دیگران',
  'report.delete': 'حذف پیام گزارش‌شده',
  'report.dismiss': 'رد گزارش',
};

function Audit() {
  const [entries, setEntries] = useState([]);
  const [more, setMore] = useState(true);
  const load = async (before) => {
    const r = await api('GET', `/admin/audit${before ? `?before=${before}` : ''}`);
    setEntries((e) => (before ? [...e, ...r.entries] : r.entries));
    setMore(r.entries.length === 100);
  };
  useEffect(() => {
    load().catch(() => {});
  }, []);
  return (
    <>
      <ul className="audit">
        {entries.map((a) => (
          <li key={a.id}>
            <small>{formatDateTime(a.created_at)}</small>
            <b>{a.actor_name || 'سیستم'}</b> {ACTION_LABELS[a.action] || a.action}
            {a.target && <code dir="ltr"> #{a.target}</code>}
            {a.details && <div className="audit-details" dir="ltr">{a.details}</div>}
          </li>
        ))}
      </ul>
      {more && entries.length > 0 && (
        <button className="btn wide" onClick={() => load(entries[entries.length - 1].id)}>
          موارد بیشتر
        </button>
      )}
    </>
  );
}
