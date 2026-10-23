import type { ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './app/AppContext';
import { AppShell } from './app/AppShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StudentList from './pages/students/StudentList';
import Admission from './pages/students/Admission';
import { EnquiryDashboard, EnquiryDetail, NewEnquiry } from './pages/students/Enquiries';
import StudentProfile from './pages/students/StudentProfile';
import { Courses } from './pages/academics/Academics';
import FeeCollection from './pages/fees/FeeCollection';
import { FeeReminders, PaymentHistory, ReceiptView } from './pages/fees/FeeFinance';
import Jobs from './pages/services/Jobs';
import JobDetail from './pages/services/JobDetail';
import { CustomerProfile, Customers } from './pages/services/Customers';
import { Bills } from './pages/services/Bills';
import BillDesk from './pages/services/BillDesk';
import ServiceMaster from './pages/services/ServiceMaster';
import Expenses from './pages/Expenses';
import { DailyCash, ProfitLoss } from './pages/Finance';
import { ReportViewer, ReportsCenter } from './pages/Reports';
import { Audit, Backup, Permissions, Settings, Staff } from './pages/Admin';
import NotFound, { PermissionDenied } from './pages/NotFound';

/* Route guards are UX only — the API returns 401/403 regardless. */
function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useApp();
  return can(perm) ? <>{children}</> : <PermissionDenied />;
}

function Booting() {
  return (
    <div className="denied">
      <span className="spinner" aria-label="Loading" />
    </div>
  );
}

function Protected() {
  const { signedIn, booting } = useApp();
  if (booting) return <Booting />;
  return signedIn ? <AppShell /> : <Navigate to="/login" replace />;
}

function LoginRoute() {
  const { signedIn, booting } = useApp();
  if (booting) return <Booting />;
  return signedIn ? <Navigate to="/" replace /> : <Login />;
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<Protected />}>
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Guard perm="students.view"><StudentList /></Guard>} />
            <Route path="students/new" element={<Guard perm="students.create"><Admission /></Guard>} />
            <Route path="enquiries" element={<Guard perm="students.view"><EnquiryDashboard /></Guard>} />
            <Route path="enquiries/new" element={<Guard perm="students.create"><NewEnquiry /></Guard>} />
            <Route path="enquiries/:id" element={<Guard perm="students.view"><EnquiryDetail /></Guard>} />
            <Route path="students/:id" element={<Guard perm="students.view"><StudentProfile /></Guard>} />
            <Route path="academics/courses" element={<Guard perm="courses.manage"><Courses /></Guard>} />
            <Route path="academics/batches" element={<Navigate to="/academics/courses" replace />} />
            <Route path="fees/collect" element={<Guard perm="fees.collect"><FeeCollection /></Guard>} />
            <Route path="fees/payments" element={<Guard perm="fees.view"><PaymentHistory /></Guard>} />
            <Route path="fees/receipts" element={<Guard perm="receipts.view_print"><PaymentHistory receipts /></Guard>} />
            <Route path="fees/receipts/:no" element={<Guard perm="receipts.view_print"><ReceiptView /></Guard>} />
            <Route path="fees/reminders" element={<Guard perm="reminders.view"><FeeReminders /></Guard>} />
            <Route path="services/jobs" element={<Guard perm="service_jobs.view"><Jobs /></Guard>} />
            <Route path="services/jobs/:id" element={<Guard perm="service_jobs.view"><JobDetail /></Guard>} />
            <Route path="services/customers" element={<Guard perm="customers.view"><Customers /></Guard>} />
            <Route path="services/customers/:id" element={<Guard perm="customers.view"><CustomerProfile /></Guard>} />
            <Route path="services/bills" element={<Guard perm="service_bill.create"><Bills /></Guard>} />
            <Route path="services/bills/new" element={<Guard perm="service_bill.create"><BillDesk /></Guard>} />
            <Route path="services/bills/:id" element={<Guard perm="service_bill.create"><BillDesk /></Guard>} />
            <Route path="services/master" element={<Guard perm="service_master.manage"><ServiceMaster /></Guard>} />
            <Route path="expenses" element={<Guard perm="expenses.view"><Expenses /></Guard>} />
            <Route path="finance/daily-cash" element={<Guard perm="reports.view"><DailyCash /></Guard>} />
            <Route path="finance/pnl" element={<Guard perm="reports.view"><ProfitLoss /></Guard>} />
            <Route path="reports" element={<Guard perm="reports.view"><ReportsCenter /></Guard>} />
            <Route path="reports/:slug" element={<Guard perm="reports.view"><ReportViewer /></Guard>} />
            <Route path="admin/staff" element={<Guard perm="staff.manage"><Staff /></Guard>} />
            <Route path="admin/permissions" element={<Guard perm="permissions.manage"><Permissions /></Guard>} />
            <Route path="admin/audit" element={<Guard perm="audit.view"><Audit /></Guard>} />
            <Route path="admin/backup" element={<Guard perm="backup.create"><Backup /></Guard>} />
            <Route path="admin/settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  );
}
