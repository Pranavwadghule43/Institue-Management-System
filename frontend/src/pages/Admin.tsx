import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Building2, CheckCircle2, ChevronDown, ChevronRight, Copy, Database, FileText, KeyRound, ListChecks, Lock, LockOpen, Pencil, Plus, Receipt, Search, ShieldCheck, Tags, Trash2, UserX,
} from 'lucide-react';
import { ADMIN_ONLY, PERMISSIONS, errText, useApp } from '../app/AppContext';
import { Badge, Confirm, Drawer, Empty, Field, LoadError, Menu, Modal, PageHeader, Pagination, Person, Segmented, SkeletonRows, StatusDot, Switch, pager, useDebounced, usePage } from '../components/ui';
import { api, useQuery, write, type Page } from '../api/client';
import type { AccountLimit, ExpenseCategory, Ref, Settings as SettingsT, StaffMember } from '../api/types';
import { ago, dateTime } from '../lib/format';

/* ------------------------------ Staff (UX-023): 1 Admin + max 4 Staff ------------------------------ */

function TempPassword({ value, name, onClose }: { value: string | null; name: string; onClose: () => void }) {
  const { toast } = useApp();
  return (
    <Modal open={!!value} onClose={onClose}>
      <div className="modal__head">
        <div className="modal__icon success"><KeyRound /></div>
        <div>
          <h2>Temporary password for {name}</h2>
          <p>Shown only once. Hand it over in person; they should change it after signing in (account menu → Change password).</p>
        </div>
      </div>
      <div className="modal__body">
        <div className="row" style={{ gap: 8 }}>
          <input className="input mono" readOnly value={value ?? ''} onFocus={(e) => e.target.select()} />
          <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(value ?? '').then(() => toast('success', 'Copied'))}><Copy /> Copy</button>
        </div>
      </div>
      <div className="modal__foot"><button className="btn btn-primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

export function Staff() {
  const { toast, user } = useApp();
  const [reset, setReset] = useState<StaffMember | null>(null);
  const [toggle, setToggle] = useState<StaffMember | null>(null);
  const [remove, setRemove] = useState<StaffMember | null>(null);
  const [typed, setTyped] = useState('');
  const [edit, setEdit] = useState<StaffMember | null>(null);
  const [ef, setEf] = useState({ full_name: '', mobile: '', designation: '' });
  const [add, setAdd] = useState(false);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [f, setF] = useState({ full_name: '', username: '', mobile: '', designation: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useQuery<{ items: StaffMember[]; account_limit: AccountLimit }>('/staff');
  const lim = data?.account_limit;
  const full = !!lim && lim.staff_remaining <= 0;

  const create = async () => {
    setBusy(true);
    try {
      const r = await write(api<{ staff: StaffMember; temporary_password: string }>('/staff', { method: 'POST', body: { ...f, mobile: f.mobile || null, designation: f.designation || null } }));
      setAdd(false);
      setF({ full_name: '', username: '', mobile: '', designation: '' });
      setErrs({});
      setTemp({ name: r.staff.full_name, password: r.temporary_password });
    } catch (e) {
      setErrs((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const openEdit = (s: StaffMember) => {
    setEf({ full_name: s.full_name, mobile: s.mobile ?? '', designation: s.designation ?? '' });
    setErrs({});
    setEdit(s);
  };
  const saveEdit = async () => {
    setBusy(true);
    try {
      await write(api(`/staff/${edit!.id}`, { method: 'PATCH', body: { full_name: ef.full_name.trim(), mobile: ef.mobile.trim() || null, designation: ef.designation.trim() || null } }));
      toast('success', 'Details saved', ef.full_name.trim());
      setEdit(null);
    } catch (e) {
      setErrs((e as { fields?: Record<string, string> }).fields ?? {});
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (s: StaffMember, path: string, msg: string) => {
    try {
      await write(api(`/staff/${s.id}/${path}`, { method: 'POST' }));
      toast('success', msg, s.full_name);
    } catch (e) {
      toast('error', errText(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Staff"
        sub={lim ? `Accounts that can sign in · ${lim.staff_used} of ${lim.staff_limit} staff accounts used (plus 1 Admin)` : 'Accounts that can sign in.'}
        crumbs={[['Administration'], ['Staff']]}
        actions={<button className="btn btn-primary" onClick={() => setAdd(true)} disabled={full} title={full ? 'All 4 staff accounts are in use. Remove an account to free a slot.' : undefined}><Plus /> Add staff</button>}
      />
      {full && <div className="callout warning" style={{ marginBottom: 16 }}><Lock /> <span>All {lim!.staff_limit} staff accounts are in use. Disabled accounts still occupy a slot. To add someone new, remove an account you no longer need (⋯ → Remove account).</span></div>}
      <section className="panel">
        {error ? <LoadError error={error} retry={reload} /> : loading ? <SkeletonRows rows={5} cols={6} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Mobile</th><th>Status</th><th>Last sign-in</th><th className="ta-r" /></tr></thead>
              <tbody>
                {data!.items.map((s) => (
                  <tr key={s.id}>
                    <td><Person name={s.full_name} sub={s.designation ?? undefined} /></td>
                    <td className="id">{s.username}</td>
                    <td>{s.role === 'Admin' ? <Badge tone="primary" icon={<ShieldCheck />}>Admin</Badge> : <Badge tone="neutral">Staff</Badge>}</td>
                    <td className="num">{s.mobile ?? '—'}</td>
                    <td><StatusDot s={s.status} /></td>
                    <td>{s.last_login_at ? ago(s.last_login_at) : '—'}</td>
                    <td className="ta-r">
                      <Menu>
                        <button className="menu__item" onClick={() => openEdit(s)}><Pencil /> Edit details</button>
                        {s.id !== user.id && s.role !== 'Admin' && (
                          <>
                            <button className="menu__item" onClick={() => setReset(s)}><KeyRound /> Reset password</button>
                            {s.status === 'Locked' && <button className="menu__item" onClick={() => act(s, 'unlock', 'Account unlocked')}><LockOpen /> Unlock account</button>}
                            <div className="menu__sep" />
                            <button className={`menu__item ${s.status !== 'Disabled' ? 'danger' : ''}`} onClick={() => setToggle(s)}>
                              {s.status === 'Disabled' ? <CheckCircle2 /> : <UserX />} {s.status === 'Disabled' ? 'Enable account' : 'Disable account'}
                            </button>
                            <button className="menu__item danger" onClick={() => { setTyped(''); setRemove(s); }}><Trash2 /> Remove account</button>
                          </>
                        )}
                      </Menu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Confirm open={!!reset} onClose={() => setReset(null)} icon={<KeyRound />} title={`Reset password for ${reset?.full_name}?`}
        body="A temporary password will be generated and their active sessions signed out." confirmLabel="Reset password"
        onConfirm={async () => {
          try {
            const r = await write(api<{ temporary_password: string }>(`/staff/${reset!.id}/reset-password`, { method: 'POST' }));
            setTemp({ name: reset!.full_name, password: r.temporary_password });
          } catch (e) {
            toast('error', errText(e));
          }
          setReset(null);
        }} />
      <Confirm
        open={!!toggle}
        onClose={() => setToggle(null)}
        tone={toggle?.status === 'Disabled' ? 'primary' : 'danger'}
        icon={toggle?.status === 'Disabled' ? <CheckCircle2 /> : <UserX />}
        title={`${toggle?.status === 'Disabled' ? 'Enable' : 'Disable'} ${toggle?.full_name}?`}
        body={toggle?.status === 'Disabled' ? 'They will be able to sign in again with their existing permissions.' : 'They are signed out immediately and can’t sign in. The account still counts toward the 4-staff limit. To free the slot, use Remove account instead.'}
        confirmLabel={toggle?.status === 'Disabled' ? 'Enable account' : 'Disable account'}
        onConfirm={async () => {
          const s = toggle!;
          setToggle(null);
          await act(s, s.status === 'Disabled' ? 'activate' : 'deactivate', s.status === 'Disabled' ? 'Account enabled' : 'Account disabled');
        }}
      />
      <Confirm
        open={!!remove}
        onClose={() => setRemove(null)}
        tone="danger"
        icon={<Trash2 />}
        title={`Remove ${remove?.full_name}?`}
        body={`This closes the account for good and frees a staff slot. They are signed out and can’t sign in again. Their name stays on past receipts, payments and the audit log. The username “${remove?.username}” can’t be used again. This can’t be undone.`}
        confirmLabel="Remove account"
        disabled={typed.trim().toLowerCase() !== remove?.username}
        onConfirm={async () => {
          const s = remove!;
          setRemove(null);
          await act(s, 'remove', 'Account removed');
        }}
      >
        <Field label={`Type ${remove?.username ?? ''} to confirm`} htmlFor="rm"><input id="rm" className="input mono" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
      </Confirm>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.full_name ?? ''}`} sub={`Username ${edit?.username ?? ''} can’t be changed`}
        foot={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !ef.full_name.trim()} onClick={saveEdit}>{busy && <span className="spinner" />}Save changes</button></>}>
        <div className="form-grid">
          <Field label="Full name" required className="span-2" error={errs.full_name} htmlFor="en"><input id="en" className="input" value={ef.full_name} onChange={(e) => setEf({ ...ef, full_name: e.target.value })} /></Field>
          <Field label="Mobile" error={errs.mobile} htmlFor="ep"><input id="ep" className="input num" value={ef.mobile} onChange={(e) => setEf({ ...ef, mobile: e.target.value })} /></Field>
          <Field label="Designation" error={errs.designation} htmlFor="ed"><input id="ed" className="input" placeholder="e.g. Front Desk" value={ef.designation} onChange={(e) => setEf({ ...ef, designation: e.target.value })} /></Field>
        </div>
      </Drawer>
      <Drawer open={add} onClose={() => setAdd(false)} title="Add staff member" sub="New staff start with no permissions — grant them on the Permissions page"
        foot={<><button className="btn btn-secondary" onClick={() => setAdd(false)}>Cancel</button><button className="btn btn-primary" disabled={busy || !f.full_name.trim() || !f.username.trim()} onClick={create}>{busy && <span className="spinner" />}Create account</button></>}>
        <div className="form-grid">
          <Field label="Full name" required className="span-2" error={errs.full_name} htmlFor="sn"><input id="sn" className="input" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Username" required error={errs.username} hint="Lowercase letters, numbers, dot or underscore" htmlFor="su"><input id="su" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoComplete="off" /></Field>
          <Field label="Mobile" error={errs.mobile} htmlFor="sp"><input id="sp" className="input num" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
          <Field label="Designation" className="span-2" htmlFor="sd"><input id="sd" className="input" placeholder="e.g. Front Desk" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
        </div>
      </Drawer>
      <TempPassword value={temp?.password ?? null} name={temp?.name ?? ''} onClose={() => setTemp(null)} />
    </>
  );
}

/* ------------------------------ Permissions (UX-024) ------------------------------ */

interface Matrix { catalog: { code: string; description: string; admin_only: boolean }[]; staff: StaffMember[] }

export function Permissions() {
  const { toast } = useApp();
  const { data, error, loading, reload } = useQuery<Matrix>('/permissions');
  const [draft, setDraft] = useState<Record<number, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const saved = useMemo(() => Object.fromEntries((data?.staff ?? []).map((s) => [s.id, new Set(s.permissions ?? [])])), [data]);
  useEffect(() => setDraft(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, new Set(v)]))), [saved]);
  const staffUsers = data?.staff ?? [];
  const changed = staffUsers.filter((u) => {
    const a = saved[u.id] ?? new Set();
    const b = draft[u.id] ?? new Set();
    return a.size !== b.size || [...a].some((p) => !b.has(p));
  });
  const selectable = PERMISSIONS.flatMap((g) => g.items.map(([key]) => key)).filter((key) => !ADMIN_ONLY.has(key));
  const toggle = (uid: number, perm: string) => setDraft((d) => {
    const s = new Set(d[uid] ?? []);
    if (s.has(perm)) s.delete(perm);
    else s.add(perm);
    return { ...d, [uid]: s };
  });
  const save = async () => {
    setBusy(true);
    try {
      for (const u of changed) await api(`/staff/${u.id}/permissions`, { method: 'PUT', body: { codes: [...(draft[u.id] ?? [])] } });
      await write(Promise.resolve());
      toast('success', 'Permissions saved', `${changed.length} staff updated · recorded in the audit log`);
    } catch (e) {
      toast('error', errText(e));
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <LoadError error={error} retry={reload} />;
  return (
    <>
      <PageHeader title="Permissions" sub="Grant each staff member only what they need. Admin-only actions can’t be delegated." crumbs={[['Administration'], ['Permissions']]} />
      <section className="panel">
        {loading ? <SkeletonRows rows={8} cols={4} /> : !staffUsers.length ? <Empty icon={<ShieldCheck />} title="No staff accounts yet" body="Add staff on the Staff page, then grant permissions here." /> : (
          <div className="table-wrap">
            <table className="table perm-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 240 }}>Permission</th>
                  <th className="user-col">Admin<small>Full access</small></th>
                  {staffUsers.map((u) => (
                    <th key={u.id} className="user-col">
                      {u.full_name.split(' ')[0]}
                      <small>{u.designation}</small>
                      <label className="check" style={{ justifyContent: 'center', marginTop: 6 }}>
                        <input type="checkbox" aria-label={`Select all permissions for ${u.full_name}`} disabled={u.status === 'Disabled'} checked={selectable.every((key) => draft[u.id]?.has(key))}
                          ref={(node) => { if (node) node.indeterminate = selectable.some((key) => draft[u.id]?.has(key)) && !selectable.every((key) => draft[u.id]?.has(key)); }}
                          onChange={(e) => setDraft((d) => ({ ...d, [u.id]: new Set(e.target.checked ? selectable : []) }))} /> Select all
                      </label>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((g) => (
                  <Fragment key={g.group}>
                    <tr className="perm-group"><td colSpan={2 + staffUsers.length}>{g.group === 'Admin only' && <Lock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />}{g.group}</td></tr>
                    {g.items.map(([key, label]) => (
                      <tr key={key}>
                        <td className="perm-name">{label}<code>{key}</code></td>
                        <td className="ta-c"><CheckCircle2 size={18} style={{ color: 'var(--success-500)' }} /></td>
                        {staffUsers.map((u) => (
                          <td key={u.id} className="ta-c">
                            {ADMIN_ONLY.has(key) ? <span className="lock-note" title="Admin only" style={{ justifyContent: 'center' }}><Lock /></span>
                              : <Switch on={!!draft[u.id]?.has(key)} onChange={() => toggle(u.id, key)} label={`${label} for ${u.full_name}`} disabled={u.status === 'Disabled'} />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {changed.length > 0 && (
        <div className="savebar">
          <span><strong>{changed.length}</strong> staff with unsaved permission changes · applied on their next action</span>
          <div className="row">
            <button className="btn btn-secondary btn-sm" onClick={() => setDraft(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, new Set(v)])))}>Discard</button>
            <button className="btn btn-accent btn-sm" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save changes</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------ Audit (UX-025) ------------------------------ */

interface AuditRow { id: number; at: string; actor: Ref; category: string; action: string; entity_type: string; entity_id: string | null; summary: string | null; reason: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip_address: string | null }

export function Audit() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'money' | 'deleted' | 'security'>('all');
  const [open, setOpen] = useState<number | null>(null);
  const dq = useDebounced(q);
  const [page, setPage] = usePage([dq, kind]);
  const { data, error, loading, reload } = useQuery<Page<AuditRow>>('/audit', { q: dq, category: kind, page, page_size: 15 });
  const tone = (a: string) => (/DELETED|REVERSED|CANCELLED|FAILED|ARCHIVED|LOCKED/.test(a) ? 'danger' : /PAYMENT|PAID/.test(a) ? 'success' : /PERMISSION|RATE|LOGIN|AADHAAR/.test(a) ? 'hold' : 'neutral');
  const show = (o: Record<string, unknown> | null) => (o ? Object.entries(o).map(([k, v]) => <div key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>) : '—');

  return (
    <>
      <PageHeader title="Audit & deleted history" sub="Append-only log of who changed what and when. Entries can’t be edited or removed." crumbs={[['Administration'], ['Audit log']]} />
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group"><Search /><input className="input" placeholder="Search action, record or details…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" /></div>
          <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'money', label: 'Financial' }, { value: 'deleted', label: 'Deleted & cancelled' }, { value: 'security', label: 'Security' }]} />
        </div>
        {error ? <LoadError error={error} retry={reload} /> : loading ? <SkeletonRows rows={8} cols={5} /> : data!.items.length === 0 ? <Empty icon={<ListChecks />} title="No entries found" /> : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th style={{ width: 28 }} /><th>When</th><th>Staff</th><th>Action</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
                <tbody>
                  {data!.items.map((a) => {
                    const has = !!(a.before || a.after || a.reason);
                    const isOpen = open === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr className={has ? 'is-clickable' : ''} onClick={() => has && setOpen(isOpen ? null : a.id)}>
                          <td>{has && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</td>
                          <td>{dateTime(a.at)}<div className="muted" style={{ fontSize: 11.5 }}>{ago(a.at)}</div></td>
                          <td>{a.actor.name}</td>
                          <td><span className={`badge badge--${tone(a.action)}`} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 }}>{a.action}</span></td>
                          <td><span className="muted" style={{ fontSize: 12 }}>{a.entity_type}</span><div className="id">{a.entity_id}</div></td>
                          <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{a.summary}</td>
                          <td className="id">{a.ip_address}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={6} style={{ whiteSpace: 'normal', background: 'var(--surface-2)' }}>
                              {a.reason && <p style={{ margin: '0 0 8px' }}><strong>Reason:</strong> {a.reason}</p>}
                              <div className="diff"><div className="before"><b>Before</b>{show(a.before)}</div><div className="after"><b>After</b>{show(a.after)}</div></div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...pager(data, setPage)} noun="entries" />
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------ Backup (UX-026) ------------------------------ */

interface BackupRow { id: number; started_at: string; finished_at: string | null; status: string; size_bytes: number | null; created_by: Ref | null; error: string | null }

export function Backup() {
  const { data, error } = useQuery<Page<BackupRow>>('/backups');
  return (
    <>
      <PageHeader title="Backup & restore" sub="Backups run on the database server. Destination, encryption, schedule and retention are set by the database administrator." crumbs={[['Administration'], ['Backup']]} />
      <div className="callout info" style={{ marginBottom: 16 }}><Database /> <span>Manual backup and restore from this screen are switched off until the backup policy is approved; nothing here pretends to run one.</span></div>
      <section className="panel">
        <div className="panel__head"><h2><Database /> Backup history</h2></div>
        {error ? <LoadError error={error} /> : !data ? <SkeletonRows rows={3} cols={4} /> : data.items.length === 0 ? <Empty icon={<Database />} title="No backups recorded yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Started</th><th>Finished</th><th>Status</th><th>Size</th><th>By</th></tr></thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}><td>{dateTime(b.started_at)}</td><td>{b.finished_at ? dateTime(b.finished_at) : '—'}</td><td><StatusDot s={b.status} /></td><td className="num">{b.size_bytes ? `${(b.size_bytes / 1048576).toFixed(1)} MB` : '—'}</td><td>{b.created_by?.name ?? 'System'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------ Settings (UX-027) ------------------------------ */

export function Settings() {
  const { toast } = useApp();
  const [sec, setSec] = useState<'identity' | 'numbering' | 'categories'>('identity');
  const { data, error, reload } = useQuery<SettingsT>('/settings');
  const { data: cats } = useQuery<ExpenseCategory[]>('/expense-categories');
  const [inst, setInst] = useState<SettingsT['institute'] | null>(null);
  const [rec, setRec] = useState<SettingsT['receipts'] | null>(null);
  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) {
      setInst(data.institute);
      setRec(data.receipts);
    }
  }, [data]);
  if (error) return <LoadError error={error} retry={reload} />;
  if (!inst || !rec) return <SkeletonRows rows={6} cols={2} />;

  const save = async () => {
    setBusy(true);
    try {
      if (sec === 'identity') await write(api('/settings/institute', { method: 'PATCH', body: { name: inst.name, tagline: inst.tagline, address: inst.address, phone: inst.phone, email: inst.email } }));
      else await write(api('/settings/receipts', { method: 'PATCH', body: { fee_receipt_prefix: rec.fee_receipt_prefix, service_bill_prefix: rec.service_bill_prefix, receipt_heading: rec.receipt_heading, receipt_footer: rec.receipt_footer, service_bill_footer: rec.service_bill_footer, service_bill_account_note: rec.service_bill_account_note } }));
      toast('success', 'Settings saved', 'Changes recorded in the audit log');
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const addCat = async () => {
    try {
      await write(api('/expense-categories', { method: 'POST', body: { name: newCat } }));
      toast('success', 'Category added', newCat.trim());
      setNewCat('');
    } catch (e) {
      toast('error', errText(e));
    }
  };
  const setI = (k: keyof SettingsT['institute'], v: string) => setInst({ ...inst, [k]: v });
  const setR = (k: keyof SettingsT['receipts'], v: string) => setRec({ ...rec, [k]: v });

  return (
    <>
      <PageHeader title="Settings" sub="Approved configuration only — changes are audited." crumbs={[['Administration'], ['Settings']]} />
      <div className="two-col" style={{ gridTemplateColumns: '240px minmax(0,1fr)' }}>
        <section className="panel" style={{ padding: 8 }}>
          <nav className="settings-nav">
            <button className={sec === 'identity' ? 'is-active' : ''} onClick={() => setSec('identity')}><Building2 /> Institute details</button>
            <button className={sec === 'numbering' ? 'is-active' : ''} onClick={() => setSec('numbering')}><Receipt /> Receipts & bills</button>
            <button className={sec === 'categories' ? 'is-active' : ''} onClick={() => setSec('categories')}><Tags /> Expense categories</button>
          </nav>
        </section>
        <section className="panel">
          {sec === 'identity' && (
            <>
              <div className="panel__head"><div><h2>Institute details</h2><p>Printed on every new receipt and bill</p></div></div>
              <div className="panel__body">
                <div className="form-grid">
                  <Field label="Institute name" required htmlFor="in"><input id="in" className="input" value={inst.name ?? ''} onChange={(e) => setI('name', e.target.value)} /></Field>
                  <Field label="Tagline" htmlFor="it"><input id="it" className="input" value={inst.tagline ?? ''} onChange={(e) => setI('tagline', e.target.value)} /></Field>
                  <Field label="Address" required className="span-2" htmlFor="ia"><textarea id="ia" className="textarea" rows={2} value={inst.address ?? ''} onChange={(e) => setI('address', e.target.value)} /></Field>
                  <Field label="Phone" required htmlFor="ip"><input id="ip" className="input" value={inst.phone ?? ''} onChange={(e) => setI('phone', e.target.value)} /></Field>
                  <Field label="Email" htmlFor="ie"><input id="ie" className="input" value={inst.email ?? ''} onChange={(e) => setI('email', e.target.value)} /></Field>
                </div>
              </div>
            </>
          )}
          {sec === 'numbering' && (
            <>
              <div className="panel__head"><div><h2>Receipts & bills</h2><p>New prefixes apply to the next number only; issued receipts and bills keep theirs</p></div></div>
              <div className="panel__body">
                <div className="form-grid">
                  <Field label="Fee receipt prefix" htmlFor="rp" hint="A–Z and 0–9, up to 6"><input id="rp" className="input" value={rec.fee_receipt_prefix} onChange={(e) => setR('fee_receipt_prefix', e.target.value.toUpperCase())} maxLength={6} /></Field>
                  <Field label="Next receipt"><div className="prefix-preview">{rec.next_receipt_preview}</div></Field>
                  <Field label="Service bill prefix" htmlFor="bp" hint="A–Z and 0–9, up to 6"><input id="bp" className="input" value={rec.service_bill_prefix} onChange={(e) => setR('service_bill_prefix', e.target.value.toUpperCase())} maxLength={6} /></Field>
                  <Field label="Next bill"><div className="prefix-preview">{rec.next_bill_preview}</div></Field>
                  <Field label="Receipt heading" className="span-2" htmlFor="rh"><input id="rh" className="input" value={rec.receipt_heading ?? ''} onChange={(e) => setR('receipt_heading', e.target.value)} /></Field>
                  <Field label="Receipt footer note" className="span-2" htmlFor="rf"><textarea id="rf" className="textarea" value={rec.receipt_footer ?? ''} onChange={(e) => setR('receipt_footer', e.target.value)} /></Field>
                  <Field label="Bill footer note" className="span-2" htmlFor="bf"><textarea id="bf" className="textarea" value={rec.service_bill_footer ?? ''} onChange={(e) => setR('service_bill_footer', e.target.value)} /></Field>
                </div>
              </div>
            </>
          )}
          {sec === 'categories' && (
            <>
              <div className="panel__head"><div><h2>Expense categories</h2><p>Used when adding expenses and in the P&L breakdown. Categories in use can be deactivated, not deleted.</p></div></div>
              <div className="panel__body">
                <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {cats?.map((c) => (
                    <button key={c.id} className="chip" style={!c.is_active ? { opacity: 0.55 } : undefined} title={c.is_active ? 'Click to deactivate' : 'Click to activate'}
                      onClick={() => write(api(`/expense-categories/${c.id}`, { method: 'PATCH', body: { is_active: !c.is_active } })).catch((e) => toast('error', errText(e)))}>
                      <FileText /> {c.name}{!c.is_active && ' (inactive)'}
                    </button>
                  ))}
                </div>
                <div className="row" style={{ maxWidth: 420 }}>
                  <input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category" onKeyDown={(e) => e.key === 'Enter' && newCat.trim() && addCat()} />
                  <button className="btn btn-secondary" disabled={!newCat.trim()} onClick={addCat}><Plus /> Add</button>
                </div>
              </div>
            </>
          )}
          {sec !== 'categories' && (
            <div className="panel__foot" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setInst(data!.institute); setRec(data!.receipts); }}>Reset</button>
              <button className="btn btn-primary" disabled={busy} onClick={save}>{busy && <span className="spinner" />}Save settings</button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
