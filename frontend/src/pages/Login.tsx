import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import logo from '../assets/logo.png';
import { errText, useApp } from '../app/AppContext';
import { api, ApiError } from '../api/client';
import { KeyReveal } from '../components/RecoveryKey';
import { Field } from '../components/ui';
import { INSTITUTE } from '../lib/whatsapp';

/* UX-001 — Staff sign-in. The server checks the password, throttles repeated failures (FR-003)
   and never reveals whether an account exists (M01).
   23 Nov (SEC-03): after repeated wrong passwords the wait grows; the countdown comes from the server.
   Forgot password: everyone resets with their own one-time recovery key; without one, the Admin resets staff. */
export default function Login() {
  const { signIn } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setTimeout(() => setLockedFor((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockedFor]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (busy || lockedFor > 0 || !username.trim() || !password) return;
    setError('');
    setBusy(true);
    try {
      await signIn(username.trim(), password);
      nav('/');
    } catch (err) {
      setError(errText(err));
      if (err instanceof ApiError && err.status === 429) setLockedFor(err.retryAfter > 0 ? Math.min(err.retryAfter, 900) : 60);
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="signin">
      <div className="signin__band" aria-hidden />
      <main className="signin__main">
        {forgot ? <ForgotPassword onDone={() => setForgot(false)} initialUser={username} /> : (
        <form className="signin__card" onSubmit={submit} noValidate>
          <img className="signin__logo" src={logo} alt={INSTITUTE} />
          <div className="signin__heading">
            <h1>Staff sign-in</h1>
            <span>{today}</span>
          </div>

          {error && (
            <div className="callout danger" role="alert" style={{ marginBottom: 16 }}>
              <AlertCircle />
              <span>
                {error}
              </span>
            </div>
          )}

          <div className="stack" style={{ gap: 14 }}>
            <Field label="Username" htmlFor="u" error={touched && !username.trim() ? 'Enter your username' : undefined}>
              <input id="u" className="input" style={{ height: 42 }} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </Field>
            <Field label="Password" htmlFor="p" error={touched && !password ? 'Enter your password' : undefined}>
              <div className="input-group">
                <input id="p" className="input" style={{ height: 42, paddingLeft: 12, paddingRight: 44 }} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="icon-btn sm pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </Field>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || lockedFor > 0}>
              {busy && <span className="spinner" />}
              {busy ? 'Signing in…' : lockedFor > 0 ? `Wait ${lockedFor}s` : 'Sign in'}
            </button>
          </div>
          <p className="signin__help">
            <button type="button" className="link-btn" onClick={() => setForgot(true)}>Forgot password?</button>
          </p>
        </form>
        )}
      </main>
      <footer className="signin__foot">
        <span>{INSTITUTE}</span>
        <span>Sessions end after 30 minutes of inactivity</span>
      </footer>
    </div>
  );
}


/** Username + recovery key + new password. The answer carries the next key, shown once here. */
function ForgotPassword({ onDone, initialUser }: { onDone: () => void; initialUser: string }) {
  const [f, setF] = useState({ username: initialUser, key: '', next: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextKey, setNextKey] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.username.trim() || !f.key.trim()) return setError('Enter your username and your recovery key.');
    if (f.next.length < 10) return setError('New password must be at least 10 characters.');
    if (f.next !== f.again) return setError('New passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      const r = await api<{ recovery_key: string }>('/auth/recover', { method: 'POST', body: { username: f.username.trim(), recovery_key: f.key.trim(), new_password: f.next } });
      setNextKey(r.recovery_key);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="signin__card forgot" onSubmit={submit} noValidate aria-labelledby="fp-title">
        {!nextKey && <button type="button" className="btn btn-ghost btn-sm" onClick={onDone} style={{ alignSelf: 'flex-start' }}><ArrowLeft /> Back to sign-in</button>}
        <h2 id="fp-title">Forgot password</h2>
        {nextKey ? (
          <>
            <div className="callout success" role="status"><CheckCircle2 /><span>Password changed. Your old recovery key no longer works — here is your new one. Save it, then sign in with the new password.</span></div>
            <KeyReveal value={nextKey} saved={saved} onSaved={setSaved} />
          </>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {error && <div className="callout danger" role="alert"><AlertCircle /><span>{error}</span></div>}
            <Field label="Username" htmlFor="fp-u">
              <input id="fp-u" className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
            </Field>
            <Field label="Recovery key" htmlFor="fp-k" hint="The key you saved at your first sign-in, e.g. ABCDE-FGHJK-…">
              <input id="fp-k" className="input mono" autoComplete="off" spellCheck={false} value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
            </Field>
            <Field label="New password" htmlFor="fp-n" hint="At least 10 characters; not your username or a common password.">
              <input id="fp-n" type="password" className="input" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
            </Field>
            <Field label="Repeat new password" htmlFor="fp-a">
              <input id="fp-a" type="password" className="input" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
            </Field>
            <button className="btn btn-primary btn-block" disabled={busy}>{busy && <span className="spinner" />} Reset password</button>
            <div className="forgot__staff">
              <strong>No recovery key?</strong>
              <span>Staff: ask the Admin to reset your password (Staff page → Reset password). Admin: ask whoever runs the server.</span>
            </div>
          </div>
        )}
        {nextKey && <button type="button" className="btn btn-primary btn-block" disabled={!saved} onClick={onDone}>Back to sign-in</button>}
    </form>
  );
}
