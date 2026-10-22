import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Ban, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Clock, Home,
  Loader2, MoreHorizontal, PauseCircle, X,
} from 'lucide-react';
import { avatarColor, initials, money } from '../lib/format';
import type { BillStatus, JobStatus } from '../data/types';
import type { FeeState, InstState } from '../data/store';

/* ------------------------------ Layout bits ------------------------------ */

export function PageHeader({ title, sub, crumbs, actions }: { title: ReactNode; sub?: ReactNode; crumbs?: [string, string?][]; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__title">
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to="/" aria-label="Dashboard">
              <Home />
            </Link>
            {crumbs.map(([label, to], i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                <ChevronRight />
                {to ? <Link to={to}>{label}</Link> : <span>{label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, sub, icon, actions, children, flush, className = '', foot }: { title?: ReactNode; sub?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; foot?: ReactNode }) {
  return (
    <section className={`panel ${flush ? 'panel--flush' : ''} ${className}`}>
      {title && (
        <div className="panel__head">
          <div>
            <h2>
              {icon}
              {title}
            </h2>
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className="panel__body">{children}</div>
      {foot && <div className="panel__foot">{foot}</div>}
    </section>
  );
}

/* ------------------------------ Data display ------------------------------ */

export const Money = ({ v, className = '' }: { v: number; className?: string }) => <span className={`money ${className}`}>{money(v)}</span>;

export function Avatar({ name, size = '' }: { name: string; size?: '' | 'sm' | 'lg' | 'xl' }) {
  return (
    <span className={`avatar ${size}`} style={{ background: avatarColor(name) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Person({ name, sub, to }: { name: string; sub?: ReactNode; to?: string }) {
  const body = (
    <div className="person">
      <Avatar name={name} />
      <div className="person__meta">
        <strong>{name}</strong>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'hold' | 'neutral' | 'primary' | 'accent';
export const Badge = ({ tone, children, icon, dot }: { tone: Tone; children: ReactNode; icon?: ReactNode; dot?: boolean }) => (
  <span className={`badge badge--${tone}`}>
    {dot && <span className="dot" />}
    {icon}
    {children}
  </span>
);

const jobMeta: Record<JobStatus, { tone: Tone; icon: ReactNode }> = {
  Pending: { tone: 'warning', icon: <Clock /> },
  'In Process': { tone: 'info', icon: <Loader2 /> },
  'On Hold': { tone: 'hold', icon: <PauseCircle /> },
  Completed: { tone: 'success', icon: <CheckCircle2 /> },
  Cancelled: { tone: 'danger', icon: <Ban /> },
};
export const jobTone = (s: JobStatus) => jobMeta[s].tone;
export const JobStatusBadge = ({ s }: { s: JobStatus }) => (
  <Badge tone={jobMeta[s].tone} icon={jobMeta[s].icon}>
    {s}
  </Badge>
);
export const JobStatusIcon = ({ s }: { s: JobStatus }) => <>{jobMeta[s].icon}</>;

export const BillStatusBadge = ({ s }: { s: BillStatus }) =>
  s === 'Paid' ? <Badge tone="success" icon={<CheckCircle2 />}>Paid</Badge> : s === 'Unpaid' ? <Badge tone="warning" icon={<Clock />}>Unpaid</Badge> : <Badge tone="danger" icon={<Ban />}>Cancelled</Badge>;

export function FeeStateBadge({ s }: { s: FeeState }) {
  switch (s) {
    case 'Fully Paid':
      return <Badge tone="success" icon={<CheckCircle2 />}>Fully paid</Badge>;
    case 'Overdue':
      return <Badge tone="danger" icon={<AlertCircle />}>Overdue</Badge>;
    case 'Due Today':
      return <Badge tone="accent" icon={<Clock />}>Due today</Badge>;
    case 'Due Tomorrow':
      return <Badge tone="warning" icon={<Clock />}>Due tomorrow</Badge>;
    default:
      return <Badge tone="neutral" dot>On track</Badge>;
  }
}

export function InstBadge({ s }: { s: InstState }) {
  const map: Record<InstState, [Tone, ReactNode]> = {
    Paid: ['success', <CheckCircle2 key="i" />],
    Partial: ['info', <CircleDot key="i" />],
    Overdue: ['danger', <AlertCircle key="i" />],
    'Due Today': ['accent', <Clock key="i" />],
    Upcoming: ['neutral', <Clock key="i" />],
  };
  return (
    <Badge tone={map[s][0]} icon={map[s][1]}>
      {s}
    </Badge>
  );
}

export const StatusDot = ({ s }: { s: string }) => {
  const tone: Tone = s === 'Active' || s === 'Running' || s === 'Success' ? 'success' : s === 'Completed' ? 'primary' : s === 'Upcoming' || s === 'Locked' ? 'warning' : s === 'Left' || s === 'Disabled' || s === 'Failed' ? 'danger' : 'neutral';
  return (
    <Badge tone={tone} dot>
      {s}
    </Badge>
  );
};

export function Progress({ value, tone = '', lg }: { value: number; tone?: '' | 'success' | 'warning' | 'danger'; lg?: boolean }) {
  return (
    <div className={`progress ${tone} ${lg ? 'lg' : ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/* ------------------------------ Overlays ------------------------------ */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, children, size = '' }: { open: boolean; onClose: () => void; children: ReactNode; size?: '' | 'lg' }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function Confirm({
  open, onClose, onConfirm, title, body, tone = 'primary', confirmLabel = 'Confirm', icon, children, busy, disabled,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; body?: ReactNode; tone?: 'primary' | 'danger' | 'success' | 'warning';
  confirmLabel?: string; icon: ReactNode; children?: ReactNode; busy?: boolean; disabled?: boolean;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose}>
      <div className="modal__head">
        <div className={`modal__icon ${tone}`}>{icon}</div>
        <div>
          <h2>{title}</h2>
          {body && <p>{body}</p>}
        </div>
      </div>
      {children && <div className="modal__body">{children}</div>}
      {!children && <div style={{ height: 18 }} />}
      <div className="modal__foot">
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy || disabled}>
          {busy && <span className="spinner" />}
          {busy ? 'Processing…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Drawer({ open, onClose, title, sub, children, foot }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; foot?: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer__head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {foot && <div className="drawer__foot">{foot}</div>}
      </aside>
    </>
  );
}

export function Menu({ trigger, children, align = 'right' }: { trigger?: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref} onClick={(e) => e.stopPropagation()}>
      <span onClick={() => setOpen((o) => !o)}>
        {trigger ?? (
          <button className="icon-btn sm" aria-label="More actions" aria-expanded={open}>
            <MoreHorizontal />
          </button>
        )}
      </span>
      {open && (
        <div className={`menu ${align === 'left' ? 'left' : ''}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Forms ------------------------------ */

export function Field({ label, required, error, hint, children, className = '', htmlFor }: { label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="req" aria-label="required">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          <AlertCircle />
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  );
}

/** ₹ amount input — digits only, Indian grouping as you type */
export function MoneyInput({ value, onChange, id, xl, placeholder = '0' }: { value: number | ''; onChange: (v: number | '') => void; id?: string; xl?: boolean; placeholder?: string }) {
  const shown = value === '' ? '' : new Intl.NumberFormat('en-IN').format(value);
  return (
    <div className="input-group">
      <span className="input-prefix">₹</span>
      <input
        id={id}
        className={`input num ${xl ? 'input-xl' : ''}`}
        inputMode="numeric"
        value={shown}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 9);
          onChange(raw === '' ? '' : parseInt(raw, 10));
        }}
      />
    </div>
  );
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'is-on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange, block }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; block?: boolean }) {
  return (
    <div className={`segmented ${block ? 'block' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: string; count?: number; alert?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'is-active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className={`count ${t.alert && t.count > 0 ? 'alert' : ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Tables & states ------------------------------ */

export function usePaged<T>(rows: T[], size = 10) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  useEffect(() => setPage(1), [rows.length]);
  return { page: p, pages, setPage, slice: rows.slice((p - 1) * size, p * size), total: rows.length, size };
}

export function Pagination({ page, pages, setPage, total, size, noun = 'records' }: { page: number; pages: number; setPage: (n: number) => void; total: number; size: number; noun?: string }) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="pagination">
      <span>
        Showing <strong className="num">{from}–{to}</strong> of <strong className="num">{total.toLocaleString('en-IN')}</strong> {noun}
      </span>
      <div className="pagination__pages">
        <button onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
          <ChevronLeft />
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} style={{ padding: '0 4px' }}>
              …
            </span>
          ) : (
            <button key={n} className={n === page ? 'is-active' : ''} onClick={() => setPage(n)}>
              {n}
            </button>
          ),
        )}
        <button onClick={() => setPage(page + 1)} disabled={page === pages} aria-label="Next page">
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art">{icon}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ padding: '6px 16px' }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`, gap: 18, padding: '14px 0', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
          <div className="row">
            <div className="skeleton" style={{ width: 34, height: 34, borderRadius: '50%' }} />
            <div style={{ flex: 1 }}>
              <div className="skeleton" style={{ height: 11, width: '70%', marginBottom: 7 }} />
              <div className="skeleton" style={{ height: 9, width: '40%' }} />
            </div>
          </div>
          {Array.from({ length: cols - 1 }).map((__, c) => (
            <div key={c} className="skeleton" style={{ height: 11, width: `${50 + ((r * 7 + c * 13) % 40)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Simulated network latency so loading states are visible in the prototype */
export function useLoading(ms = 450, deps: unknown[] = []) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return loading;
}

export function useDebounced<T>(v: T, ms = 220) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
