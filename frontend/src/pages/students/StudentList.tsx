import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Eye, IndianRupee, MessageCircle, Pencil, RotateCcw, SearchX, Trash2, UserPlus, Users, Search } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import {
  Confirm, Empty, FeeStateBadge, Field, LoadError, Menu, PageHeader, Pagination, Person, Progress, SkeletonRows, StatusDot, pager, useDebounced, usePage,
} from '../../components/ui';
import { api, download, useQuery, write, type Page } from '../../api/client';
import type { Course, StudentRow, TimeSlot } from '../../api/types';
import { date, money, n } from '../../lib/format';
import { feeReminderText, waLink } from '../../lib/whatsapp';

export default function StudentList() {
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [course, setCourse] = useState(params.get('course') ?? '');
  const [batch, setBatch] = useState(params.get('batch') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [fee, setFee] = useState('');
  const [del, setDel] = useState<StudentRow | null>(null);
  const [reason, setReason] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, course, batch, status, fee]);
  const { data: courses } = useQuery<Course[]>('/courses');
  const { data: slots } = useQuery<TimeSlot[]>('/time-slots', { course_id: course });
  const filters = { q: dq, course_id: course, time_slot_id: batch, status, fee_status: fee };
  const { data, error, loading, reload } = useQuery<Page<StudentRow> & { counts: { total: number; active: number } }>('/students', { ...filters, page, page_size: 12 });
  const filtered = !!(q || course || batch || status || fee);
  const reset = () => {
    setQ('');
    setCourse('');
    setBatch('');
    setStatus('');
    setFee('');
  };

  return (
    <>
      <PageHeader
        title="Students"
        sub={data ? `${data.counts.total} students · ${data.counts.active} active` : ' '}
        crumbs={[['Students']]}
        actions={
          <>
            {can('reports.view') && (
              <button className="btn btn-secondary" onClick={() => download('/reports/student-list/export.xlsx', { course_id: course, time_slot_id: batch, student_status: status, q: dq }).catch((e) => toast('error', errText(e)))}>
                <Download /> Export
              </button>
            )}
            {can('students.create') && (
              <Link className="btn btn-primary" to="/enquiries/new">
                <UserPlus /> New enquiry
              </Link>
            )}
          </>
        }
      />

      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Name, mobile, Student ID or Aadhaar (12 digits / last 4)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          </div>
          <select className="select" value={course} onChange={(e) => { setCourse(e.target.value); setBatch(''); }} aria-label="Course">
            <option value="">All courses</option>
            {courses?.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
          <select className="select" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch">
            <option value="">All batches</option>
            {slots?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {['Active', 'Completed', 'Left'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="select" value={fee} onChange={(e) => setFee(e.target.value)} aria-label="Fee status">
            <option value="">Any fee status</option>
            <option value="Overdue">Overdue</option>
            <option value="Due Today">Due today</option>
            <option value="Pending">Balance pending</option>
            <option value="Fully Paid">Fully paid</option>
          </select>
          {filtered && (
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              <RotateCcw /> Reset
            </button>
          )}
        </div>

        {error ? (
          <LoadError error={error} retry={reload} />
        ) : loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : data!.items.length === 0 ? (
          filtered ? (
            <Empty icon={<SearchX />} title="No students match these filters" body="Try a different name or mobile number, or reset the filters." action={<button className="btn btn-secondary" onClick={reset}><RotateCcw /> Reset filters</button>} />
          ) : (
            <Empty icon={<Users />} title="No students yet" body="Create an enquiry to begin the admission process." action={can('students.create') ? <Link className="btn btn-primary" to="/enquiries/new"><UserPlus /> New enquiry</Link> : undefined} />
          )
        ) : (
          <>
            <div className="table-wrap responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Mobile</th>
                    <th>Course & batch</th>
                    <th>Admitted</th>
                    <th style={{ minWidth: 150 }}>Fee paid</th>
                    <th className="ta-r">Balance</th>
                    <th>Status</th>
                    <th className="ta-r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.items.map((s) => {
                    const bal = n(s.balance);
                    return (
                      <tr key={s.code} className="is-clickable" onClick={() => nav(`/students/${s.code}`)}>
                        <td><Person name={s.full_name} sub={s.code} /></td>
                        <td className="num">{s.mobile}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.course.code}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{s.time_slot.name}</div>
                        </td>
                        <td>{date(s.admission_date)}</td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Progress value={s.paid_pct} tone={s.fee_state === 'Overdue' ? 'danger' : s.paid_pct === 100 ? 'success' : ''} />
                            <span className="num muted" style={{ fontSize: 12, minWidth: 32 }}>{s.paid_pct}%</span>
                          </div>
                          <div style={{ marginTop: 4 }}><FeeStateBadge s={s.fee_state} /></div>
                        </td>
                        <td className="ta-r num" style={{ fontWeight: 700, color: bal ? undefined : 'var(--ink-3)' }}>{money(bal)}</td>
                        <td><StatusDot s={s.status} /></td>
                        <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                          <div className="actions">
                            {can('fees.collect') && bal > 0 ? (
                              <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${s.code}`}><IndianRupee /> Collect</Link>
                            ) : (
                              <Link className="btn btn-ghost btn-sm" to={`/students/${s.code}`}>View</Link>
                            )}
                            <RowMenu s={s} onDelete={() => { setReason(''); setDel(s); }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-list">
              {data!.items.map((s) => (
                <Link key={s.code} to={`/students/${s.code}`} className="m-card">
                  <div className="m-card__row">
                    <Person name={s.full_name} sub={`${s.code} · ${s.course.code}`} />
                    <StatusDot s={s.status} />
                  </div>
                  <div className="m-card__row">
                    <FeeStateBadge s={s.fee_state} />
                    <span className="num" style={{ fontWeight: 700 }}>{money(s.balance)} due</span>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination {...pager(data, setPage)} noun="students" />
          </>
        )}
      </section>

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Archive ${del?.full_name}?`}
        body="The student moves to Deleted History. Payments and receipts are kept for audit and reports."
        confirmLabel="Archive student"
        disabled={reason.trim().length < 5}
        onConfirm={async () => {
          try {
            await write(api(`/students/${del!.code}/archive`, { method: 'POST', body: { reason } }));
            toast('success', 'Student moved to Deleted History', `${del?.full_name} (${del?.code})`);
            setDel(null);
          } catch (e) {
            toast('error', errText(e));
          }
        }}
      >
        <Field label="Reason" required hint="Minimum 5 characters — kept in the audit log" htmlFor="arch">
          <textarea id="arch" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Confirm>
    </>
  );
}

function RowMenu({ s, onDelete }: { s: StudentRow; onDelete: () => void }) {
  const { can } = useApp();
  const nav = useNavigate();
  return (
    <Menu>
      <button className="menu__item" onClick={() => nav(`/students/${s.code}`)}>
        <Eye /> View profile
      </button>
      {can('students.edit') && (
        <button className="menu__item" onClick={() => nav(`/students/${s.code}?edit=1`)}>
          <Pencil /> Edit details
        </button>
      )}
      {s.next_due && (
        <a className="menu__item" href={waLink(s.mobile, feeReminderText(s.full_name, s.next_due.amount, s.next_due.due_date, s.balance))} target="_blank" rel="noreferrer">
          <MessageCircle /> WhatsApp reminder
        </a>
      )}
      {can('students.delete') && (
        <>
          <div className="menu__sep" />
          <button className="menu__item danger" onClick={onDelete}>
            <Trash2 /> Archive student
          </button>
        </>
      )}
    </Menu>
  );
}
