import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import type { GroupLesson, StudentGroup, StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { lessonOccurrenceDates, lessonPeriodEnd, lessonWeekday, localLessonDate, type LessonRepeatPeriod } from '../../lib/lessonRecurrence';
import './create-lesson.css';
import { LessonTargetPicker, type LessonTargetKind } from './LessonTargetPicker';

function initialDate(): string { return localLessonDate(new Date()); }

export function CreateLessonPanel({ students, groups, onCreated, selectedDate, disabled = false }: {
  students: StudentListItem[];
  groups: StudentGroup[];
  onCreated: (lessons: GroupLesson[]) => void | Promise<void>;
  selectedDate?: string;
  disabled?: boolean;
}) {
  const { language, t } = useI18n();
  const de = language === 'DE';
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState('');
  const [targetKind, setTargetKind] = useState<LessonTargetKind>('student');
  const [trialName, setTrialName] = useState('');
  const [lessonDate, setLessonDate] = useState(initialDate);
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [period, setPeriod] = useState<LessonRepeatPeriod>('ONCE');
  const [weekdays, setWeekdays] = useState<number[]>(() => [lessonWeekday(initialDate())]);
  const [customWeekdays, setCustomWeekdays] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const host = layer.current?.parentElement;
    const siblings = host ? [...host.children].filter((element) => element !== layer.current) : [];
    const previousInert = siblings.map((element) => element.getAttribute('inert'));
    siblings.forEach((element) => element.setAttribute('inert', ''));
    dialog.current?.querySelector<HTMLElement>('select, input, button')?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element, index) => {
        const value = previousInert[index];
        if (value === null) element.removeAttribute('inert'); else element.setAttribute('inert', value);
      });
      trigger.current?.focus({ preventScroll: true });
    };
  }, [expanded]);

  function close() { if (!saving) setExpanded(false); }
  function handleKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const isTrial = targetKind === 'trial';
  const group = target.startsWith('group:') ? groups.find((item) => item.id === target.slice(6)) : undefined;
  const student = target.startsWith('student:') ? students.find((item) => item.id === target.slice(8)) : undefined;
  const title = isTrial
    ? (trialName.trim() ? (de ? 'Probeunterricht · ' : 'Пробный урок · ') + trialName.trim() : '')
    : group?.name ?? student?.fullName ?? '';
  const duration = Number(durationMinutes);
  const start = new Date(lessonDate + 'T00:00:00');
  const validDuration = Number.isInteger(duration) && duration > 0 && duration <= 1440;
  const endsAt = Number.isFinite(start.getTime()) && validDuration
    ? new Date(start.getTime() + duration * 60_000) : null;

  const occurrenceDates = lessonOccurrenceDates(lessonDate, period, weekdays);
  const series = period !== 'ONCE';
  const periodEnd = lessonPeriodEnd(lessonDate, period);
  const formatDate = (value: string) => new Intl.DateTimeFormat(de ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(value + 'T12:00:00'));
  const weekdayNames = de
    ? ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
    : ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
  const weekdayShort = de ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] : ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (isTrial && !trialName.trim()) {
      setError(de ? 'Gib den Namen des Schülers ein.' : 'Укажите имя ученика для пробного урока.');
      return;
    }
    if (!target || !title || !Number.isFinite(start.getTime()) || !endsAt || !validDuration) {
      setError(de ? 'Wähle einen Unterricht, das Datum und eine Dauer von 1 bis 1440 Minuten.' : 'Выберите группу, ученика или пробный урок, укажите дату и длительность от 1 до 1440 минут.');
      return;
    }
    if (occurrenceDates.length === 0) {
      setError(de ? 'Wähle mindestens einen Wochentag.' : 'Выберите хотя бы один день недели.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = period === 'ONCE'
        ? [await api.lessons.create({ title, startsAt: start.toISOString(), endsAt: endsAt.toISOString(), groupId: group?.id ?? null, studentId: student?.id ?? null })]
        : await api.lessons.createSeries({ title, startDate: lessonDate, durationMinutes: duration, period, weekdays: [...weekdays].sort((a, b) => a - b), groupId: group?.id ?? null, studentId: student?.id ?? null });
      await onCreated(created);
      setTarget('');
      setTargetKind('student');
      setTrialName('');
      setExpanded(false);
    } catch (cause) {
      setError(toErrorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button className="btn lesson-plan-trigger" type="button" ref={trigger} aria-haspopup="dialog" aria-expanded={expanded} aria-controls="create-lesson-dialog"
      disabled={saving || disabled} onClick={() => {
        if (!target && selectedDate) { setLessonDate(selectedDate); if (!customWeekdays) setWeekdays([lessonWeekday(selectedDate)]); }
        setError(null); setExpanded(true);
      }}>
      {de ? 'Unterricht planen' : 'Запланировать урок'}
    </button>
    {expanded && createPortal(
      <div className="lesson-drawer-layer" ref={layer} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div className="lesson-drawer teacher-content" ref={dialog} id="create-lesson-dialog" role="dialog" aria-modal="true" aria-labelledby="create-lesson-title" aria-describedby="create-lesson-description" onKeyDown={handleKeys}>
          <header className="lesson-drawer__header">
            <div><span className="lesson-drawer__eyebrow">{de ? 'Stundenplan' : 'Расписание'}</span>
              <h2 id="create-lesson-title">{de ? 'Unterricht planen' : 'Запланировать урок'}</h2>
            </div>
            <button type="button" className="teacher-icon-button" aria-label={de ? 'Planung schließen' : 'Закрыть планирование'} disabled={saving} onClick={close}>×</button>
          </header>
          <p className="muted lesson-drawer__description" id="create-lesson-description">{de ? 'Wähle die Teilnehmer, das Datum und die Dauer. Du kannst auch eine Terminserie erstellen.' : 'Выберите участников, дату и длительность. Можно запланировать один урок или серию занятий.'}</p>
        <form id="create-lesson-form" className="lesson-create__form" onSubmit={(event) => void submit(event)} aria-busy={saving}>
          <fieldset disabled={saving}>
            <div className="lesson-create__fields">
              <LessonTargetPicker kind={targetKind} value={target} students={students} groups={groups} de={de} invalid={Boolean(error && !target)}
                onKindChange={(kind) => { setTargetKind(kind); setTarget(kind === 'trial' ? 'trial' : ''); setTrialName(''); setError(null); }}
                onChange={(value) => { setTarget(value); setTrialName(''); setError(null); }} />
              {isTrial && <label className="field lesson-create__full-row">
                <span className="field__label">{de ? 'Name des Schülers' : 'Имя ученика'}</span>
                <input className="input" type="text" autoComplete="off" required maxLength={120} value={trialName}
                  onChange={(event) => setTrialName(event.target.value)} placeholder={de ? 'Name eingeben' : 'Введите имя ученика'} />
              </label>}
              <label className="field">
                <span className="field__label">{de ? 'Unterrichtsdatum' : 'Дата урока'}</span>
                <input className="input" type="date" required value={lessonDate} onChange={(event) => { setLessonDate(event.target.value); if (!customWeekdays) setWeekdays([lessonWeekday(event.target.value)]); }} />
              </label>
              <label className="field">
                <span className="field__label">{de ? 'Dauer in Minuten' : 'Длительность урока, минут'}</span>
                <input className="input" type="number" inputMode="numeric" required min={1} max={1440} step={1}
                  value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
              </label>
            </div>
            <div className="lesson-repeat">
              <div className="field__label" id="lesson-repeat-label">{de ? 'Zeitraum' : 'На какой срок'}</div>
              <div className="lesson-repeat__periods" role="group" aria-labelledby="lesson-repeat-label">
                {(['ONCE', 'TWO_WEEKS', 'THREE_WEEKS', 'MONTH'] as const).map((value, index) => (
                  <button className={'lesson-repeat__period' + (period === value ? ' is-selected' : '')} key={value}
                    type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setError(null); }}>
                    {(de ? ['Ein Unterricht', '2 Wochen', '3 Wochen', 'Ein Monat'] : ['Один урок', '2 недели', '3 недели', 'Месяц'])[index]}
                  </button>
                ))}
              </div>
              {series && <fieldset className="lesson-repeat__weekdays">
                <legend className="field__label">{de ? 'Wochentage' : 'Дни недели'}</legend>
                <div className="lesson-repeat__days">
                  {weekdayNames.map((name, index) => <label className={'lesson-repeat__day' + (weekdays.includes(index + 1) ? ' is-selected' : '')} key={name} title={name}>
                    <input type="checkbox" aria-label={name} checked={weekdays.includes(index + 1)} onChange={(event) => {
                      setCustomWeekdays(true);
                      setWeekdays((current) => event.target.checked ? [...current, index + 1] : current.filter((day) => day !== index + 1));
                      setError(null);
                    }} />
                    {weekdayShort[index]}
                  </label>)}
                </div>
              </fieldset>}
            </div>
            {(title || endsAt) && <div className="lesson-create__preview" role="status">
              {title && <div>{de ? 'Unterrichtstitel: ' : 'Название урока: '}<strong>{title}</strong></div>}
              {endsAt && <div className="muted">{de ? 'Dauer: ' : 'Длительность: '}{duration} {de ? 'Min.' : 'мин'}</div>}
              {series && periodEnd && <>
                <div>{de ? 'Zeitraum: ' : 'Период: '}{formatDate(lessonDate)} — {formatDate(periodEnd)}</div>
                <div><strong>{de ? 'Unterrichtstermine: ' : 'Уроков в расписании: '}{occurrenceDates.length}</strong></div>
                {occurrenceDates.length > 0 ? <ul className="lesson-repeat__dates" aria-label={de ? 'Unterrichtsdaten' : 'Даты уроков'}>
                  {occurrenceDates.map((date) => <li key={date}>{formatDate(date)}</li>)}
                </ul> : <div>{de ? 'Wähle mindestens einen Wochentag.' : 'Выберите хотя бы один день недели.'}</div>}
              </>}
            </div>}
            {error && <div className="banner banner--error" role="alert" id="lesson-create-error">{error}</div>}
            <div className="lesson-create__actions">
              <span className="muted">{de ? 'Wähle den Tag und die Dauer des Unterrichts.' : 'Укажите день занятия и его длительность.'}</span>
              <button className="btn" type="submit">{saving ? (de ? 'Wird gespeichert…' : 'Сохраняем…') : (series ? (de ? 'Serie erstellen (' : 'Создать серию (') + occurrenceDates.length + ')' : (de ? 'Unterricht speichern' : 'Сохранить урок'))}</button>
            </div>
          </fieldset>
        </form>
        </div>
      </div>, document.querySelector('.teacher-shell') ?? document.body,
    )}
  </>;
}
