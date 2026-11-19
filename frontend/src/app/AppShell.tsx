import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Bell, Briefcase, ChevronRight, CornerDownLeft, FileText, KeyRound, LogOut, Menu as MenuIcon,
  Moon, PanelLeftClose, PanelLeftOpen, ReceiptText, Search, Sun, UserRound, Users,
} from 'lucide-react';
import logoReverse from '../assets/logo-reverse.png';
import markReverse from '../assets/mark-reverse.png';
import { errText, useApp } from './AppContext';
import { NAV, type NavNode } from './nav';
import { Avatar, Field, Menu, Modal, useDebounced } from '../components/ui';
import { api, useQuery } from '../api/client';
import type { AuditItem } from '../api/types';
import { ago } from '../lib/format';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ims.nav') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const loc = useLocation();
  const billDesk = useMatch('/services/bills/:id');
  const { user, role, can } = useApp();
  const canAdmit = can('students.create');

  useEffect(() => setDrawer(false), [loc.pathname]);
  useEffect(() => {
    if (!canAdmit) return;
    const preload = () => { void import('../pages/students/Admission').catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 600 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(preload, 100);
    return () => clearTimeout(timer);
  }, [canAdmit]);
  useEffect(() => {
    try {
      localStorage.setItem('ims.nav', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdk((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${drawer ? 'is-drawer-open' : ''}`}>
      <Sidebar />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="main">
        <Topbar onToggleNav={() => setCollapsed((c) => !c)} collapsed={collapsed} onSearch={() => setCmdk(true)} />
        <main className="content" key={billDesk ? '/services/bills/:id' : loc.pathname}>
          <Suspense fallback={<div className="denied"><span className="spinner" role="status" aria-label="Loading page" /></div>}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="appfoot no-print">
          <span>
            <span className="appfoot__dot" /> {user.name} · {role}
          </span>
          <span>Live data</span>
          <span className="appfoot__ver">IMS v1.0</span>
        </footer>
      </div>
      {cmdk && <CommandPalette onClose={() => setCmdk(false)} />}
    </div>
  );
}

/* ------------------------------ Sidebar ------------------------------ */

function Sidebar() {
  const { can } = useApp();
  const loc = useLocation();
  const { data: counts } = useQuery<{ fee_reminders: number | null; open_jobs: number | null }>('/meta/sidebar');

  const visible = (n: NavNode) => (!n.perm || can(n.perm)) && (!n.children || n.children.some((c) => !c.perm || can(c.perm)));

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link to="/" className="sidebar__brand" style={{ textDecoration: 'none' }}>
        <img className="full" src={logoReverse} alt="Updaate Computers" />
        <img className="mark" src={markReverse} alt="Updaate Computers" />
      </Link>
      <div className="sidebar__scroll">
        {NAV.map((sec) => {
          const items = sec.items.filter(visible);
          if (!items.length) return null;
          return (
            <div className="nav-section" key={sec.label}>
              <div className="nav-section__label">{sec.label}</div>
              {items.map((n) =>
                n.children ? (
                  <NavGroup key={n.label} node={n} pathname={loc.pathname} badge={n.badge === 'reminders' ? counts?.fee_reminders ?? undefined : n.badge === 'jobs' ? counts?.open_jobs ?? undefined : undefined} />
                ) : (
                  <NavLink key={n.label} to={n.to!} end className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`} data-tip={n.label}>
                    <n.icon />
                    <span className="nav-item__label">{n.label}</span>
                  </NavLink>
                ),
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function NavGroup({ node, pathname, badge }: { node: NavNode; pathname: string; badge?: number }) {
  const { can } = useApp();
  const kids = node.children!.filter((c) => !c.perm || can(c.perm));
  const activeChild = kids.some((c) => pathname === c.to || (c.to !== '/' && pathname.startsWith(c.to + '/')) || pathname.startsWith(c.to));
  const [open, setOpen] = useState(activeChild);
  useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);
  const nav = useNavigate();
  return (
    <div className={`nav-group ${open ? 'is-open' : ''}`}>
      <button
        className={`nav-item ${activeChild && !open ? 'is-active' : ''}`}
        onClick={() => {
          // collapsed rail: jump to first child instead of expanding
          if (document.querySelector('.shell.is-collapsed') && window.innerWidth > 1023) nav(kids[0].to);
          else setOpen((o) => !o);
        }}
        aria-expanded={open}
        data-tip={node.label}
      >
        <node.icon />
        <span className="nav-item__label">{node.label}</span>
        {badge ? <span className="nav-item__count">{badge}</span> : null}
        <ChevronRight className="nav-item__chev" />
      </button>
      <div className="nav-sub">
        <div className="nav-sub__inner">
          {kids.map((c) => (
            <NavLink key={c.to} to={c.to} end className={({ isActive }) => `nav-item ${isActive || (c.to.split('/').length > 2 && pathname.startsWith(c.to + '/')) ? 'is-active' : ''}`}>
              <span className="nav-item__label">{c.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Topbar ------------------------------ */

interface Notes { overdue_fees: number | null; urgent_jobs: number | null; unpaid_bills: number | null; recent_activity: AuditItem[] }

function Topbar({ onToggleNav, collapsed, onSearch }: { onToggleNav: () => void; collapsed: boolean; onSearch: () => void }) {
  const { user, role, theme, toggleTheme, signOut } = useApp();
  const nav = useNavigate();
  const { data: notes } = useQuery<Notes>('/meta/notifications');
  const [pw, setPw] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const attention = (notes?.overdue_fees ?? 0) + (notes?.urgent_jobs ?? 0);

  return (
    <header className="topbar no-print">
      <button className="icon-btn" onClick={onToggleNav} aria-label="Toggle navigation">
        <span className="hide-lg">{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</span>
        <span className="show-md">
          <MenuIcon />
        </span>
      </button>
      <button className="topbar__search" onClick={onSearch} aria-label="Search">
        <Search size={17} />
        <span>Search students, customers, jobs, receipts…</span>
        <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="topbar__spacer" />
      <div className="topbar__actions">
        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" data-tip={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? <Moon /> : <Sun />}
        </button>

        <Menu
          trigger={
            <button className="icon-btn" aria-label="Notifications">
              <Bell />
              {attention > 0 && <span className="ping" />}
            </button>
          }
        >
          <div style={{ width: 320 }}>
            <div className="menu__label">Needs attention</div>
            {notes?.overdue_fees !== null && notes?.overdue_fees !== undefined && (
              <button className="menu__item" onClick={() => nav('/fees/reminders?tab=overdue')} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
                <AlertCircle style={{ color: 'var(--danger-500)' }} />
                <span>
                  <strong style={{ fontWeight: 600 }}>{notes.overdue_fees} students have overdue fees</strong>
                  <br />
                  <small className="muted">Send WhatsApp reminders from Fee Reminders</small>
                </span>
              </button>
            )}
            {notes?.urgent_jobs !== null && notes?.urgent_jobs !== undefined && (
              <button className="menu__item" onClick={() => nav('/services/jobs')} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
                <Briefcase style={{ color: 'var(--accent-500)' }} />
                <span>
                  <strong style={{ fontWeight: 600 }}>{notes.urgent_jobs} service jobs are past their last date</strong>
                  <br />
                  <small className="muted">Review pending and in-process jobs</small>
                </span>
              </button>
            )}
            {notes?.unpaid_bills ? (
              <button className="menu__item" onClick={() => nav('/services/bills')} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
                <ReceiptText style={{ color: 'var(--warning-500)' }} />
                <span>
                  <strong style={{ fontWeight: 600 }}>{notes.unpaid_bills} service bills are unpaid</strong>
                </span>
              </button>
            ) : null}
            {!!notes?.recent_activity.length && (
              <>
                <div className="menu__sep" />
                <div className="menu__label">Recent activity</div>
                {notes.recent_activity.map((a, i) => (
                  <div key={i} className="menu__item" style={{ whiteSpace: 'normal', alignItems: 'flex-start', cursor: 'default' }}>
                    <FileText />
                    <span>
                      <span style={{ fontSize: 13 }}>{a.summary}</span>
                      <br />
                      <small className="muted">
                        {a.by?.name ?? 'System'} · {ago(a.at)}
                      </small>
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </Menu>

        <Menu
          trigger={
            <button className="user-btn" aria-label="Account">
              <Avatar name={user.name} />
              <span className="user-btn__meta">
                <strong>{user.name}</strong>
                <span>
                  {role}
                  {user.designation && ` · ${user.designation}`}
                </span>
              </span>
            </button>
          }
        >
          <div className="menu__label">Signed in as {user.username}</div>
          <button className="menu__item" onClick={() => setPw(true)}>
            <KeyRound /> Change password
          </button>
          <div className="menu__sep" />
          <button
            className="menu__item danger"
            onClick={() => {
              signOut();
              nav('/login');
            }}
          >
            <LogOut /> Sign out
          </button>
        </Menu>
      </div>
      <ChangePassword open={pw} onClose={() => setPw(false)} />
    </header>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF({ current: '', next: '', again: '' });
      setErr('');
    }
  }, [open]);
  const save = async () => {
    if (f.next.length < 10) return setErr('New password must be at least 10 characters.');
    if (f.next !== f.again) return setErr('New passwords don’t match.');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: f.current, new_password: f.next } });
      toast('success', 'Password changed', 'Other devices have been signed out.');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal__head">
        <div className="modal__icon primary">
          <KeyRound />
        </div>
        <div>
          <h2>Change password</h2>
          <p>At least 10 characters, not your username or a common password. Other devices will be signed out.</p>
        </div>
      </div>
      <div className="modal__body stack" style={{ gap: 12 }}>
        <Field label="Current password" htmlFor="pw0">
          <input id="pw0" type="password" className="input" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="New password" htmlFor="pw1">
          <input id="pw1" type="password" className="input" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Repeat new password" htmlFor="pw2" error={err || undefined}>
          <input id="pw2" type="password" className="input" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
        </Field>
      </div>
      <div className="modal__foot">
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.current || !f.next}>
          {busy && <span className="spinner" />} Save password
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------ Command palette ------------------------------ */

interface Cmd { group: string; label: string; sub?: string; icon: JSX.Element; to: string }
interface Hit { code: string; label: string; sub: string }
type SearchResult = Partial<Record<'students' | 'enquiries' | 'customers' | 'service_jobs' | 'receipts' | 'service_bills', Hit[]>>;

const GROUPS: [keyof SearchResult, string, JSX.Element, (code: string) => string][] = [
  ['enquiries', 'Enquiries', <Users key="e" />, (c) => `/enquiries/${c}`],
  ['students', 'Students', <Users key="s" />, (c) => `/students/${c}`],
  ['customers', 'Customers', <UserRound key="c" />, (c) => `/services/customers/${c}`],
  ['service_jobs', 'Service jobs', <Briefcase key="j" />, (c) => `/services/jobs/${c}`],
  ['receipts', 'Receipts', <FileText key="r" />, (c) => `/fees/receipts/${c}`],
  ['service_bills', 'Service bills', <ReceiptText key="b" />, (c) => `/services/bills/${c}`],
];

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { can } = useApp();
  const listRef = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 200);
  const { data } = useQuery<SearchResult>(dq.length >= 2 ? '/search' : null, { q: dq });

  const results = useMemo<Cmd[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const pages = NAV.flatMap((sec) => sec.items.flatMap((n) => (n.children ? n.children.map((c) => ({ label: c.label, to: c.to, perm: c.perm ?? n.perm })) : [{ label: n.label, to: n.to!, perm: n.perm }])))
      .filter((p) => (!p.perm || can(p.perm)) && p.label.toLowerCase().includes(s))
      .map<Cmd>((p) => ({ group: 'Go to', label: p.label, icon: <ChevronRight />, to: p.to }));
    const hits = dq.length >= 2 && data
      ? GROUPS.flatMap(([key, group, icon, to]) => (data[key] ?? []).map<Cmd>((h) => ({ group, label: h.label, sub: h.sub, icon, to: to(h.code) })))
      : [];
    return [...pages, ...hits];
  }, [q, dq, data, can]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (c: Cmd) => {
    nav(c.to);
    onClose();
  };

  let lastGroup = '';
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-label="Search">
        <div className="cmdk__input">
          <Search />
          <input
            autoFocus
            placeholder="Name, mobile, Student ID, Aadhaar (12 digits), job or receipt no."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && results[active]) go(results[active]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="cmdk__list" ref={listRef}>
          {results.length === 0 && q.trim() && (
            <div className="empty" style={{ padding: 32 }}>
              <div className="empty__art">
                <Search />
              </div>
              <h3>No matches for “{q}”</h3>
              <p>Try a mobile number, Student ID (UC-…), job ID (SJ-…) or receipt number.</p>
            </div>
          )}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? <div className="cmdk__group">{r.group}</div> : null;
            lastGroup = r.group;
            return (
              <div key={r.group + r.label + i}>
                {head}
                <button className={`cmdk__item ${i === active ? 'is-active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => go(r)}>
                  <span className="ico">{r.icon}</span>
                  <span>
                    <strong>{r.label}</strong>
                    {r.sub && <small>{r.sub}</small>}
                  </span>
                  <CornerDownLeft size={15} className="enter" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk__foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">↵</kbd> open
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
