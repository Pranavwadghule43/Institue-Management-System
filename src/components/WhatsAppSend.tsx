import { Fragment, useEffect, useState } from 'react';
import { FileDown, MessageCircle, X } from 'lucide-react';
import { Field, Modal } from './ui';
import { waLink } from '../lib/whatsapp';

/** Renders WhatsApp's *bold* / _italic_ markers the way the customer will see them */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((ln, i) => (
        <Fragment key={i}>
          {ln.split(/(\*[^*]+\*|_[^_]+_)/g).map((part, k) =>
            part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
              <strong key={k}>{part.slice(1, -1)}</strong>
            ) : part.startsWith('_') && part.endsWith('_') && part.length > 2 ? (
              <em key={k}>{part.slice(1, -1)}</em>
            ) : (
              <Fragment key={k}>{part}</Fragment>
            ),
          )}
          <br />
        </Fragment>
      ))}
    </>
  );
}

/* "Open WhatsApp" for receipts and bills (FR-030 / C-56).
   wa.me opens the customer's chat with the full receipt/bill typed in — the user presses Send.
   A PDF can be attached manually; wa.me cannot attach files or send by itself. */
export function WhatsAppSend({
  open, onClose, title, name, phone, message, onPdf, onOpened,
}: {
  open: boolean; onClose: () => void; title: string; name: string; phone: string; message: string; onPdf?: () => void; onOpened?: (phone: string) => void;
}) {
  const [num, setNum] = useState(phone);
  const [text, setText] = useState(message);
  useEffect(() => {
    if (open) {
      setNum(phone);
      setText(message);
    }
  }, [open, phone, message]);
  const digits = num.replace(/\D/g, '');
  const valid = /^[6-9]\d{9}$/.test(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits);

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="wa">
        <div className="wa__form">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 16 }}>{title}</h2>
            <button className="icon-btn sm" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
          <Field label={`WhatsApp number of ${name}`} required htmlFor="wanum" error={!valid ? 'Enter a 10-digit Indian mobile number' : undefined}>
            <div className="input-group">
              <span className="input-prefix" style={{ fontSize: 13 }}>
                +91
              </span>
              <input id="wanum" className="input num" style={{ paddingLeft: 44 }} value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d ]/g, ''))} />
            </div>
          </Field>
          <Field label="Message" htmlFor="watext" hint="You can edit before opening WhatsApp. *text* shows bold, _text_ italic.">
            <textarea id="watext" className="textarea mono" rows={13} style={{ fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
        <div className="wa__phone" aria-label="Preview">
          <div className="wa__bar">
            <span className="wa__avatar">{name.slice(0, 1)}</span>
            <div>
              <strong>{name}</strong>
              <small>+91 {digits.slice(-10).replace(/(\d{5})(\d{5})/, '$1 $2')}</small>
            </div>
          </div>
          <div className="wa__chat">
            <div className="wa__bubble">
              <WaText text={text} />
              <span className="wa__time">{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="modal__foot" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>
          WhatsApp opens with this message ready. Attach the PDF if needed, then press Send.
        </span>
        <div className="row" style={{ gap: 8 }}>
          {onPdf && (
            <button className="btn btn-secondary" onClick={onPdf}>
              <FileDown /> Save PDF
            </button>
          )}
          <a
            className={`btn btn-whatsapp ${valid ? '' : 'is-disabled'}`}
            href={valid ? waLink(digits.slice(-10), text) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!valid}
            onClick={(e) => {
              if (!valid) return e.preventDefault();
              onOpened?.(digits.slice(-10));
              onClose();
            }}
          >
            <MessageCircle /> Open WhatsApp
          </a>
        </div>
      </div>
    </Modal>
  );
}
