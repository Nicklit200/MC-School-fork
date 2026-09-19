import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '../api/types';
import { useAuth } from './AuthContext';
import { homePathForRole } from './roleRoutes';

/**
 * Guards a route: redirects to /login when signed out, or to the caller's own
 * home when they lack the required role. Server-side checks still enforce
 * authorization — this only keeps the UI tidy.
 */
export function ProtectedRoute({ role, children }: { role?: Role | Role[]; children: ReactNode }) {
  const { user, initializing } = useAuth();

  if (initializing) {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  const allowed = role === undefined || (Array.isArray(role) ? role.includes(user.role) : user.role === role);
  if (!allowed) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }
  return <>{children}</>;
}
