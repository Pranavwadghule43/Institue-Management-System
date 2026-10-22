import { Link } from 'react-router-dom';
import { ArrowLeft, Compass, Lock } from 'lucide-react';
import { useApp } from '../app/AppContext';

export default function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <div className="denied">
      <div className="empty">
        <div className="empty__art">
          <Compass />
        </div>
        <h3>We couldn’t find that {what}</h3>
        <p>It may have been moved or deleted, or the link is incorrect.</p>
        <Link to="/" className="btn btn-primary">
          <ArrowLeft /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}

/** Shown when a user reaches a route without permission (API would return 403). */
export function PermissionDenied() {
  const { setRole, role } = useApp();
  return (
    <div className="denied">
      <div className="empty">
        <div className="empty__art">
          <Lock />
        </div>
        <h3>You don’t have access to this page</h3>
        <p>This area is restricted to administrators. If you need access, ask the Admin to update your permissions.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <Link to="/" className="btn btn-secondary" style={{ marginTop: 0 }}>
            <ArrowLeft /> Dashboard
          </Link>
          {role === 'Staff' && (
            <button className="btn btn-ghost" style={{ marginTop: 0 }} onClick={() => setRole('Admin')}>
              Switch preview to Admin
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
