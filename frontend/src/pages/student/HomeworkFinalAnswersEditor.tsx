import { useMemo, useState } from 'react';
import { saveHomeworkFinalAnswers, type HomeworkFinalAnswer } from '../../api/homeworkAnswers';
import { useI18n } from '../../i18n/I18nContext';

const KEYS = ['7', '8', '9', '/', '%', '4', '5', '6', '−', '+', '1', '2', '3', '×', '÷', '0', ',', '.', '(', ')', 'x', '=', '^', '√'];

function storageKey(homeworkId: string) {
  return `mindcrafti-final-answers:${homeworkId}`;
}

function loadInitial(homeworkId: string): HomeworkFinalAnswer[] {
  try {
    const raw = localStorage.getItem(storageKey(homeworkId));
    if (!raw) return [{ label: '1', answer: '' }];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [{ label: '1', answer: '' }];
    return parsed.map((item) => ({
      label: typeof item?.label === 'string' ? item.label : '',
      answer: typeof item?.answer === 'string' ? item.answer : '',
    }));
  } catch {
    return [{ label: '1', answer: '' }];
  }
}

export function HomeworkFinalAnswersEditor({ homeworkId }: { homeworkId: string }) {
  const { language } = useI18n();
  const [answers, setAnswers] = useState<HomeworkFinalAnswer[]>(() => loadInitial(homeworkId));
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAnswers = useMemo(
    () => answers
      .map((item) => ({ label: item.label.trim(), answer: item.answer.trim() }))
      .filter((item) => item.label || item.answer),
    [answers],
  );

  function persist(next: HomeworkFinalAnswer[]) {
    setAnswers(next);
    setSaved(false);
    localStorage.setItem(storageKey(homeworkId), JSON.stringify(next));
  }

  function changeRow(index: number, field: keyof HomeworkFinalAnswer, value: string) {
    const next = answers.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row);
    persist(next);
  }

  function appendKey(key: string) {
    const normalized = key === '−' ? '-' : key;
    const next = answers.map((row, index) => index === activeIndex
      ? { ...row, answer: `${row.answer}${normalized}` }
      : row);
    persist(next);
  }

  function backspace() {
    const next = answers.map((row, index) => index === activeIndex
      ? { ...row, answer: row.answer.slice(0, -1) }
      : row);
    persist(next);
  }

  function clearActive() {
    changeRow(activeIndex, 'answer', '');
  }

  function addRow() {
    const next = [...answers, { label: String(answers.length + 1), answer: '' }];
    persist(next);
    setActiveIndex(next.length - 1);
  }

  function removeRow(index: number) {
    const next = answers.filter((_, rowIndex) => rowIndex !== index);
    const normalized = next.length > 0 ? next : [{ label: '1', answer: '' }];
    persist(normalized);
    setActiveIndex(Math.min(activeIndex, normalized.length - 1));
  }

  async function save() {
    setError(null);
    if (validAnswers.length === 0) {
      setError(language === 'DE' ? 'Gib mindestens eine Antwort ein.' : 'Введи хотя бы один ответ.');
      return;
    }
    if (validAnswers.some((item) => !item.label || !item.answer)) {
      setError(language === 'DE' ? 'Fülle bei jeder Zeile Aufgabe und Antwort aus.' : 'В каждой заполненной строке укажи номер задания и ответ.');
      return;
    }

    setSaving(true);
    try {
      await saveHomeworkFinalAnswers(homeworkId, validAnswers);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel stack" style={{ marginTop: 18, marginBottom: 34, border: '2px solid #8b5cf6' }}>
      <div>
        <div className="pill" style={{ display: 'inline-flex', marginBottom: 8 }}>TEST</div>
        <h2 style={{ margin: 0 }}>{language === 'DE' ? 'Endantworten' : 'Ответы в конце домашки'}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {language === 'DE'
            ? 'Trage nur die Endantworten ein. Brüche kannst du z. B. als 3/4 und Prozente als 25% schreiben.'
            : 'Введи только конечные ответы. Дробь можно писать как 3/4, проценты — как 25%, отрицательное число — как -7.'}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {answers.map((row, index) => (
          <div key={index} className="row" style={{ gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0, width: 105 }}>
              <span className="field__label">{language === 'DE' ? 'Aufgabe' : 'Задание'}</span>
              <input
                className="input"
                value={row.label}
                placeholder="1a"
                onChange={(event) => changeRow(index, 'label', event.target.value)}
              />
            </label>
            <label className="field" style={{ margin: 0, flex: '1 1 220px' }}>
              <span className="field__label">{language === 'DE' ? 'Antwort' : 'Ответ'}</span>
              <input
                className="input"
                value={row.answer}
                placeholder={language === 'DE' ? 'z. B. -3/4 oder 25%' : 'например, -3/4 или 25%'}
                onFocus={() => setActiveIndex(index)}
                onChange={(event) => changeRow(index, 'answer', event.target.value)}
                inputMode="text"
                autoComplete="off"
              />
            </label>
            <button type="button" className="btn btn--ghost" onClick={() => removeRow(index)} disabled={answers.length === 1}>
              {language === 'DE' ? 'Entfernen' : 'Удалить'}
            </button>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn--secondary" onClick={addRow}>
        + {language === 'DE' ? 'Antwort hinzufügen' : 'Добавить ответ'}
      </button>

      <div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {language === 'DE' ? `Tastatur für Aufgabe ${answers[activeIndex]?.label || activeIndex + 1}` : `Клавиатура для задания ${answers[activeIndex]?.label || activeIndex + 1}`}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(48px, 1fr))', gap: 7 }}>
          {KEYS.map((key) => (
            <button key={key} type="button" className="btn btn--secondary" style={{ minHeight: 44, fontSize: 18 }} onClick={() => appendKey(key)}>
              {key}
            </button>
          ))}
          <button type="button" className="btn btn--secondary" style={{ minHeight: 44 }} onClick={backspace}>⌫</button>
          <button type="button" className="btn btn--ghost" style={{ minHeight: 44, gridColumn: 'span 2' }} onClick={clearActive}>
            {language === 'DE' ? 'Löschen' : 'Очистить'}
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {saved && (
        <div className="banner banner--success">
          {language === 'DE'
            ? 'Antworten gespeichert. Jetzt kannst du die Hausaufgabe oben abgeben.'
            : 'Ответы сохранены. Теперь можно сдать домашку кнопкой выше.'}
        </div>
      )}

      <button className="btn btn--block" type="button" onClick={() => void save()} disabled={saving}>
        {saving
          ? (language === 'DE' ? 'Speichern…' : 'Сохраняем…')
          : (language === 'DE' ? 'Antworten speichern' : 'Сохранить ответы')}
      </button>
    </section>
  );
}
