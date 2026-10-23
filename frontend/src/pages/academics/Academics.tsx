import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { errText, useApp } from '../../app/AppContext';
import { Confirm, Drawer, Empty, Field, LoadError, Menu, MoneyInput, PageHeader, SkeletonRows, Switch } from '../../components/ui';
import { api, useQuery, write } from '../../api/client';
import type { Course, Subtype, TimeSlot } from '../../api/types';
import { money, n } from '../../lib/format';
import { validInstituteSlot } from '../../lib/schedule';

const blankCourse = { code: '', name: '', duration_months: 3, fee: '' as number | '', description: '' };

export function Courses() {
  const { can, toast } = useApp();
  const [edit, setEdit] = useState<Course | 'new' | null>(null);
  const [del, setDel] = useState<Course | null>(null);
  const [subCourse, setSubCourse] = useState<Course | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const { data: courses, error, loading, reload } = useQuery<Course[]>('/courses');
  const { data: slots } = useQuery<TimeSlot[]>('/time-slots', { include_completed: false });
  const manageSlots = can('batches.manage') || can('courses.manage');

  const toggle = async (c: Course, v: boolean) => {
    try {
      await write(api(`/courses/${c.id}/${v ? 'activate' : 'deactivate'}`, { method: 'POST' }));
      toast('success', v ? 'Course activated' : 'Course deactivated', v ? `${c.code} is available for admissions` : `${c.code} is hidden from new admissions; existing students are unaffected`);
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Courses"
        sub="Fees set here are copied to each enrolment — editing a course never changes existing students’ fees."
        crumbs={[['Academics'], ['Courses']]}
        actions={<button className="btn btn-primary" onClick={() => setEdit('new')}><Plus /> Add course</button>}
      />
      <section className="panel">
        {error ? <LoadError error={error} retry={reload} /> : loading ? <SkeletonRows rows={5} cols={6} /> : !courses!.length ? (
          <Empty icon={<BookOpen />} title="No courses yet" body="Add the first course to start taking admissions." action={<button className="btn btn-primary" onClick={() => setEdit('new')}><Plus /> Add course</button>} />
        ) : (
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
                {courses!.map((c) => (
                  <tr key={c.id} style={!c.is_active ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div className="row">
                        <span className="feed-item__ico" style={{ background: 'var(--primary-50)', color: 'var(--primary-600)' }}><BookOpen /></span>
                        <div style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                          <div style={{ fontWeight: 600 }}>{c.name} <span className="tag" style={{ marginLeft: 4 }}>{c.code}</span></div>
                          <div className="muted" style={{ fontSize: 12 }}>{c.description}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {c.subtypes?.map((s) => <span className="tag" key={s.id} style={{ marginRight: 4 }}>{s.name}</span>)}
                      <button className="btn btn-ghost btn-sm" onClick={() => setSubCourse(c)}><Plus /> Manage</button>
                    </td>
                    <td>{c.duration_months ? `${c.duration_months} months` : '—'}</td>
                    <td className="ta-r num" style={{ fontWeight: 700 }}>{money(c.fee)}</td>
                    <td className="ta-r num"><Link to={`/students?course=${c.id}`}>{c.active_students}</Link></td>
                    <td className="ta-r num">{c.time_slots}</td>
                    <td><Switch on={c.is_active} label={`${c.name} active`} onChange={(v) => toggle(c, v)} /></td>
                    <td className="ta-r">
                      <Menu>
                        <button className="menu__item" onClick={() => setEdit(c)}><Pencil /> Edit course</button>
                        <div className="menu__sep" />
                        <button className="menu__item danger" onClick={() => setDel(c)}><Trash2 /> Delete course</button>
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="panel__head"><div><h2>Scheduled time slots</h2><p>Students assigned by time slot; these are enrolment counts, not attendance.</p></div>{manageSlots && <button className="btn btn-primary" onClick={() => setSlotOpen(true)} disabled={!courses?.some((c) => c.is_active)}><Plus /> Add time slot</button>}</div>
        {slots && !slots.length ? <Empty icon={<BookOpen />} title="No time slots yet" body="Add a time slot (batch) for a course before admitting students." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Time slot</th><th>Timing</th><th>Course</th><th>Days</th><th>Faculty</th><th className="ta-r">Students assigned</th><th className="ta-r">Capacity</th><th>Active</th></tr></thead><tbody>{slots?.map((b) => <tr key={b.id} style={!b.is_active ? { opacity: 0.6 } : undefined}><td style={{ fontWeight: 600 }}>{b.name}</td><td>{b.timing}</td><td>{b.course?.name}</td><td>{b.days}</td><td>{b.faculty ?? '—'}</td><td className="ta-r"><Link to={`/students?course=${b.course_id}&batch=${b.id}`}>{b.assigned_students}</Link></td><td className="ta-r num">{b.capacity}</td><td>{manageSlots ? <Switch on={b.is_active} label={`${b.name} active`} onChange={async (v) => { try { await write(api(`/time-slots/${b.id}/${v ? 'activate' : 'deactivate'}`, { method: 'POST' })); } catch (e) { toast('error', errText(e)); } }} /> : b.is_active ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <SlotDrawer open={slotOpen} onClose={() => setSlotOpen(false)} courses={(courses ?? []).filter((c) => c.is_active)} />
      <SubtypeDrawer course={subCourse} onClose={() => setSubCourse(null)} />
      <CourseDrawer course={edit} onClose={() => setEdit(null)} />

      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        tone="danger"
        icon={<Trash2 />}
        title="Delete this course?"
        body={del && del.active_students ? 'This course has enrolled students, so it can only be deactivated.' : 'Courses that never had students are removed from the list. Courses with students can only be deactivated.'}
        confirmLabel={del && del.active_students ? 'Deactivate instead' : 'Delete course'}
        onConfirm={async () => {
          const c = del!;
          try {
            if (c.active_students) await write(api(`/courses/${c.id}/deactivate`, { method: 'POST' }));
            else await write(api(`/courses/${c.id}`, { method: 'DELETE' }));
            toast('success', c.active_students ? 'Course deactivated' : 'Course deleted', c.name);
          } catch (e) {
            toast('error', errText(e));
          }
          setDel(null);
        }}
      />
    </>
  );
}

function CourseDrawer({ course, onClose }: { course: Course | 'new' | null; onClose: () => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState(blankCourse);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNew = course === 'new';
  useEffect(() => {
    setSubmitted(false);
    if (course && course !== 'new') setForm({ code: course.code, name: course.name, duration_months: course.duration_months ?? 3, fee: n(course.fee), description: course.description ?? '' });
    else setForm(blankCourse);
  }, [course]);
  const errs = { code: !form.code.trim() ? 'Short code is required' : '', name: !form.name.trim() ? 'Course name is required' : '', fee: form.fee === '' ? 'Enter the course fee' : '' };
  const save = async () => {
    setSubmitted(true);
    if (errs.code || errs.name || errs.fee) return;
    setBusy(true);
    try {
      const body = { ...form, fee: String(form.fee) };
      if (isNew) await write(api('/courses', { method: 'POST', body }));
      else await write(api(`/courses/${(course as Course).id}`, { method: 'PATCH', body }));
      toast('success', isNew ? 'Course added' : 'Course updated', form.name);
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={!!course} onClose={onClose} title={isNew ? 'Add course' : 'Edit course'} sub={isNew ? 'Visible in admissions once active' : 'Fee changes apply to new admissions only'}
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save course</button></>}>
      <div className="form-grid">
        <Field label="Short code" required error={submitted ? errs.code : ''} htmlFor="cc">
          <input id="cc" className="input" maxLength={8} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Duration" required htmlFor="cd">
          <select id="cd" className="select" value={form.duration_months} onChange={(e) => setForm({ ...form, duration_months: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 9, 12, 18].map((m) => <option key={m} value={m}>{m} months</option>)}
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
  );
}

function SubtypeDrawer({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const { data: subtypes } = useQuery<Subtype[]>(course ? `/courses/${course.id}/subtypes` : null);
  const add = async () => {
    if (!name.trim()) return;
    try {
      await write(api(`/courses/${course!.id}/subtypes`, { method: 'POST', body: { name } }));
      toast('success', 'Sub-type added', name.trim());
      setName('');
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <Drawer open={!!course} onClose={onClose} title="Course sub-types" sub={course?.name ?? ''} foot={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      <div className="stack">
        {subtypes?.map((s) => (
          <div className="row-between" key={s.id}>
            <span>{s.name} {!s.is_active && <span className="muted">(inactive)</span>}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => write(api(`/course-subtypes/${s.id}/${s.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' })).catch((e) => toast('error', errText(e)))}>
              {s.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
        <Field label="New sub-type" htmlFor="sub-name"><input id="sub-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
        <button className="btn btn-primary" onClick={add} disabled={!name.trim()}><Plus /> Add sub-type</button>
      </div>
    </Drawer>
  );
}

function SlotDrawer({ open, onClose, courses }: { open: boolean; onClose: () => void; courses: Course[] }) {
  const { toast } = useApp();
  const blank = { name: '', course_id: '', start_time: '08:00', end_time: '09:00', days: 'Mon – Sat', faculty: '', capacity: 30 };
  const [slot, setSlot] = useState(blank);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSlot(blank), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = !!(slot.course_id && slot.name.trim() && validInstituteSlot(slot.start_time, slot.end_time) && slot.capacity > 0);
  const save = async () => {
    setBusy(true);
    try {
      await write(api('/time-slots', { method: 'POST', body: { ...slot, course_id: Number(slot.course_id) } }));
      toast('success', 'Time slot added', slot.name);
      onClose();
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Add time slot" sub="Institute hours: 8:00 AM to 9:00 PM" foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={save}>{busy && <span className="spinner" />}Save time slot</button></>}>
      <div className="form-grid"><Field label="Slot name" required htmlFor="slot-name"><input id="slot-name" className="input" value={slot.name} onChange={(e) => setSlot({ ...slot, name: e.target.value })} /></Field><Field label="Course" required htmlFor="slot-course"><select id="slot-course" className="select" value={slot.course_id} onChange={(e) => setSlot({ ...slot, course_id: e.target.value })}><option value="">Select course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Start" required htmlFor="slot-start"><input id="slot-start" className="input" type="time" min="08:00" max="21:00" value={slot.start_time} onChange={(e) => setSlot({ ...slot, start_time: e.target.value })} /></Field><Field label="End" required htmlFor="slot-end" error={slot.start_time && slot.end_time && !validInstituteSlot(slot.start_time, slot.end_time) ? 'Between 8:00 AM and 9:00 PM, after the start' : undefined}><input id="slot-end" className="input" type="time" min="08:00" max="21:00" value={slot.end_time} onChange={(e) => setSlot({ ...slot, end_time: e.target.value })} /></Field><Field label="Days" htmlFor="slot-days"><input id="slot-days" className="input" value={slot.days} onChange={(e) => setSlot({ ...slot, days: e.target.value })} /></Field><Field label="Faculty" htmlFor="slot-teacher"><input id="slot-teacher" className="input" value={slot.faculty} onChange={(e) => setSlot({ ...slot, faculty: e.target.value })} /></Field><Field label="Capacity" required htmlFor="slot-capacity"><input id="slot-capacity" className="input" type="number" min="1" value={slot.capacity} onChange={(e) => setSlot({ ...slot, capacity: Number(e.target.value) })} /></Field></div>
    </Drawer>
  );
}
