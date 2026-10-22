import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Bell, Briefcase, ChevronRight, CornerDownLeft, FileText, KeyRound, LogOut, Menu as MenuIcon,
  Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, UserRound, Users,
} from 'lucide-react';
import logoReverse from '../assets/logo-reverse.png';
import markReverse from '../assets/mark-reverse.png';
import { useApp } from './AppContext';
import { NAV, type NavNode } from './nav';
import { Avatar, Menu } from '../components/ui';
import { db, feeState, useStore } from '../data/store';
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
  const { user, role } = useApp();

  useEffect(() => setDrawer(false), [loc.pathname]);
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
        <Topbar
          onToggleNav={() => setCollapsed((c) => !c)}
          collapsed={collapsed}
          onSearch={() => setCmdk(true)}
        />
        <main className="content" key={loc.pathname}>
          <Outlet />
        </main>
        <footer className="appfoot no-print">
          <span>
            <span className="appfoot__dot" /> {user.name} · {role}
          </span>
          <span>Demo data · session only</span>
          <span className="appfoot__ver">IMS v1.0 · UI preview</span>
        </footer>
      </div>
      {cmdk && <CommandPalette onClose={() => setCmdk(false)} />}
    </div>
  );
}

/* ------------------------------ Sidebar ------------------------------ */

function Sidebar() {
  const { can } = useApp();
  useStore();
  const loc = useLocation();
  const reminders = db.students.filter((s) => s.status === 'Active' && ['Overdue', 'Due Today'].includes(feeState(s))).length;
  const openJobs = db.jobs.filter((j) => j.status === 'Pending' || j.status === 'In Process').length;

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
                  <NavGroup key={n.label} node={n} pathname={loc.pathname} badge={n.badge === 'reminders' ? reminders : n.badge === 'jobs' ? openJobs : undefined} />
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
      <div className="sidebar__foot">
        <div className="backup-chip" data-tip="Demo preview">
          <span className="dot" />
          <div>
            Demo preview
            <small>Data resets on reload</small>
          </div>
        </div>
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

function Topbar({ onToggleNav, collapsed, onSearch }: { onToggleNav: () => void; collapsed: boolean; onSearch: () => void }) {
  const { user, role, setRole, theme, toggleTheme, signOut, toast } = useApp();
  const nav = useNavigate();
  useStore();
  const overdue = db.students.filter((s) => s.status === 'Active' && feeState(s) === 'Overdue').length;
  const urgentJobs = db.jobs.filter((j) => (j.status === 'Pending' || j.status === 'In Process') && j.lastDate < db.TODAY).length;
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

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
        <div className="row hide-sm" style={{ gap: 4 }} title="Prototype only — preview how each role sees the system">
          <span className="role-switch__label">Viewing as</span>
          <div className="role-switch">
            {(['Admin', 'Staff'] as const).map((r) => (
              <button
                key={r}
                className={role === r ? 'is-active' : ''}
                onClick={() => {
                  setRole(r);
                  toast('info', `Now viewing as ${r}`, r === 'Staff' ? 'Admin-only menus and actions are hidden.' : 'Full access restored.');
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" data-tip={theme === 'light' ? 'Dark mode' : 'Light mode'}>
          {theme === 'light' ? <Moon /> : <Sun />}
        </button>

        <Menu
          trigger={
            <button className="icon-btn" aria-label="Notifications">
              <Bell />
              <span className="ping" />
            </button>
          }
        >
          <div style={{ width: 320 }}>
            <div className="menu__label">Needs attention</div>
            <button className="menu__item" onClick={() => nav('/fees/reminders?tab=Overdue')} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
              <AlertCircle style={{ color: 'var(--danger-500)' }} />
              <span>
                <strong style={{ fontWeight: 600 }}>{overdue} students have overdue fees</strong>
                <br />
                <small className="muted">Send WhatsApp reminders from Fee Reminders</small>
              </span>
            </button>
            <button className="menu__item" onClick={() => nav('/services/jobs')} style={{ whiteSpace: 'normal', alignItems: 'flex-start' }}>
              <Briefcase style={{ color: 'var(--accent-500)' }} />
              <span>
                <strong style={{ fontWeight: 600 }}>{urgentJobs} service jobs are past their last date</strong>
                <br />
                <small className="muted">Review pending and in-process jobs</small>
              </span>
            </button>
            <div className="menu__sep" />
            <div className="menu__label">Recent activity</div>
            {db.audit.slice(0, 3).map((a) => (
              <div key={a.id} className="menu__item" style={{ whiteSpace: 'normal', alignItems: 'flex-start', cursor: 'default' }}>
                <FileText />
                <span>
                  <span style={{ fontSize: 13 }}>{a.summary}</span>
                  <br />
                  <small className="muted">
                    {db.staffById(a.actor)?.name} · {ago(a.at)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </Menu>

        <Menu
          trigger={
            <button className="user-btn" aria-label="Account">
              <Avatar name={user.name} />
              <span className="user-btn__meta">
                <strong>{user.name}</strong>
                <span>
                  {role} · {user.designation}
                </span>
              </span>
            </button>
          }
        >
          <div className="menu__label">Signed in as {user.username}</div>
          <button className="menu__item" onClick={() => toast('info', 'Change password', 'Opens the password change dialog in the live system.')}>
            <KeyRound /> Change password
          </button>
          <div className="row show-sm-flex" style={{ padding: '6px 10px' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              View as
            </span>
            <div className="role-switch">
              {(['Admin', 'Staff'] as const).map((r) => (
                <button key={r} className={role === r ? 'is-active' : ''} onClick={() => setRole(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
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
    </header>
  );
}

/* ------------------------------ Command palette ------------------------------ */

interface Cmd { group: string; label: string; sub?: string; icon: JSX.Element; to: string }

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const nav = useNavigate();
  const { can } = useApp();
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Cmd[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const st = can('students.view') ? db.students
      .filter((x) => x.name.toLowerCase().includes(s) || x.id.toLowerCase().includes(s) || x.phone.replace(/\s/g, '').includes(s.replace(/\s/g, '')) || (/^\d{4,}$/.test(s.replace(/\s/g, '')) && x.aadhaar.replace(/\s/g, '').includes(s.replace(/\s/g, ''))))
      .slice(0, 5)
      .map<Cmd>((x) => ({ group: 'Students', label: x.name, sub: `${x.id} · ${db.courseById(x.courseId).code} · ${x.phone}`, icon: <Users />, to: `/students/${x.id}` })) : [];
    const eq = can('students.view') ? db.enquiries.filter((e) => `${e.id} ${e.name} ${e.phone}`.toLowerCase().includes(s)).slice(0, 5).map<Cmd>((e) => ({ group: 'Enquiries', label: e.name, sub: `${e.id} · ${e.status}`, icon: <Users />, to: `/enquiries/${e.id}` })) : [];
    const cu = can('customers.view')
      ? db.customers
          .filter((x) => x.name.toLowerCase().includes(s) || x.id.toLowerCase().includes(s) || x.mobile.replace(/\s/g, '').includes(s.replace(/\s/g, '')))
          .slice(0, 4)
          .map<Cmd>((x) => ({ group: 'Customers', label: x.name, sub: `${x.id} · ${x.mobile}`, icon: <UserRound />, to: `/services/customers/${x.id}` }))
      : [];
    const jb = can('service_jobs.view') ? db.jobs
      .filter((j) => j.id.toLowerCase().includes(s) || db.customerById(j.customerId).name.toLowerCase().includes(s))
      .slice(0, 4)
      .map<Cmd>((j) => ({ group: 'Service jobs', label: `${j.id} — ${db.serviceById(j.serviceIds[0]).name}`, sub: `${db.customerById(j.customerId).name} · ${j.status}`, icon: <Briefcase />, to: `/services/jobs/${j.id}` })) : [];
    const rc = can('receipts.view_print') ? db.payments
      .filter((p) => p.receiptNo.toLowerCase().includes(s))
      .slice(-3)
      .map<Cmd>((p) => ({ group: 'Receipts', label: p.receiptNo, sub: db.studentById(p.studentId).name, icon: <FileText />, to: `/fees/receipts/${p.receiptNo}` })) : [];
    const pg = NAV.flatMap((sec) => sec.items.flatMap((n) => (n.children ? n.children.map((c) => ({ label: c.label, to: c.to, perm: c.perm ?? n.perm })) : [{ label: n.label, to: n.to!, perm: n.perm }])))
      .filter((p) => (!p.perm || can(p.perm)) && p.label.toLowerCase().includes(s))
      .map<Cmd>((p) => ({ group: 'Go to', label: p.label, icon: <ChevronRight />, to: p.to }));
    return [...pg, ...eq, ...st, ...cu, ...jb, ...rc];
  }, [q, can]);

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
            placeholder="Name, mobile, Aadhaar, Student ID, job or receipt no."
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
          {results.length === 0 && (
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
