import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Eye, IndianRupee, MessageCircle, Pencil, Printer, RotateCcw, Search, SearchX, Trash2, UserPlus, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import {
  Confirm, Empty, FeeStateBadge, Menu, PageHeader, Pagination, Person, Progress, SkeletonRows, StatusDot, useDebounced, useLoading, usePaged,
} from '../../components/ui';
import { balanceFor, db, feeState, netFee, nextDue, paidFor, studentPayments, useStore } from '../../data/store';
import { date, money, pct } from '../../lib/format';
import { feeReminderText, waLink } from '../../lib/whatsapp';
import type { Student } from '../../data/types';

export default function StudentList() {
  useStore();
  const { can, toast } = useApp();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [course, setCourse] = useState(params.get('course') ?? '');
  const [batch, setBatch] = useState(params.get('batch') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [fee, setFee] = useState('');
  const [del, setDel] = useState<Student | null>(null);
  const dq = useDebounced(q);
  const loading = useLoading(500);

  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return [...db.students]
      .reverse()
      .filter((x) => !s || x.name.toLowerCase().includes(s) || x.id.toLowerCase().includes(s) || x.phone.replace(/\s/g, '').includes(s.replace(/\s/g, '')) || x.fatherName.toLowerCase().includes(s) || (s.replace(/\s/g, '').length >= 4 && /^\d+$/.test(s.replace(/\s/g, '')) && x.aadhaar.replace(/\s/g, '').includes(s.replace(/\s/g, ''))))
      .filter((x) => !course || x.courseId === course)
      .filter((x) => !batch || x.batchId === batch)
      .filter((x) => !status || x.status === status)
      .filter((x) => !fee || feeState(x) === fee || (fee === 'Pending' && feeState(x) !== 'Fully Paid'));
  }, [dq, course, batch, status, fee, db.students.length]);
  const pg = usePaged(rows, 12);
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
        sub={`${db.students.length} students · ${db.students.filter((s) => s.status === 'Active').length} active`}
        crumbs={[['Students']]}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => toast('success', 'Export ready', `${rows.length} students exported to Excel`)}>
              <Download /> Export
            </button>
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
            <input className="input" placeholder="Name, mobile, Aadhaar or Student ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" />
          </div>
          <select className="select" value={course} onChange={(e) => { setCourse(e.target.value); setBatch(''); }} aria-label="Course">
            <option value="">All courses</option>
            {db.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          <select className="select" value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch">
            <option value="">All batches</option>
            {db.batches.filter((b) => !course || b.courseId === course).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {['Active', 'Completed', 'Left'].map((s) => (
              <option key={s}>{s}</option>
            ))}
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

        {loading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : rows.length === 0 ? (
          filtered ? (
            <Empty icon={<SearchX />} title="No students match these filters" body="Try a different name or mobile number, or reset the filters." action={<button className="btn btn-secondary" onClick={reset}><RotateCcw /> Reset filters</button>} />
          ) : (
            <Empty icon={<Users />} title="No students yet" body="Create an enquiry to begin the admission process." action={<Link className="btn btn-primary" to="/enquiries/new"><UserPlus /> New enquiry</Link>} />
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
                  {pg.slice.map((s) => {
                    const paid = paidFor(s);
                    const p = pct(paid, netFee(s));
                    const fs = feeState(s);
                    const bal = balanceFor(s);
                    return (
                      <tr key={s.id} className="is-clickable" onClick={() => nav(`/students/${s.id}`)}>
                        <td>
                          <Person name={s.name} sub={s.id} />
                        </td>
                        <td className="num">{s.phone}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{db.courseById(s.courseId).code}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {db.batchById(s.batchId).name}
                          </div>
                        </td>
                        <td>{date(s.admissionDate)}</td>
                        <td>
                          <div className="row" style={{ gap: 8 }}>
                            <Progress value={p} tone={fs === 'Overdue' ? 'danger' : p === 100 ? 'success' : ''} />
                            <span className="num muted" style={{ fontSize: 12, minWidth: 32 }}>
                              {p}%
                            </span>
                          </div>
                          <div style={{ marginTop: 4 }}>
                            <FeeStateBadge s={fs} />
                          </div>
                        </td>
                        <td className="ta-r num" style={{ fontWeight: 700, color: bal ? undefined : 'var(--ink-3)' }}>
                          {money(bal)}
                        </td>
                        <td>
                          <StatusDot s={s.status} />
                        </td>
                        <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                          <div className="actions">
                            {can('fees.collect') && bal > 0 ? (
                              <Link className="btn btn-secondary btn-sm" to={`/fees/collect?student=${s.id}`}>
                                <IndianRupee /> Collect
                              </Link>
                            ) : (
                              <Link className="btn btn-ghost btn-sm" to={`/students/${s.id}`}>
                                View
                              </Link>
                            )}
                            <RowMenu s={s} onDelete={() => setDel(s)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-list">
              {pg.slice.map((s) => (
                <Link key={s.id} to={`/students/${s.id}`} className="m-card">
                  <div className="m-card__row">
                    <Person name={s.name} sub={`${s.id} · ${db.courseById(s.courseId).code}`} />
                    <StatusDot s={s.status} />
                  </div>
                  <div className="m-card__row">
                    <FeeStateBadge s={feeState(s)} />
                    <span className="num" style={{ fontWeight: 700 }}>
                      {money(balanceFor(s))} due
                    </span>
                  </div>
                </Link>
              ))}
            </div>
            <Pagination {...pg} noun="students" />
          </>
        )}
      </section>

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Delete ${del?.name}?`}
        body="The student will be moved to Deleted History. Payments and receipts are preserved for audit and can still be reported on."
        confirmLabel="Delete student"
        onConfirm={() => {
          toast('success', 'Student moved to Deleted History', `${del?.name} (${del?.id})`);
          setDel(null);
        }}
      />
    </>
  );
}

function RowMenu({ s, onDelete }: { s: Student; onDelete: () => void }) {
  const { can, toast } = useApp();
  const nav = useNavigate();
  const last = studentPayments(s)[0];
  const n = nextDue(s);
  return (
    <Menu>
      <button className="menu__item" onClick={() => nav(`/students/${s.id}`)}>
        <Eye /> View profile
      </button>
      {can('students.edit') && (
        <button className="menu__item" onClick={() => toast('info', 'Edit student', 'Opens the admission form pre-filled for editing.')}>
          <Pencil /> Edit details
        </button>
      )}
      {last && (
        <button className="menu__item" onClick={() => nav(`/fees/receipts/${last.receiptNo}`)}>
          <Printer /> Last receipt <span className="meta">{last.receiptNo.slice(-5)}</span>
        </button>
      )}
      {n && (
        <a className="menu__item" href={waLink(s.phone, feeReminderText(s.name, n.remaining, n.due, balanceFor(s)))} target="_blank" rel="noreferrer">
          <MessageCircle /> WhatsApp reminder
        </a>
      )}
      {can('students.delete') && (
        <>
          <div className="menu__sep" />
          <button className="menu__item danger" onClick={onDelete}>
            <Trash2 /> Delete student
          </button>
        </>
      )}
    </Menu>
  );
}
