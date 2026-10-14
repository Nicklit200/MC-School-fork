import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '../api/types';
import { ProtectedRoute } from './ProtectedRoute';

const authState: { user: { role: Role } | null; initializing: boolean } = {
  user: null,
  initializing: false,
};

vi.mock('./AuthContext', () => ({
  useAuth: () => authState,
}));

function renderAt(path: string, role?: Role | Role[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/online-classes"
          element={
            <ProtectedRoute role={role}>
              <p>class list</p>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/today" element={<p>student home</p>} />
        <Route path="/students" element={<p>teacher home</p>} />
        <Route path="/parent" element={<p>parent home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('sends a signed-out visitor to login', () => {
    authState.user = null;
    renderAt('/online-classes', ['TEACHER', 'STUDENT']);

    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('admits a teacher to a shared teacher/student route', () => {
    authState.user = { role: 'TEACHER' };
    renderAt('/online-classes', ['TEACHER', 'STUDENT']);

    expect(screen.getByText('class list')).toBeInTheDocument();
  });

  it('admits a student to a shared teacher/student route', () => {
    authState.user = { role: 'STUDENT' };
    renderAt('/online-classes', ['TEACHER', 'STUDENT']);

    expect(screen.getByText('class list')).toBeInTheDocument();
  });

  it('redirects a parent away from online classes', () => {
    // Parents do not join classes in this release.
    authState.user = { role: 'PARENT' };
    renderAt('/online-classes', ['TEACHER', 'STUDENT']);

    expect(screen.queryByText('class list')).not.toBeInTheDocument();
    expect(screen.getByText('parent home')).toBeInTheDocument();
  });

  it('still enforces a single required role', () => {
    authState.user = { role: 'STUDENT' };
    renderAt('/online-classes', 'TEACHER');

    expect(screen.queryByText('class list')).not.toBeInTheDocument();
    expect(screen.getByText('student home')).toBeInTheDocument();
  });

  it('renders nothing while auth is still initializing', () => {
    authState.user = null;
    authState.initializing = true;
    const { container } = renderAt('/online-classes', ['TEACHER', 'STUDENT']);

    expect(container).toBeEmptyDOMElement();
    authState.initializing = false;
  });
});
