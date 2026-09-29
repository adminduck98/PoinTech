import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentAdmin, verifyAdminSession, can, type Capability } from '../lib/auth';

interface Props {
  children: React.ReactNode;
  /** Capability the route needs. Omit for pages any signed-in admin may open. */
  requires?: Capability;
  /** 'read' for view-only pages, 'write' for pages that change data. */
  mode?: 'read' | 'write';
}

export const AdminRoute = ({ children, requires, mode = 'write' }: Props) => {
  const [verified, setVerified] = useState<boolean | null>(null);
  const admin = getCurrentAdmin();

  useEffect(() => {
    if (!admin) {
      setVerified(false);
      return;
    }

    verifyAdminSession().then((valid) => {
      setVerified(valid);
    });
  }, [admin]);

  // Loading state while verifying
  if (verified === null) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!verified || !admin) {
    return <Navigate to="/nanyy" replace />;
  }

  // UI-level gate only — admin-api enforces the same matrix server-side.
  if (requires && !can(admin, requires, mode)) {
    return <Navigate to="/nanyy/dashboard" replace />;
  }

  return <>{children}</>;
};
