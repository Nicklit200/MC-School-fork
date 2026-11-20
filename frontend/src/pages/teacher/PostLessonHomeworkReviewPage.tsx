import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { onlineClassesApi, type PostLessonHomeworkReview } from '../../api/onlineClasses';
import './post-lesson-homework-review.css';
import { PostLessonHomeworkPdfCanvas } from './PostLessonHomeworkPdfCanvas';

type Kind = 'student' | 'teacher';

export function PostLessonHomeworkReviewPage() {
  const { classId = '' } = useParams();
  const [report, setReport] = useState<PostLessonHomeworkReview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState('');
  const [day, setDay] = useState(1);
  const [kind, setKind] = useState<Kind>('student');
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfKey, setPdfKey] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const cached = useRef(new Map<string, { url: string; blob: Blob }>());

  useEffect(() => {
    let active = true;
    setLoading(true); setReport(null); setError('');
    void onlineClassesApi.postLessonHomeworkReview(classId)
      .then(data => {
        if (!active) return;
        setReport(data);
        if (data.documents.length) {
          setStudentId(data.documents[0].studentId);
          setDay(data.documents[0].day);
        }
      })
      .catch(() => { if (active) setError('Не удалось загрузить отчёт. Проверьте доступ к уроку.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [classId]);

  useEffect(() => {
    const localCache = cached.current;
    return () => { localCache.forEach(entry => URL.revokeObjectURL(entry.url)); localCache.clear(); };
  }, [classId]);

  const students = useMemo(() => Array.from(new Map((report?.documents ?? [])
    .map(item => [item.studentId, item.studentName])).entries()), [report]);
  const documents = useMemo(() => (report?.documents ?? []).filter(item => item.studentId === studentId)
    .sort((a, b) => a.day - b.day), [report, studentId]);
  const current = documents.find(item => item.day === day) ?? null;
  const cacheKey = [classId, studentId, day, kind].join(':');

  useEffect(() => {
    if (!current) { setPdfUrl(''); setPdfBlob(null); setPdfKey(''); return; }
    let active = true;
    const saved = cached.current.get(cacheKey);
    setPdfUrl(saved?.url ?? '');
    setPdfBlob(saved?.blob ?? null);
    setPdfKey(saved ? cacheKey : '');
    setPdfError('');
    if (saved) { setPdfLoading(false); return; }
    setPdfLoading(true);
    void onlineClassesApi.postLessonHomeworkReviewPdf(classId, studentId, day, kind)
      .then(blob => {
        if (!active) return;
        const url = URL.createObjectURL(blob);
        cached.current.set(cacheKey, { url, blob });
        setPdfUrl(url);
        setPdfBlob(blob);
        setPdfKey(cacheKey);
      })
      .catch(() => { if (active) setPdfError('Не удалось открыть PDF. Повторите попытку.'); })
      .finally(() => { if (active) setPdfLoading(false); });
    return () => { active = false; };
  }, [classId, studentId, day, kind, cacheKey, current]);

  function changeStudent(next: string) {
    setStudentId(next);
    const first = report?.documents.find(doc => doc.studentId === next);
    setDay(first?.day ?? 1);
    setKind('student');
  }

  const visiblePdfUrl = pdfKey === cacheKey ? pdfUrl : '';
  const visiblePdfBlob = pdfKey === cacheKey ? pdfBlob : null;
  const selectedIndex = documents.findIndex(doc => doc.day === day);
  const back = () => { if (selectedIndex > 0) setDay(documents[selectedIndex - 1].day); };
  const forward = () => { if (selectedIndex >= 0 && selectedIndex < documents.length - 1) setDay(documents[selectedIndex + 1].day); };
  return (
    <div className="post-review">
      <header className="post-review-header">
        <div>
          <div className="post-review-brand">MINDCRAFTI SCHOOL · ПРОВЕРКА ДОМАШКИ</div>
          <h1>{report?.lessonTitle || 'Домашняя работа после урока'}</h1>
          {report && <p>{report.state === 'PUBLISHED' ? 'Домашка назначена' : report.state === 'FAILED' ? 'Генерация прервалась' : 'Создаются документы'} · {report.generatedFiles} / {report.expectedFiles} PDF</p>}
        </div>
        <div className="post-review-header-actions">
          {report && <button type="button" className="btn btn--secondary" onClick={() => {
            setLoading(true);
            void onlineClassesApi.postLessonHomeworkReview(classId).then(setReport)
              .catch(() => setError('Не удалось обновить отчёт.')).finally(() => setLoading(false));
          }}>Обновить</button>}
          <Link className="btn" to="/teacher/lessons">К урокам</Link>
        </div>
      </header>
      {loading && !report && <div role="status" className="post-review-message">Загружаем домашку…</div>}
      {error && <div role="alert" className="post-review-message">{error}</div>}
      {report && <>
        <div className="post-review-toolbar">
          <label>Ученик
            <select value={studentId} onChange={e => changeStudent(e.target.value)}>
              {students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <div className="post-review-days" role="group" aria-label="День домашки">
            {documents.map(doc => <button type="button" key={doc.day} aria-pressed={day === doc.day}
              className={day === doc.day ? 'post-review-day active' : 'post-review-day'} onClick={() => setDay(doc.day)}>
                День {doc.day}
              </button>)}
          </div>
        </div>
        {current ? <div className="post-review-grid">
          <aside className="post-review-summary">
            <div className="post-review-eyebrow">День {current.day} · {new Date(current.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
            <h2>{current.summary?.topic || 'Задания на день'}</h2>
            {current.summary?.subtitle && <p>{current.summary.subtitle}</p>}
            <h3>Какие задания?</h3>
            {current.summary?.tasks?.length ? <ol>
              {current.summary.tasks.map((task, index) => <li key={index}>
                <strong>{task.title}</strong>
                {task.description && <p>{task.description}</p>}
                {task.expression && <code>{task.expression}</code>}
              </li>)}
            </ol> : <p>Краткое описание для этого документа ещё недоступно. Откройте PDF справа.</p>}
            <h3>Почему именно они?</h3>
            <p>{current.summary?.why || 'Задания подобраны по материалам урока. Дополнительное объяснение для этого документа не сохранено.'}</p>
            <p className="post-review-caption">Описание отражает темы и указания преподавателя, а не предполагаемые ошибки ученика.</p>
          </aside>
          <section className="post-review-document">
            <div className="post-review-document-bar">
              <div role="group" aria-label="Тип PDF">
                <button type="button" aria-pressed={kind === 'student'} onClick={() => setKind('student')}>Задания</button>
                <button type="button" aria-pressed={kind === 'teacher'} onClick={() => setKind('teacher')}>Ответы для учителя</button>
              </div>
              {visiblePdfUrl && <div className="post-review-pdf-file-actions">
                <a className="btn btn--secondary" href={visiblePdfUrl} target="_blank" rel="noopener noreferrer">Открыть отдельно</a>
                <a className="btn btn--secondary" download={'Mindcrafti_' + kind + '_' + current.date + '.pdf'} href={visiblePdfUrl}>Скачать PDF</a>
              </div>}
            </div>
            {pdfLoading && !visiblePdfBlob ? <div className="post-review-message" role="status">Загружаем PDF…</div>
              : pdfError ? <div role="alert" className="post-review-message">{pdfError}</div>
              : visiblePdfBlob ? <PostLessonHomeworkPdfCanvas key={cacheKey} blob={visiblePdfBlob} />
              : <div className="post-review-message">PDF пока недоступен.</div>}
            <div className="post-review-pagination">
              <button type="button" className="btn btn--secondary" onClick={back} disabled={selectedIndex <= 0}>← Предыдущий день</button>
              <span>День {day} из {report.days}</span>
              <button type="button" className="btn btn--secondary" onClick={forward} disabled={selectedIndex < 0 || selectedIndex >= documents.length - 1}>Следующий день →</button>
            </div>
          </section>
        </div> : <div className="post-review-message">
          Пока нет сохранённых PDF. Если генерация завершилась ошибкой, откройте урок и повторите её.
        </div>}
      </>}
    </div>
  );
}
