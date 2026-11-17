import { useEffect, useRef, useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';
import '../../styles/post-lesson-homework.css';

type Props = { classId: string; title: string; language: string; onDone: () => void };

/** Shown only after successful classroom end and board save. */
export function PostLessonHomeworkDialog({ classId, title, language, onDone }: Props) {
  const de = language === 'DE';
  const [days, setDays] = useState(7);
  const [instructions, setInstructions] = useState('');
  const [pending, setPending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
      const current = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
      recorder.current = current; chunks.current = [];
      current.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      current.onstop = async () => {
        setRecording(false);
        stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
        const recorded = new Blob(chunks.current, { type: current.mimeType });
        if (!recorded.size) return;
        const extension = current.mimeType.includes('mp4') ? 'mp4' : current.mimeType.includes('ogg') ? 'ogg' : 'webm';
        setTranscribing(true);
        try {
          const text = await onlineClassesApi.transcribePostLessonHomework(
            classId, new File([recorded], 'instruction.' + extension, { type: current.mimeType }));
          setInstructions(previous => [previous.trim(), text.trim()].filter(Boolean).join('\n'));
        } catch {
          setError(de ? 'Sprachnachricht konnte nicht erkannt werden.' : 'Не удалось распознать голосовое. Напишите указание текстом.');
        } finally { setTranscribing(false); }
      };
      current.start(); setRecording(true);
    } catch {
      stream.current?.getTracks().forEach(track => track.stop());
      setError(de ? 'Mikrofonzugriff nicht möglich.' : 'Не удалось получить доступ к микрофону.');
    }
  };

  const submit = async () => {
    if (pending || recording || transcribing) return;
    setPending(true); setError(null);
    try {
      await onlineClassesApi.postLessonHomework(classId, days, instructions);
      onDone();
    } catch {
      setError(de ? 'Hausaufgabe konnte nicht gestartet werden. Bitte erneut versuchen.' :
        'Не удалось запустить домашку. Проверьте подключение и повторите.');
      setPending(false);
    }
  };

  return (
    <div className="post-homework-backdrop">
      <section role="dialog" aria-modal="true" aria-labelledby="post-homework-title" className="post-homework-island">
        <header className="post-homework-header">
          <span className="post-homework-book" aria-hidden="true">▣</span>
          <div>
            <h2 ref={heading} tabIndex={-1} id="post-homework-title">
              {de ? 'Hausaufgaben' : 'Домашнее задание'}
            </h2>
            <p>{title} · {de ? 'Nach Unterrichtsende' : 'После завершения урока'}</p>
          </div>
        </header>
        <div className="post-homework-main">
          <h3>{de ? 'Für wie viele Tage Hausaufgaben?' : 'На сколько дней задать домашку?'}</h3>
          <div className="post-homework-days" role="group" aria-label={de ? 'Anzahl der Tage' : 'Количество дней'}>
            {[1, 2, 3, 4, 5, 6, 7].map(number => (
              <button key={number} type="button"
                className={'post-homework-day' + (number <= days ? ' is-selected' : '')}
                aria-pressed={number === days} disabled={pending} onClick={() => setDays(number)}>
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
          <h3>{de ? 'Zusätzliche Anweisungen' : 'Дополнительные указания преподавателя'}</h3>
          <textarea className="post-homework-textarea" value={instructions}
            maxLength={3000} onChange={event => setInstructions(event.target.value)}
            placeholder={de ? 'Zum Beispiel: Melissa war heute nicht dabei, ihr nichts aufgeben. Vitalina soll Brüche und Terme üben.' :
              'Например: Мелиссы сегодня не было, ей не задавай. Виталине повторить Brüche и Terme перед контрольной.'}
            disabled={pending || recording || transcribing} />
          <button type="button" className={'post-homework-voice' + (recording ? ' is-recording' : '')}
            onClick={() => void toggleVoice()} disabled={pending || transcribing}>
            <span aria-hidden="true">{recording ? '■' : '●'}</span>
            {recording ? (de ? 'Aufnahme stoppen' : 'Остановить запись') :
              transcribing ? (de ? 'Wird erkannt...' : 'Распознаём голос...') :
              (de ? 'Sprachanweisung aufnehmen' : 'Записать голосовое указание')}
          </button>
        </div>
        {error && <p className="post-homework-error" role="alert">{error}</p>}
        <footer className="post-homework-footer">
          <button type="button" className="post-homework-skip" onClick={onDone} disabled={pending || transcribing}>
            {de ? 'Überspringen' : 'Пропустить'}
          </button>
          <button type="button" className="post-homework-submit" disabled={pending || transcribing || recording}
            onClick={() => void submit()}>
            {pending ? (de ? 'Wird gestartet…' : 'Запускаем…') :
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
