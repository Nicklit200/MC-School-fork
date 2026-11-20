import type { PostLessonHomeworkJob } from '../../api/onlineClasses';

/** Fixed messages only: provider responses and internal exception text are not user-facing. */
export function postLessonHomeworkFailureMessage(code: string | null | undefined, de: boolean): string {
  switch (code) {
    case 'LESSON_MATERIAL_MISSING':
      return de
        ? 'Es fehlen verwertbare Unterrichtsmaterialien. Bitte ein Arbeitsblatt oder Unterrichtsnotizen speichern und erneut versuchen.'
        : 'Недостаточно материалов урока. Сохраните рабочую тетрадь или заметки о пройденном и повторите запуск.';
    case 'AI_UNAVAILABLE':
    case 'AI_TIMEOUT':
    case 'AI_RATE_LIMITED':
      return de
        ? 'Der Dienst zur Aufgabenerstellung ist gerade nicht verfügbar. Bitte später erneut versuchen.'
        : 'Сервис создания заданий сейчас недоступен. Повторите запуск позже.';
    case 'AI_AUTH_FAILED':
      return de
        ? 'Die Verbindung zum Dienst zur Aufgabenerstellung muss von der Schulverwaltung geprüft werden.'
        : 'Администратору школы нужно проверить подключение сервиса создания заданий.';
    case 'AI_EMPTY_RESPONSE':
    case 'AI_RESPONSE_INVALID':
      return de
        ? 'Der Dienst zur Aufgabenerstellung hat keine verwertbare Antwort geliefert. Bitte erneut versuchen.'
        : 'Сервис создания заданий не вернул пригодный ответ. Повторите запуск.';
    case 'AI_REFUSED':
      return de
        ? 'Der Dienst zur Aufgabenerstellung konnte die Anfrage nicht bearbeiten. Bitte die Schulverwaltung informieren.'
        : 'Сервис создания заданий отказался обрабатывать запрос. Обратитесь к администратору школы.';
    case 'RENDERER_UNAVAILABLE':
    case 'SCHOOL_SETTINGS_MISSING':
      return de
        ? 'Die automatische PDF-Erstellung ist nicht betriebsbereit. Bitte die Schulverwaltung informieren.'
        : 'Создание PDF на сервере не готово к работе. Обратитесь к администратору школы.';
    case 'RENDERER_TIMEOUT':
      return de
        ? 'Die PDF-Erstellung hat zu lange gedauert. Bitte erneut versuchen.'
        : 'Создание PDF заняло слишком много времени. Повторите запуск.';
    case 'RENDERER_BUSY':
      return de
        ? 'Der Dienst zur PDF-Erstellung ist gerade ausgelastet. Bitte kurz warten und erneut versuchen.'
        : 'Сервис создания PDF сейчас занят. Подождите немного и повторите запуск.';
    case 'NO_RECIPIENTS':
      return de
        ? 'Nach den gespeicherten Anweisungen gibt es keine Empfänger. Bitte die Anweisungen mit der Schulverwaltung prüfen.'
        : 'По сохранённым указаниям не осталось получателей домашки. Проверьте указания с администратором школы.';
    case 'RECIPIENT_SELECTION_INVALID':
      return de
        ? 'Die Empfänger der Hausaufgaben konnten nicht zuverlässig bestimmt werden. Bitte erneut versuchen.'
        : 'Не удалось надёжно определить получателей домашки. Повторите запуск.';
    case 'DRAFT_COUNT_MISMATCH':
      return de
        ? 'Nicht alle erforderlichen PDFs wurden gespeichert. Die Hausaufgaben wurden nicht verteilt. Bitte erneut versuchen.'
        : 'Сохранены не все нужные PDF. Домашка не назначена. Повторите запуск.';
    case 'HOMEWORK_JSON_INVALID':
    case 'HOMEWORK_JSON_RENDER_INVALID':
    case 'HOMEWORK_MATH_QA_FAILED':
    case 'PDF_INVALID':
      return de
        ? 'Die erstellten Aufgaben haben die Prüfung nicht bestanden. Es wurden keine neuen Hausaufgaben verteilt. Bitte erneut versuchen.'
        : 'Созданные задания не прошли проверку. Новая домашка не назначена. Повторите создание.';
    case 'INTERRUPTED':
      return de
        ? 'Die Erstellung wurde unterbrochen. Mit einem erneuten Versuch werden bereits gespeicherte PDFs weiterverwendet.'
        : 'Создание прервалось. При повторном запуске уже сохранённые PDF будут использованы дальше.';
    case 'CONFLICT_409':
    case 'STUDENT_CHANGED':
    case 'TEACHER_REVOKED':
    case 'CLASS_CHANGED':
    case 'MEMBERSHIP_CHANGED':
      return de
        ? 'Die Unterrichtsdaten haben sich geändert. Bitte den Unterricht prüfen und die Schulverwaltung informieren, falls der Fehler bleibt.'
        : 'Данные урока изменились. Проверьте карточку урока и обратитесь к администратору, если ошибка повторяется.';
    default:
      return de
        ? 'Der Server konnte die Hausaufgaben nicht fertigstellen. Bitte erneut versuchen. Wenn der Fehler bleibt, die Schulverwaltung informieren.'
        : 'Сервер не смог завершить создание домашки. Повторите запуск. Если ошибка повторяется, обратитесь к администратору школы.';
  }
}

export function postLessonHomeworkStageMessage(job: PostLessonHomeworkJob, de: boolean): string | null {
  const labels = {
    RECIPIENT_SELECTION: de ? 'Empfänger bestimmen' : 'выбор получателей',
    LESSON_EVIDENCE: de ? 'Unterrichtsmaterialien lesen' : 'подготовка материалов урока',
    AI_CONTENT: de ? 'Aufgaben erstellen' : 'создание заданий',
    CONTENT_VALIDATION: de ? 'Aufgaben prüfen' : 'проверка заданий',
    PDF_RENDER: de ? 'PDF erstellen und prüfen' : 'создание и проверка PDF',
    PDF_STORAGE: de ? 'PDF speichern' : 'сохранение PDF',
    PUBLICATION: de ? 'Hausaufgaben zuweisen' : 'назначение домашки',
  };
  const stage = job.stage ? labels[job.stage] : null;
  if (!stage) return null;
  const day = typeof job.dayNumber === 'number' && job.dayNumber > 0
    ? (de ? `, Tag ${job.dayNumber}` : `, день ${job.dayNumber}`) +
      (job.days ? (de ? ` von ${job.days}` : ` из ${job.days}`) : '')
    : '';
  return `${de ? 'Schritt' : 'Этап'}: ${stage}${day}.`;
}
