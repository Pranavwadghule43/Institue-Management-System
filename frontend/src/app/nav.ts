import {
  BarChart3, BookOpen, Briefcase, IndianRupee, LayoutDashboard, Receipt, Settings2, ShieldCheck, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavLeaf { label: string; to: string; perm?: string }
export interface NavNode { label: string; icon: LucideIcon; to?: string; perm?: string; children?: NavLeaf[]; badge?: 'reminders' | 'jobs' }
export interface NavSection { label: string; items: NavNode[] }

/* Mirrors the Information Architecture in 07_UI_UX_DESIGN_SPECIFICATION */
export const NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/' }],
  },
  {
    label: 'Institute',
    items: [
      {
        label: 'Admission Desk', icon: Users, perm: 'students.view',
        children: [
          { label: 'Student List', to: '/students' },
          { label: 'Enquiry Dashboard', to: '/enquiries' },
          { label: 'New Enquiry', to: '/enquiries/new', perm: 'students.create' },
        ],
      },
      {
        label: 'Academics', icon: BookOpen,
        children: [
          { label: 'Courses', to: '/academics/courses', perm: 'courses.manage' },
        ],
      },
      {
        label: 'Student Finance', icon: IndianRupee, perm: 'fees.view', badge: 'reminders',
        children: [
          { label: 'Fee Collection', to: '/fees/collect', perm: 'fees.collect' },
          { label: 'Payment History', to: '/fees/payments' },
          { label: 'Receipts', to: '/fees/receipts', perm: 'receipts.view_print' },
          { label: 'Fee Reminders', to: '/fees/reminders', perm: 'reminders.view' },
        ],
      },
    ],
  },
  {
    label: 'Digital Services',
    items: [
      {
        label: 'Services', icon: Briefcase, perm: 'service_jobs.view', badge: 'jobs',
        children: [
          { label: 'Service Jobs', to: '/services/jobs' },
          { label: 'Customers', to: '/services/customers', perm: 'customers.view' },
          { label: 'Service Bills', to: '/services/bills', perm: 'service_bill.create' },
          { label: 'Service Master', to: '/services/master', perm: 'service_master.manage' },
        ],
      },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Expenses', icon: Receipt, to: '/expenses', perm: 'expenses.view' },
      {
        label: 'Finance', icon: Wallet, perm: 'reports.view',
        children: [
          { label: 'Daily Cash', to: '/finance/daily-cash' },
          { label: 'Profit & Loss', to: '/finance/pnl' },
        ],
      },
      { label: 'Reports', icon: BarChart3, to: '/reports', perm: 'reports.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Administration', icon: ShieldCheck, perm: 'staff.manage',
        children: [
          { label: 'Staff', to: '/admin/staff' },
          { label: 'Permissions', to: '/admin/permissions' },
          { label: 'Audit & Deleted History', to: '/admin/audit' },
          { label: 'Backup', to: '/admin/backup' },
        ],
      },
      { label: 'Settings', icon: Settings2, to: '/admin/settings', perm: 'settings.manage' },
    ],
  },
];
