import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BadgeIndianRupee, Ban, BookOpen, Briefcase, CalendarDays, ChevronRight, ClipboardCheck, ClipboardList, FileSpreadsheet, FileText, History, IndianRupee,
  Layers, LineChart, Printer, Receipt, Search, ShieldCheck, TrendingUp, UserCog, Users, Wallet, type LucideIcon,
} from 'lucide-react';
import { errText, useApp } from '../app/AppContext';
import { Empty, LoadError, PageHeader, Pagination, Segmented, SkeletonRows, pager, usePage } from '../components/ui';
import { download, useQuery } from '../api/client';
import { date, dateTime, iso, money } from '../lib/format';
import NotFound from './NotFound';

interface Col { key: string; label: string; type: 'text' | 'int' | 'money' | 'date' | 'datetime' }
interface ReportMeta { slug: string; name: string; group: string; description: string; note: string | null; columns: Col[]; filters: string[]; exports: string[] }
interface ReportData extends ReportMeta { items: Record<string, string | number | null>[]; totals: Record<string, string>; page: number; page_size: number; total: number; pages: number }

const ICONS: Record<string, LucideIcon> = {
  'student-list': Users, 'course-wise': BookOpen, 'batch-wise': Layers, 'fee-collection': IndianRupee, 'pending-fee': BadgeIndianRupee,
  'payment-history': History, 'daily-collection': CalendarDays, expense: Receipt, 'service-income': Briefcase, 'daily-cash': Wallet,
  'monthly-income': TrendingUp, pnl: LineChart, 'staff-collection': UserCog, 'staff-activity': ClipboardList, 'deleted-records': ShieldCheck,
  'daily-service': CalendarDays, 'monthly-service': TrendingUp, 'service-revenue': BadgeIndianRupee, 'customer-history': Users,
  'pending-jobs': ClipboardList, 'completed-jobs': ClipboardCheck, 'staff-service': UserCog, 'service-payment': Wallet, 'cancelled-bills': Ban,
  'service-profit': LineChart,
};
const GROUPS = ['Students & fees', 'Finance', 'Staff & audit', 'Services'];

export function ReportsCenter() {
  const [q, setQ] = useState('');
  const { data, error } = useQuery<ReportMeta[]>('/reports');
  const list = (data ?? []).filter((r) => !q || (r.name + r.description).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader
        title="Reports"
        sub={`${data?.length ?? 25} reports — view on screen, print or export to Excel.`}
        crumbs={[['Reports']]}
        actions={<div className="input-group" style={{ width: 280 }}><Search /><input className="input" placeholder="Find a report…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a report" /></div>}
      />
      {error ? <LoadError error={error} /> : !data ? <SkeletonRows rows={6} cols={2} /> : list.length === 0 ? (
        <section className="panel"><Empty icon={<FileText />} title="No report matches" body="Try “fee”, “service” or “expense”." /></section>
      ) : (
        <div className="report-groups">
          {GROUPS.map((g) => {
            const items = list.filter((r) => r.group === g);
            if (!items.length) return null;
            return (
              <section className="panel" key={g}>
                <div className="panel__head"><h2>{g}</h2><span className="muted" style={{ fontSize: 12 }}>{items.length} reports</span></div>
                {items.map((r) => {
                  const Icon = ICONS[r.slug] ?? FileText;
                  return (
                    <Link key={r.slug} to={`/reports/${r.slug}`} className="report-link">
                      <span className="ri"><Icon /></span>
                      <span><strong>{r.name}</strong><small>{r.description}</small></span>
                      <ChevronRight className="go" />
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

type Range = '7' | '30' | '90' | '365';
const fromFor = (r: Range) => iso(new Date(Date.now() - (Number(r) - 1) * 86400000));

function cell(v: string | number | null, type: Col['type']) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'money') return money(v);
  if (type === 'date') return date(String(v));
  if (type === 'datetime') return dateTime(String(v));
  return v;
}

export function ReportViewer() {
  const { slug } = useParams();
  const { toast } = useApp();
  const [range, setRange] = useState<Range>('30');
  const [page, setPage] = usePage([range, slug]);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useQuery<ReportData>(`/reports/${slug}`, { date_from: fromFor(range), page, page_size: 15 });
  if (error?.status === 404) return <NotFound what="report" />;
  if (error) return <LoadError error={error} retry={reload} />;
  if (loading || !data) return <SkeletonRows rows={10} cols={5} />;
  const dated = data.filters.includes('date_from');
  const exportXlsx = async () => {
    setBusy(true);
    try {
      await download(`/reports/${slug}/export.xlsx`, { date_from: fromFor(range) });
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data.name}
        sub={data.description}
        crumbs={[['Reports', '/reports'], [data.name]]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => window.print()}><Printer /> Print / Save PDF</button>
            <button className="btn btn-primary" onClick={exportXlsx} disabled={busy}>{busy ? <span className="spinner" /> : <FileSpreadsheet />} Excel</button>
          </>
        }
      />
      {data.note && <div className="callout info" style={{ marginBottom: 14 }}><FileText /> <span>{data.note}</span></div>}
      <section className="panel">
        <div className="table-toolbar">
          {dated ? (
            <>
              <span className="field__label">Period</span>
              <Segmented value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
              <span className="muted" style={{ fontSize: 12.5 }}>{date(fromFor(range))} – {date(new Date())}</span>
            </>
          ) : <span className="muted" style={{ fontSize: 12.5 }}>Current position</span>}
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{data.total} rows</span>
        </div>
        {data.items.length === 0 ? (
          <Empty icon={<FileText />} title="No data for this period" body={dated ? 'Choose a longer period to see results.' : 'Nothing to show yet.'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{data.columns.map((c) => <th key={c.key} className={c.type === 'money' || c.type === 'int' ? 'ta-r' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.items.map((row, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td key={c.key} className={c.type === 'money' || c.type === 'int' ? 'ta-r num' : ''} style={c.type === 'money' ? { fontWeight: 600 } : undefined}>{cell(row[c.key], c.type)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(data.totals).length > 0 && (
                  <tfoot>
                    <tr>{data.columns.map((c, k) => <td key={c.key} className={c.type === 'money' ? 'ta-r num' : ''}>{k === 0 ? 'Total' : data.totals[c.key] !== undefined ? money(data.totals[c.key]) : ''}</td>)}</tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="rows" />
          </>
        )}
      </section>
    </>
  );
}
