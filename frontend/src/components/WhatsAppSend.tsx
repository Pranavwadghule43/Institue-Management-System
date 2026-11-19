import { Fragment, useCallback, useEffect, useState } from 'react';
import { FileDown, FileText, MessageCircle, Share2, X } from 'lucide-react';
import { useApp } from '../app/AppContext';
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

export type PdfShareEvent = 'NATIVE_PDF_SHARE_OPENED' | 'WHATSAPP_OPENED';

export function WhatsAppSend({
  open, onClose, title, name, phone, message, pdf, onShared, automaticPath, recordLabel = 'record',
}: {
  open: boolean; onClose: () => void; title: string; name: string; phone: string | null | undefined; message: string; pdf: () => Promise<File>;
  onShared?: (event: PdfShareEvent) => void; recordLabel?: string; automaticPath?: string;
}) {
  const { user } = useApp();
  const [num, setNum] = useState(phone ?? '');
  const [text, setText] = useState(message);
  const [file, setFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [opened, setOpened] = useState<{ blocked: boolean } | null>(null);
  const [native, setNative] = useState<'ready' | 'sharing' | 'opened' | 'failed'>('ready');
  const [manual, setManual] = useState<{ notice?: string } | null>(null);
  const showManual = useCallback((notice?: string) => setManual({ notice }), []);
  const automatic = !!automaticPath && user.whatsappDocumentDelivery && !manual;
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
    setNative('ready');
    let live = true;
    pdf().then((f) => live && setFile(f)).catch(() => live && setPdfError('The PDF could not be created. Reopen sharing to try again.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, automatic]);
  const { local, problem } = waNumber(num);
  const valid = !problem;
  const nativePdf = file ? { files: [file], text, title } : undefined;
  const supportsNative = nativePdf && typeof navigator.share === 'function' && navigator.canShare?.(nativePdf);
  const registered = waNumber(phone).local;
  const changed = valid && registered !== local;
  const link = valid ? waLink(local, text) : undefined;
  const shown = `+91 ${local.replace(/(\d{5})(\d{5})/, '$1 $2')}`;
  const numError = problem === 'missing'
    ? `No WhatsApp number is saved for ${name}. Type it here, or add it to the ${recordLabel}.`
    : problem === 'invalid' ? 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.' : undefined;

  const recordOpen = () => {
    setOpened({ blocked: false });
    onShared?.('WHATSAPP_OPENED');
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
  const saveAndOpenChat = () => {
    if (!file || !valid) return;
    saveFile(file);
    openChat();
  };
  const shareOnDevice = async () => {
    if (!supportsNative || native === 'sharing' || native === 'opened') return;
    setNative('sharing');
    try {
      // Call share during the click. Rendering the PDF first could consume user activation.
      await navigator.share(nativePdf);
      setNative('opened');
      onShared?.('NATIVE_PDF_SHARE_OPENED');
    } catch (error) {
      setNative(error instanceof Error && error.name === 'AbortError' ? 'ready' : 'failed');
    }
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
          {native === 'opened' ? (
            <div className="callout info" role="status">
              <Share2 />
              <span>Device share window opened with the PDF. Finish sending in WhatsApp.</span>
            </div>
          ) : opened ? (
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
                {file && (
                  <li className="is-done"><strong>PDF download started</strong> for <span className="mono">{file.name}</span></li>
                )}
                {file && (
                  <li>In the chat, choose <strong>Attach document</strong> and select <span className="mono">{file.name}</span> from Downloads.</li>
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
                <textarea id="watext" className="textarea mono" rows={9} style={{ fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className={`callout ${pdfError ? 'warning' : 'info'}`} style={{ marginTop: 4 }}>
                <FileText />
                <span>
                  {file ? <><strong>{file.name}</strong> · {Math.max(1, Math.round(file.size / 1024))} KB ready.</> : pdfError || <><span className="spinner" /> Preparing the PDF…</>}
                </span>
              </div>
              {supportsNative && <p className="muted">Choose WhatsApp and select the recipient in the device share window.</p>}
              {native === 'failed' && <p role="alert">Device sharing failed. Open the chat and save the PDF to attach it in WhatsApp.</p>}
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
        {native === 'opened' ? (
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        ) : opened ? (
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
              <button className={`btn ${supportsNative ? 'btn-secondary' : 'btn-whatsapp'}`} disabled={!file || !valid || native === 'sharing'} onClick={saveAndOpenChat}>
                <MessageCircle /> Open chat &amp; save PDF
              </button>
              {supportsNative && (
                <button className="btn btn-whatsapp" disabled={native === 'sharing'} onClick={shareOnDevice}>
                  <Share2 /> Share PDF on WhatsApp
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
