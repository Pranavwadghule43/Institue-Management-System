import { Fragment, useEffect, useState } from 'react';
import { FileDown, FileText, MessageCircle, Send, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { Field, Modal } from './ui';
import { waLink } from '../lib/whatsapp';
import { saveFile } from '../lib/pdf';

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

const canShareFile = (f: File) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [f] });

/* Send a receipt / bill on WhatsApp (FR-030 / C-56). No WhatsApp API is used: nothing is sent automatically.
   - With the device share sheet (Android, iPhone, Windows with the WhatsApp app): the PDF is attached and the
     message goes with it; the user picks the chat in WhatsApp and presses Send.
   - Otherwise (e.g. WhatsApp Web): the PDF is downloaded and the customer's chat opens with the message typed in;
     the user attaches the downloaded PDF (drag it into the chat) and presses Send. */
export function WhatsAppSend({
  open, onClose, title, name, phone, message, pdf, onOpened,
}: {
  open: boolean; onClose: () => void; title: string; name: string; phone: string; message: string; pdf?: () => Promise<File>; onOpened?: (phone: string) => void;
}) {
  const { toast } = useApp();
  const [num, setNum] = useState(phone);
  const [text, setText] = useState(message);
  const [file, setFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState('');
  useEffect(() => {
    if (!open) return;
    setNum(phone);
    setText(message);
    setFile(null);
    setPdfError('');
    if (!pdf) return;
    let live = true;
    pdf().then((f) => live && setFile(f)).catch(() => live && setPdfError('The PDF could not be created. You can still send the message.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const digits = num.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  const valid = /^[6-9]\d{9}$/.test(local);
  const share = file && canShareFile(file);

  const done = () => {
    onOpened?.(local);
    onClose();
  };
  const sendWithPdf = async () => {
    if (!file) return;
    if (share) {
      try {
        await navigator.share({ files: [file], text, title });
        done();
      } catch (e) {
        if ((e as DOMException).name !== 'AbortError') toast('error', 'Sharing failed', 'Use “Download PDF” and attach it in WhatsApp.');
      }
      return;
    }
    saveFile(file);
    window.open(waLink(local, text), '_blank', 'noopener');
    toast('info', 'PDF downloaded', `Attach ${file.name} in the WhatsApp chat, then press Send.`);
    done();
  };

  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="wa">
        <div className="wa__form">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 16 }}>{title}</h2>
            <button className="icon-btn sm" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          <Field label={`WhatsApp number of ${name}`} required htmlFor="wanum" error={!valid ? 'Enter a 10-digit Indian mobile number' : undefined}>
            <div className="input-group">
              <span className="input-prefix" style={{ fontSize: 13 }}>+91</span>
              <input id="wanum" className="input num" style={{ paddingLeft: 44 }} value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d ]/g, ''))} />
            </div>
          </Field>
          <Field label="Message" htmlFor="watext" hint="You can edit before sending. *text* shows bold, _text_ italic.">
            <textarea id="watext" className="textarea mono" rows={11} style={{ fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {pdf && (
            <div className="callout info" style={{ marginTop: 4 }}>
              <FileText />
              <span>
                {file ? <><strong>{file.name}</strong> · {Math.max(1, Math.round(file.size / 1024))} KB — attached when you send.</> : pdfError || <><span className="spinner" /> Preparing the PDF…</>}
              </span>
            </div>
          )}
        </div>
        <div className="wa__phone" aria-label="Preview">
          <div className="wa__bar">
            <span className="wa__avatar">{name.slice(0, 1)}</span>
            <div>
              <strong>{name}</strong>
              <small>+91 {local.replace(/(\d{5})(\d{5})/, '$1 $2')}</small>
            </div>
          </div>
          <div className="wa__chat">
            {file && (
              <div className="wa__bubble" style={{ marginBottom: 6 }}>
                <span className="row" style={{ gap: 8 }}><FileText size={18} /> <strong>{file.name}</strong></span>
              </div>
            )}
            <div className="wa__bubble">
              <WaText text={text} />
              <span className="wa__time">{new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="modal__foot" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center', maxWidth: 360 }}>
          {pdf
            ? share ? 'Choose WhatsApp in the share window; the PDF and message go together. Press Send in WhatsApp.' : 'The PDF downloads and the chat opens with the message. Drag the PDF into the chat, then press Send.'
            : 'WhatsApp opens with this message ready. Press Send in WhatsApp.'}
        </span>
        <div className="row" style={{ gap: 8 }}>
          {file && <button className="btn btn-secondary" onClick={() => saveFile(file)}><FileDown /> Download PDF</button>}
          <a className={`btn ${pdf ? 'btn-secondary' : 'btn-whatsapp'} ${valid ? '' : 'is-disabled'}`} href={valid ? waLink(local, text) : undefined} target="_blank" rel="noreferrer"
            aria-disabled={!valid} onClick={(e) => { if (!valid) return e.preventDefault(); done(); }}>
            <MessageCircle /> {pdf ? 'Text only' : 'Open WhatsApp'}
          </a>
          {pdf && (
            <button className="btn btn-whatsapp" disabled={!file || (!share && !valid)} onClick={sendWithPdf}>
              <Send /> {share ? 'Share PDF on WhatsApp' : 'Send PDF + message'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
