import { Navigate } from 'react-router-dom';
import { useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getAccessToken } from '../api/client';
import { homePathForRole } from '../auth/roleRoutes';

export function SkillsPage() {
  const { user } = useAuth();
  const frame = useRef<HTMLIFrameElement>(null);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') return <Navigate to={homePathForRole(user.role)} replace />;
  return <iframe ref={frame} title="Карта навыков — 6 класс" src="/skills-board/index.html"
    allow="fullscreen" allowFullScreen
    style={{ width: '100%', height: 'calc(100dvh - 140px)', minHeight: 600, border: '1px solid #e5e7eb', borderRadius: 18, display: 'block', background: '#fff' }}
    onLoad={() => frame.current?.contentWindow?.postMessage({
      type: 'mindcrafti-skills-config',
      apiBase: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
      token: getAccessToken(), canEdit: user.role === 'ADMIN', userId: user.id,
    }, window.location.origin)}
  />;
}
