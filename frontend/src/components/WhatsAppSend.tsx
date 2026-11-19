import { Fragment, useCallback, useEffect, useState } from 'react';
import { FileDown, FileText, MessageCircle, Send, X } from 'lucide-react';
import { Field, Modal } from './ui';
import { waLink, waNumber } from '../lib/whatsapp';
import { saveFile } from '../lib/pdf';
import { AutomaticWhatsApp } from './AutomaticWhatsApp';

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

// Open the recipient's chat and download the file. The user attaches the PDF and sends it in WhatsApp.
export function WhatsAppSend({
  open, onClose, title, name, phone, message, pdf, onOpened, automaticPath, recordLabel = 'record',
}: {
  open: boolean; onClose: () => void; title: string; name: string; phone: string | null | undefined; message: string; pdf?: () => Promise<File>;
  onOpened?: (phone: string) => void; recordLabel?: string; automaticPath?: string;
}) {
  const [num, setNum] = useState(phone ?? '');
  const [text, setText] = useState(message);
  const [file, setFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [opened, setOpened] = useState<{ blocked: boolean } | null>(null);
  const [manual, setManual] = useState<{ notice?: string } | null>(null);
  const showManual = useCallback((notice?: string) => setManual({ notice }), []);
  const automatic = !!automaticPath && !manual;
  useEffect(() => {
    if (!open) {
      setManual(null);
      return;
    }
    if (automatic) return;
    setNum(phone ?? '');
    setText(message);
    setFile(null);
    setPdfError('');
    setOpened(null);
    if (!pdf) return;
    let live = true;
    pdf().then((f) => live && setFile(f)).catch(() => live && setPdfError('The PDF could not be created. You can still send the message as text.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, automatic]);
  const { local, problem } = waNumber(num);
  const valid = !problem;
  const registered = waNumber(phone).local;
  const changed = valid && registered !== local;
  const link = valid ? waLink(local, text) : undefined;
  const shown = `+91 ${local.replace(/(\d{5})(\d{5})/, '$1 $2')}`;
  const numError = problem === 'missing'
    ? `No WhatsApp number is saved for ${name}. Type it here, or add it to the ${recordLabel}.`
    : problem === 'invalid' ? 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' : undefined;

  const recordOpen = () => {
    setOpened({ blocked: false });
    onOpened?.(local);
  };
  const openChat = () => {
    if (!link) return;
    const chat = window.open('about:blank', '_blank');
    if (!chat) {
      setOpened({ blocked: true });
      return;
    }
    chat.opener = null;
    chat.location.replace(link);
    recordOpen();
  };
  const sendWithPdf = () => {
    if (!file || !valid) return;
    saveFile(file);
    openChat();
  };

  if (automaticPath && automatic) {
    return open ? <AutomaticWhatsApp key={automaticPath} path={automaticPath} title={title} onClose={onClose} onManual={showManual} /> : null;
  }
  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="wa">
        <div className="wa__form">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 16 }}>{title}</h2>
            <button className="icon-btn sm" onClick={onClose} aria-label="Close"><X /></button>
          </div>
          {manual?.notice && <p className="muted">{manual.notice}</p>}
          {opened ? (
            <div className="wa-steps" role="status">
              {opened.blocked ? (
                <div className="callout warning">
                  <MessageCircle />
                  <span>The browser blocked the new tab. <a href={link} target="_blank" rel="noreferrer" onClick={recordOpen}><strong>Open {name}’s chat</strong></a> to continue.</span>
                </div>
              ) : null}
              <ol className="wa-steps__list">
                <li className={opened.blocked ? '' : 'is-done'}>
                  <strong>{opened.blocked ? 'Open the chat' : 'Chat opened'}</strong> for {name} · {shown}. Check this number at the top of the WhatsApp chat.
                </li>
                {pdf && file && (
                  <li className="is-done"><strong>PDF download started</strong> for <span className="mono">{file.name}</span></li>
                )}
                {pdf && file && (
                  <li><strong>Attach it:</strong> in the chat click <strong>📎 / +</strong> → <strong>Document</strong> and choose <span className="mono">{file.name}</span> — or drag it from Downloads into the chat.</li>
                )}
                <li><strong>Press Send</strong> in WhatsApp. The message is already typed in.</li>
              </ol>
            </div>
          ) : (
            <>
              <Field label={`WhatsApp number of ${name}`} required htmlFor="wanum" error={numError}
                hint={changed && registered ? `Changed from the registered number +91 ${registered}.` : undefined}>
                <div className="input-group">
                  <span className="input-prefix" style={{ fontSize: 13 }}>+91</span>
                  <input id="wanum" type="tel" className="input num" style={{ paddingLeft: 44 }} value={num} onChange={(e) => setNum(e.target.value)} />
                </div>
              </Field>
              <Field label="Message" htmlFor="watext" hint="You can edit before sending. *text* shows bold, _text_ italic.">
                <textarea id="watext" className="textarea mono" rows={pdf ? 9 : 11} style={{ fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              {pdf && (
                <div className={`callout ${pdfError ? 'warning' : 'info'}`} style={{ marginTop: 4 }}>
                  <FileText />
                  <span>
                    {file ? <><strong>{file.name}</strong> · {Math.max(1, Math.round(file.size / 1024))} KB ready to download.</> : pdfError || <><span className="spinner" /> Preparing the PDF…</>}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="wa__phone" aria-label="Preview">
          <div className="wa__bar">
            <span className="wa__avatar">{name.slice(0, 1)}</span>
            <div>
              <strong>{name}</strong>
              <small>{valid ? shown : 'No valid number'}</small>
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
      <div className="modal__foot" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        {opened ? (
          <>
            <span />
            <div className="row" style={{ gap: 8 }}>
              {file && <button className="btn btn-secondary" onClick={() => saveFile(file)}><FileDown /> Save PDF again</button>}
              {!opened.blocked && <a className="btn btn-secondary" href={link} target="_blank" rel="noreferrer"><MessageCircle /> Open chat again</a>}
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 8 }}>
              {file && <button className="btn btn-ghost btn-sm" onClick={() => saveFile(file)}><FileDown /> Download PDF</button>}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className={`btn ${pdf ? 'btn-secondary' : 'btn-whatsapp'}`} disabled={!valid} onClick={openChat}>
                <MessageCircle /> {pdf ? 'Text only' : 'Open WhatsApp'}
              </button>
              {pdf && (
                <button className="btn btn-whatsapp" disabled={!file || !valid} onClick={sendWithPdf}>
                  <Send /> Open chat &amp; save PDF
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
