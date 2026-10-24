import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { notebookCamerasApi, notebookCameraError, pairingUrl, type CameraPairing, type NotebookCamera } from '../../api/notebookCameras';
import { drawCameraQR } from './cameraModules';
import { NotebookCameraViewer } from './NotebookCameraViewer';
import './notebookCamera.css';

export interface NotebookStudent { userId: string; displayName: string }
export interface NotebookCameraProps {
  eventId: string;
  classId?: string;
  currentUserId: string;
  isTeacher: boolean;
  students?: NotebookStudent[];
  autoPair?: boolean;
}
interface PanelSession { active: boolean; mutation: number; listSequence: number; pairing: boolean; initialized: boolean }
export function NotebookCameraPanel({ eventId, classId, currentUserId, isTeacher, students: providedStudents, autoPair = false, onClose, closeLabel = 'Закрыть' }: NotebookCameraProps & { onClose?: () => void; closeLabel?: string }) {
  const [cameras, setCameras] = useState<NotebookCamera[]>([]);
  const [students, setStudents] = useState<NotebookStudent[]>(providedStudents ?? []);
  const [studentId, setStudentId] = useState(isTeacher ? providedStudents?.[0]?.userId ?? currentUserId : currentUserId);
  const studentChosen = useRef(false);
  const [pairing, setPairing] = useState<CameraPairing | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const qr = useRef<HTMLCanvasElement>(null);
  const session = useRef<PanelSession | null>(null);
  const https = window.location.protocol === 'https:';
  const isActiveCamera = (camera: NotebookCamera, now: number) => camera.eventId === eventId
    && (camera.classId ?? null) === (classId ?? null)
    && (isTeacher || camera.ownerId === currentUserId)
    && Date.parse(camera.sessionExpiresAt) > now
    && (camera.status === 'CONNECTED' || camera.status === 'PAIRING' && Date.parse(camera.pairingExpiresAt) > now);
  const activeCameras = cameras.filter(camera => isActiveCamera(camera, clock));
  const current = activeCameras.find(camera => camera.cameraId === selected);
  const url = useMemo(() => pairing ? pairingUrl(window.location.origin, pairing.camera.cameraId, pairing.pairingToken) : '', [pairing]);
  const qrValid = pairing && Date.parse(pairing.camera.pairingExpiresAt) > clock
    && activeCameras.find(camera => camera.cameraId === pairing.camera.cameraId)?.status === 'PAIRING';
  useEffect(() => {
    if (providedStudents) {
      setStudents(providedStudents);
      setStudentId(previous => (previous === currentUserId && studentChosen.current) || providedStudents.some(student => student.userId === previous)
        ? previous : providedStudents[0]?.userId ?? currentUserId);
    }
  }, [providedStudents, currentUserId]);
  useEffect(() => {
    const scope: PanelSession = { active: true, mutation: 0, listSequence: 0, pairing: false, initialized: false };
    session.current = scope;
    setCameras([]); setSelected(''); setPairing(null); setBusy(false); setError(null); setLoading(true);
    const load = async () => {
      const version = scope.mutation;
      const sequence = ++scope.listSequence;
      try {
        const values = await notebookCamerasApi.list(eventId);
        if (!scope.active || version !== scope.mutation || sequence !== scope.listSequence) return;
        const now = Date.now();
        const available = values.filter(camera => isActiveCamera(camera, now));
        const connected = available.find(camera => camera.status === 'CONNECTED');
        setCameras(values);
        setClock(now);
        setSelected(previous => available.some(camera => camera.cameraId === previous) ? previous : (connected ?? available[0])?.cameraId ?? '');
        if (autoPair && !isTeacher && !scope.initialized) {
          scope.initialized = true;
          if (!connected) void createPairing(scope);
        }
      } catch (reason) { if (scope.active && version === scope.mutation && sequence === scope.listSequence) setError(notebookCameraError(reason)); }
      finally { if (scope.active && sequence === scope.listSequence) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => { setClock(Date.now()); void load(); }, 5000);
    return () => { scope.active = false; clearInterval(timer); };
  }, [eventId, classId, currentUserId, isTeacher, autoPair]);
  useEffect(() => {
    if (!isTeacher || providedStudents) return;
    let active = true;
    void Promise.all([api.lessons.groupLessons(), api.students.list()]).then(async ([lessons, allStudents]) => {
      const lesson = lessons.find(item => item.eventId === eventId);
      if (!lesson) return;
      const ids = new Set([...(lesson.participantStudentIds ?? []), ...(lesson.studentId ? [lesson.studentId] : [])]);
      if (lesson.groupId) (await api.groups.get(lesson.groupId)).students.forEach(student => ids.add(student.id));
      if (!active) return;
      const roster = allStudents.filter(student => ids.has(student.id)).map(student => ({ userId: student.id, displayName: student.fullName }));
      setStudents(roster);
      setStudentId(previous => (previous === currentUserId && studentChosen.current) || roster.some(student => student.userId === previous)
        ? previous : roster[0]?.userId ?? currentUserId);
    }).catch(() => { /* Existing cameras remain selectable if the roster cannot load. */ });
    return () => { active = false; };
  }, [eventId, isTeacher, providedStudents, currentUserId]);
  useEffect(() => {
    if (!url || !qr.current || !qrValid) return;
    let active = true;
    void drawCameraQR(qr.current, url).catch(() => { if (active) setError('Не удалось построить QR. Можно скопировать ссылку подключения.'); });
    return () => { active = false; };
  }, [url, qrValid]);
  async function createPairing(scope = session.current) {
    if (!scope?.active || scope.pairing || !https || (isTeacher && !studentId)) return;
    scope.pairing = true;
    scope.initialized = true;
    setBusy(true); setError(null);
    scope.mutation++;
    try {
      const value = await notebookCamerasApi.pair(eventId, isTeacher ? studentId : undefined, classId);
      if (!scope.active) return;
      scope.mutation++;
      setPairing(value); setSelected(value.camera.cameraId); setClock(Date.now());
      setCameras(previous => [...previous.filter(camera => camera.ownerId !== value.camera.ownerId), value.camera]);
    } catch (reason) { if (scope.active) setError(notebookCameraError(reason)); }
    finally { scope.pairing = false; if (scope.active) setBusy(false); }
  }
  const revoke = async () => {
    const scope = session.current;
    if (!current || !scope?.active) return;
    setBusy(true); setError(null);
    scope.mutation++;
    try {
      await notebookCamerasApi.revoke(current.cameraId);
      if (!scope.active) return;
      scope.mutation++;
      setCameras(previous => previous.filter(camera => camera.cameraId !== current.cameraId));
      setSelected(''); setPairing(null);
    } catch (reason) { if (scope.active) setError(notebookCameraError(reason)); }
    finally { if (scope.active) setBusy(false); }
  };
  return <section className="notebook-camera" aria-label="Камера тетради">
    <div className="notebook-camera__heading"><div><h2>Камера тетради</h2><p>{isTeacher
      ? 'Подключённые тетради учеников появляются здесь автоматически. Выберите нужную тетрадь ниже.'
      : 'Сканируйте QR-код телефоном, включите камеру и разместите телефон над тетрадью.'}</p></div>
      {onClose && <button type="button" className="btn btn--secondary" onClick={onClose}>{closeLabel}</button>}
    </div>
    {error && <div className="banner banner--error" role="alert">{error}</div>}
    {!https && <p role="alert">Подключение телефона доступно на HTTPS-сайте Mindcrafti. Откройте урок по защищённому адресу сайта.</p>}
    <div className="notebook-camera__connect">
      <div>
        {isTeacher && <label>Ученик <select aria-label="Ученик для подключения камеры" value={studentId} onChange={event => { studentChosen.current = true; setStudentId(event.target.value); }}>
          <option value={currentUserId}>Камера для пробного урока</option>
          {students.map(student => <option key={student.userId} value={student.userId}>{student.displayName}</option>)}
        </select></label>}
        <button className="btn" type="button" disabled={busy || !https || (autoPair && !isTeacher && loading) || (isTeacher && !studentId)} onClick={() => void createPairing()}>
          {busy ? 'Подождите…' : pairing || current ? 'Новый QR-код' : 'Подключить телефон'}
        </button>
        <p className="muted">Телефон может быть в другой сети. Нужен только интернет. QR одноразовый и действует 5 минут.</p>
        {isTeacher && <p className="muted">Для пробного урока без аккаунта ученика выберите «Камера для пробного урока» и покажите QR-код ученику.</p>}
        {pairing && !qrValid && <p role="status">{cameras.find(camera => camera.cameraId === pairing.camera.cameraId)?.status === 'CONNECTED' ? 'QR использован. Камеру можно включать на подключённом телефоне.' : 'Срок QR истёк. Создайте новый QR-код.'}</p>}
        {current && <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void revoke()}>Отключить телефон</button>}
      </div>
      {url && qrValid && <div className="notebook-camera__qr">
        <canvas ref={qr} aria-label="QR-код для камеры тетради" />
        <p>Сканируйте камерой телефона</p>
        <button type="button" className="btn btn--secondary" onClick={() => void navigator.clipboard.writeText(url).catch(() => setError('Не удалось скопировать ссылку. Используйте QR-код.'))}>Скопировать ссылку</button>
      </div>}
    </div>
    {activeCameras.length > 0 && <label className="notebook-camera__picker">{isTeacher ? 'Тетрадь ученика' : 'Моя тетрадь'} <select aria-label="Выбрать камеру тетради" value={current?.cameraId ?? ''} onChange={event => setSelected(event.target.value)}>
      <option value="" disabled>Выберите камеру</option>
      {activeCameras.map(camera => <option key={camera.cameraId} value={camera.cameraId}>{camera.ownerName} · {camera.status === 'CONNECTED' ? 'телефон подключён' : 'ждём телефон'}</option>)}
    </select></label>}
    {current ? <NotebookCameraViewer key={current.cameraId} cameraId={current.cameraId} ownerId={current.ownerId} /> : <p className="muted">Подключите телефон, чтобы увидеть тетрадь, выровнять лист и делать пометки поверх видео.</p>}
  </section>;
}

export function NotebookCameraButton(props: NotebookCameraProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), iframe, a[href]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', key); trigger.current?.focus(); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>Камера тетради</button>
    {open && <div className="notebook-camera__backdrop"><div ref={dialog} tabIndex={-1} className="notebook-camera__dialog" role="dialog" aria-modal="true" aria-label="Камера тетради">
      <NotebookCameraPanel {...props} onClose={() => setOpen(false)} />
    </div></div>}
  </>;
}
