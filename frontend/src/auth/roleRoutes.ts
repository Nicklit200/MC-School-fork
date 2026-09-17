import type { Role } from '../api/types';

/** The landing page each role sees after signing in. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return '/teachers';
    case 'TEACHER':
      return '/students';
    case 'STUDENT':
      return '/today';
    case 'PARENT':
      return '/parent';
  }
}
