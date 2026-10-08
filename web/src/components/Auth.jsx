import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export default function Auth({ invite: initialInvite }) {
  const config = useStore((s) => s.config);
  const canRegister = config.needsSetup || config.registrationMode !== 'closed';
  const needsCode = config.needsSetup || config.registrationMode === 'invite';
  const [mode, setMode] = useState(config.needsSetup || initialInvite ? 'register' : 'login');
  const [form, setForm] = useState({ username: '', password: '', displayName: '', invite: initialInvite || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api('POST', mode === 'login' ? '/auth/login' : '/auth/register', form);
      if (location.hash.startsWith('#/invite/')) history.replaceState(null, '', '/');
      useStore.setState({ me: user, config: { ...config, needsSetup: false } });
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <img src="/icon.svg" alt="" width="64" height="64" />
        <h1>{config.siteName}</h1>
        {config.needsSetup && (
          <p className="hint">
            راه‌اندازی اولیه: اولین حساب، مالک سرور می‌شود. کد راه‌اندازی در لاگ سرور چاپ شده است.
          </p>
        )}
        {!config.needsSetup && canRegister && (
          <div className="tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              ورود
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              ثبت‌نام
            </button>
          </div>
        )}
        {mode === 'register' && (
          <label>
            نام نمایشی
            <input value={form.displayName} onChange={set('displayName')} required maxLength={64} autoComplete="name" />
          </label>
        )}
        <label>
          نام کاربری
          <input
            value={form.username}
            onChange={set('username')}
            required
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            placeholder={mode === 'register' ? 'english_name' : ''}
          />
        </label>
        <label>
          رمز عبور
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={mode === 'register' ? 8 : undefined}
            dir="ltr"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' && needsCode && (
          <label>
            {config.needsSetup ? 'کد راه‌اندازی' : 'کد دعوت'}
            <input value={form.invite} onChange={set('invite')} required dir="ltr" autoCapitalize="none" />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'ورود' : 'ساخت حساب'}
        </button>
        {!canRegister && <p className="hint">ثبت‌نام بسته است. برای ساخت حساب با مدیر تماس بگیرید.</p>}
      </form>
    </div>
  );
}
