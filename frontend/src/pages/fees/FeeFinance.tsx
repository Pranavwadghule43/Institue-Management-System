import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, FileDown, IndianRupee, MessageCircle, Printer, Search, SearchX, Undo2 } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import {
  Badge, Confirm, Empty, Field, LoadError, Modal, PageHeader, Pagination, Person, Segmented, SkeletonRows, Tabs, pager, useDebounced, usePage,
} from '../../components/ui';
import { api, download, useQuery, write, type Page } from '../../api/client';
import type { PayMode, Payment, Receipt } from '../../api/types';
import { PAY_LABEL, PAY_MODES } from '../../lib/payModes';
import { date, iso, money, relDays } from '../../lib/format';
import { feeReminderText, receiptMessage, waLink } from '../../lib/whatsapp';
import { WhatsAppSend } from '../../components/WhatsAppSend';
import { FeeReceiptPrint, PrintArea, receiptPdf, receiptPrintData } from '../../components/PrintDocs';
import { saveFile } from '../../lib/pdf';
import { PaymentsTable } from '../students/StudentProfile';
import NotFound from '../NotFound';

/* ------------------------------ Payment history / receipts ------------------------------ */

type Range = 'today' | '7' | '30' | 'all';
const rangeFrom = (r: Range) => {
  if (r === 'all') return '';
  const d = new Date();
  d.setDate(d.getDate() - (r === 'today' ? 0 : Number(r) - 1));
  return iso(d);
};
interface PaymentsPage extends Page<Payment> { totals: { collected: string; receipts: number; by_mode: { mode: PayMode; label: string; amount: string; count: number }[] } }

export function PaymentHistory({ receipts }: { receipts?: boolean }) {
  const { can, toast } = useApp();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<Range>(receipts ? '30' : '7');
  const [mode, setMode] = useState<'' | PayMode>('');
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, range, mode]);
  const query = { q: dq, mode, date_from: rangeFrom(range), status: receipts ? 'Valid' : undefined };
  const { data, error, loading, reload } = useQuery<PaymentsPage>('/fees/payments', { ...query, page, page_size: 12 });
  const total = Number(data?.totals.collected ?? 0);

  return (
    <>
      <PageHeader
        title={receipts ? 'Receipts' : 'Payment history'}
        sub={receipts ? 'Every fee receipt issued — reprint or share on WhatsApp.' : 'All student fee payments, including reversed entries kept for audit.'}
        crumbs={[['Student Finance'], [receipts ? 'Receipts' : 'Payment history']]}
        actions={can('reports.view') ? (
          <button className="btn btn-secondary" onClick={() => download(`/reports/${receipts ? 'fee-collection' : 'payment-history'}/export.xlsx`, { date_from: query.date_from || '2000-01-01', payment_mode: mode }).catch((e) => toast('error', errText(e)))}>
            <Download /> Export
          </button>
        ) : undefined}
      />
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="ledger-sum">
          <div>
            <span>Total collected</span>
            <strong>{money(total)}</strong>
            <div className="muted" style={{ fontSize: 12 }}>{data?.totals.receipts ?? 0} receipts</div>
          </div>
          {data?.totals.by_mode.slice(0, 3).map((m) => (
            <div key={m.mode}>
              <span>{m.label}</span>
              <strong>{money(m.amount)}</strong>
              <div className="muted" style={{ fontSize: 12 }}>{total ? Math.round((Number(m.amount) / total) * 100) : 0}% of total</div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Receipt no, student name or ID…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" />
          </div>
          <Segmented value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: 'all', label: 'All' }]} />
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as PayMode | '')} aria-label="Payment mode">
            <option value="">All modes</option>
            {PAY_MODES.map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
          </select>
        </div>
        {error ? <LoadError error={error} retry={reload} /> : loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : data!.items.length === 0 ? (
          <Empty icon={<SearchX />} title="No payments found" body="No payments match this period or search. Try a wider date range." />
        ) : (
          <>
            <PaymentsTable rows={data!.items} showStudent />
            <Pagination {...pager(data, setPage)} noun={receipts ? 'receipts' : 'payments'} />
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------ Receipt (UX-009): printed from the immutable snapshot ------------------------------ */

export function ReceiptView() {
  const { no } = useParams();
  const { role, toast } = useApp();
  const [rev, setRev] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [wa, setWa] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { data: r, error, loading } = useQuery<Receipt>(`/receipts/${no}`);
  if (error?.status === 404) return <NotFound what="receipt" />;
  if (error) return <LoadError error={error} />;
  if (loading || !r) return <SkeletonRows rows={6} cols={3} />;
  const s = r.snapshot;
  const doc = receiptPrintData(r);
  const savePdf = async () => {
    setPdfBusy(true);
    try {
      saveFile(await receiptPdf(r));
    } catch (e) {
      toast('error', 'PDF could not be created', errText(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`Receipt ${r.receipt_no}`}
        crumbs={[['Student Finance'], ['Receipts', '/fees/receipts'], [r.receipt_no]]}
        actions={
          <>
            {role === 'Admin' && r.status === 'Valid' && <button className="btn btn-danger-soft" onClick={() => { setReason(''); setRev(true); }}><Undo2 /> Reverse</button>}
            {r.status === 'Valid' && <button className="btn btn-whatsapp" onClick={() => setWa(true)}><MessageCircle /> Send on WhatsApp</button>}
            <button className="btn btn-secondary" onClick={savePdf} disabled={pdfBusy}>{pdfBusy ? <span className="spinner" /> : <FileDown />} Download PDF</button>
            <button className="btn btn-primary" onClick={() => window.print()}><Printer /> Print</button>
          </>
        }
      />
      {r.status === 'Reversed' && (
        <div className="callout danger no-print" style={{ marginBottom: 16 }}>
          <Undo2 /> <span>Reversed on {date(r.reversed_at!)} — {r.reversal_reason}. The receipt below is the original as issued.</span>
        </div>
      )}
      <FeeReceiptPrint r={doc} />
      <PrintArea>
        <FeeReceiptPrint r={doc} />
      </PrintArea>

      <WhatsAppSend
        open={wa}
        onClose={() => setWa(false)}
        title={`Send receipt ${r.receipt_no}`}
        name={s.student.name}
        phone={r.send_to?.whatsapp_number ?? s.student.mobile}
        recordLabel="student’s profile"
        message={receiptMessage(s)}
        pdf={() => receiptPdf(r)}
        automaticPath={r.status === 'Valid' ? `/receipts/${r.receipt_no}/whatsapp-delivery` : undefined}
        onOpened={() => {
          api(`/receipts/${r.receipt_no}/share-events`, { method: 'POST', body: { event_type: 'WHATSAPP_OPENED' } }).catch(() => {});
          toast('success', 'WhatsApp opened', `Receipt ready to send to ${s.student.name}`);
        }}
      />

      <Confirm
        open={rev}
        onClose={() => setRev(false)}
        tone="danger"
        icon={<Undo2 />}
        title={`Reverse ${money(s.payment.amount)} from ${s.student.name}?`}
        body="The receipt stays in history marked REVERSED and the amount is added back to the student’s balance. This is recorded in the audit log."
        confirmLabel="Reverse payment"
        busy={busy}
        disabled={reason.trim().length < 5}
        onConfirm={async () => {
          setBusy(true);
          try {
            await write(api(`/fees/payments/${r.payment_id}/reverse`, { method: 'POST', body: { reason: reason.trim() } }));
            setRev(false);
            toast('success', 'Payment reversed', `${r.receipt_no} · balance updated`);
          } catch (e) {
            toast('error', errText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Reason for reversal" required hint="Minimum 5 characters — shown in the audit log" htmlFor="rr">
          <textarea id="rr" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Confirm>
    </>
  );
}

/* ------------------------------ Fee reminders (UX-010) ------------------------------ */

type RTab = 'today' | 'tomorrow' | 'overdue' | 'pending' | 'fully_paid';
const TAB_LABEL: Record<RTab, string> = { today: 'Due today', tomorrow: 'Due tomorrow', overdue: 'Overdue', pending: 'Pending', fully_paid: 'Fully Paid' };
interface ReminderRow {
  student: { code: string; name: string; mobile: string; whatsapp_number: string | null }; course: { id: number; code: string }; next_due_date: string | null;
  installment_due: string; balance: string; total_paid: string; fee_state: string; overdue_days: number; last_reminded_at: string | null;
}
interface ReminderPage extends Page<ReminderRow> { counts: Record<RTab, number>; total_due: string }

export function FeeReminders() {
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const initial = (params.get('tab') ?? 'overdue').toLowerCase() as RTab;
  const [tab, setTab] = useState<RTab>(initial in TAB_LABEL ? initial : 'overdue');
  const [preview, setPreview] = useState<{ row: ReminderRow; text: string } | null>(null);
  const [page, setPage] = usePage([tab]);
  const { data, error, loading, reload } = useQuery<ReminderPage>('/fees/reminders', { tab, page, page_size: 12 });
  const list = data?.items ?? [];

  return (
    <>
      <PageHeader title="Fee reminders" sub="Open WhatsApp with a ready message — nothing is sent automatically." crumbs={[['Student Finance'], ['Fee reminders']]} />
      <section className="panel">
        <div style={{ padding: '0 8px' }}>
          <Tabs value={tab} onChange={setTab} tabs={(Object.keys(TAB_LABEL) as RTab[]).map((t) => ({ value: t, label: TAB_LABEL[t], count: data?.counts[t], alert: t === 'overdue' }))} />
        </div>
        {tab !== 'fully_paid' && list.length > 0 && (
          <div className="table-toolbar" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>
              <strong>{data!.total}</strong> students · <strong className="num">{money(data!.total_due)}</strong> due in this list
            </span>
            <span className="muted" style={{ fontSize: 12 }}>Tip: each WhatsApp opens in a new tab with the message pre-filled.</span>
          </div>
        )}
        {error ? <LoadError error={error} retry={reload} /> : loading ? (
          <SkeletonRows rows={6} cols={6} />
        ) : list.length === 0 ? (
          <Empty icon={<IndianRupee />} title={tab === 'fully_paid' ? 'No fully paid students yet' : 'Nothing due here'} body={tab === 'today' ? 'No installments are due today. Check Overdue for older dues.' : 'All caught up for this list.'} />
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Mobile</th>
                    <th>Course</th>
                    {tab !== 'fully_paid' && <th>Due date</th>}
                    <th className="ta-r">{tab === 'fully_paid' ? 'Total paid' : 'Installment due'}</th>
                    {tab !== 'fully_paid' && <th className="ta-r">Total balance</th>}
                    <th>Last reminded</th>
                    <th className="ta-r" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.student.code} className="is-clickable" onClick={() => nav(`/students/${r.student.code}`)}>
                      <td><Person name={r.student.name} sub={r.student.code} /></td>
                      <td className="num">{r.student.mobile}</td>
                      <td>{r.course.code}</td>
                      {tab !== 'fully_paid' && (
                        <td>
                          {r.next_due_date && date(r.next_due_date)}
                          <div style={{ fontSize: 12, fontWeight: 600, color: r.overdue_days ? 'var(--danger-700)' : 'var(--ink-3)' }}>
                            {r.overdue_days ? `${r.overdue_days} days overdue` : r.next_due_date && relDays(r.next_due_date)}
                          </div>
                        </td>
                      )}
                      <td className="ta-r num" style={{ fontWeight: 700 }}>{money(tab === 'fully_paid' ? r.total_paid : r.installment_due)}</td>
                      {tab !== 'fully_paid' && <td className="ta-r num">{money(r.balance)}</td>}
                      <td>{r.last_reminded_at ? (relDays(r.last_reminded_at) === 'Today' ? <Badge tone="success" dot>Today</Badge> : <span className="muted">{relDays(r.last_reminded_at)}</span>) : <span className="muted">Never</span>}</td>
                      <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                        <div className="actions">
                          {r.next_due_date && (
                            <button className="btn btn-whatsapp btn-sm" onClick={() => setPreview({ row: r, text: feeReminderText(r.student.name, r.installment_due, r.next_due_date!, r.balance) })}>
                              <MessageCircle /> Remind
                            </button>
                          )}
                          {r.next_due_date && can('fees.collect') && <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${r.student.code}`}>Collect</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="students" />
          </>
        )}
      </section>

      <Modal open={!!preview} onClose={() => setPreview(null)}>
        {preview && (
          <>
            <div className="modal__head">
              <div className="modal__icon success"><MessageCircle /></div>
              <div>
                <h2>WhatsApp reminder</h2>
                <p>To {preview.row.student.name} · {preview.row.student.whatsapp_number || preview.row.student.mobile}</p>
              </div>
            </div>
            <div className="modal__body">
              <Field label="Message" hint="You can edit the text before opening WhatsApp" htmlFor="wamsg">
                <textarea id="wamsg" className="textarea" rows={7} value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} />
              </Field>
            </div>
            <div className="modal__foot">
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>Cancel</button>
              <a
                className="btn btn-whatsapp"
                href={waLink(preview.row.student.whatsapp_number || preview.row.student.mobile, preview.text)}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  write(api(`/fees/reminders/${preview.row.student.code}/opened-whatsapp`, { method: 'POST', body: {} })).catch((e) => toast('error', errText(e)));
                  toast('success', 'WhatsApp opened', preview.row.student.name);
                  setPreview(null);
                }}
              >
                <MessageCircle /> Open WhatsApp
              </a>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
