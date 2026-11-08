import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import type { KolinContext, KolinTranscriptContext } from '../../api/kolin';
import type { KolinFailureCode, useKolinChat } from './useKolinChat';
import { KolinWorksheetCard } from './KolinWorksheetCard';
import './kolin-panel.css';

function lessonTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function failureMessage(code: KolinFailureCode | null, de: boolean) {
  switch (code) {
    case 'KOLIN_BUSY': return de
      ? 'Kolyn bereitet die Antwort noch vor. Versuchen Sie es in ein paar Sekunden erneut.'
      : 'Kolyn ещё готовит ответ. Повторите через несколько секунд.';
    case 'KOLIN_TASK_INVALID': return de
      ? 'Die Aufgaben konnten nicht überprüft werden. Bitte senden Sie die Anfrage erneut.'
      : 'Не удалось проверить задания. Повторите запрос.';
    case 'KOLIN_GENERATION_FAILED': return de
      ? 'Kolyn konnte die Antwort nicht fertigstellen. Bitte senden Sie die Anfrage erneut.'
      : 'Kolyn не смог завершить ответ. Повторите запрос.';
    default: return de
      ? 'Die Antwort konnte nicht geladen werden. Bitte erneut versuchen.'
      : 'Не удалось получить ответ. Повторите отправку.';
  }
}

function TranscriptContextNote({ context, de }: { context: KolinTranscriptContext; de: boolean }) {
  const range = context.fromMs !== null && context.toMs !== null
    ? `${lessonTime(context.fromMs)}-${lessonTime(context.toMs)}`
    : context.toMs !== null ? `${de ? 'bis' : 'до'} ${lessonTime(context.toMs)}` : null;
  const date = context.latestSegmentAt ? new Date(context.latestSegmentAt) : null;
  const locale = de ? 'de-DE' : 'ru-RU';
  return <footer className="kolin-panel__transcript-context" aria-label={de ? 'Transkript-Kontext' : 'Контекст расшифровки'}
    data-transcript-state={context.state}>
    <span>{context.state === 'included'
      ? `${de ? 'Transkript' : 'Расшифровка'}: ${context.segmentCount} ${de ? 'Beiträge' : 'реплик'}${range ? `, ${range} ${de ? 'im Unterricht' : 'урока'}` : ''}.${context.truncated ? de ? ' Ausschnitt.' : ' Фрагмент.' : ''}`
      : context.state === 'empty'
        ? de ? 'Transkript: noch keine gespeicherten Beiträge.' : 'Расшифровка: сохранённых реплик пока нет.'
        : de ? 'Transkript konnte nicht geladen werden. Antwort ohne Transkript.' : 'Расшифровку не удалось прочитать. Ответ без неё.'}</span>
    {context.state === 'included' && <span>{date
      ? <>{de ? 'Letzter gespeicherter Beitrag: ' : 'Последняя сохранённая реплика: '}
        <time dateTime={context.latestSegmentAt!} title={date.toLocaleString(locale)}>{date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>.</>
      : de ? 'Zeit des letzten Beitrags unbekannt.' : 'Время последней реплики неизвестно.'}</span>}
    {!context.transcriptionActive && <span>{de ? 'Transkription war bei der Anfrage nicht aktiv.' : 'На момент запроса расшифровка была неактивна.'}</span>}
  </footer>;
}

export function KolinPanel({ chat, context }: { chat: ReturnType<typeof useKolinChat>; context: KolinContext }) {
  const { language } = useI18n();
  const de = language === 'DE';
  const log = useRef<HTMLOListElement>(null);
  const nearBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (chat.open && nearBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.messages.length, chat.pending, chat.open]);
  useEffect(() => { if (chat.open) input.current?.focus(); }, [chat.open]);
  const send = () => void chat.send(context);

  return <aside id="kolin-panel" className="answers-panel kolin-panel" aria-label="Kolyn">
    <header className="answers-panel__heading">
      <div><strong className="kolin-panel__title">Kolyn</strong>
        <p className="kolin-panel__subtitle">{de ? 'KI-Assistent für Lehrkräfte' : 'AI-помощник преподавателя'}</p></div>
      <button type="button" className="answers-panel__close" onClick={chat.close}
        aria-label={de ? 'Kolyn schließen' : 'Закрыть Kolyn'}>×</button>
    </header>
    <ol ref={log} className="kolin-panel__messages" role="log" aria-label={de ? 'Chat mit Kolyn' : 'Переписка с Kolyn'}
      onScroll={() => { const element = log.current; if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      {!chat.messages.length && <li className="kolin-panel__welcome">{de
        ? 'Ich bin Kolyn. Ich helfe beim Erklären, beim Besprechen von Lösungen und beim Vorbereiten von Aufgaben.'
        : 'Я Kolyn. Помогу объяснить тему, разобрать решение и подготовить задания.'}
        <p>{de ? 'Bei Ihrer Frage nutze ich das gespeicherte Transkript dieses Unterrichts. Ich gebe keine automatischen Hinweise.'
          : 'Когда вы задаёте вопрос, я использую сохранённую расшифровку этого урока. Автоматических подсказок нет.'}</p></li>}
      {chat.messages.map(message => <li key={message.id} className={`kolin-panel__message kolin-panel__message--${message.role}`}
        data-role={message.role} data-message-type={message.type}>
        <span className="kolin-panel__speaker">{message.role === 'assistant' ? 'Kolyn' : de ? 'Sie' : 'Вы'}</span>
        {message.text && <p>{message.text}</p>}
        {message.role === 'assistant' && (message.materials ?? (message.worksheet ? [message.worksheet] : [])).map(worksheet =>
          <KolinWorksheetCard key={worksheet.id} classId={chat.classId} worksheet={worksheet}
            appendStatus={message.materials ? message.materialAppendStatus?.[worksheet.id] : message.appendStatus} de={de}
            onAdd={() => void chat.appendWorksheet(worksheet.id)} />)}
        {message.role === 'assistant' && message.transcriptContext && <TranscriptContextNote context={message.transcriptContext} de={de} />}
      </li>)}
    </ol>
    {chat.pending && <p className="kolin-panel__status" role="status">{de ? 'Kolyn denkt nach…' : 'Kolyn думает…'}</p>}
    {chat.availability === 'checking' && <p className="kolin-panel__status" role="status">{de ? 'Kolyn wird verbunden…' : 'Подключаем Kolyn…'}</p>}
    {chat.availability === 'unconfigured' && <p className="kolin-panel__status" role="status">{de ? 'Kolyn ist noch nicht verfügbar.' : 'Kolyn пока недоступен.'}</p>}
    {chat.error && <div className="kolin-panel__error" role="alert">
      <p>{failureMessage(chat.failureCode, de)}</p>
      <button type="button" onClick={() => void chat.retry()} disabled={chat.pending || chat.availability === 'checking'}>
        {de ? 'Erneut senden' : 'Повторить отправку'}
      </button>
    </div>}
    <form className="kolin-panel__form" onSubmit={event => { event.preventDefault(); send(); }}>
      <textarea ref={input} value={chat.draft} onChange={event => chat.setDraft(event.target.value)} rows={2} maxLength={2000}
        aria-label={de ? 'An Kolyn schreiben…' : 'Напишите Kolyn…'} placeholder={de ? 'An Kolyn schreiben…' : 'Напишите Kolyn…'}
        disabled={chat.pending} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          event.stopPropagation();
        }} />
      <button type="submit" disabled={chat.pending || chat.availability !== 'ready' || !chat.draft.trim()}>{de ? 'Senden' : 'Отправить'}</button>
    </form>
  </aside>;
}
