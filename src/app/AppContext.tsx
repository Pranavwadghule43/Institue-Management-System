import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { DEMO_ROLES } from '../data/mock';
import type { Role, Staff } from '../data/types';

/* Permission catalog — mirrors 05_USER_ROLES_AND_PERMISSIONS. Admin has all.
   UI hiding is convenience only; the API enforces the real rule. */
export const PERMISSIONS = [
  { group: 'Students', items: [['students.view', 'View students and enquiries'], ['students.create', 'Create enquiries and admissions'], ['students.edit', 'Edit students'], ['students.delete', 'Delete students']] },
  { group: 'Academics', items: [['courses.manage', 'Manage courses'], ['batches.manage', 'Manage batches']] },
  { group: 'Student Finance', items: [['fees.view', 'View fees'], ['fees.collect', 'Collect fees'], ['payments.delete_or_reverse', 'Reverse payments'], ['receipts.view_print', 'Print receipts'], ['reminders.view', 'Fee reminders']] },
  { group: 'Services', items: [['customers.view', 'View customers'], ['customers.manage', 'Manage customers'], ['service_jobs.view', 'View jobs'], ['service_jobs.create', 'Create jobs'], ['service_jobs.update', 'Update jobs'], ['service_jobs.assign', 'Assign staff'], ['service_jobs.status', 'Change job status'], ['service_documents.upload', 'Upload documents'], ['service_documents.view_sensitive', 'View sensitive documents'], ['service_documents.delete', 'Delete documents'], ['service_bill.create', 'Create service bills']] },
  { group: 'Expenses & Reports', items: [['expenses.view', 'View expenses'], ['expenses.create', 'Add expenses'], ['expenses.edit_delete', 'Edit / delete expenses'], ['reports.view', 'View reports'], ['audit.view', 'View audit log']] },
  { group: 'Admin only', items: [['service_master.manage', 'Service master'], ['service_bill.rate_override', 'Override bill rate'], ['service_bill.edit_after_payment', 'Edit paid bills'], ['service_bill.cancel', 'Cancel bills'], ['staff.manage', 'Manage staff'], ['permissions.manage', 'Manage permissions'], ['backup.create', 'Create backup'], ['backup.restore', 'Restore backup'], ['settings.manage', 'Settings']] },
] as const;

export const ADMIN_ONLY = new Set<string>(PERMISSIONS.find((g) => g.group === 'Admin only')!.items.map((i) => i[0]));

const DEFAULT_STAFF_PERMS = new Set<string>([
  'students.view', 'students.create', 'students.edit', 'fees.view', 'fees.collect', 'receipts.view_print', 'reminders.view',
  'customers.view', 'customers.manage', 'service_jobs.view', 'service_jobs.create', 'service_jobs.update', 'service_jobs.assign',
  'service_jobs.status', 'service_documents.upload', 'service_bill.create', 'expenses.view', 'expenses.create', 'reports.view',
]);

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }

interface Ctx {
  role: Role;
  user: Staff;
  setRole: (r: Role) => void;
  can: (perm: string) => boolean;
  staffPerms: Record<string, Set<string>>;
  setStaffPerms: (p: Record<string, Set<string>>) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  toast: (kind: ToastKind, title: string, body?: string) => void;
  signedIn: boolean;
  signIn: (r: Role) => void;
  signOut: () => void;
}

const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>((read('ims.role') as Role) || 'Admin');
  const [signedIn, setSignedIn] = useState(read('ims.signedIn') === '1');
  const [theme, setTheme] = useState<'light' | 'dark'>((read('ims.theme') as 'light' | 'dark') || 'light');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [staffPerms, setStaffPerms] = useState<Record<string, Set<string>>>(() => {
    const defaults: Record<string, Set<string>> = {
      U2: new Set(DEFAULT_STAFF_PERMS),
      U3: new Set([...DEFAULT_STAFF_PERMS].filter((p) => !p.startsWith('fees.') && p !== 'students.create' && p !== 'students.edit')),
      U4: new Set(['students.view', 'fees.view', 'reminders.view', 'reports.view']),
      U5: new Set(['customers.view', 'service_jobs.view', 'service_jobs.update', 'service_jobs.status', 'service_documents.upload']),
      U6: new Set<string>(),
    };
    try {
      const saved = JSON.parse(read('ims.staffPerms') || 'null') as Record<string, string[]> | null;
      if (saved) for (const [uid, perms] of Object.entries(saved)) defaults[uid] = new Set(perms.filter((p) => PERMISSIONS.some((g) => g.items.some(([key]) => key === p)) && !ADMIN_ONLY.has(p)));
    } catch { /* ignore invalid demo storage */ }
    return defaults;
  });

  useEffect(() => {
    write('ims.staffPerms', JSON.stringify(Object.fromEntries(Object.entries(staffPerms).map(([id, perms]) => [id, [...perms]]))));
  }, [staffPerms]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    write('ims.theme', theme);
  }, [theme]);

  const user = DEMO_ROLES[role];
  const can = useCallback(
    (perm: string) => role === 'Admin' || (!ADMIN_ONLY.has(perm) && !!staffPerms[user.id]?.has(perm)),
    [role, staffPerms, user.id],
  );

  const toast = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      role,
      user,
      setRole: (r) => {
        setRoleState(r);
        write('ims.role', r);
      },
      can,
      staffPerms,
      setStaffPerms,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      toast,
      signedIn,
      signIn: (r) => {
        setRoleState(r);
        write('ims.role', r);
        setSignedIn(true);
        write('ims.signedIn', '1');
      },
      signOut: () => {
        setSignedIn(false);
        write('ims.signedIn', '0');
      },
    }),
    [role, user, can, staffPerms, theme, toast, signedIn],
  );

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <XCircle /> : <Info />}
            <div>
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
            </div>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X />
            </button>
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}
