import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import logo from '../assets/logo.png';
import { useApp } from '../app/AppContext';
import { Field } from '../components/ui';
import { institute } from '../lib/institute';

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 60;

/* UX-001 — Staff sign-in. Errors never reveal whether an account exists (M01);
   repeated failures are throttled (FR-003); disabled/locked accounts get a generic message. */
export default function Login() {
  const { signIn } = useApp();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const t = setTimeout(() => setLockedFor((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [lockedFor]);

  const fail = (msg: string) => {
    const n = fails + 1;
    setFails(n);
    if (n >= MAX_ATTEMPTS) {
      setLockedFor(LOCK_SECONDS);
      setFails(0);
      setError('Too many attempts. Sign-in is paused for a minute.');
    } else setError(msg);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (lockedFor > 0 || !username.trim() || !password) return;
    setError('');
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      const u = username.trim().toLowerCase();
      if (u === 'sunil.y' || u === 'kavita.j') return fail('This account can’t sign in right now. Please contact the administrator.');
      if (password.length < 4) return fail('Incorrect username or password.');
      signIn(u === 'admin' ? 'Admin' : 'Staff');
      nav('/');
    }, 600);
  };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="signin">
      <div className="signin__band" aria-hidden />
      <main className="signin__main">
        <form className="signin__card" onSubmit={submit} noValidate>
          <img className="signin__logo" src={logo} alt={institute.name} />
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

        <p className="signin__demo">
          Demo build — sign in as <code>admin</code> for the Admin view, or any other name for Staff (password: any 4+ characters).
        </p>
      </main>
      <footer className="signin__foot">
        <span>
          {institute.name} · {institute.address}
        </span>
        <span>Sessions end after 30 minutes of inactivity</span>
      </footer>
    </div>
  );
}
