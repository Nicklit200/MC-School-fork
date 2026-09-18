import type { Role, User } from '../api/types';

const ADMIN_TOKEN_KEY = 'mindcrafti.impersonation.adminToken';
const USER_ID_KEY = 'mindcrafti.impersonation.userId';
const USER_NAME_KEY = 'mindcrafti.impersonation.userName';
const USER_ROLE_KEY = 'mindcrafti.impersonation.role';
const RETURN_TO_KEY = 'mindcrafti.impersonation.returnTo';
const LEGACY_TEACHER_ID_KEY = 'mindcrafti.impersonation.teacherId';
const LEGACY_TEACHER_NAME_KEY = 'mindcrafti.impersonation.teacherName';

export interface AdminImpersonation {
  adminToken: string;
  userId: string | null;
  userName: string | null;
  role: Role | null;
  returnTo: string | null;
}

export function saveAdminImpersonation(adminToken: string, user: User, returnTo: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
  sessionStorage.setItem(USER_ID_KEY, user.id);
  sessionStorage.setItem(USER_NAME_KEY, user.fullName);
  sessionStorage.setItem(USER_ROLE_KEY, user.role);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);
  sessionStorage.removeItem(LEGACY_TEACHER_ID_KEY);
  sessionStorage.removeItem(LEGACY_TEACHER_NAME_KEY);
}

export function readAdminImpersonation(): AdminImpersonation | null {
  const adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (!adminToken) return null;
  const legacyTeacherId = sessionStorage.getItem(LEGACY_TEACHER_ID_KEY);
  const storedRole = sessionStorage.getItem(USER_ROLE_KEY);
  const role = isRole(storedRole) ? storedRole : legacyTeacherId ? 'TEACHER' : null;
  return {
    adminToken,
    userId: sessionStorage.getItem(USER_ID_KEY) || legacyTeacherId,
    userName: sessionStorage.getItem(USER_NAME_KEY) || sessionStorage.getItem(LEGACY_TEACHER_NAME_KEY),
    role,
    returnTo: sessionStorage.getItem(RETURN_TO_KEY)
      || (legacyTeacherId ? `/admin/lessons?teacherId=${legacyTeacherId}` : '/teachers'),
  };
}

export function clearAdminImpersonation(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  sessionStorage.removeItem(USER_ID_KEY);
  sessionStorage.removeItem(USER_NAME_KEY);
  sessionStorage.removeItem(USER_ROLE_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  sessionStorage.removeItem(LEGACY_TEACHER_ID_KEY);
  sessionStorage.removeItem(LEGACY_TEACHER_NAME_KEY);
}

function isRole(value: string | null): value is Role {
  return value === 'ADMIN' || value === 'TEACHER' || value === 'STUDENT' || value === 'PARENT';
}
