/* 23 Nov: every account's one-time recovery key for a forgotten password (sign-in page → Forgot password?).
   The key is shown once; the server keeps only a hash. Making a new key replaces the old one. */
import { useState } from 'react';
import { Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { errText, useApp } from '../app/AppContext';
import { Field, Modal } from './ui';

/** The key, shown once, with Copy and an "I saved it" tick. */
export function KeyReveal({ value, saved, onSaved }: { value: string; saved: boolean; onSaved: (v: boolean) => void }) {
  const { toast } = useApp();
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="callout warning"><ShieldAlert /><span>Shown only now. Write it on paper or save it in a password manager, and keep it away from this computer. It works once.</span></div>
      <input className="input mono recovery-key" readOnly value={value} onFocus={(e) => e.target.select()} aria-label="Recovery key" size={value.length} />
      <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
        onClick={() => navigator.clipboard?.writeText(value).then(() => toast('success', 'Copied'))}><Copy /> Copy key</button>
      <label className="row" style={{ gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={saved} onChange={(e) => onSaved(e.target.checked)} /> I have saved my recovery key somewhere safe
      </label>
    </div>
  );
}

export function RecoveryKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, refreshMe, user } = useApp();
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPassword('');
    setKey('');
    setSaved(false);
    setErr('');
    onClose();
  };
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api<{ recovery_key: string }>('/auth/recovery-key', { method: 'POST', body: { current_password: password } });
      setKey(r.recovery_key);
      setPassword('');
      await refreshMe();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={key && !saved ? () => {} : close}>
      <div className="modal__head">
        <div className="modal__icon primary"><KeyRound /></div>
        <div>
          <h2>Recovery key</h2>
          <p>If you forget your password, use this key on the sign-in page (“Forgot password?”) to set a new one.</p>
        </div>
      </div>
      <div className="modal__body stack" style={{ gap: 12 }}>
        {!key ? (
          <>
            {user.recoveryKeySet && (
              <div className="callout warning"><ShieldAlert /><span>A recovery key already exists. Making a new one stops the old one from working.</span></div>
            )}
            <Field label="Your current password" htmlFor="rk-pw" error={err || undefined}>
              <input id="rk-pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          </>
        ) : (
          <KeyReveal value={key} saved={saved} onSaved={setSaved} />
        )}
      </div>
      <div className="modal__foot">
        {!key ? (
          <>
            <button className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={busy || !password}>{busy && <span className="spinner" />} {user.recoveryKeySet ? 'Make a new key' : 'Make recovery key'}</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => { toast('success', 'Recovery key saved'); close(); }} disabled={!saved}>Done</button>
        )}
      </div>
    </Modal>
  );
}
