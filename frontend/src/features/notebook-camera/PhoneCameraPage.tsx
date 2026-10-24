import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { notebookCameraError } from '../../api/notebookCameras';
import { PhoneCameraSession } from './PhoneCameraSession';
import './notebookCamera.css';

export function PhoneCameraPage() {
  const { cameraId: routeId } = useParams();
  const [credentials] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return { cameraId: routeId ?? fragment.get('cameraId'), token: fragment.get('token') };
  });
  const preview = useRef<HTMLVideoElement>(null);
  const session = useRef<PhoneCameraSession | null>(null);
  const [status, setStatus] = useState('Наведите телефон на тетрадь и включите камеру.');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const operation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (!credentials.cameraId || !credentials.token) {
      setStatus('Откройте эту страницу по QR-коду из урока Mindcrafti.');
      return () => { mounted.current = false; };
    }
    const controller = new PhoneCameraSession(credentials.cameraId, credentials.token, stream => {
      if (!mounted.current) return;
      setRunning(Boolean(stream));
      if (preview.current) {
        preview.current.srcObject = stream;
        if (stream) void preview.current.play().catch(() => {});
      }
    }, message => { if (mounted.current) setStatus(message); }, () => {
      // The single-use secret never enters a request URL or browser history after claiming.
      window.history.replaceState(window.history.state, '', window.location.pathname);
    });
    session.current = controller;
    setReady(true);
    const hide = () => {
      if (document.hidden) { operation.current++; controller.stop(false); setStatus('Камера приостановлена. Вернитесь на страницу и включите её снова.'); setBusy(false); }
    };
    const leave = () => controller.stop(false);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false; controller.stop(false); session.current = null;
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave);
    };
  }, [credentials]);
  const start = async () => {
    const attempt = ++operation.current;
    setBusy(true); setStatus('Подключаем камеру…');
    try { await session.current?.start(); }
    catch (error) { if (mounted.current && operation.current === attempt) setStatus(notebookCameraError(error)); }
    finally { if (mounted.current && operation.current === attempt) setBusy(false); }
  };
  return <main className="notebook-phone">
    <div className="notebook-phone__brand">Mindcrafti</div>
    <h1>Камера тетради</h1>
    <p>Поставьте телефон над тетрадью. Изображение появится в вашем уроке.</p>
    <div className="notebook-phone__preview">
      <video ref={preview} autoPlay playsInline muted aria-label="Изображение камеры тетради" hidden={!running} />
      {!running && <span>Тетрадь будет видна здесь</span>}
    </div>
    <p role="status" aria-live="polite">{status}</p>
    <button className="btn" type="button" disabled={!ready || busy || running} onClick={() => void start()}>
      {busy ? 'Подключаем…' : running ? 'Камера включена' : 'Включить камеру'}
    </button>
    <button className="btn btn--secondary" type="button" disabled={!busy && !running} onClick={() => { operation.current++; session.current?.stop(); setBusy(false); }}>Выключить камеру</button>
    <p className="muted">Оставьте страницу открытой и экран включённым. Все настройки листа — в уроке на компьютере или планшете.</p>
    <p className="muted">Микрофон не используется. Приложения и настройки телефона не нужны.</p>
  </main>;
}
