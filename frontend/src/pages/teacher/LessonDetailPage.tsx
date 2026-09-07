import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { lessonPreparationApi } from '../../api/lessonPreparation';
import type { GroupLesson, Homework, LessonPreparation, StudentListItem } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';
import { GoogleDrivePdfPicker } from './GoogleDrivePdfPicker';

type HomeworkSummary = {
  assigned: number;
  submitted: number;
  open: number;
  students: Array<{ id: string; name: string; assigned: number; submitted: number }>;
};

type LessonStudent = Pick<StudentListItem, 'id' | 'fullName' | 'chatGptProjectUrl'>;
type TextSectionKind = 'homework' | 'difficulties' | 'plan';
type MaterialKind = 'workbook' | 'answers';

type NoteGroup = {
  key: string;
  title: string;
  items: string[];
  student: boolean;
};

export function LessonDetailPage() {
  const { eventId = '' } = useParams();
  const { t } = useI18n();
  const [lesson, setLesson] = useState<GroupLesson | null>(null);
  const [lessonStudents, setLessonStudents] = useState<LessonStudent[]>([]);
  const [preparation, setPreparation] = useState<LessonPreparation | null>(null);
  const [homeworkNotes, setHomeworkNotes] = useState('');
  const [difficulties, setDifficulties] = useState('');
  const [lessonPlan, setLessonPlan] = useState('');
  const [homeworkSummary, setHomeworkSummary] = useState<HomeworkSummary | null>(null);
  const [workbookUrl, setWorkbookUrl] = useState<string | null>(null);
  const [answersUrl, setAnswersUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingWorkbook, setUploadingWorkbook] = useState(false);
  const [uploadingAnswers, setUploadingAnswers] = useState(false);
  const [openingChatGpt, setOpeningChatGpt] = useState<MaterialKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [lessons, prep, allStudents] = await Promise.all([
          api.lessons.groupLessons(),
          lessonPreparationApi.get(eventId),
          api.students.list(),
        ]);
        if (cancelled) return;
        const currentLesson = lessons.find((item) => item.eventId === eventId) ?? null;
        setLesson(currentLesson);
        setPreparation(prep);
        setHomeworkNotes(prep.homeworkNotes ?? '');
        setDifficulties(prep.difficulties ?? '');
        setLessonPlan(prep.lessonPlan ?? '');

        if (prep.hasWorkbook) {
          try { if (!cancelled) setWorkbookUrl(await lessonPreparationApi.workbookUrl(eventId)); } catch { /* page still works */ }
        }
        if (prep.hasAnswers) {
          try { if (!cancelled) setAnswersUrl(await lessonPreparationApi.answersUrl(eventId)); } catch { /* page still works */ }
        }
        if (currentLesson) {
          const [summary, students] = await Promise.all([
            buildHomeworkSummary(currentLesson),
            resolveLessonStudents(currentLesson, allStudents),
          ]);
          if (!cancelled) {
            setHomeworkSummary(summary);
            setLessonStudents(students);
          }
        }
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [eventId, t]);

  useEffect(() => () => {
    if (workbookUrl) URL.revokeObjectURL(workbookUrl);
  }, [workbookUrl]);

  useEffect(() => () => {
    if (answersUrl) URL.revokeObjectURL(answersUrl);
  }, [answersUrl]);

  const dateText = useMemo(() => {
    if (!lesson) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(lesson.startsAt));
  }, [lesson]);

  async function savePreparation() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await lessonPreparationApi.update(eventId, { homeworkNotes, difficulties, lessonPlan });
      setPreparation(updated);
      setMessage('Информация для урока сохранена.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPdf(kind: MaterialKind, file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Нужен PDF-файл.');
      return;
    }
    const isWorkbook = kind === 'workbook';
    if (isWorkbook ? uploadingWorkbook : uploadingAnswers) return;
    isWorkbook ? setUploadingWorkbook(true) : setUploadingAnswers(true);
    setError(null);
    setMessage(null);
    try {
      const updated = isWorkbook
        ? await lessonPreparationApi.uploadWorkbook(eventId, file)
        : await lessonPreparationApi.uploadAnswers(eventId, file);
      setPreparation(updated);
      if (isWorkbook) setWorkbookUrl(await lessonPreparationApi.workbookUrl(eventId));
      else setAnswersUrl(await lessonPreparationApi.answersUrl(eventId));
      setMessage(isWorkbook ? 'Рабочая тетрадь обновлена.' : 'Ответы для учителя обновлены.');
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      isWorkbook ? setUploadingWorkbook(false) : setUploadingAnswers(false);
    }
  }

  async function editPdfInChatGpt(kind: MaterialKind, url: string | null, filename?: string | null) {
    if (!url || openingChatGpt) return;
    setOpeningChatGpt(kind);
    setError(null);
    setMessage(null);

    const singleStudentProject = lessonStudents.length === 1 ? lessonStudents[0].chatGptProjectUrl?.trim() : null;
    const chatUrl = singleStudentProject || 'https://chatgpt.com/';
    const chatTab = window.open(chatUrl, '_blank');
    if (chatTab) chatTab.opener = null;

    try {
      downloadObjectUrl(url, filename || (kind === 'workbook' ? 'lesson-workbook.pdf' : 'lesson-answers.pdf'));
      const lessonLabel = lesson?.groupName
        ? `группы «${lesson.groupName}»`
        : lesson?.studentName
          ? `ученика ${lesson.studentName}`
          : 'этого урока';
      const instruction = kind === 'workbook'
        ? `Отредактируй прикреплённую рабочую тетрадь для ${lessonLabel}. Меняй только то, что я попрошу в чате. Сохрани формат страниц, структуру заданий и удобство для ученика. Верни результат снова PDF-файлом.`
        : `Отредактируй прикреплённый PDF с ответами для учителя к уроку ${lessonLabel}. Меняй только то, что я попрошу в чате. Сохрани соответствие рабочей тетради и верни результат снова PDF-файлом.`;
      try {
        await navigator.clipboard.writeText(instruction);
      } catch {
        // Clipboard can be unavailable; opening ChatGPT and downloading the file still works.
      }
      setMessage('PDF скачан, ChatGPT открыт, инструкция для редактирования скопирована.');
    } catch (e) {
      if (chatTab) chatTab.close();
      setError(toErrorMessage(e, t));
    } finally {
      setOpeningChatGpt(null);
    }
  }

  if (loading) return <p className="muted">{t('common.loading')}</p>;

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link to="/teacher/lessons" className="muted">← Назад к расписанию</Link>
          <h1 style={{ margin: '10px 0 4px' }}>{lesson?.title ?? 'Урок'}</h1>
          <div className="muted">{dateText || 'Событие Google Calendar'}</div>
          {(lesson?.groupName || lesson?.studentName) && (
            <div style={{ marginTop: 8, fontWeight: 800, color: '#d94f00' }}>
              {lesson?.groupName ? `Группа: ${lesson.groupName}` : `Ученик: ${lesson?.studentName}`}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {lesson?.calendarUrl && <a className="btn btn--ghost" href={lesson.calendarUrl} target="_blank" rel="noreferrer">Google Calendar</a>}
          {lesson?.meetUrl && <a className="btn" href={lesson.meetUrl} target="_blank" rel="noreferrer">Google Meet</a>}
        </div>
      </div>

      {error && <div className="banner banner--error" style={{ marginBottom: 14 }}>{error}</div>}
      {message && <div className="banner banner--success" style={{ marginBottom: 14 }}>{message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginBottom: 18 }}>
        <MaterialPanel
          title="Рабочая тетрадь"
          subtitle="Материал, который используется на уроке"
          filename={preparation?.workbookFilename}
          url={workbookUrl}
          emptyText="Рабочая тетрадь ещё не добавлена"
          uploading={uploadingWorkbook}
          editingInChatGpt={openingChatGpt === 'workbook'}
          onUpload={(file) => void uploadPdf('workbook', file)}
          onEditInChatGpt={() => void editPdfInChatGpt('workbook', workbookUrl, preparation?.workbookFilename)}
        />
        <MaterialPanel
          title="Ответы для учителя"
          subtitle="Решения и подсказки, которые видит только учитель"
          filename={preparation?.answersFilename}
          url={answersUrl}
          emptyText="Ответы ещё не добавлены"
          uploading={uploadingAnswers}
          editingInChatGpt={openingChatGpt === 'answers'}
          onUpload={(file) => void uploadPdf('answers', file)}
          onEditInChatGpt={() => void editPdfInChatGpt('answers', answersUrl, preparation?.answersFilename)}
        />
      </div>

      <div className="stack" style={{ gap: 14 }}>
        <section className="panel" style={{ padding: 20, margin: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0 }}>Домашняя работа</h2>
              <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Что было сделано перед уроком и что требует внимания</div>
            </div>
          </div>

          {homeworkSummary ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(90px, 1fr))', gap: 10, marginTop: 16 }}>
                <Stat value={homeworkSummary.assigned} label="выдано" />
                <Stat value={homeworkSummary.submitted} label="сдано" />
                <Stat value={homeworkSummary.open} label="не сдано" />
              </div>
              {homeworkSummary.students.length > 1 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginTop: 12 }}>
                  {homeworkSummary.students.map((student) => (
                    <div key={student.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <strong>{student.name}</strong>
                        <span style={{ fontWeight: 800 }}>{student.submitted} / {student.assigned}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>сдано за последние задания</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : <div className="muted" style={{ marginTop: 14 }}>Нет привязанного ученика или группы.</div>}

          <div style={{ marginTop: 16 }}>
            <StructuredTextSection
              kind="homework"
              value={homeworkNotes}
              students={lessonStudents}
              onChange={setHomeworkNotes}
              placeholder="Например: ## Мелисса — что сдала, где ошиблась; ## София — что сдала; ## Общее — что проверить."
              rows={6}
            />
          </div>
        </section>

        <section className="panel" style={{ padding: 20, margin: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Проблемы и сложности</h2>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>Отдельно по каждому ученику — что не понял, где ошибается и что проверить</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <StructuredTextSection
              kind="difficulties"
              value={difficulties}
              students={lessonStudents}
              onChange={setDifficulties}
              placeholder="Например: ## Мелисса\n- Отрицательные числа: путает знаки...\n## София\n- Probe не автоматизирована...\n## Общее\n- Дать 60 секунд самостоятельной работы."
              rows={10}
            />
          </div>
        </section>

        <section className="panel" style={{ padding: 20, margin: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Рекомендованный план урока</h2>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>План автоматически раскладывается по времени, чтобы его можно было быстро читать во время занятия</div>
          </div>
          <div style={{ marginTop: 16 }}>
            <StructuredTextSection
              kind="plan"
              value={lessonPlan}
              students={lessonStudents}
              onChange={setLessonPlan}
              placeholder="0–15 мин: разминка... 15–25 мин: общая числовая прямая..."
              rows={11}
            />
          </div>
        </section>

        <div className="panel" style={{ padding: 14, margin: 0, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="muted" style={{ fontSize: 13 }}>Текст можно менять вручную. После изменения нажмите «Сохранить информацию».</div>
          <button className="btn" type="button" onClick={() => void savePreparation()} disabled={saving} style={{ minWidth: 220 }}>
            {saving ? 'Сохраняем…' : 'Сохранить информацию'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MaterialPanel({ title, subtitle, filename, url, emptyText, uploading, editingInChatGpt, onUpload, onEditInChatGpt }: {
  title: string;
  subtitle: string;
  filename?: string | null;
  url: string | null;
  emptyText: string;
  uploading: boolean;
  editingInChatGpt: boolean;
  onUpload: (file: File) => void;
  onEditInChatGpt: () => void;
}) {
  const hasPdf = Boolean(url);
  const uploadLabel = hasPdf ? 'Заменить PDF' : 'Загрузить PDF';

  return (
    <section className="panel" style={{ padding: 20, margin: 0, minHeight: 210 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#fff7ed', fontSize: 22, flex: '0 0 auto' }}>PDF</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
          <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>{subtitle}</div>
        </div>
        {hasPdf && <span className="pill pill--learned">готово</span>}
      </div>

      {hasPdf ? (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: '#fff' }}>
          <div style={{ fontWeight: 750, overflowWrap: 'anywhere' }}>{filename || 'PDF-файл'}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Открывается отдельно — страница урока остаётся на месте.</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <a className="btn" href={url ?? undefined} target="_blank" rel="noopener noreferrer">Открыть PDF ↗</a>
            <button className="btn btn--secondary" type="button" onClick={onEditInChatGpt} disabled={editingInChatGpt}>
              {editingInChatGpt ? 'Открываем…' : 'Редактировать в ChatGPT'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16, border: '2px dashed #f0c7ad', borderRadius: 14, padding: 20, background: '#fffaf7' }}>
          <strong>{emptyText}</strong>
          <div className="muted" style={{ marginTop: 5, fontSize: 12 }}>Выберите PDF с компьютера или из Google Drive.</div>
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <GoogleDrivePdfPicker disabled={uploading} onSelect={onUpload} />
        <label className="btn btn--ghost" style={{ cursor: uploading ? 'default' : 'pointer' }}>
          {uploading ? 'Загружаем…' : uploadLabel}
          <input type="file" accept="application/pdf,.pdf" hidden disabled={uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpload(file); e.currentTarget.value = ''; }} />
        </label>
      </div>
    </section>
  );
}

function StructuredTextSection({ kind, value, students, onChange, placeholder, rows }: {
  kind: TextSectionKind;
  value: string;
  students: LessonStudent[];
  onChange: (value: string) => void;
  placeholder: string;
  rows: number;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: editing ? 8 : 10 }}>
        <button className="btn btn--ghost" type="button" onClick={() => setEditing((current) => !current)}>
          {editing ? 'Показать красиво' : 'Редактировать текст'}
        </button>
      </div>
      {editing ? (
        <div>
          <textarea className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
          {kind !== 'plan' && (
            <div className="muted" style={{ marginTop: 7, fontSize: 12 }}>
              Для идеального разделения можно писать заголовки <strong>## Имя ученика</strong> и <strong>## Общее</strong>. Старый обычный текст тоже распознаётся автоматически.
            </div>
          )}
        </div>
      ) : kind === 'plan' ? (
        <PlanPreview value={value} />
      ) : (
        <StudentNotesPreview value={value} students={students} />
      )}
    </div>
  );
}

function StudentNotesPreview({ value, students }: { value: string; students: LessonStudent[] }) {
  const groups = useMemo(() => buildNoteGroups(value, students), [value, students]);
  if (!value.trim()) return <div className="muted">Пока нет заметок.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
      {groups.map((group) => (
        <article key={group.key} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: group.student ? '#fff' : '#fffaf7' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 9 }}>
            <div aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 999, display: 'grid', placeItems: 'center', background: group.student ? '#fff7ed' : '#f8fafc', fontWeight: 900 }}>
              {group.student ? studentInitial(group.title) : '•'}
            </div>
            <strong style={{ fontSize: 16 }}>{group.title}</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 7, lineHeight: 1.45 }}>
            {group.items.map((item, index) => <li key={`${group.key}-${index}`}>{item}</li>)}
          </ul>
        </article>
      ))}
    </div>
  );
}

function PlanPreview({ value }: { value: string }) {
  if (!value.trim()) return <div className="muted">План пока не заполнен.</div>;
  const parsed = parsePlan(value);

  return (
    <div>
      {parsed.intro && (
        <div style={{ borderRadius: 14, padding: 14, background: '#fffaf7', border: '1px solid #f0c7ad', lineHeight: 1.5, marginBottom: 12 }}>
          <strong>Цель и основа урока</strong>
          <div style={{ marginTop: 5 }}>{parsed.intro}</div>
        </div>
      )}
      {parsed.steps.length > 0 ? (
        <div style={{ display: 'grid', gap: 9 }}>
          {parsed.steps.map((step, index) => (
            <div key={`${step.time}-${index}`} style={{ display: 'grid', gridTemplateColumns: '95px minmax(0, 1fr)', gap: 12, alignItems: 'start', border: '1px solid var(--border)', borderRadius: 13, padding: 12, background: '#fff' }}>
              <div style={{ fontWeight: 900, color: '#d94f00' }}>{step.time}</div>
              <div style={{ lineHeight: 1.48 }}>{step.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, lineHeight: 1.5 }}>
          {splitStatements(value).map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function buildNoteGroups(value: string, students: LessonStudent[]): NoteGroup[] {
  const explicit = parseExplicitNoteGroups(value, students);
  if (explicit.length > 0) return explicit;

  const buckets = new Map<string, string[]>();
  students.forEach((student) => buckets.set(student.id, []));
  const common: string[] = [];
  let lastOwner: string | null = null;

  for (const statement of splitStatements(value)) {
    const normalized = normalizeText(statement);
    if (isCommonStatement(normalized)) {
      common.push(statement);
      lastOwner = null;
      continue;
    }
    const matched = students.filter((student) => normalized.includes(studentStem(student.fullName)));
    if (matched.length > 1) {
      common.push(statement);
      lastOwner = null;
      continue;
    }
    if (matched.length === 1) {
      buckets.get(matched[0].id)?.push(statement);
      lastOwner = matched[0].id;
      continue;
    }
    if (lastOwner && buckets.has(lastOwner)) buckets.get(lastOwner)?.push(statement);
    else common.push(statement);
  }

  const groups: NoteGroup[] = students
    .map((student) => ({ key: student.id, title: student.fullName, items: buckets.get(student.id) ?? [], student: true }))
    .filter((group) => group.items.length > 0);
  if (common.length > 0) groups.push({ key: 'common', title: 'Общее для урока', items: common, student: false });
  if (groups.length === 0 && value.trim()) return [{ key: 'common', title: 'Сводка', items: splitStatements(value), student: false }];
  return groups;
}

function parseExplicitNoteGroups(value: string, students: LessonStudent[]): NoteGroup[] {
  const lines = value.replace(/\r/g, '').split('\n');
  const sections: Array<{ key: string; title: string; student: boolean; items: string[] }> = [];
  let current: { key: string; title: string; student: boolean; items: string[] } | null = null;
  let recognizedHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (headingMatch) {
      const heading = headingMatch[1].replace(/:$/, '').trim();
      const normalizedHeading = normalizeText(heading);
      const student = students.find((item) => normalizedHeading.includes(studentStem(item.fullName)) || studentStem(item.fullName).includes(normalizedHeading));
      const commonHeading = /^(общее|общая|для всех|группа|всем)/u.test(normalizedHeading);
      if (student || commonHeading) {
        current = {
          key: student?.id ?? `common-${sections.length}`,
          title: student?.fullName ?? 'Общее для урока',
          student: Boolean(student),
          items: [],
        };
        sections.push(current);
        recognizedHeading = true;
        continue;
      }
    }
    const item = line.replace(/^[-–—•*]\s*/, '').trim();
    if (!item) continue;
    if (!current) {
      current = { key: 'common-before', title: 'Общее для урока', student: false, items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }

  if (!recognizedHeading) return [];
  return sections.filter((section) => section.items.length > 0);
}

function parsePlan(value: string): { intro: string; steps: Array<{ time: string; text: string }> } {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const timePattern = /(\d{1,3}\s*[–—-]\s*\d{1,3}\s*мин(?:ут(?:ы)?)?)\s*:/giu;
  const matches = Array.from(normalized.matchAll(timePattern));
  if (matches.length === 0) return { intro: '', steps: [] };

  const firstIndex = matches[0].index ?? 0;
  const intro = normalized.slice(0, firstIndex).trim().replace(/[.;]\s*$/, '');
  const steps = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    return {
      time: match[1].replace(/\s+/g, ' '),
      text: normalized.slice(start, end).trim().replace(/^[-–—]\s*/, '').replace(/\s+$/, ''),
    };
  }).filter((step) => step.text.length > 0);
  return { intro, steps };
}

function splitStatements(value: string): string[] {
  return value
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s+(?=[А-ЯA-ZЁ0-9«(])/u)
    .map((item) => item.replace(/^[-–—•*]\s*/, '').trim())
    .filter(Boolean);
}

function studentStem(fullName: string): string {
  const firstName = normalizeText(fullName).split(' ')[0] ?? '';
  if (firstName.length <= 4) return firstName;
  if (/[ая]$/u.test(firstName)) return firstName.slice(0, -1);
  return firstName;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function isCommonStatement(normalized: string): boolean {
  return /^(обеим|обоим|обеих|обоих|обе |оба |для обеих|для обоих|для группы|общее|всем |в группе)/u.test(normalized);
}

function studentInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function downloadObjectUrl(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div style={{ background: '#fff7ed', borderRadius: 12, padding: '11px 8px', textAlign: 'center' }}><div style={{ fontSize: 23, fontWeight: 900 }}>{value}</div><div className="muted" style={{ fontSize: 11 }}>{label}</div></div>;
}

async function resolveLessonStudents(lesson: GroupLesson, allStudents: StudentListItem[]): Promise<LessonStudent[]> {
  if (lesson.groupId) {
    const group = await api.groups.get(lesson.groupId);
    const memberIds = new Set(group.students.map((student) => student.id));
    return allStudents
      .filter((student) => memberIds.has(student.id))
      .map((student) => ({ id: student.id, fullName: student.fullName, chatGptProjectUrl: student.chatGptProjectUrl }));
  }
  if (lesson.studentId) {
    const student = allStudents.find((item) => item.id === lesson.studentId) ?? await api.students.get(lesson.studentId);
    return [{ id: student.id, fullName: student.fullName, chatGptProjectUrl: student.chatGptProjectUrl }];
  }
  return [];
}

async function buildHomeworkSummary(lesson: GroupLesson): Promise<HomeworkSummary | null> {
  if (lesson.groupId) {
    const group = await api.groups.get(lesson.groupId);
    const rows = await Promise.all(group.students.map(async (student) => {
      const homeworks = await api.homeworks.listForStudent(student.id);
      return studentHomeworkRow(student.id, student.fullName, homeworks);
    }));
    return combine(rows);
  }
  if (lesson.studentId) {
    const student = await api.students.get(lesson.studentId);
    const homeworks = await api.homeworks.listForStudent(lesson.studentId);
    return combine([studentHomeworkRow(student.id, student.fullName, homeworks)]);
  }
  return null;
}

function studentHomeworkRow(id: string, name: string, homeworks: Homework[]) {
  const recent = homeworks.filter((item) => item.hasWorksheet).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 5);
  return { id, name, assigned: recent.length, submitted: recent.filter((item) => item.submitted).length };
}

function combine(students: Array<{ id: string; name: string; assigned: number; submitted: number }>): HomeworkSummary {
  const assigned = students.reduce((sum, item) => sum + item.assigned, 0);
  const submitted = students.reduce((sum, item) => sum + item.submitted, 0);
  return { assigned, submitted, open: Math.max(0, assigned - submitted), students };
}
