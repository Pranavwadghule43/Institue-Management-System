import { Link } from 'react-router-dom';
import { useApp } from '../app/AppContext';

/** Counter shortcuts — the same Alt keys work anywhere in the app (see AppShell) */
export function Shortcuts() {
  const { can } = useApp();
  return (
    <nav className="shortcuts" aria-label="Quick actions">
      {can('students.create') && (
        <Link to="/students/new">
          <kbd>Alt A</kbd> New admission
        </Link>
      )}
      {can('fees.collect') && (
        <Link to="/fees/collect" className="primary">
          <kbd>Alt F</kbd> Collect fee
        </Link>
      )}
      {can('service_jobs.create') && (
        <Link to="/services/jobs?new=1">
          <kbd>Alt J</kbd> Service job
        </Link>
      )}
      {can('service_bill.create') && (
        <Link to="/services/bills/new">
          <kbd>Alt B</kbd> Service bill
        </Link>
      )}
      {can('expenses.create') && (
        <Link to="/expenses?new=1">
          <kbd>Alt E</kbd> Expense
        </Link>
      )}
      <button onClick={() => document.querySelector<HTMLButtonElement>('.topbar__search')?.click()}>
        <kbd>Ctrl K</kbd> Find student
      </button>
      <Link to="/reports" className="push">
        Reports
      </Link>
    </nav>
  );
}
