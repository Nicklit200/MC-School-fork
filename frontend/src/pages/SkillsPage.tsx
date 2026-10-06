import { Navigate, useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getAccessToken } from '../api/client';
import { homePathForRole } from '../auth/roleRoutes';

export function SkillsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN' && user.role !== 'TEACHER') {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return (
    <>
      <iframe
        ref={frame}
        title="Карта навыков"
        src="/skills-board/index.html?v=20261006-3"
        allow="fullscreen"
        allowFullScreen
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          width: '100vw',
          height: '100dvh',
          minHeight: 0,
          border: 0,
          borderRadius: 0,
          display: 'block',
          background: '#f8fafc',
        }}
        onLoad={() => frame.current?.contentWindow?.postMessage({
          type: 'mindcrafti-skills-config',
          apiBase: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
          token: getAccessToken(),
          canEdit: user.role === 'ADMIN',
          userId: user.id,
        }, window.location.origin)}
      />
      <button
        type="button"
        onClick={() => navigate(homePathForRole(user.role))}
        title="Вернуться в школу"
        style={{
          position: 'fixed',
          zIndex: 1001,
          top: 18,
          right: 18,
          height: 36,
          padding: '0 12px',
          border: '1px solid #e2e8f0',
          borderRadius: 11,
          background: 'rgba(255,255,255,.94)',
          color: '#607089',
          fontWeight: 800,
          fontSize: 12,
          boxShadow: '0 8px 24px rgba(39,54,84,.10)',
          backdropFilter: 'blur(16px)',
          cursor: 'pointer',
        }}
      >
        ← В школу
      </button>
    </>
  );
}
