/* 23 Nov security screens, shown instead of the app right after sign-in:
   1. SEC-05 — a temporary password (new staff, or reset by the Admin) must be replaced first (the server enforces it:
      403 on every other endpoint);
   2. every account then gets its one-time recovery key, shown once, for a forgotten password. */
import { useState } from 'react';
import { AlertCircle, KeyRound, LifeBuoy, LogOut } from 'lucide-react';
import { KeyReveal } from '../components/RecoveryKey';
import logo from '../assets/logo.png';
import { api } from '../api/client';
import { errText, useApp } from '../app/AppContext';
import { Field } from '../components/ui';
import { INSTITUTE } from '../lib/whatsapp';

function Frame({ title, sub, icon, children }: { title: string; sub: string; icon: React.ReactNode; children: React.ReactNode }) {
  const { signOut, user } = useApp();
  return (
    <div className="signin">
      <div className="signin__band" aria-hidden />
      <main className="signin__main">
        <div className="signin__card security-setup">
          <img className="signin__logo" src={logo} alt={INSTITUTE} />
          <div className="security-setup__head">
            <span className="security-setup__icon">{icon}</span>
            <div>
              <h1>{title}</h1>
              <p>{sub}</p>
            </div>
          </div>
          {children}
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={signOut}>
            <LogOut /> Sign out ({user.username})
          </button>
        </div>
      </main>
      <footer className="signin__foot">
        <span>{INSTITUTE}</span>
        <span>Security set-up</span>
      </footer>
    </div>
  );
}

/** After the key is shown and saved, continue into the app. */
function KeyStep({ value }: { value: string }) {
  const { refreshMe, toast } = useApp();
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <KeyReveal value={value} saved={saved} onSaved={setSaved} />
      <button className="btn btn-primary btn-lg btn-block" disabled={!saved}
        onClick={() => { toast('success', 'Recovery key saved'); void refreshMe(); }}>Continue</button>
    </div>
  );
}

const KEY_SUB = 'If you ever forget your password, use this key on the sign-in page (“Forgot password?”) to set a new one yourself.';

export function ForcedPasswordChange() {
  const { refreshMe, toast, user } = useApp();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next.length < 10) return setErr('New password must be at least 10 characters.');
    if (f.next !== f.again) return setErr('New passwords don’t match.');
    setErr('');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: f.current, new_password: f.next } });
      toast('success', 'Password changed', 'Use your new password from now on.');
      if (user.recoveryKeySet) return void (await refreshMe());
      try {
        // First sign-in: hand out the recovery key straight away (the new password confirms it's them).
        setKey((await api<{ recovery_key: string }>('/auth/recovery-key', { method: 'POST', body: { current_password: f.next } })).recovery_key);
      } catch {
        await refreshMe(); // the next screen asks for the password and makes the key
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (key) {
    return (
      <Frame title="Save your recovery key" sub={KEY_SUB} icon={<LifeBuoy />}>
        <KeyStep value={key} />
      </Frame>
    );
  }
  return (
    <Frame title="Choose your own password" sub="You signed in with a temporary password. Replace it before you continue." icon={<KeyRound />}>
      <form className="stack" style={{ gap: 12 }} onSubmit={save} noValidate>
        {err && <div className="callout danger" role="alert"><AlertCircle /><span>{err}</span></div>}
        <Field label="Temporary password" htmlFor="fp0">
          <input id="fp0" type="password" className="input" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus />
        </Field>
        <Field label="New password" htmlFor="fp1" hint="At least 10 characters; not your username or a common password.">
          <input id="fp1" type="password" className="input" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Repeat new password" htmlFor="fp2">
          <input id="fp2" type="password" className="input" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !f.current || !f.next || !f.again}>
          {busy && <span className="spinner" />} Save and continue
        </button>
      </form>
    </Frame>
  );
}

/** Accounts without a usable key (existing accounts after this update, or after an Admin reset): once, after sign-in. */
export function RecoveryKeySetup() {
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      setKey((await api<{ recovery_key: string }>('/auth/recovery-key', { method: 'POST', body: { current_password: password } })).recovery_key);
      setPassword('');
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame title="Save your recovery key" sub={KEY_SUB} icon={<LifeBuoy />}>
      {key ? <KeyStep value={key} /> : (
        <form className="stack" style={{ gap: 12 }} onSubmit={make} noValidate>
          {err && <div className="callout danger" role="alert"><AlertCircle /><span>{err}</span></div>}
          <Field label="Confirm your password" htmlFor="rk0" hint="This is done once. Your key appears on the next step.">
            <input id="rk0" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy || !password}>{busy && <span className="spinner" />} Show my recovery key</button>
        </form>
      )}
    </Frame>
  );
}
