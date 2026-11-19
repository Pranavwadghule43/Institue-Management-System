import { useEffect, useState } from 'react';
import { Send, X } from 'lucide-react';
import { api } from '../api/client';
import { errText } from '../app/AppContext';
import { Modal } from './ui';

const labels = {
  pending: 'Pending provider confirmation', submitted: 'Submitted to WhatsApp', sent: 'Sent',
  delivered: 'Delivered', read: 'Read', failed: 'Failed',
};

interface Delivery {
  available: boolean;
  eligible: boolean;
  recipient: string | null;
  delivery: { status: keyof typeof labels; result_code: string | null; recipient_last4: string } | null;
}

function failureText(code: string | null) {
  if (code === 'pdf_unavailable') return 'The PDF could not be generated. Try again or save it from the manual sharing screen.';
  if (code === 'media_rejected' || code === 'media_unavailable') return 'WhatsApp could not accept the PDF upload.';
  if (code === 'provider_unavailable') return 'The WhatsApp provider is temporarily unavailable.';
  return code?.startsWith('meta_') ? `WhatsApp reported error ${code.slice(5)}.` : 'WhatsApp reported a delivery failure.';
}

export function AutomaticWhatsApp({ path, title, onClose, onManual }: {
  path: string; title: string; onClose: () => void; onManual: (notice?: string) => void;
}) {
  const [view, setView] = useState<Delivery>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const status = view?.delivery?.status;
  const inProgress = status === 'pending' || status === 'submitted' || status === 'sent';

  useEffect(() => {
    if (busy) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const next = await api<Delivery>(path, { signal: AbortSignal.timeout(15000) });
        if (!live) return;
        if (!next.available || !next.eligible) {
          onManual('Automatic PDF delivery is unavailable.');
          return;
        }
        setView(next);
        if (next.delivery && ['pending', 'submitted', 'sent'].includes(next.delivery.status)) {
          timer = setTimeout(check, 5000);
        }
      } catch (e) {
        if (!live) return;
        setError(errText(e));
        if (inProgress) timer = setTimeout(check, 10000);
      }
    };
    if (inProgress) timer = setTimeout(check, 5000);
    else void check();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, onManual, busy, refresh, inProgress]);

  const phone = view?.recipient;
  useEffect(() => setConsent(false), [phone]);
  const canSend = !!phone && (!status || status === 'failed');

  const send = async () => {
    if (busy || !phone || !canSend || !consent) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<Delivery>(path, {
        method: 'POST',
        signal: AbortSignal.timeout(40000),
        body: { opted_in: true, recipient: phone, attempt_id: crypto.randomUUID() },
      });
      setView(data);
    } catch (e) {
      setError(errText(e));
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
      setConsent(false);
    }
  };

  return (
    <Modal open onClose={onClose}>
      <div className="modal__head row-between">
        <h2>{title}</h2>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div style={{ padding: '0 24px 20px' }}>
        {!view && !error && <p role="status">Checking automatic PDF delivery…</p>}
        {phone && <p>Registered WhatsApp number <strong>+{phone}</strong></p>}
        {view && !phone && <p>Save a valid WhatsApp number on the recipient’s record to send automatically.</p>}
        {view?.delivery && <p role="status"><strong>{labels[view.delivery.status]}</strong> · Number ending {view.delivery.recipient_last4}</p>}
        {status === 'failed' && <p>{failureText(view?.delivery?.result_code ?? null)}</p>}
        {status === 'pending' && <p>Wait for provider confirmation before sharing the PDF again.</p>}
        {error && <p role="alert">{error} <button className="btn btn-ghost btn-sm" onClick={() => {
          setError('');
          setRefresh((value) => value + 1);
        }}>Refresh status</button></p>}
        {canSend && <label className="check">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
          The recipient opted in to receive this PDF at this WhatsApp number.
        </label>}
      </div>
      <div className="modal__foot">
        <button className="btn btn-secondary" disabled={busy} onClick={() => onManual()}>Manual sharing</button>
        {canSend && <button className="btn btn-whatsapp" disabled={busy || !consent} onClick={send}>
          {busy ? <span className="spinner" /> : <Send />} {status === 'failed' ? 'Retry PDF delivery' : 'Send PDF on WhatsApp'}
        </button>}
      </div>
    </Modal>
  );
}
