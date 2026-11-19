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
  const [slotEdit, setSlotEdit] = useState<TimeSlot | 'new' | null>(null);
  const { data: courses, error, loading, reload } = useQuery<Course[]>('/courses');
  const { data: slots, error: slotError, loading: slotsLoading, reload: reloadSlots } =
    useQuery<TimeSlot[]>('/time-slots', { include_completed: false });
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
        <div className="panel__head"><div><h2>Scheduled time slots</h2><p>Students assigned by time slot; these are enrolment counts, not attendance.</p></div>{manageSlots && <button className="btn btn-primary" onClick={() => setSlotEdit('new')} disabled={!courses?.some((c) => c.is_active)}><Plus /> Add time slot</button>}</div>
        {slotError ? <LoadError error={slotError} retry={reloadSlots} /> : slotsLoading ? <SkeletonRows rows={3} cols={10} /> :
          slots?.length === 0 ? <Empty icon={<BookOpen />} title="No time slots yet" body="Add a time slot (batch) for a course before admitting students." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time slot</th><th>Timing</th><th>Course</th><th>Course subtype</th><th>Days</th><th>Faculty</th>
                <th className="ta-r">Students assigned</th><th className="ta-r">Capacity</th><th>Active</th>{manageSlots && <th>Actions</th>}</tr></thead>
              <tbody>{slots?.map((b) => (
                <tr key={b.id} style={!b.is_active ? { opacity: 0.6 } : undefined}>
                  <td style={{ fontWeight: 600 }}>{b.name}</td><td>{b.timing}</td><td>{b.course?.name}</td>
                  <td>{b.course_subtype?.name ?? 'Course-wide'}</td><td>{b.days}</td><td>{b.faculty ?? '—'}</td>
                  <td className="ta-r"><Link to={`/students?course=${b.course_id}&batch=${b.id}`}>{b.assigned_students}</Link></td>
                  <td className="ta-r num">{b.capacity}</td>
                  <td>{manageSlots ? <Switch on={b.is_active} label={`${b.name} active`} onChange={async (v) => {
                    try { await write(api(`/time-slots/${b.id}/${v ? 'activate' : 'deactivate'}`, { method: 'POST' })); }
                    catch (e) { toast('error', errText(e)); }
                  }} /> : b.is_active ? 'Yes' : 'No'}</td>
                  {manageSlots && <td><button className="btn btn-ghost btn-sm" onClick={() => setSlotEdit(b)} aria-label={`Edit time slot ${b.name}`}><Pencil /> Edit</button></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <SlotDrawer selected={slotEdit} onClose={() => setSlotEdit(null)} courses={courses ?? []} />
      <SubtypeDrawer course={subCourse} canManage={can('courses.manage')} onClose={() => setSubCourse(null)} />
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

function SubtypeDrawer({ course, canManage, onClose }: { course: Course | null; canManage: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [editing, setEditing] = useState<Subtype | 'new' | null>(null);
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: subtypes, error, loading, reload } = useQuery<Subtype[]>(course ? `/courses/${course.id}/subtypes` : null);
  useEffect(() => { setEditing(null); }, [course?.id]);

  const openForm = (value: Subtype | 'new') => {
    setEditing(value);
    setName(value === 'new' ? '' : value.name);
    setFee(value === 'new' ? '' : value.fee ?? '');
    setErrors({});
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!course || !editing || busy) return;
    const cleanedFee = fee.trim();
    const invalid: Record<string, string> = {};
    if (!name.trim()) invalid.name = 'Enter a subtype name.';
    if (cleanedFee && !/^\d{1,10}(?:\.\d{1,2})?$/.test(cleanedFee)) {
      invalid.fee = 'Enter a non-negative amount with up to 10 digits and 2 decimal places.';
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) return;
    setBusy(true);
    try {
      const path = editing === 'new' ? `/courses/${course.id}/subtypes` : `/course-subtypes/${editing.id}`;
      await write(api(path, { method: editing === 'new' ? 'POST' : 'PATCH', body: { name: name.trim(), fee: cleanedFee || null } }));
      toast('success', editing === 'new' ? 'Course subtype added' : 'Course subtype updated');
      setEditing(null);
    } catch (e) {
      setErrors((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={!!course} onClose={onClose}
      title={editing === 'new' ? 'Add course subtype' : editing ? 'Edit course subtype' : 'Course subtypes'}
      sub={course?.name ?? ''}
      foot={editing ? <>
        <button className="btn btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        <button type="submit" form="course-subtype-form" className="btn btn-primary" disabled={busy}>Save subtype</button>
      </> : <button className="btn btn-secondary" onClick={onClose}>Done</button>}>
      {editing ? (
        <form id="course-subtype-form" className="stack" onSubmit={save}>
          <Field label="Parent course" htmlFor="sub-course"><input id="sub-course" className="input" value={course?.name ?? ''} readOnly /></Field>
          <Field label="Subtype name" required htmlFor="sub-name" error={errors.name}>
            <input id="sub-name" className="input" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Course subtype fee (₹)" htmlFor="sub-fee" error={errors.fee} hint="Leave blank when no subtype fee is configured.">
            <input id="sub-fee" className="input num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </Field>
        </form>
      ) : (
        <div className="stack">
          {error ? <LoadError error={error} retry={reload} /> : loading ? <p className="muted">Loading course subtypes…</p> :
            subtypes?.length === 0 ? <p className="muted">This course has no subtypes.</p> : subtypes?.map((s) => (
              <div className="row-between" key={s.id}>
                <div><strong>{s.name}</strong> {!s.is_active && <span className="muted">(inactive)</span>}
                  <div className="muted">{s.fee == null ? 'Fee not set' : money(s.fee)}</div>
                </div>
                {canManage && <div className="row">
                  <button className="btn btn-ghost btn-sm" onClick={() => openForm(s)} aria-label={`Edit subtype ${s.name}`}><Pencil /> Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => write(api(`/course-subtypes/${s.id}/${s.is_active ? 'deactivate' : 'activate'}`, { method: 'POST' })).catch((e) => toast('error', errText(e)))}>
                    {s.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>}
              </div>
            ))}
          {canManage && <button className="btn btn-primary" onClick={() => openForm('new')}><Plus /> Add course subtype</button>}
        </div>
      )}
    </Drawer>
  );
}

const blankSlot = { name: '', course_id: '', course_subtype_id: '', start_time: '08:00', end_time: '09:00', days: 'Mon – Sat', faculty: '', capacity: 30 };

function SlotDrawer({ selected, onClose, courses }: { selected: TimeSlot | 'new' | null; onClose: () => void; courses: Course[] }) {
  const { toast } = useApp();
  const editing = selected && selected !== 'new' ? selected : null;
  const [slot, setSlot] = useState(blankSlot);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: subtypes, error, loading, reload } = useQuery<Subtype[]>(selected && slot.course_id ? `/courses/${slot.course_id}/subtypes` : null);
  const choices = subtypes?.filter((s) => s.is_active || s.id === editing?.course_subtype_id) ?? [];
  useEffect(() => {
    setErrors({});
    setSlot(editing ? { name: editing.name, course_id: String(editing.course_id), course_subtype_id: String(editing.course_subtype_id ?? ''),
      start_time: editing.start_time, end_time: editing.end_time, days: editing.days, faculty: editing.faculty ?? '', capacity: editing.capacity } : blankSlot);
  }, [editing, selected]);

  const set = <K extends keyof typeof blankSlot>(key: K, value: (typeof blankSlot)[K]) => setSlot((current) => ({ ...current, [key]: value }));
  const valid = !!(slot.course_id && slot.name.trim() && validInstituteSlot(slot.start_time, slot.end_time) &&
    Number.isInteger(slot.capacity) && slot.capacity >= 1 && slot.capacity <= 1000);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setErrors({});
    const { course_id, course_subtype_id, ...details } = slot;
    const assignment = { ...details, course_subtype_id: course_subtype_id ? Number(course_subtype_id) : null };
    try {
      if (editing) await write(api(`/time-slots/${editing.id}`, { method: 'PATCH', body: assignment }));
      else await write(api('/time-slots', { method: 'POST', body: { ...assignment, course_id: Number(course_id) } }));
      toast('success', editing ? 'Time slot updated' : 'Time slot added', slot.name);
      onClose();
    } catch (e) {
      setErrors((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open={!!selected} onClose={onClose} title={editing ? 'Edit time slot' : 'Add time slot'} sub="Institute hours: 8:00 AM to 9:00 PM"
      foot={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="time-slot-form" className="btn btn-primary" disabled={!valid || busy}>Save time slot</button></>}>
      <form id="time-slot-form" className="form-grid" onSubmit={save}>
        <Field label="Slot name" required htmlFor="slot-name" error={errors.name}><input id="slot-name" className="input" maxLength={120} value={slot.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Course" required htmlFor="slot-course" error={errors.course_id}>
          <select id="slot-course" className="select" value={slot.course_id} disabled={!!editing} onChange={(e) => {
            setSlot((current) => ({ ...current, course_id: e.target.value, course_subtype_id: '' }));
            setErrors({});
          }}>
            <option value="">Select course</option>
            {courses.filter((c) => c.is_active || c.id === editing?.course_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {editing && !courses.some((c) => c.id === editing.course_id) && <option value={editing.course_id}>{editing.course?.name ?? 'Assigned course'}</option>}
          </select>
        </Field>
        <Field label="Course subtype" htmlFor="slot-subtype" className="span-2" error={errors.course_subtype_id}
          hint={error ? <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>Could not load subtypes. Retry</button>
            : !slot.course_id ? 'Select a course first.' : loading ? 'Loading course subtypes…' : choices.length === 0 ? 'This course has no available subtypes.' : undefined}>
          <select id="slot-subtype" className="select" value={slot.course_subtype_id} disabled={!slot.course_id || loading || !!error}
            onChange={(e) => set('course_subtype_id', e.target.value)}>
            <option value="">Course-wide</option>
            {editing?.course_subtype && !choices.some((s) => s.id === editing.course_subtype_id) && (
              <option value={editing.course_subtype.id}>{editing.course_subtype.name}</option>
            )}
            {choices.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
        <Field label="Start" required htmlFor="slot-start"><input id="slot-start" className="input" type="time" min="08:00" max="21:00" value={slot.start_time} onChange={(e) => set('start_time', e.target.value)} /></Field>
        <Field label="End" required htmlFor="slot-end" error={slot.start_time && slot.end_time && !validInstituteSlot(slot.start_time, slot.end_time) ? 'Between 8:00 AM and 9:00 PM, after the start' : undefined}>
          <input id="slot-end" className="input" type="time" min="08:00" max="21:00" value={slot.end_time} onChange={(e) => set('end_time', e.target.value)} />
        </Field>
        <Field label="Days" htmlFor="slot-days" error={errors.days}><input id="slot-days" className="input" value={slot.days} onChange={(e) => set('days', e.target.value)} /></Field>
        <Field label="Faculty" htmlFor="slot-teacher" error={errors.faculty}><input id="slot-teacher" className="input" value={slot.faculty} onChange={(e) => set('faculty', e.target.value)} /></Field>
        <Field label="Capacity" required htmlFor="slot-capacity" error={errors.capacity}>
          <input id="slot-capacity" className="input" type="number" min="1" max="1000" value={slot.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />
        </Field>
      </form>
    </Drawer>
  );
}
