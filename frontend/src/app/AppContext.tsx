import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import type { Me, Role } from '../api/types';

/* Permission catalog — mirrors the backend (app/security.py). Admin has all.
   UI hiding is convenience only; the API enforces every rule. */
export const PERMISSIONS = [
  { group: 'Students', items: [['students.view', 'View students and enquiries'], ['students.create', 'Create enquiries and admissions'], ['students.edit', 'Edit students'], ['students.delete', 'Archive students']] },
  { group: 'Academics', items: [['courses.manage', 'Manage courses'], ['batches.manage', 'Manage time slots']] },
  { group: 'Student Finance', items: [['fees.view', 'View fees'], ['fees.collect', 'Collect fees'], ['receipts.view_print', 'Print receipts'], ['reminders.view', 'Fee reminders']] },
  { group: 'Services', items: [['customers.view', 'View customers'], ['customers.manage', 'Manage customers'], ['service_jobs.view', 'View jobs'], ['service_jobs.create', 'Create jobs'], ['service_jobs.update', 'Update jobs'], ['service_jobs.assign', 'Assign staff'], ['service_jobs.status', 'Change job status'], ['service_documents.upload', 'Upload documents'], ['service_documents.view_sensitive', 'View sensitive documents'], ['service_documents.delete', 'Delete documents'], ['service_bill.create', 'Create service bills']] },
  { group: 'Expenses & Reports', items: [['expenses.view', 'View expenses'], ['expenses.create', 'Add expenses'], ['expenses.edit_delete', 'Edit / delete expenses'], ['reports.view', 'View reports'], ['audit.view', 'View audit log']] },
  { group: 'Admin only', items: [['payments.delete_or_reverse', 'Reverse payments'], ['service_master.manage', 'Service master'], ['service_bill.rate_override', 'Override bill rate'], ['service_bill.edit_after_payment', 'Edit paid bills'], ['service_bill.cancel', 'Cancel bills'], ['staff.manage', 'Manage staff'], ['permissions.manage', 'Manage permissions'], ['backup.create', 'Create backup'], ['backup.restore', 'Restore backup'], ['settings.manage', 'Settings']] },
] as const;

export const ADMIN_ONLY = new Set<string>(PERMISSIONS.find((g) => g.group === 'Admin only')!.items.map((i) => i[0]));

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; title: string; body?: string }
export interface User { id: number; name: string; username: string; role: Role; designation: string; permissions: string[]; whatsappDocumentDelivery: boolean }

interface Ctx {
  role: Role;
  user: User;
  can: (perm: string) => boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  toast: (kind: ToastKind, title: string, body?: string) => void;
  signedIn: boolean;
  booting: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  refreshMe: () => Promise<void>;
}

const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

const toUser = (m: Me): User => ({
  id: m.id, name: m.full_name, username: m.username, role: m.role, designation: m.designation ?? '',
  permissions: m.permissions, whatsappDocumentDelivery: m.whatsapp_document_delivery ?? true,
});
const NOBODY: User = { id: 0, name: '', username: '', role: 'Staff', designation: '', permissions: [], whatsappDocumentDelivery: false };

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(!!getToken());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('ims.theme') as 'light' | 'dark') || 'light';
    } catch {
      return 'light';
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => setUser(toUser(await api<Me>('/auth/me'))), []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (getToken()) toast('info', 'Signed out', 'Your session ended. Please sign in again.');
      clear();
    });
    if (getToken()) refreshMe().catch(clear).finally(() => setBooting(false));
  }, [clear, refreshMe, toast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ims.theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const can = useCallback((perm: string) => !!user && (user.role === 'Admin' || user.permissions.includes(perm)), [user]);

  const value = useMemo<Ctx>(
    () => ({
      role: user?.role ?? 'Staff',
      user: user ?? NOBODY,
      can,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
      toast,
      signedIn: !!user,
      booting,
      signIn: async (username, password) => {
        const r = await api<{ token: string; user: Me }>('/auth/login', { method: 'POST', body: { username, password } });
        setToken(r.token);
        setUser(toUser(r.user));
      },
      signOut: () => {
        api('/auth/logout', { method: 'POST' }).catch(() => {}).finally(clear);
      },
      refreshMe,
    }),
    [user, can, theme, toast, booting, clear, refreshMe],
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

/** Error text for toasts and inline messages. */
export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');
