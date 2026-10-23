import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import logo from '../assets/logo.png';
import { errText, useApp } from '../app/AppContext';
import { ApiError } from '../api/client';
import { Field } from '../components/ui';
import { INSTITUTE } from '../lib/whatsapp';

/* UX-001 — Staff sign-in. The server checks the password, throttles repeated failures (FR-003)
   and never reveals whether an account exists (M01). */
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
      if (err instanceof ApiError && err.status === 429) setLockedFor(60);
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="signin">
      <div className="signin__band" aria-hidden />
      <main className="signin__main">
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
                {lockedFor > 0 && <> Try again in {lockedFor}s.</>}
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
          <p className="signin__help">Forgot your password? The administrator can reset it from Staff settings.</p>
        </form>
      </main>
      <footer className="signin__foot">
        <span>{INSTITUTE}</span>
        <span>Sessions end after 30 minutes of inactivity</span>
      </footer>
    </div>
  );
}
