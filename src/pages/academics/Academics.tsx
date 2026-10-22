import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Confirm, Drawer, Field, Menu, MoneyInput, PageHeader, Switch } from '../../components/ui';
import { db, touch, useStore } from '../../data/store';
import { money } from '../../lib/format';
import { enrolledIn } from '../students/Admission';
import { formatInstituteSlot, validInstituteSlot } from '../../lib/schedule';

export function Courses() {
  useStore();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [subCourse, setSubCourse] = useState<string | null>(null);
  const [subName, setSubName] = useState('');
  const [slotOpen, setSlotOpen] = useState(false);
  const [slot, setSlot] = useState({ name: '', courseId: '', start: '08:00', end: '09:00', days: 'Mon – Sat', teacher: '', capacity: 30 });
  const slotValid = !!(slot.courseId && slot.name.trim() && validInstituteSlot(slot.start, slot.end) && slot.capacity > 0);
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
                <th>Sub-types</th>
                <th>Duration</th>
                <th className="ta-r">Fee</th>
                <th className="ta-r">Students</th>
                <th className="ta-r">Time slots</th>
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
                    <td style={{ whiteSpace: 'normal' }}>
                      {db.courseSubtypes.filter((s) => s.courseId === c.id && s.active).map((s) => <span className="tag" key={s.id} style={{ marginRight: 4 }}>{s.name}</span>)}
                      <button className="btn btn-ghost btn-sm" onClick={() => setSubCourse(c.id)}><Plus /> Manage</button>
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

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head"><div><h2>Scheduled time slots</h2><p>Students assigned by time slot; these are enrolment counts, not attendance.</p></div><button className="btn btn-primary" onClick={() => setSlotOpen(true)}><Plus /> Add time slot</button></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Time slot</th><th>Course</th><th>Days</th><th>Faculty</th><th className="ta-r">Students assigned</th></tr></thead><tbody>{db.batches.filter((b) => b.status !== 'Completed').map((b) => <tr key={b.id}><td>{b.timing}</td><td>{db.courseById(b.courseId).name}</td><td>{b.days}</td><td>{b.teacher}</td><td className="ta-r"><Link to={`/students?batch=${b.id}`}>{enrolledIn(b.id)}</Link></td></tr>)}</tbody></table></div>
      </section>

      <Drawer open={slotOpen} onClose={() => setSlotOpen(false)} title="Add time slot" sub="Institute hours: 8:00 AM to 9:00 PM" foot={<><button className="btn btn-secondary" onClick={() => setSlotOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!slotValid} onClick={() => { if (!slotValid) return; db.batches.push({ id: `B${Date.now()}`, name: slot.name.trim(), courseId: slot.courseId, timing: formatInstituteSlot(slot.start, slot.end), days: slot.days.trim(), teacher: slot.teacher.trim(), capacity: Number(slot.capacity), start: new Date(), end: new Date(new Date().setFullYear(new Date().getFullYear() + 1)), status: 'Running' }); touch(); setSlotOpen(false); toast('success', 'Time slot added', slot.name); }}>Save time slot</button></>}>
        <div className="form-grid"><Field label="Slot name" required htmlFor="slot-name"><input id="slot-name" className="input" value={slot.name} onChange={(e) => setSlot({ ...slot, name: e.target.value })} /></Field><Field label="Course" required htmlFor="slot-course"><select id="slot-course" className="select" value={slot.courseId} onChange={(e) => setSlot({ ...slot, courseId: e.target.value })}><option value="">Select course</option>{db.courses.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Start" required htmlFor="slot-start"><input id="slot-start" className="input" type="time" min="08:00" max="21:00" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} /></Field><Field label="End" required htmlFor="slot-end"><input id="slot-end" className="input" type="time" min="08:00" max="21:00" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} /></Field><Field label="Days" htmlFor="slot-days"><input id="slot-days" className="input" value={slot.days} onChange={(e) => setSlot({ ...slot, days: e.target.value })} /></Field><Field label="Faculty" htmlFor="slot-teacher"><input id="slot-teacher" className="input" value={slot.teacher} onChange={(e) => setSlot({ ...slot, teacher: e.target.value })} /></Field><Field label="Capacity" required htmlFor="slot-capacity"><input id="slot-capacity" className="input" type="number" min="1" value={slot.capacity} onChange={(e) => setSlot({ ...slot, capacity: Number(e.target.value) })} /></Field></div>
      </Drawer>

      <Drawer open={!!subCourse} onClose={() => setSubCourse(null)} title="Course sub-types" sub={db.courses.find((c) => c.id === subCourse)?.name ?? ''} foot={<button className="btn btn-secondary" onClick={() => setSubCourse(null)}>Done</button>}>
        <div className="stack">
          {db.courseSubtypes.filter((s) => s.courseId === subCourse).map((s) => <div className="row-between" key={s.id}><span>{s.name} {!s.active && <span className="muted">(inactive)</span>}</span><button className="btn btn-ghost btn-sm" onClick={() => { s.active = !s.active; touch(); }}>{s.active ? 'Deactivate' : 'Activate'}</button></div>)}
          <Field label="New sub-type" htmlFor="sub-name"><input id="sub-name" className="input" value={subName} onChange={(e) => setSubName(e.target.value)} /></Field>
          <button className="btn btn-primary" onClick={() => { const name = subName.trim(); if (!subCourse || !name || db.courseSubtypes.some((s) => s.courseId === subCourse && s.name.toLowerCase() === name.toLowerCase())) { toast('error', 'Enter a unique sub-type name'); return; } db.courseSubtypes.push({ id: `CS${Date.now()}`, courseId: subCourse, name, active: true }); setSubName(''); touch(); toast('success', 'Sub-type added', name); }}><Plus /> Add sub-type</button>
        </div>
      </Drawer>
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
