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
  const [slotOpen, setSlotOpen] = useState<TimeSlot | 'new' | null>(null);
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
                      {c.subtypes?.map((s) => <span className="tag" key={s.id} style={{ marginRight: 4 }}>{s.name}{s.fee !== null && <span className="muted"> · {money(s.fee)}</span>}</span>)}
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
        <div className="panel__head"><div><h2>Scheduled time slots</h2><p>Students assigned by time slot; these are enrolment counts, not attendance.</p></div>{manageSlots && <button className="btn btn-primary" onClick={() => setSlotOpen('new')} disabled={!courses?.some((c) => c.is_active)}><Plus /> Add time slot</button>}</div>
        {slots && !slots.length ? <Empty icon={<BookOpen />} title="No time slots yet" body="Add a time slot (batch) for a course before admitting students." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Time slot</th><th>Timing</th><th>Course · sub-type</th><th>Days</th><th>Faculty</th><th className="ta-r">Students assigned</th><th className="ta-r">Capacity</th><th>Active</th>{manageSlots && <th className="ta-r" />}</tr></thead><tbody>{slots?.map((b) => <tr key={b.id} style={!b.is_active ? { opacity: 0.6 } : undefined}><td style={{ fontWeight: 600 }}>{b.name}</td><td>{b.timing}</td><td>{b.course?.name}<div style={{ fontSize: 12 }}>{b.course_subtype ? <span className="tag">{b.course_subtype.name}</span> : <span className="muted">Whole course</span>}</div></td><td>{b.days}</td><td>{b.faculty ?? '—'}</td><td className="ta-r"><Link to={`/students?course=${b.course_id}&batch=${b.id}`}>{b.assigned_students}</Link></td><td className="ta-r num">{b.capacity}</td><td>{manageSlots ? <Switch on={b.is_active} label={`${b.name} active`} onChange={async (v) => { try { await write(api(`/time-slots/${b.id}/${v ? 'activate' : 'deactivate'}`, { method: 'POST' })); } catch (e) { toast('error', errText(e)); } }} /> : b.is_active ? 'Yes' : 'No'}</td>{manageSlots && <td className="ta-r"><Menu><button className="menu__item" onClick={() => setSlotOpen(b)}><Pencil /> Edit time slot</button></Menu></td>}</tr>)}</tbody></table></div>
        )}
      </section>

      <SlotDrawer slot={slotOpen} onClose={() => setSlotOpen(null)} courses={(courses ?? []).filter((c) => c.is_active)} />
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

// 19 Nov (client): each sub-type can have its own fee. When a student ticks priced sub-types at admission, their fees
// (each once) replace the course fee; with no priced sub-type ticked the course fee applies, as before.
function SubtypeDrawer({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { toast } = useApp();
  const [name, setName] = useState('');
  const [fee, setFee] = useState<number | ''>('');
  const [editing, setEditing] = useState<{ id: number; name: string; fee: number | '' } | null>(null);
  const { data: subtypes } = useQuery<Subtype[]>(course ? `/courses/${course.id}/subtypes` : null);
  useEffect(() => {
    setName('');
    setFee('');
    setEditing(null);
  }, [course]);
  const add = async () => {
    if (!name.trim()) return;
    try {
      await write(api(`/courses/${course!.id}/subtypes`, { method: 'POST', body: { name: name.trim(), fee: fee === '' ? null : String(fee) } }));
      toast('success', 'Sub-type added', `${name.trim()}${fee === '' ? '' : ` · ${money(fee)}`}`);
      setName('');
      setFee('');
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    try {
      await write(api(`/course-subtypes/${editing.id}`, { method: 'PATCH', body: { name: editing.name.trim(), fee: editing.fee === '' ? null : String(editing.fee) } }));
      toast('success', 'Sub-type saved', editing.name.trim());
      setEditing(null);
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <Drawer open={!!course} onClose={onClose} title="Course sub-types" sub={course?.name ?? ''} foot={<button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          A sub-type fee replaces the course fee ({course ? money(course.fee) : ''}) for students who tick it; several ticked sub-types are added together.
          Leave the fee empty to use the course fee. A changed fee applies to new admissions only.
        </p>
        {subtypes?.map((s) => editing?.id === s.id ? (
          <div className="subtype-edit" key={s.id}>
            <div className="form-grid">
              <Field label="Name" required htmlFor={`st-n-${s.id}`}><input id={`st-n-${s.id}`} className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Sub-type fee (₹)" hint="Empty = course fee" htmlFor={`st-f-${s.id}`}><MoneyInput id={`st-f-${s.id}`} value={editing.fee} onChange={(v) => setEditing({ ...editing, fee: v })} /></Field>
            </div>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={!editing.name.trim()} onClick={save}>Save</button>
            </div>
          </div>
        ) : (
          <div className="row-between" key={s.id}>
            <span>
              {s.name} {!s.is_active && <span className="muted">(inactive)</span>}
              <span className="muted num" style={{ marginLeft: 8, fontSize: 13 }}>{s.fee !== null ? money(s.fee) : 'course fee'}</span>
            </span>
            <span className="row" style={{ gap: 4 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: s.id, name: s.name, fee: s.fee !== null ? n(s.fee) : '' })}><Pencil /> Edit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => write(api(`/course-subtypes/${s.id}/${s.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' })).catch((e) => toast('error', errText(e)))}>
                {s.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </span>
          </div>
        ))}
        <div className="form-grid">
          <Field label="New sub-type" htmlFor="sub-name"><input id="sub-name" className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
          <Field label="Sub-type fee (₹)" hint="Optional" htmlFor="sub-fee"><MoneyInput id="sub-fee" value={fee} onChange={setFee} /></Field>
        </div>
        <button className="btn btn-primary" onClick={add} disabled={!name.trim()}><Plus /> Add sub-type</button>
      </div>
    </Drawer>
  );
}

// Add or edit a time slot. 19 Nov: a slot can be for one sub-type of its course; "Whole course" fits every student.
function SlotDrawer({ slot: target, onClose, courses }: { slot: TimeSlot | 'new' | null; onClose: () => void; courses: Course[] }) {
  const { toast } = useApp();
  const editing = target && target !== 'new' ? target : null;
  const blank = { name: '', course_id: '', course_subtype_id: '', start_time: '08:00', end_time: '09:00', days: 'Mon – Sat', faculty: '', capacity: 30 };
  const [slot, setSlot] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    setErrs({});
    setSlot(editing ? { name: editing.name, course_id: String(editing.course_id), course_subtype_id: editing.course_subtype ? String(editing.course_subtype.id) : '',
      start_time: editing.start_time, end_time: editing.end_time, days: editing.days, faculty: editing.faculty ?? '', capacity: editing.capacity } : blank);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: subtypes } = useQuery<Subtype[]>(target && slot.course_id ? `/courses/${slot.course_id}/subtypes` : null);
  const offered = (subtypes ?? []).filter((s) => s.is_active || String(s.id) === slot.course_subtype_id);
  const allCourses = editing && !courses.some((c) => c.id === editing.course_id) && editing.course ? [...courses, { ...editing.course } as Course] : courses;
  const valid = !!(slot.course_id && slot.name.trim() && validInstituteSlot(slot.start_time, slot.end_time) && slot.capacity > 0);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: slot.name, start_time: slot.start_time, end_time: slot.end_time, days: slot.days, faculty: slot.faculty, capacity: slot.capacity,
        course_subtype_id: slot.course_subtype_id ? Number(slot.course_subtype_id) : null };
      if (editing) await write(api(`/time-slots/${editing.id}`, { method: 'PATCH', body }));
      else await write(api('/time-slots', { method: 'POST', body: { ...body, course_id: Number(slot.course_id) } }));
      toast('success', editing ? 'Time slot saved' : 'Time slot added', slot.name);
      onClose();
    } catch (e) {
      setErrs((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={!!target} onClose={onClose} title={editing ? 'Edit time slot' : 'Add time slot'} sub="Institute hours: 8:00 AM to 9:00 PM" foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={save}>{busy && <span className="spinner" />}Save time slot</button></>}>
      <div className="form-grid">
        <Field label="Slot name" required htmlFor="slot-name"><input id="slot-name" className="input" value={slot.name} onChange={(e) => setSlot({ ...slot, name: e.target.value })} /></Field>
        <Field label="Course" required htmlFor="slot-course" hint={editing ? 'A slot stays with its course' : undefined}>
          <select id="slot-course" className="select" value={slot.course_id} disabled={!!editing} onChange={(e) => setSlot({ ...slot, course_id: e.target.value, course_subtype_id: '' })}>
            <option value="">Select course</option>{allCourses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Course sub-type" htmlFor="slot-subtype" error={errs.course_subtype_id} hint={slot.course_id && !offered.length ? 'This course has no sub-types' : 'Whole course = students of any sub-type'}>
          <select id="slot-subtype" className="select" value={slot.course_subtype_id} disabled={!slot.course_id || !offered.length} onChange={(e) => setSlot({ ...slot, course_subtype_id: e.target.value })}>
            <option value="">Whole course</option>{offered.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
        <Field label="Faculty" htmlFor="slot-teacher"><input id="slot-teacher" className="input" value={slot.faculty} onChange={(e) => setSlot({ ...slot, faculty: e.target.value })} /></Field>
        <Field label="Start" required htmlFor="slot-start"><input id="slot-start" className="input" type="time" min="08:00" max="21:00" value={slot.start_time} onChange={(e) => setSlot({ ...slot, start_time: e.target.value })} /></Field>
        <Field label="End" required htmlFor="slot-end" error={slot.start_time && slot.end_time && !validInstituteSlot(slot.start_time, slot.end_time) ? 'Between 8:00 AM and 9:00 PM, after the start' : undefined}><input id="slot-end" className="input" type="time" min="08:00" max="21:00" value={slot.end_time} onChange={(e) => setSlot({ ...slot, end_time: e.target.value })} /></Field>
        <Field label="Days" htmlFor="slot-days"><input id="slot-days" className="input" value={slot.days} onChange={(e) => setSlot({ ...slot, days: e.target.value })} /></Field>
        <Field label="Capacity" required htmlFor="slot-capacity"><input id="slot-capacity" className="input" type="number" min="1" value={slot.capacity} onChange={(e) => setSlot({ ...slot, capacity: Number(e.target.value) })} /></Field>
      </div>
    </Drawer>
  );
}
