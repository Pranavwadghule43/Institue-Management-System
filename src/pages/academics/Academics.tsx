import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarRange, Clock, Pencil, Plus, Trash2, UserRound, Users } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Confirm, Drawer, Field, Menu, MoneyInput, PageHeader, Progress, Segmented, StatusDot, Switch } from '../../components/ui';
import { db, touch, useStore } from '../../data/store';
import { date, money } from '../../lib/format';
import { enrolledIn } from '../students/Admission';

export function Courses() {
  useStore();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', duration: 3, fee: '' as number | '', description: '' });
  const [submitted, setSubmitted] = useState(false);
  const errs = { code: !form.code.trim() ? 'Short code is required' : '', name: !form.name.trim() ? 'Course name is required' : '', fee: !form.fee ? 'Enter the course fee' : '' };

  return (
    <>
      <PageHeader
        title="Courses"
        sub="Fees set here are copied to each enrolment — editing a course never changes existing students’ fees."
        crumbs={[['Academics'], ['Courses']]}
        actions={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus /> Add course
          </button>
        }
      />
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Duration</th>
                <th className="ta-r">Fee</th>
                <th className="ta-r">Students</th>
                <th className="ta-r">Batches</th>
                <th>Active</th>
                <th className="ta-r" />
              </tr>
            </thead>
            <tbody>
              {db.courses.map((c) => {
                const n = db.students.filter((s) => s.courseId === c.id && s.status === 'Active').length;
                return (
                  <tr key={c.id} style={!c.active ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="row">
                        <span className="feed-item__ico" style={{ background: 'var(--primary-50)', color: 'var(--primary-600)' }}>
                          <BookOpen />
                        </span>
                        <div style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                          <div style={{ fontWeight: 600 }}>
                            {c.name} <span className="tag" style={{ marginLeft: 4 }}>{c.code}</span>
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {c.description}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{c.duration} months</td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>
                      {money(c.fee)}
                    </td>
                    <td className="ta-r num">
                      <Link to={`/students?course=${c.id}`}>{n}</Link>
                    </td>
                    <td className="ta-r num">{db.batches.filter((b) => b.courseId === c.id && b.status !== 'Completed').length}</td>
                    <td>
                      <Switch
                        on={c.active}
                        label={`${c.name} active`}
                        onChange={(v) => {
                          c.active = v;
                          touch();
                          toast('success', v ? 'Course activated' : 'Course deactivated', v ? `${c.code} is available for admissions` : `${c.code} is hidden from new admissions; existing students are unaffected`);
                        }}
                      />
                    </td>
                    <td className="ta-r">
                      <Menu>
                        <button className="menu__item" onClick={() => setOpen(true)}>
                          <Pencil /> Edit course
                        </button>
                        <div className="menu__sep" />
                        <button className="menu__item danger" onClick={() => setDel(c.id)}>
                          <Trash2 /> Delete course
                        </button>
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Add course"
        sub="Visible in admissions once active"
        foot={
          <>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(true);
                if (errs.code || errs.name || errs.fee) return;
                db.courses.push({ id: `C${db.courses.length + 1}`, code: form.code.toUpperCase(), name: form.name, duration: form.duration, fee: Number(form.fee), description: form.description, active: true });
                touch();
                toast('success', 'Course added', form.name);
                setOpen(false);
                setSubmitted(false);
                setForm({ code: '', name: '', duration: 3, fee: '', description: '' });
              }}
            >
              Save course
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Short code" required error={submitted ? errs.code : ''} htmlFor="cc">
            <input id="cc" className="input" maxLength={8} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Duration" required htmlFor="cd">
            <select id="cd" className="select" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) })}>
              {[1, 2, 3, 4, 6, 9, 12, 18].map((m) => (
                <option key={m} value={m}>
                  {m} months
                </option>
              ))}
            </select>
          </Field>
          <Field label="Course name" required className="span-2" error={submitted ? errs.name : ''} htmlFor="cn">
            <input id="cn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Course fee" required className="span-2" error={submitted ? errs.fee : ''} htmlFor="cfee">
            <MoneyInput id="cfee" value={form.fee} onChange={(v) => setForm({ ...form, fee: v })} />
          </Field>
          <Field label="Description" className="span-2" htmlFor="cdesc">
            <textarea id="cdesc" className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title="Delete this course?"
        body={del && db.students.some((s) => s.courseId === del) ? 'This course has enrolled students, so it can only be deactivated. Deactivate it instead to hide it from new admissions.' : 'This course has no students and will be permanently removed.'}
        confirmLabel={del && db.students.some((s) => s.courseId === del) ? 'Deactivate instead' : 'Delete course'}
        onConfirm={() => {
          const c = db.courseById(del!);
          c.active = false;
          touch();
          toast('success', 'Course deactivated', c.name);
          setDel(null);
        }}
      />
    </>
  );
}

export function Batches() {
  useStore();
  const { toast } = useApp();
  const [status, setStatus] = useState<'Running' | 'Upcoming' | 'Completed' | 'All'>('Running');
  const list = db.batches.filter((b) => status === 'All' || b.status === status);
  return (
    <>
      <PageHeader
        title="Batches"
        sub="Timings, faculty and seat capacity for every running batch."
        crumbs={[['Academics'], ['Batches']]}
        actions={
          <>
            <Segmented
              value={status}
              onChange={setStatus}
              options={(['Running', 'Upcoming', 'Completed', 'All'] as const).map((v) => ({ value: v, label: `${v} ${v === 'All' ? db.batches.length : db.batches.filter((b) => b.status === v).length}` }))}
            />
            <button className="btn btn-primary" onClick={() => toast('info', 'Add batch', 'Opens the batch form: course, timing, faculty, capacity and dates.')}>
              <Plus /> Add batch
            </button>
          </>
        }
      />
      <div className="batch-grid">
        {list.map((b) => {
          const n = enrolledIn(b.id);
          const p = (n / b.capacity) * 100;
          return (
            <article className="batch" key={b.id}>
              <div className="batch__top">
                <div>
                  <h3>{b.name}</h3>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {db.courseById(b.courseId).name}
                  </div>
                </div>
                <StatusDot s={b.status} />
              </div>
              <div className="batch__facts">
                <span>
                  <Clock /> {b.timing}
                </span>
                <span>
                  <CalendarRange /> {b.days}
                </span>
                <span>
                  <UserRound /> {b.teacher}
                </span>
                <span>
                  <Users /> {n} students
                </span>
              </div>
              <div>
                <div className="cap">
                  <span>Seats filled</span>
                  <span>
                    <strong className="num">{n}</strong> / {b.capacity} {n >= b.capacity ? '· Full' : `· ${b.capacity - n} left`}
                  </span>
                </div>
                <Progress value={p} tone={p >= 100 ? 'danger' : p >= 85 ? 'warning' : ''} />
              </div>
              <div className="row-between" style={{ fontSize: 12, color: 'var(--ink-3)', borderTop: '1px dashed var(--line)', paddingTop: 10 }}>
                <span>
                  {date(b.start)} → {date(b.end)}
                </span>
                <Link to={`/students?batch=${b.id}`} className="btn btn-ghost btn-sm">
                  View students
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
