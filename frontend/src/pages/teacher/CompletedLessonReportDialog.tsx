import { useEffect, useRef, useState } from 'react';
import { onlineClassesApi, type CompletedLessonReportJob } from '../../api/onlineClasses';
import '../../styles/post-lesson-homework.css';
import './completed-lesson-report.css';

type Props = { eventId: string; title: string; de: boolean; onClose: () => void };
type Recipient = { id: string; name: string };
const isActive = (job?: CompletedLessonReportJob) => job?.state === 'QUEUED' || job?.state === 'RUNNING';

function statusLabel(state: CompletedLessonReportJob['state'], de: boolean) {
  return ({ QUEUED: de ? 'In Warteschlange' : 'В очереди', RUNNING: de ? 'Auswertung läuft' : 'Анализируется урок',
    DONE: de ? 'Fertig' : 'Готово', FAILED: de ? 'Fehlgeschlagen' : 'Ошибка генерации' })[state];
}
function detailLabel(code: string, de: boolean) {
  const messages: Record<string, [string, string]> = {
    STUDENT_GRADE_UNSET: ['Не указан класс ученика.', 'Klassenstufe fehlt.'],
    GRADE_BOARD_NOT_FOUND: ['Не найдена карта навыков для класса.', 'Kein passender Lehrplan gefunden.'],
    GRADE_BOARD_AMBIGUOUS: ['Найдено несколько карт навыков; выбор неоднозначен.', 'Mehrere Lehrpläne passen.'],
    NO_MATCHING_SKILLS: ['Не найдены подходящие навыки.', 'Keine passenden Lernziele gefunden.'],
    NO_PUPIL_WORK_OR_SPEECH: ['Нет записей или реплик с подтверждённым авторством ученика.', 'Keine eindeutig zugeordneten Schülerlösungen oder Äußerungen.'],
    ANNOTATED_PDF_NOT_SAVED: ['Не найден архивный PDF личной доски.', 'Kein archiviertes persönliches Tafel-PDF.'],
    NO_CONFIRMED_SKILL_EVIDENCE: ['ИИ не смог подтвердить навыки по доступным материалам.', 'Keine ausreichend belegten Beobachtungen.'],
    AI_TIMEOUT: ['Сервер ИИ не ответил вовремя.', 'Die KI hat nicht rechtzeitig geantwortet.'],
    WORKER_INTERRUPTED: ['Работа сервера прервалась. Можно запустить новый тест.', 'Der Server wurde unterbrochen. Ein neuer Test ist möglich.'],
    ANALYSIS_FAILED: ['Не удалось завершить анализ. Можно повторить генерацию.', 'Die Auswertung ist fehlgeschlagen.'],
  };
  return messages[code]?.[de ? 1 : 0] ?? (de ? 'Keine belastbare Auswertung verfügbar.' : 'Нет надёжного результата анализа.');
}
function resultLabel(code: string, de: boolean) {
  const labels: Record<string, [string, string]> = {
    CORRECT: ['Верно', 'Richtig'], INCORRECT: ['Ошибка', 'Fehler'], PARTIAL: ['Частично верно', 'Teilweise richtig'],
    FIRST_TRY: ['С первой попытки', 'Beim ersten Versuch'], INDEPENDENT: ['Самостоятельно', 'Selbstständig'],
    HINTED: ['С подсказкой', 'Mit Hinweis'], AFTER_EXPLANATION: ['После объяснения', 'Nach Erklärung'],
    NOT_YET: ['Пока не самостоятельно', 'Noch nicht selbstständig'], UNKNOWN: ['Неясно', 'Unklar'],
  };
  return labels[code]?.[de ? 1 : 0] ?? (de ? 'Unklar' : 'Неясно');
}

export function CompletedLessonReportDialog({ eventId, title, de, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const statusVersion = useRef(0);
  const submittingRef = useRef(false);
  const retryRequest = useRef<{ studentId: string; prompt: string; id: string } | null>(null);
  const [classId, setClassId] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [studentId, setStudentId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<CompletedLessonReportJob[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [actionError, setActionError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { mounted.current = false; statusVersion.current += 1; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(''); setClassId(''); setRecipients([]); setStudentId('');
    void (async () => {
      try {
        const rooms = await onlineClassesApi.findByEvent(eventId);
        const ended = rooms.filter(room => room.status === 'ENDED').sort((a, b) =>
          Date.parse(b.actualEndAt || b.scheduledEndAt) - Date.parse(a.actualEndAt || a.scheduledEndAt))[0];
        if (!active) return;
        if (!ended) {
          setLoadError(de ? 'Beenden Sie zuerst die Online-Stunde.' : 'Сначала завершите онлайн-урок.');
          return;
        }
        const pupils = await onlineClassesApi.completedLessonReportRecipients(ended.id);
        if (!active) return;
        setClassId(ended.id); setRecipients(pupils); setStudentId(pupils[0]?.id ?? '');
        if (!pupils.length) setLoadError(de ? 'Keine verfügbaren Schüler dieser Stunde.' : 'Нет доступных учеников этого урока.');
      } catch {
        if (active) setLoadError(de ? 'Die Stundendaten konnten nicht geladen werden.' : 'Не удалось загрузить данные урока.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [eventId, de, refresh]);

  useEffect(() => {
    let active = true;
    statusVersion.current += 1;
    setJobs([]); setSelectedId(''); setHistoryError(''); setActionError(''); setLoadingHistory(true);
    if (!classId || !studentId) { setLoadingHistory(false); return; }
    const load = () => {
      if (submittingRef.current) return;
      const version = ++statusVersion.current;
      void onlineClassesApi.completedLessonReports(classId, studentId).then(result => {
        if (!active || version !== statusVersion.current) return;
        setJobs(result); setHistoryError(''); setLoadingHistory(false);
      }).catch(() => {
        if (active && version === statusVersion.current) {
          setHistoryError(de ? 'Der Berichtsstatus konnte nicht geladen werden.' : 'Не удалось загрузить статус отчёта.');
          setLoadingHistory(false);
        }
      });
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => { active = false; statusVersion.current += 1; window.clearInterval(timer); };
  }, [classId, studentId, de]);

  const latest = jobs[0];
  const selected = jobs.find(job => job.id === selectedId) ?? latest;
  const report = selected?.report;

  const generate = async () => {
    if (!classId || !studentId || submittingRef.current || loadingHistory || isActive(latest)) return;
    submittingRef.current = true; statusVersion.current += 1;
    setSubmitting(true); setActionError('');
    try {
      const focus = prompt.trim();
      if (!retryRequest.current || retryRequest.current.studentId !== studentId || retryRequest.current.prompt !== focus)
        retryRequest.current = { studentId, prompt: focus, id: crypto.randomUUID() };
      const job = await onlineClassesApi.createCompletedLessonReport(classId, studentId, retryRequest.current.id, focus);
      retryRequest.current = null;
      if (!mounted.current) return;
      setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setSelectedId(job.id);
    } catch {
      if (mounted.current) setActionError(de
        ? 'Start nicht bestätigt. Prüfen Sie den Status; möglicherweise läuft bereits ein Bericht.'
        : 'Запуск не подтверждён. Проверьте статус: возможно, отчёт уже создаётся.');
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  const download = async () => {
    if (!selected || !report || downloading) return;
    setDownloading(true); setActionError('');
    try {
      const blob = await onlineClassesApi.completedLessonReportPdf(classId, studentId, selected.id, de);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'Mindcrafti-lesson-report.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (mounted.current) setActionError(de ? 'PDF konnte nicht heruntergeladen werden.' : 'Не удалось скачать PDF.');
    } finally { if (mounted.current) setDownloading(false); }
  };

  return <dialog ref={dialog} className="post-homework-island completed-lesson-report-dialog"
    aria-labelledby="completed-report-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="post-homework-header">
      <span className="post-homework-book" aria-hidden="true">M</span>
      <div><h2 id="completed-report-title">{de ? 'Dokument der vergangenen Stunde' : 'Документ пройденного урока'}</h2>
        <p>{title}</p></div>
      <button className="teacher-icon-button completed-report-close" aria-label={de ? 'Schließen' : 'Закрыть'}
        type="button" onClick={onClose}>×</button>
    </header>
    <div className="post-homework-main">
      <h3>{de ? 'Schüler auswählen' : 'Выберите ученика'}</h3>
      {loading && <p role="status" className="post-homework-hint">{de ? 'Wird geladen…' : 'Загружаем участников…'}</p>}
      {loadError && <><p role="alert" className="post-homework-error">{loadError}</p>
        <button type="button" className="btn btn--secondary" onClick={() => setRefresh(x => x + 1)}>{de ? 'Aktualisieren' : 'Обновить'}</button></>}
      {recipients.length > 0 && <select className="completed-report-select" aria-label={de ? 'Schüler' : 'Ученик'}
        value={studentId} disabled={submitting || downloading} onChange={event => { retryRequest.current = null; setStudentId(event.target.value); }}>
        {recipients.map(pupil => <option key={pupil.id} value={pupil.id}>{pupil.name}</option>)}
      </select>}
      <p className="post-homework-hint">{de ? 'Nur die eigene archivierte Tafel, zugeordnete Schreibspuren und Schüleräußerungen werden geprüft.' :
        'Анализируется личная тетрадь ученика с его записями и транскрипция с подтверждённым авторством.'}</p>
    </div>
    <div className="post-homework-main">
      <label htmlFor="completed-report-prompt"><h3>{de ? 'Zusätzliche Anweisungen' : 'Промпт генератора'}</h3></label>
      <textarea id="completed-report-prompt" className="post-homework-textarea" value={prompt}
        maxLength={3000} disabled={submitting} onChange={event => { retryRequest.current = null; setPrompt(event.target.value); }}
        placeholder={de ? 'Prüfe, welche Aufgaben selbstständig gelöst wurden und wo Hilfe nötig war. Antworte auf Deutsch.' :
          'Например: покажи, какие задания ученик решил сам, где ошибся, какие подсказки давал учитель. Ответь на русском.'}/>
      <p className="post-homework-hint">{de ? 'Optional. Die Auswertung bleibt privat und ändert weder Hausaufgaben noch Lernstand.' :
        'Можно оставить пустым. Это тест анализа: домашка, карта навыков и документы доски не изменяются.'}</p>
    </div>
    {historyError && <p role="alert" className="post-homework-error">{historyError}</p>}
    {loadingHistory && classId && studentId && <p role="status" className="post-homework-hint">{de ? 'Berichte werden geladen…' : 'Загружаем отчёты…'}</p>}
    {latest && <div className="post-homework-main">
      <h3>{de ? 'Status und Berichte' : 'Статус и отчёты'}</h3>
      <p role="status" className="completed-report-status"><strong>{statusLabel(latest.state, de)}</strong>
        {isActive(latest) && <span>{de ? 'Sie können das Fenster schließen und später zurückkehren.' : 'Окно можно закрыть и открыть снова.'}</span>}</p>
      {jobs.length > 1 && <select className="completed-report-select" aria-label={de ? 'Berichtsversion' : 'Версия отчёта'}
        value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>
        {jobs.map(job => <option key={job.id} value={job.id}>{new Date(job.createdAt).toLocaleString(de ? 'de-DE' : 'ru-RU')} · {statusLabel(job.state, de)}</option>)}
      </select>}
      {selected?.state === 'FAILED' && <p role="alert" className="post-homework-error">{detailLabel(selected.failureCode ?? '', de)}</p>}
      {report && <div className="completed-report-results">
        <div className="completed-report-sources">
          <span>{de ? 'Persönliche PDFs' : 'Личные PDF'}<strong>{report.archivedPdfs}</strong></span>
          <span>{de ? 'Seiten mit Schülerstift' : 'Страницы с записями'}<strong>{report.verifiedInkPages}</strong></span>
          <span>{de ? 'Schülerstimme' : 'Речь ученика'}<strong>{report.verifiedSpeech ? (de ? 'Ja' : 'Есть') : (de ? 'Nein' : 'Нет')}</strong></span>
        </div>
        {report.state !== 'READY' && <p className="post-homework-hint">{detailLabel(report.detail, de)}</p>}
        {report.observations.map(row => <article key={row.skillId} className="completed-report-observation">
          <strong>{row.skillTitle}</strong>
          <div className="completed-report-tags">
            <span>{resultLabel(row.correctness, de)}</span><span>{resultLabel(row.autonomy, de)}</span>
          </div>
          <p>{row.explanation}</p>
          <blockquote>{row.excerpt}</blockquote>
          <small>{row.origin === 'WRITING' ? (de ? 'Persönliche Tafel, Seite ' : 'Личная доска, страница ') + row.pageNumber :
            (de ? 'Zugeordnete Schüleräußerung' : 'Реплика ученика')} · {de ? 'KI-Sicherheit' : 'Уверенность ИИ'}: {row.confidence}%</small>
        </article>)}
        <button type="button" className="btn btn--secondary" disabled={downloading} onClick={() => void download()}>
          {downloading ? (de ? 'Wird geladen…' : 'Загружаем…') : (de ? 'PDF herunterladen' : 'Скачать PDF')}
        </button>
      </div>}
    </div>}
    {actionError && <p role="alert" className="post-homework-error">{actionError}</p>}
    <footer className="post-homework-footer">
      <button type="button" className="post-homework-skip" onClick={onClose}>{de ? 'Schließen' : 'Закрыть'}</button>
      <button type="button" className="post-homework-submit"
        disabled={!classId || !studentId || loading || loadingHistory || !!historyError || submitting || isActive(latest)}
        onClick={() => void generate()}>{submitting ? (de ? 'Wird gestartet…' : 'Запускаем…') :
          latest ? (de ? 'Neuen Bericht erstellen' : 'Создать новый отчёт') : (de ? 'Bericht erstellen' : 'Создать документ')}</button>
    </footer>
    <p className="post-homework-fineprint">{de ? 'Nur für Lehrkräfte. Keine Benachrichtigung an Schüler oder Eltern.' : 'Только для преподавателя. Без уведомлений ученику и родителям.'}</p>
  </dialog>;
}
