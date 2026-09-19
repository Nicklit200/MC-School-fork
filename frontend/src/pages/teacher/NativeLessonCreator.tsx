import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import type { StudentGroup, StudentListItem } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';
import { useI18n } from '../../i18n/I18nContext';

function localDateTimeValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function NativeLessonCreator({ onCreated }: { onCreated: () => void }) {
  const { language, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [startsAt, setStartsAt] = useState(() => {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + 1);
    return localDateTimeValue(date);
  });
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.students.list(), api.groups.list()])
      .then(([studentList, groupList]) => {
        setStudents(studentList);
        setGroups(groupList);
      })
      .catch(() => undefined);
  }, []);

  const targetOptions = useMemo(() => [
    ...groups.map((group) => ({ value: `group:${group.id}`, label: `Группа: ${group.name}` })),
    ...students.map((student) => ({ value: `student:${student.id}`, label: `Ученик: ${student.fullName}` })),
  ], [groups, students]);

  async function createLesson() {
    if (!target || !startsAt || busy) return;
    setBusy(true);
    setError(null);
    try {
      const start = new Date(startsAt);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      const [kind, id] = target.split(':', 2);
      await api.lessons.createNative({
        title: title.trim(),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        groupId: kind === 'group' ? id : null,
        studentId: kind === 'student' ? id : null,
        repeatWeeks,
      });
      setOpen(false);
      setTitle('');
      onCreated();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          {language === 'DE' ? '+ Unterricht erstellen' : '+ Создать урок'}
        </button>
      ) : (
        <section className="panel" style={{ padding: 20, maxWidth: 820 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>{language === 'DE' ? 'Unterricht in Mindcrafti erstellen' : 'Создать урок в Mindcrafti'}</h2>
              <p className="muted" style={{ margin: '5px 0 0' }}>
                {language === 'DE'
                  ? 'Funktioniert ohne Google Kalender.'
                  : 'Работает без Google Calendar. Урок, доска и история останутся в Mindcrafti.'}
              </p>
            </div>
            <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
              {language === 'DE' ? 'Schließen' : 'Закрыть'}
            </button>
          </div>

          {error && <div className="banner banner--error" style={{ marginTop: 12 }}>{error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 16 }}>
            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Schüler / Gruppe' : 'Ученик / группа'}</span>
              <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{language === 'DE' ? 'Auswählen' : 'Выбрать'}</option>
                {targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Titel' : 'Название'}</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={language === 'DE' ? 'Mathematik' : 'Математика'} />
            </label>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Beginn' : 'Дата и время'}</span>
              <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </label>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Dauer' : 'Длительность'}</span>
              <select className="select" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
                <option value={45}>45 мин</option>
                <option value={60}>60 мин</option>
                <option value={75}>75 мин</option>
                <option value={90}>90 мин</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">{language === 'DE' ? 'Wiederholen' : 'Повторять'}</span>
              <select className="select" value={repeatWeeks} onChange={(e) => setRepeatWeeks(Number(e.target.value))}>
                <option value={1}>{language === 'DE' ? 'Einmal' : 'Один раз'}</option>
                <option value={4}>4 недели</option>
                <option value={8}>8 недель</option>
                <option value={20}>20 недель</option>
              </select>
            </label>
          </div>

          <button className="btn" type="button" disabled={busy || !target || !startsAt} onClick={() => void createLesson()} style={{ marginTop: 14 }}>
            {busy ? (language === 'DE' ? 'Wird erstellt…' : 'Создаём…') : (language === 'DE' ? 'Unterricht erstellen' : 'Создать урок')}
          </button>
        </section>
      )}
    </div>
  );
}
