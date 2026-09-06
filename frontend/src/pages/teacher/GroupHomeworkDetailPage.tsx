import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework, StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { GoogleDrivePdfPicker } from './GoogleDrivePdfPicker';

type HomeworkByStudent = Record<string, Homework[]>;

export function GroupHomeworkDetailPage() {
  const { groupId = '', homeworkId = '' } = useParams();
  const { language, t } = useI18n();
  const [group, setGroup] = useState<StudentGroup | null>(null);
  const [homeworkByStudent, setHomeworkByStudent] = useState<HomeworkByStudent>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [openingChatGpt, setOpeningChatGpt] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  const representative = useMemo(() => {
    for (const homeworks of Object.values(homeworkByStudent)) {
      const found = homeworks.find((homework) => homework.id === homeworkId);
      if (found) return found;
    }
    return null;
  }, [homeworkByStudent, homeworkId]);

  const assignments = useMemo(() => {
    if (!group || !representative) return [];
    return group.students.map((student) => ({
      student,
      homework: findMatchingHomework(homeworkByStudent[student.id] ?? [], representative),
    }));
  }, [group, homeworkByStudent, representative]);

  const assignedCount = assignments.filter((item) => item.homework).length;
  const submittedCount = assignments.filter((item) => item.homework?.submitted).length;
  const hasAnySubmission = submittedCount > 0;

  const clearPreviewUrls = useCallback(() => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current = [];
    setPreviewUrls([]);
  }, []);

  const loadPreview = useCallback(async (current: Homework | null) => {
    if (!current?.hasWorksheet || !current.worksheetPageCount) {
      clearPreviewUrls();
      return;
    }
    setPreviewLoading(true);
    try {
      const blobs = await Promise.all(
        Array.from({ length: current.worksheetPageCount }, (_, pageIndex) =>
          api.homeworks.worksheetPage(current.id, pageIndex)),
      );
      const urls = blobs.map((blob) => URL.createObjectURL(blob));
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = urls;
      setPreviewUrls(urls);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setPreviewLoading(false);
    }
  }, [clearPreviewUrls, t]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const groupPayload = await api.groups.get(groupId);
      const entries = await Promise.all(
        groupPayload.students.map(async (student) => [student.id, await api.homeworks.listForStudent(student.id)] as const),
      );
      const byStudent = Object.fromEntries(entries) as HomeworkByStudent;
      setGroup(groupPayload);
      setHomeworkByStudent(byStudent);
      const current = Object.values(byStudent).flat().find((homework) => homework.id === homeworkId) ?? null;
      await loadPreview(current);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setLoading(false);
    }
  }, [groupId, homeworkId, loadPreview, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadWorksheet() {
    if (!representative) return;
    setError(null);
    try {
      const blob = await api.homeworks.worksheet(representative.id);
      downloadBlob(blob, representative.worksheetFilename ?? 'group-homework.pdf');
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function editInChatGpt() {
    if (!representative?.hasWorksheet || openingChatGpt) return;
    setOpeningChatGpt(true);
    setError(null);
    setMessage(null);

    const chatTab = window.open('https://chatgpt.com/', '_blank');
    if (chatTab) chatTab.opener = null;

    try {
      const blob = await api.homeworks.worksheet(representative.id);
      downloadBlob(blob, representative.worksheetFilename ?? 'group-homework.pdf');
      const instruction = language === 'DE'
        ? 'Bearbeite diese PDF-Hausaufgabe für die ganze Lerngruppe. Ändere nur das, was ich dir im Chat sage. Behalte Seitenformat und Arbeitsblatt-Struktur bei und gib das Ergebnis wieder als PDF zurück.'
        : 'Отредактируй эту PDF-домашку для всей группы. Меняй только то, что я попрошу в чате. Сохрани формат страниц и структуру рабочей тетради и верни результат снова PDF-файлом.';
      try {
        await navigator.clipboard.writeText(instruction);
      } catch {
        // Clipboard permission may be unavailable; the file still downloads and ChatGPT still opens.
      }
      setMessage(language === 'DE'
        ? 'PDF wurde heruntergeladen und ChatGPT geöffnet. Bearbeite die Datei dort und lade die fertige PDF anschließend hier wieder hoch.'
        : 'PDF скачан и ChatGPT открыт. Отредактируй файл там, затем загрузи готовый PDF обратно сюда — он заменится у всей группы.');
    } catch (e) {
      if (chatTab) chatTab.close();
      setError(toErrorMessage(e, t));
    } finally {
      setOpeningChatGpt(false);
    }
  }

  async function replaceForGroup(file: File | null) {
    if (!file || replacing || hasAnySubmission) return;
    const targets = assignments.flatMap((item) => item.homework ? [item.homework] : []);
    if (targets.length === 0) return;

    setReplacing(true);
    setError(null);
    setMessage(null);
    try {
      await Promise.all(targets.map((homework) => api.homeworks.uploadWorksheet(homework.id, file)));
      await load();
      setMessage(`Готово: новый PDF заменил предыдущую версию у ${targets.length} учеников группы.`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setReplacing(false);
    }
  }

  if (loading && !representative) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  if (!representative) {
    return (
      <div>
        <p><Link to={`/groups/${groupId}`} className="muted">← Назад к группе</Link></p>
        <div className="banner banner--error">Эта групповая домашка не найдена.</div>
      </div>
    );
  }

  return (
    <div>
      <p><Link to={`/groups/${groupId}`} className="muted">← Назад к группе</Link></p>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{group?.name ?? 'Группа'} · {formatDate(representative.startDate)}</h1>
      <div className="banner banner--info">
        <strong>{representative.worksheetFilename ?? 'PDF-домашка'}</strong>
        {representative.worksheetPageCount ? ` · ${representative.worksheetPageCount} стр.` : ''}
      </div>

      <h2>Редактирование домашки</h2>
      <div className="panel stack">
        {hasAnySubmission ? (
          <div className="banner banner--info">
            Уже есть {submittedCount} {submittedCount === 1 ? 'сдача' : 'сдачи/сдач'}. Замену PDF для всей группы отключили, чтобы ученики не получили разные версии одного задания.
          </div>
        ) : (
          <div>
            <strong>Загрузить отредактированный PDF обратно</strong>
            <p className="muted" style={{ margin: '6px 0 10px' }}>
              Новый файл одновременно заменит эту домашку у всех {assignedCount} учеников, которым она выдана.
            </p>
            <div className="row" style={{ alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 360px', margin: 0 }}>
                <span className="field__label">Отредактированный PDF с компьютера</span>
                <input
                  className="input"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={replacing}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void replaceForGroup(file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <div style={{ paddingBottom: 1 }}>
                <GoogleDrivePdfPicker disabled={replacing} onSelect={(file) => void replaceForGroup(file)} />
              </div>
            </div>
            {replacing && <div className="muted" style={{ marginTop: 8 }}>Заменяем PDF у всей группы…</div>}
          </div>
        )}

        <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-color, #ddd)' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 420px' }}>
              <strong>Редактировать в ChatGPT</strong>
              <p className="muted" style={{ margin: '6px 0 0' }}>
                Скачаем текущий PDF и откроем ChatGPT. После редактирования загрузи новый файл выше.
              </p>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn--secondary" type="button" onClick={downloadWorksheet}>Скачать исходный PDF</button>
              <button className="btn" type="button" onClick={editInChatGpt} disabled={openingChatGpt}>
                {openingChatGpt ? 'Открываем…' : 'Редактировать в ChatGPT'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <h2>Текущая домашка</h2>
      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="muted">Это версия PDF, которая сейчас выдана группе.</div>
          <button className="btn btn--secondary" type="button" onClick={downloadWorksheet}>Открыть / скачать PDF</button>
        </div>

        {previewLoading && previewUrls.length === 0 ? (
          <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>Загружаем предпросмотр…</div>
        ) : previewUrls.length > 0 ? (
          <div style={{ display: 'grid', gap: 16, justifyItems: 'center' }}>
            {previewUrls.map((url, index) => (
              <div key={url} style={{ width: '100%', maxWidth: 1100 }}>
                {previewUrls.length > 1 && <div className="muted" style={{ marginBottom: 6 }}>Страница {index + 1}</div>}
                <img
                  src={url}
                  alt={`Домашка группы, страница ${index + 1}`}
                  style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid var(--border-color, #ddd)', borderRadius: 12, background: '#fff' }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="banner banner--info">Не удалось загрузить предпросмотр.</div>
        )}
      </div>
    </div>
  );
}

function findMatchingHomework(homeworks: Homework[], representative: Homework) {
  return homeworks.find((homework) =>
    homework.hasWorksheet
    && homework.startDate === representative.startDate
    && (homework.worksheetFilename ?? 'Домашка в PDF') === (representative.worksheetFilename ?? 'Домашка в PDF')
    && (homework.worksheetPageCount ?? null) === (representative.worksheetPageCount ?? null));
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${date}T00:00:00`));
}
