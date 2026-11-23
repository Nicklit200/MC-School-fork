import { useEffect, useRef, useState } from 'react';
import { onlineClassesApi, type PostLessonHomeworkJob, type PostLessonSkillReviewJob } from '../../api/onlineClasses';
import { ApiRequestError } from '../../api/client';
import { postLessonHomeworkFailureMessage, postLessonHomeworkStageMessage } from './postLessonHomeworkMessages';
import '../../styles/post-lesson-homework.css';

type Props = { classId: string; title: string; language: string; onDone: () => void };

/** Shown only after successful classroom end and board save. */
export function PostLessonHomeworkDialog({ classId, title, language, onDone }: Props) {
  const de = language === 'DE';
  const [days, setDays] = useState(7);
  const [recipients, setRecipients] = useState<Array<{id: string; name: string}>>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [recipientsError, setRecipientsError] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [skillReview, setSkillReview] = useState<PostLessonSkillReviewJob | null>(null);
  const [pending, setPending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedJob, setFailedJob] = useState<PostLessonHomeworkJob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    return () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRecipientsLoading(true);
    setRecipientsError(false);
    void onlineClassesApi.postLessonHomeworkRecipients(classId).then(rows => {
      if (!active) return;
      setRecipients(rows);
      setSelectedRecipients(rows.map(row => row.id));
      setRecipientsLoading(false);
    }).catch(() => {
      if (!active) return;
      setRecipientsError(true);
      setRecipientsLoading(false);
    });
    return () => { active = false; };
  }, [classId]);

  // The server reviews each pupil's skills independently after End for all.
  // Polling is informational; it never re-triggers the analysis.
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void onlineClassesApi.postLessonSkillReviewStatus(classId)
        .then(result => { if (live) setSkillReview(result); })
        .catch(() => { /* Finishing the lesson does not depend on diagnostics. */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => { live = false; window.clearInterval(timer); };
  }, [classId]);

  const toggleVoice = async () => {
    setError(null);
    if (recorder.current?.state === 'recording') {
      recorder.current.stop(); setRecording(false); return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(de ? 'Sprachaufnahme wird nicht unterstützt.' : 'Запись голоса не поддерживается этим браузером.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
      const current = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      recorder.current = current; chunks.current = [];
      current.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      current.onstop = async () => {
        setRecording(false);
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
        const recorded = new Blob(chunks.current, { type: current.mimeType });
        if (!recorded.size) {
          setError(de ? 'Die Aufnahme ist leer. Bitte erneut versuchen.' : 'Запись пустая. Попробуйте ещё раз.');
          return;
        }
        if (recorded.size > 5_000_000) {
          setError(de ? 'Die Aufnahme ist zu lang. Bitte kürzer sprechen.' : 'Запись слишком длинная. Скажите короче.');
          return;
        }
        const extension = current.mimeType.includes('mp4') ? 'mp4' : current.mimeType.includes('ogg') ? 'ogg' : 'webm';
        setTranscribing(true);
        try {
          const text = await onlineClassesApi.transcribePostLessonHomework(
            classId, new File([recorded], 'instruction.' + extension, { type: current.mimeType }));
          setInstructions(previous => [previous.trim(), text.trim()].filter(Boolean).join('\n'));
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 413) {
            setError(de ? 'Die Aufnahme ist zu groß.' : 'Запись слишком большая. Попробуйте короче.');
          } else if (err instanceof ApiRequestError && err.status === 503) {
            setError(de ? 'Die Spracherkennung ist gerade nicht konfiguriert.' : 'Сервис распознавания голоса пока не настроен.');
          } else if (err instanceof ApiRequestError && err.status === 422) {
            setError(de ? 'Keine Sprache erkannt. Bitte deutlicher sprechen.' : 'Не удалось услышать речь. Попробуйте ещё раз.');
          } else {
            setError(de ? 'Spracherkennung fehlgeschlagen. Bitte erneut versuchen oder schreiben.' :
              'Не удалось распознать голос. Попробуйте ещё раз или напишите указание.');
          }
        } finally { setTranscribing(false); }
      };
      current.start(); setRecording(true);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      setError(de ? 'Mikrofonzugriff nicht möglich.' : 'Не удалось получить доступ к микрофону.');
    }
  };

  const submit = async () => {
    if (pending || recording || transcribing || recipientsLoading || recipientsError || selectedRecipients.length === 0) return;
    setPending(true); setError(null);
    try {
      const result = failedJob
        ? await onlineClassesApi.retryPostLessonHomework(classId)
        : await onlineClassesApi.postLessonHomework(classId, days, instructions, selectedRecipients);
      if (result.state === 'FAILED') {
        setFailedJob(result);
        setError(postLessonHomeworkFailureMessage(result.failureCode, de));
      } else if (result.state === 'QUEUED' || result.state === 'RUNNING' || result.state === 'PUBLISHED') {
        onDone();
      } else {
        setError(de ? 'Der Server hat keinen Erstellungsauftrag bestätigt. Bitte erneut versuchen.' :
          'Сервер не подтвердил запуск создания домашки. Повторите попытку.');
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 503) {
        setError(de ? 'Die automatische Erstellung ist derzeit nicht konfiguriert. Bitte die Schulverwaltung informieren.' :
          'Автоматическая генерация пока не настроена на сервере. Обратитесь к администратору школы.');
      } else if (err instanceof ApiRequestError && err.status === 409) {
        setError(de ? 'Für diesen Unterricht gibt es bereits einen Auftrag oder noch keine gespeicherten Unterrichtsdaten.' :
          'Для этого урока уже есть задание или пока нет сохранённых данных урока.');
      } else {
        setError(de ? 'Hausaufgabe konnte nicht gestartet werden. Bitte erneut versuchen.' :
          'Не удалось запустить домашку. Проверьте подключение и повторите.');
      }
    } finally { setPending(false); }
  };

  return (
    <div className="post-homework-backdrop">
      <section role="dialog" aria-modal="true" aria-labelledby="post-homework-title" className="post-homework-island">
        <header className="post-homework-header">
          <span className="post-homework-book" aria-hidden="true">M</span>
          <div>
            <h2 ref={heading} tabIndex={-1} id="post-homework-title">
              {de ? 'Hausaufgaben' : 'Домашнее задание'}
            </h2>
            <p>{title} · {de ? 'Nach Unterrichtsende' : 'После завершения урока'}</p>
          </div>
        </header>
        <div className="post-homework-main" role="status" aria-live="polite">
          <h3>{de ? 'Lernfortschritt' : 'Карта навыков'}</h3>
          <p className="post-homework-hint">{!skillReview || skillReview.state === 'NONE'
            ? (de ? 'Die Analyse wird nach Unterrichtsende automatisch gestartet.'
              : 'После урока сервер автоматически анализирует навыки каждого ученика.')
            : skillReview.state === 'QUEUED' || skillReview.state === 'RUNNING'
              ? (de ? `Analyse läuft: ${skillReview.processedStudents ?? 0} von ${skillReview.totalStudents ?? 0} Schülern.`
                : `Анализируем записи и транскрипцию: ${skillReview.processedStudents ?? 0} из ${skillReview.totalStudents ?? 0} учеников.`)
              : skillReview.state === 'DONE' || skillReview.state === 'PARTIAL'
                ? (de
                  ? `Fertig: ${skillReview.processedStudents ?? 0} Schüler. Evidenzen: ${skillReview.students?.reduce((sum, pupil) => sum + pupil.observations, 0) ?? 0}.`
                  : `Обработано: ${skillReview.processedStudents ?? 0} учеников. Подтверждённых наблюдений: ${skillReview.students?.reduce((sum, pupil) => sum + pupil.observations, 0) ?? 0}, изменений процентов: ${skillReview.students?.reduce((sum, pupil) => sum + pupil.masteryUpdates, 0) ?? 0}.`)
                : (de ? 'Die automatische Überprüfung ist fehlgeschlagen. Bereits gespeicherte Daten bleiben erhalten.'
                    : 'Автоматическая проверка не завершилась. Сохранённые результаты не потеряны.')}
          </p>
          <p className="post-homework-hint">{de
            ? 'Nur nachweisbare Leistungen ändern die Fähigkeitskarte. Unklare Aufgaben werden nicht bewertet.'
            : 'Только подтверждённые решения изменяют навыки. Неясные или непройденные задания не засчитываются.'}</p>
        </div>
        <div className="post-homework-main">
          <h3>{de ? 'Für wie viele Tage Hausaufgaben?' : 'На сколько дней задать домашку?'}</h3>
          <div className="post-homework-days" role="group" aria-label={de ? 'Anzahl der Tage' : 'Количество дней'}>
            {[1, 2, 3, 4, 5, 6, 7].map(number => (
              <button key={number} type="button"
                className={'post-homework-day' + (number <= days ? ' is-selected' : '')}
                aria-pressed={number === days} disabled={pending || Boolean(failedJob)} onClick={() => setDays(number)}>
                {number}
              </button>
            ))}
          </div>
          <p className="post-homework-hint">
            {de ? days + ' Tage. Alle Schülerinnen und Schüler erhalten eigene Aufgaben.' :
              'Выбрано ' + days + ' ' + (days === 1 ? 'день' : days < 5 ? 'дня' : 'дней') + '. Для каждого ученика создаётся персональная домашка.'}
          </p>
        </div>
        <div className="post-homework-main">
          <h3>{de ? 'Wer bekommt Hausaufgaben?' : 'Кому задать домашку?'}</h3>
          <p className="post-homework-hint">{de ? 'Alle sind vorausgewählt. Entfernen Sie den Haken, um jemanden auszunehmen.' :
            'По умолчанию выбраны все участники. Снимите галочку с тех, кому не нужно задавать.'}</p>
          {recipientsLoading && <p role="status">Загружаем участников…</p>}
          {recipientsError && <p role="alert" className="post-homework-error">
            {de ? 'Teilnehmer konnten nicht geladen werden. Bitte das Fenster erneut öffnen.' :
              'Не удалось проверить участников. Закройте и откройте окно заново.'}
          </p>}
          {!recipientsLoading && !recipientsError && recipients.length === 0 && <p role="alert">
            {de ? 'Keine Teilnehmer in dieser Stunde.' : 'В этом уроке нет участников.'}
          </p>}
          {!recipientsLoading && !recipientsError && recipients.map(student => (
            <label key={student.id} className="post-homework-hint"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
              <input type="checkbox" checked={selectedRecipients.includes(student.id)}
                disabled={pending || Boolean(failedJob)} onChange={event => {
                  setSelectedRecipients(previous => event.target.checked
                    ? [...previous, student.id] : previous.filter(id => id !== student.id));
                }} />
              {student.name}
            </label>
          ))}
          {!recipientsLoading && !recipientsError && recipients.length > 0 && selectedRecipients.length === 0 &&
            <p role="alert" className="post-homework-error">
              {de ? 'Bitte mindestens einen Schüler auswählen.' : 'Выберите хотя бы одного ученика.'}
            </p>}
        </div>
        <div className="post-homework-main">
          <h3>{de ? 'Zusätzliche Anweisungen' : 'Дополнительные указания преподавателя'}</h3>
          <textarea className="post-homework-textarea" value={instructions}
            maxLength={3000} onChange={event => setInstructions(event.target.value)}
            placeholder={de ? 'Zum Beispiel: Melissa war heute nicht dabei, ihr nichts aufgeben. Vitalina soll Brüche und Terme üben.' :
              'Например: Мелиссы сегодня не было, ей не задавай. Виталине повторить Brüche и Terme перед контрольной.'}
            disabled={pending || recording || transcribing || Boolean(failedJob)} />
          <button type="button" className={'post-homework-voice' + (recording ? ' is-recording' : '')}
            onClick={() => void toggleVoice()} disabled={pending || transcribing || Boolean(failedJob)}>
            <span aria-hidden="true">{recording ? '■' : '●'}</span>
            {recording ? (de ? 'Aufnahme stoppen' : 'Остановить запись') :
              transcribing ? (de ? 'Wird erkannt...' : 'Распознаём голос...') :
              (de ? 'Sprachanweisung aufnehmen' : 'Записать голосовое указание')}
          </button>
          {recording && <p className="post-homework-voice-note" role="status">
            {de ? 'Aufnahme läuft. Erneut drücken, um zu beenden.' : 'Идёт запись. Нажмите ещё раз, чтобы закончить.'}
          </p>}
        </div>
        {error && <p className="post-homework-error" role="alert">{error}</p>}
        {failedJob && postLessonHomeworkStageMessage(failedJob, de) && <p className="post-homework-hint">
          {postLessonHomeworkStageMessage(failedJob, de)}
        </p>}
        {failedJob && <p className="post-homework-hint">
          {de ? 'Der erneute Versuch verwendet die gespeicherten Tage und Anweisungen.' :
            'Повторный запуск использует сохранённые дни и указания.'}
        </p>}
        <footer className="post-homework-footer">
          <button type="button" className="post-homework-skip" onClick={onDone} disabled={pending || transcribing}>
            {failedJob ? (de ? 'Schließen' : 'Закрыть') : (de ? 'Überspringen' : 'Пропустить')}
          </button>
          <button type="button" className="post-homework-submit" disabled={pending || transcribing || recording || recipientsLoading || recipientsError || selectedRecipients.length === 0}
            onClick={() => void submit()}>
            {pending ? (de ? 'Wird gestartet…' : 'Запускаем…') :
              failedJob ? (de ? 'Erstellung erneut versuchen' : 'Повторить создание') :
                (de ? 'Hausaufgaben im Hintergrund zuweisen' : 'Задать домашнее задание')}
          </button>
        </footer>
        <p className="post-homework-fineprint">{de ?
          'Nach dem Start können Sie die Seite schließen. Die Schule erstellt und verteilt geprüfte PDFs automatisch.' :
          'После запуска можно закрыть сайт. Школа создаст, проверит и назначит PDF автоматически на сервере.'}</p>
      </section>
    </div>
  );
}
