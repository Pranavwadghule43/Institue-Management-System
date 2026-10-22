import { Fragment, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight, CloudUpload, Database, Download, FileText, KeyRound, ListChecks, Lock, LockOpen, Plus,
  Receipt, RotateCcw, Search, ShieldCheck, Tags, UserX, XCircle,
} from 'lucide-react';
import { ADMIN_ONLY, PERMISSIONS, useApp } from '../app/AppContext';
import { Badge, Confirm, Drawer, Empty, Field, Menu, PageHeader, Pagination, Panel, Person, Segmented, StatusDot, Switch, usePaged } from '../components/ui';
import { backupNow, db, touch, useStore } from '../data/store';
import type { Staff as StaffT } from '../data/types';
import { ago, dateTime } from '../lib/format';
import { institute } from '../lib/institute';

/* ------------------------------ Staff (UX-023) ------------------------------ */

export function Staff() {
  useStore();
  const { toast, user } = useApp();
  const [reset, setReset] = useState<StaffT | null>(null);
  const [toggle, setToggle] = useState<StaffT | null>(null);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: '', username: '', phone: '', designation: '' });
  const [submitted, setSubmitted] = useState(false);
  const errs = { name: !f.name.trim() ? 'Name is required' : '', username: !/^[a-z0-9._]{3,}$/.test(f.username) ? 'Lowercase letters, numbers, dot or underscore (min 3)' : db.staff.some((s) => s.username === f.username) ? 'Username already taken' : '' };

  return (
    <>
      <PageHeader
        title="Staff"
        sub="Accounts that can sign in. Permissions are set per person."
        crumbs={[['Administration'], ['Staff']]}
        actions={
          <button className="btn btn-primary" onClick={() => setAdd(true)}>
            <Plus /> Add staff
          </button>
        }
      />
      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Mobile</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th className="ta-r" />
              </tr>
            </thead>
            <tbody>
              {db.staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Person name={s.name} sub={s.designation} />
                  </td>
                  <td className="id">{s.username}</td>
                  <td>{s.role === 'Admin' ? <Badge tone="primary" icon={<ShieldCheck />}>Admin</Badge> : <Badge tone="neutral">Staff</Badge>}</td>
                  <td className="num">{s.phone}</td>
                  <td>
                    <StatusDot s={s.status} />
                  </td>
                  <td>{s.lastLogin ? ago(s.lastLogin) : '—'}</td>
                  <td className="ta-r">
                    {s.id !== user.id && (
                      <Menu>
                        <button className="menu__item" onClick={() => setReset(s)}>
                          <KeyRound /> Reset password
                        </button>
                        {s.status === 'Locked' && (
                          <button
                            className="menu__item"
                            onClick={() => {
                              s.status = 'Active';
                              touch();
                              toast('success', 'Account unlocked', s.name);
                            }}
                          >
                            <LockOpen /> Unlock account
                          </button>
                        )}
                        <div className="menu__sep" />
                        <button className={`menu__item ${s.status !== 'Disabled' ? 'danger' : ''}`} onClick={() => setToggle(s)}>
                          {s.status === 'Disabled' ? <CheckCircle2 /> : <UserX />} {s.status === 'Disabled' ? 'Enable account' : 'Disable account'}
                        </button>
                      </Menu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Confirm open={!!reset} onClose={() => setReset(null)} icon={<KeyRound />} title={`Reset password for ${reset?.name}?`} body="A temporary password will be generated. They must change it at next sign-in. All their active sessions will be signed out." confirmLabel="Reset password" onConfirm={() => { toast('success', 'Temporary password created', `Share it with ${reset?.name} in person`); setReset(null); }} />
      <Confirm
        open={!!toggle}
        onClose={() => setToggle(null)}
        tone={toggle?.status === 'Disabled' ? 'primary' : 'danger'}
        icon={<UserX />}
        title={`${toggle?.status === 'Disabled' ? 'Enable' : 'Disable'} ${toggle?.name}?`}
        body={toggle?.status === 'Disabled' ? 'They will be able to sign in again with their existing permissions.' : 'They will be signed out immediately and can’t sign in. Their history is kept.'}
        confirmLabel={toggle?.status === 'Disabled' ? 'Enable account' : 'Disable account'}
        onConfirm={() => {
          toggle!.status = toggle!.status === 'Disabled' ? 'Active' : 'Disabled';
          touch();
          toast('success', `Account ${toggle!.status === 'Disabled' ? 'disabled' : 'enabled'}`, toggle!.name);
          setToggle(null);
        }}
      />
      <Drawer
        open={add}
        onClose={() => setAdd(false)}
        title="Add staff member"
        sub="New staff start with no permissions — grant them on the Permissions page"
        foot={
          <>
            <button className="btn btn-secondary" onClick={() => setAdd(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSubmitted(true);
                if (errs.name || errs.username) return;
                db.staff.push({ id: `U${db.staff.length + 1}`, name: f.name.trim(), username: f.username, phone: f.phone, designation: f.designation || 'Staff', role: 'Staff', status: 'Active', lastLogin: null });
                touch();
                toast('success', 'Staff account created', `${f.name} · temporary password generated`);
                setAdd(false);
                setSubmitted(false);
                setF({ name: '', username: '', phone: '', designation: '' });
              }}
            >
              Create account
            </button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Full name" required className="span-2" error={submitted ? errs.name : ''} htmlFor="sn">
            <input id="sn" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Username" required error={submitted ? errs.username : ''} htmlFor="su">
            <input id="su" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoComplete="off" />
          </Field>
          <Field label="Mobile" htmlFor="sp">
            <input id="sp" className="input num" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="Designation" className="span-2" htmlFor="sd">
            <input id="sd" className="input" placeholder="e.g. Front Desk" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} />
          </Field>
        </div>
      </Drawer>
    </>
  );
}

/* ------------------------------ Permissions (UX-024) ------------------------------ */

export function Permissions() {
  const { staffPerms, setStaffPerms, toast } = useApp();
  const staffUsers = db.staff.filter((s) => s.role === 'Staff');
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(staffPerms).map(([k, v]) => [k, new Set(v)])));
  const changes = useMemo(() => {
    let n = 0;
    for (const u of staffUsers) {
      const a = staffPerms[u.id] ?? new Set();
      const b = draft[u.id] ?? new Set();
      for (const p of new Set([...a, ...b])) if (a.has(p) !== b.has(p)) n++;
    }
    return n;
  }, [draft, staffPerms, staffUsers]);

  const toggle = (uid: string, perm: string) =>
    setDraft((d) => {
      const s = new Set(d[uid] ?? []);
      if (s.has(perm)) s.delete(perm);
      else s.add(perm);
      return { ...d, [uid]: s };
    });

  return (
    <>
      <PageHeader title="Permissions" sub="Grant each staff member only what they need. Admin-only actions can’t be delegated." crumbs={[['Administration'], ['Permissions']]} />
      <section className="panel">
        <div className="table-wrap">
          <table className="table perm-table">
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Permission</th>
                <th className="user-col">
                  Admin
                  <small>Full access</small>
                </th>
                {staffUsers.map((u) => (
                  <th key={u.id} className="user-col">
                    {u.name.split(' ')[0]}
                    <small>{u.designation}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((g) => (
                <Fragment key={g.group}>
                  <tr className="perm-group">
                    <td colSpan={2 + staffUsers.length}>
                      {g.group === 'Admin only' && <Lock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />}
                      {g.group}
                    </td>
                  </tr>
                  {g.items.map(([key, label]) => (
                    <tr key={key}>
                      <td className="perm-name">
                        {label}
                        <code>{key}</code>
                      </td>
                      <td className="ta-c">
                        <CheckCircle2 size={18} style={{ color: 'var(--success-500)' }} />
                      </td>
                      {staffUsers.map((u) => (
                        <td key={u.id} className="ta-c">
                          {ADMIN_ONLY.has(key) ? (
                            <span className="lock-note" title="Admin only" style={{ justifyContent: 'center' }}>
                              <Lock />
                            </span>
                          ) : (
                            <Switch on={!!draft[u.id]?.has(key)} onChange={() => toggle(u.id, key)} label={`${label} for ${u.name}`} disabled={u.status === 'Disabled'} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {changes > 0 && (
        <div className="savebar">
          <span>
            <strong>{changes}</strong> unsaved permission change{changes > 1 ? 's' : ''} · applied on the user’s next action
          </span>
          <div className="row">
            <button className="btn btn-secondary btn-sm" onClick={() => setDraft(Object.fromEntries(Object.entries(staffPerms).map(([k, v]) => [k, new Set(v)])))}>
              Discard
            </button>
            <button
              className="btn btn-accent btn-sm"
              onClick={() => {
                setStaffPerms(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, new Set(v)])));
                toast('success', 'Permissions saved', `${changes} change${changes > 1 ? 's' : ''} recorded in the audit log`);
              }}
            >
              Save changes
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------ Audit (UX-025) ------------------------------ */

export function Audit() {
  useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'money' | 'deleted' | 'security'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = db.audit.filter((a) => {
    if (kind === 'money' && !/PAYMENT|BILL|EXPENSE/.test(a.action)) return false;
    if (kind === 'deleted' && !/DELETED|REVERSED|CANCELLED/.test(a.action)) return false;
    if (kind === 'security' && !/LOGIN|PERMISSION|PASSWORD|BACKUP/.test(a.action)) return false;
    const s = q.toLowerCase();
    return !s || a.summary.toLowerCase().includes(s) || a.entityId.toLowerCase().includes(s) || (db.staffById(a.actor)?.name ?? '').toLowerCase().includes(s);
  });
  const pg = usePaged(rows, 15);
  const tone = (a: string) => (/DELETED|REVERSED|CANCELLED|FAILED/.test(a) ? 'danger' : /PAYMENT|PAID/.test(a) ? 'success' : /PERMISSION|RATE|LOGIN/.test(a) ? 'hold' : 'neutral');

  return (
    <>
      <PageHeader
        title="Audit & deleted history"
        sub="Append-only log of who changed what and when. Entries can’t be edited or removed."
        crumbs={[['Administration'], ['Audit log']]}
        actions={
          <button className="btn btn-secondary">
            <Download /> Export
          </button>
        }
      />
      <section className="panel">
        <div className="table-toolbar">
          <div className="input-group">
            <Search />
            <input className="input" placeholder="Search action, record or staff…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
          </div>
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All' },
              { value: 'money', label: 'Financial' },
              { value: 'deleted', label: 'Deleted & cancelled' },
              { value: 'security', label: 'Security' },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon={<ListChecks />} title="No entries found" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>When</th>
                    <th>Staff</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Details</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.slice.map((a) => {
                    const has = !!(a.before || a.after);
                    const isOpen = open === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr className={has ? 'is-clickable' : ''} onClick={() => has && setOpen(isOpen ? null : a.id)}>
                          <td>{has && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</td>
                          <td>
                            {dateTime(a.at)}
                            <div className="muted" style={{ fontSize: 11.5 }}>{ago(a.at)}</div>
                          </td>
                          <td>{db.staffById(a.actor)?.name ?? 'System'}</td>
                          <td>
                            <span className={`badge badge--${tone(a.action)}`} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 }}>
                              {a.action}
                            </span>
                          </td>
                          <td>
                            <span className="muted" style={{ fontSize: 12 }}>{a.entity}</span>
                            <div className="id">{a.entityId}</div>
                          </td>
                          <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{a.summary}</td>
                          <td className="id">{a.ip}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td />
                            <td colSpan={6} style={{ whiteSpace: 'normal', background: 'var(--surface-2)' }}>
                              <div className="diff">
                                <div className="before">
                                  <b>Before</b>
                                  {a.before ? Object.entries(a.before).map(([k, v]) => <div key={k}>{k}: {v}</div>) : '—'}
                                </div>
                                <div className="after">
                                  <b>After</b>
                                  {a.after ? Object.entries(a.after).map(([k, v]) => <div key={k}>{k}: {v}</div>) : '—'}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination {...pg} noun="entries" />
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------ Backup (UX-026) ------------------------------ */

export function Backup() {
  useStore();
  const { user, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const last = db.backups.find((b) => b.status === 'Success')!;
  return (
    <>
      <PageHeader
        title="Backup & restore"
        sub="Daily automatic backups at 2:00 AM, weekly on Sundays, plus manual backups."
        crumbs={[['Administration'], ['Backup']]}
        actions={
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setTimeout(() => {
                backupNow(user.id);
                setBusy(false);
                toast('success', 'Backup completed', 'Encrypted and verified');
              }, 1600);
            }}
          >
            {busy ? <span className="spinner" /> : <CloudUpload />}
            {busy ? 'Backing up…' : 'Back up now'}
          </button>
        }
      />
      <div className="dash-grid" style={{ marginTop: 0, marginBottom: 18 }}>
        <Panel>
          <div className="backup-hero">
            <span className="backup-hero__ring">
              <ShieldCheck />
            </span>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 18 }}>Backups are healthy</h2>
              <p className="muted" style={{ fontSize: 13.5 }}>
                Last successful backup {ago(last.at)} · {dateTime(last.at)} · {last.size}
              </p>
            </div>
          </div>
          <div className="mini-stats" style={{ marginTop: 18 }}>
            <div>
              <span>Schedule</span>
              <strong style={{ fontSize: 14 }}>Daily 2:00 AM</strong>
            </div>
            <div>
              <span>Retention</span>
              <strong style={{ fontSize: 14 }}>30 daily · 12 weekly</strong>
            </div>
            <div>
              <span>Last restore test</span>
              <strong style={{ fontSize: 14 }}>7 days ago</strong>
            </div>
          </div>
        </Panel>
        <section className="panel danger-zone">
          <div className="panel__head">
            <h2 style={{ color: 'var(--danger-700)' }}>
              <AlertTriangle /> Restore
            </h2>
          </div>
          <div className="panel__body">
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Restoring replaces all current data with the selected backup. A fresh backup is taken automatically first, and the system is verified after restore.</p>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Choose “Restore” on a backup in the history below.</p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel__head">
          <h2>
            <Database /> Backup history
          </h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date & time</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
                <th>Verified</th>
                <th className="ta-r" />
              </tr>
            </thead>
            <tbody>
              {db.backups.map((b) => (
                <tr key={b.id}>
                  <td>{dateTime(b.at)}</td>
                  <td>
                    <span className="tag">{b.type}</span>
                  </td>
                  <td className="num">{b.size}</td>
                  <td>{b.status === 'Success' ? <Badge tone="success" icon={<CheckCircle2 />}>Success</Badge> : <Badge tone="danger" icon={<XCircle />}>Failed — disk full, retried</Badge>}</td>
                  <td>{b.verified ? <Badge tone="primary" dot>Restore-tested</Badge> : <span className="muted">Checksum OK</span>}</td>
                  <td className="ta-r">
                    {b.status === 'Success' && (
                      <div className="actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => toast('info', 'Download started', 'Encrypted backup file')}>
                          <Download /> Download
                        </button>
                        <button className="btn btn-danger-soft btn-sm" onClick={() => { setRestore(b.id); setTyped(''); }}>
                          <RotateCcw /> Restore
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Confirm
        open={!!restore}
        onClose={() => setRestore(null)}
        tone="danger"
        icon={<RotateCcw />}
        title="Restore this backup?"
        body={restore ? `All data will be replaced with the backup from ${dateTime(db.backups.find((b) => b.id === restore)!.at)}. Everyone will be signed out during the restore.` : ''}
        confirmLabel="Restore backup"
        disabled={typed !== 'RESTORE'}
        onConfirm={() => {
          setRestore(null);
          toast('info', 'Restore scheduled', 'A pre-restore backup is being taken first (prototype — no data changed)');
        }}
      >
        <Field label="Type RESTORE to confirm" required htmlFor="rt">
          <input id="rt" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
      </Confirm>
    </>
  );
}

/* ------------------------------ Settings (UX-027) ------------------------------ */

export function Settings() {
  const { toast } = useApp();
  const [sec, setSec] = useState<'identity' | 'numbering' | 'categories' | 'priorities'>('identity');
  const [f, setF] = useState({ ...institute });
  const [cats, setCats] = useState([...db.expenseCategories]);
  const [newCat, setNewCat] = useState('');
  const year = db.TODAY.getFullYear();
  return (
    <>
      <PageHeader title="Settings" sub="Approved configuration only — changes are audited." crumbs={[['Administration'], ['Settings']]} />
      <div className="two-col" style={{ gridTemplateColumns: '240px minmax(0,1fr)' }}>
        <section className="panel" style={{ padding: 8 }}>
          <nav className="settings-nav">
            <button className={sec === 'identity' ? 'is-active' : ''} onClick={() => setSec('identity')}>
              <Building2 /> Institute details
            </button>
            <button className={sec === 'numbering' ? 'is-active' : ''} onClick={() => setSec('numbering')}>
              <Receipt /> Receipts & bills
            </button>
            <button className={sec === 'categories' ? 'is-active' : ''} onClick={() => setSec('categories')}>
              <Tags /> Expense categories
            </button>
            <button className={sec === 'priorities' ? 'is-active' : ''} onClick={() => setSec('priorities')}>
              <ListChecks /> Job priorities
            </button>
          </nav>
        </section>
        <section className="panel">
          {sec === 'identity' && (
            <>
              <div className="panel__head">
                <div>
                  <h2>Institute details</h2>
                  <p>Printed on every receipt and bill</p>
                </div>
              </div>
              <div className="panel__body">
                <div className="form-grid">
                  <Field label="Institute name" required htmlFor="in">
                    <input id="in" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                  </Field>
                  <Field label="Tagline" htmlFor="it">
                    <input id="it" className="input" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
                  </Field>
                  <Field label="Address" required className="span-2" htmlFor="ia">
                    <textarea id="ia" className="textarea" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
                  </Field>
                  <Field label="Phone" required htmlFor="ip">
                    <input id="ip" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                  </Field>
                  <Field label="Email" htmlFor="ie">
                    <input id="ie" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                  </Field>
                </div>
              </div>
            </>
          )}
          {sec === 'numbering' && (
            <>
              <div className="panel__head">
                <div>
                  <h2>Receipts & bills</h2>
                  <p>Numbers are generated by the server and never reused</p>
                </div>
              </div>
              <div className="panel__body">
                <div className="form-grid">
                  <Field label="Fee receipt prefix" htmlFor="rp">
                    <input id="rp" className="input" value={f.receiptPrefix} onChange={(e) => setF({ ...f, receiptPrefix: e.target.value.toUpperCase() })} maxLength={6} />
                  </Field>
                  <Field label="Next receipt preview">
                    <div className="prefix-preview">{f.receiptPrefix}-{year}-0{1201 + db.payments.length}</div>
                  </Field>
                  <Field label="Service bill prefix" htmlFor="bp">
                    <input id="bp" className="input" value={f.billPrefix} onChange={(e) => setF({ ...f, billPrefix: e.target.value.toUpperCase() })} maxLength={6} />
                  </Field>
                  <Field label="Next bill preview">
                    <div className="prefix-preview">{f.billPrefix}-{year}-0{301 + db.bills.length}</div>
                  </Field>
                  <Field label="Receipt footer note" className="span-2" htmlFor="rf">
                    <textarea id="rf" className="textarea" value={f.receiptFooter} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} />
                  </Field>
                  <Field label="Bill footer note" className="span-2" htmlFor="bf">
                    <textarea id="bf" className="textarea" value={f.billFooter} onChange={(e) => setF({ ...f, billFooter: e.target.value })} />
                  </Field>
                </div>
              </div>
            </>
          )}
          {sec === 'categories' && (
            <>
              <div className="panel__head">
                <div>
                  <h2>Expense categories</h2>
                  <p>Used when adding expenses and in the P&L breakdown</p>
                </div>
              </div>
              <div className="panel__body">
                <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {cats.map((c) => (
                    <span className="chip" key={c}>
                      <FileText /> {c}
                    </span>
                  ))}
                </div>
                <div className="row" style={{ maxWidth: 420 }}>
                  <input className="input" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category" />
                  <button className="btn btn-secondary" onClick={() => { if (newCat.trim()) { setCats([...cats, newCat.trim()]); setNewCat(''); } }}>
                    <Plus /> Add
                  </button>
                </div>
              </div>
            </>
          )}
          {sec === 'priorities' && (
            <>
              <div className="panel__head">
                <div>
                  <h2>Job priorities</h2>
                  <p>Shown on service jobs and the board</p>
                </div>
              </div>
              <div className="panel__body stack" style={{ gap: 10 }}>
                {[['Urgent', 'danger', 'Deadline within 24 hours'], ['High', 'accent', 'Deadline within 3 days'], ['Normal', 'neutral', 'Standard turnaround']].map(([n, t, d]) => (
                  <div key={n} className="row-between" style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8 }}>
                    <span className="row">
                      <Badge tone={t as 'danger'}>{n}</Badge>
                      <span className="muted" style={{ fontSize: 13 }}>{d}</span>
                    </span>
                    <Switch on label={`${n} enabled`} onChange={() => toast('info', 'Priority levels are required for job tracking')} />
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="panel__foot" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={() => { setF({ ...institute }); setCats([...db.expenseCategories]); }}>
              Reset
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                Object.assign(institute, f);
                db.expenseCategories.splice(0, db.expenseCategories.length, ...cats);
                toast('success', 'Settings saved', 'Changes recorded in the audit log');
              }}
            >
              Save settings
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
