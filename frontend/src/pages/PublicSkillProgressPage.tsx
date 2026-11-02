import { useEffect, useRef } from 'react';

export function PublicSkillProgressPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  useEffect(() => {
    document.title = 'Mindcrafti · Lernkarte';
  }, []);

  return (
    <iframe
      ref={frame}
      title="Mindcrafti Lernkarte"
      src="/skills-board/index.html?v=20261102-parent"
      allow="fullscreen"
      allowFullScreen
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        border: 0,
        background: '#f8fafc',
      }}
      onLoad={() => frame.current?.contentWindow?.postMessage({
        type: 'mindcrafti-skills-public-config',
        apiBase: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1',
        shareToken: token,
      }, window.location.origin)}
    />
  );
}
