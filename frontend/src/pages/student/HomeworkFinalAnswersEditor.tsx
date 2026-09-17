import { useMemo, useState } from 'react';
import {
  saveHomeworkFinalAnswers,
  type HomeworkFinalAnswer,
  type HomeworkFinalAnswersResult,
} from '../../api/homeworkAnswers';
import { useI18n } from '../../i18n/I18nContext';

const KEYS = [
  '7', '8', '9', '/', '%', '€',
  '4', '5', '6', '−', '+', '×',
  '1', '2', '3', '.', ',', '÷',
  '0', '(', ')', 'x', '=', '√',
];

function storageKey(homeworkId: string) {
  return `mindcrafti-final-answers:${homeworkId}`;
}

function emptyAnswers(answerCount: number): HomeworkFinalAnswer[] {
  return Array.from({ length: answerCount }, (_, index) => ({ label: String(index + 1), answer: '' }));
}

function loadInitial(homeworkId: string, answerCount: number): HomeworkFinalAnswer[] {
  const fallback = emptyAnswers(answerCount);
  try {
    const raw = localStorage.getItem(storageKey(homeworkId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return fallback.map((row, index) => ({
      ...row,
      answer: typeof parsed[index]?.answer === 'string' ? parsed[index].answer : '',
    }));
  } catch {
    return fallback;
  }
}

export function HomeworkFinalAnswersEditor({
  homeworkId,
  answerCount,
  onCompleted,
}: {
  homeworkId: string;
  answerCount: number;
  onCompleted?: () => void;
}) {
  const { language } = useI18n();
  const [answers, setAnswers] = useState<HomeworkFinalAnswer[]>(() => loadInitial(homeworkId, answerCount));
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<HomeworkFinalAnswersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allFilled = useMemo(() => answers.every((item) => item.answer.trim().length > 0), [answers]);

  function persist(next: HomeworkFinalAnswer[]) {
    setAnswers(next);
    setResult(null);
    localStorage.setItem(storageKey(homeworkId), JSON.stringify(next));
  }

  function changeAnswer(index: number, value: string) {
    persist(answers.map((row, rowIndex) => rowIndex === index ? { ...row, answer: value } : row));
  }

  function appendKey(key: string) {
    const normalized = key === '−' ? '-' : key;
    persist(answers.map((row, index) => index === activeIndex
      ? { ...row, answer: `${row.answer}${normalized}` }
      : row));
  }

  function backspace() {
    persist(answers.map((row, index) => index === activeIndex
      ? { ...row, answer: row.answer.slice(0, -1) }
      : row));
  }

  function clearActive() {
    changeAnswer(activeIndex, '');
  }

  async function save() {
    setError(null);
    if (!allFilled) {
      setError(language === 'DE'
        ? `Bitte alle ${answerCount} Antworten ausfüllen.`
        : `Заполни все ${answerCount} ответа.`);
      return;
    }

    setSaving(true);
    try {
      const graded = await saveHomeworkFinalAnswers(homeworkId, answers);
      setResult(graded);
      if (graded.allCorrect) localStorage.removeItem(storageKey(homeworkId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel stack" style={{ margin: 0, border: '2px solid #8b5cf6', boxShadow: '0 22px 60px rgba(15,23,42,.22)' }}>
      <div>
        <div className="pill" style={{ display: 'inline-flex', marginBottom: 8 }}>TEST</div>
        <h2 style={{ margin: 0 }}>{language === 'DE' ? 'Endantworten eingeben' : 'Введи ответы по домашке'}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {language === 'DE'
            ? `Die PDF ist abgegeben. Trage jetzt ${answerCount} Endantworten ein. Brüche: 3/4, Prozent: 25%, Euro: 60€, Dezimalzahl: 2.5.`
            : `PDF уже сдан. Теперь введи ${answerCount} конечных ответа. Дробь: 3/4, процент: 25%, евро: 60€, десятичное число: 2.5.`}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {answers.map((row, index) => {
          const gradedItem = result?.items[index];
          return (
            <label key={row.label} className="field" style={{ margin: 0 }}>
              <span className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {language === 'DE' ? `Aufgabe ${index + 1}` : `Задание ${index + 1}`}
                {gradedItem && <span aria-label={gradedItem.correct ? 'correct' : 'wrong'}>{gradedItem.correct ? '✓' : '✕'}</span>}
              </span>
              <input
                className="input"
                value={row.answer}
                placeholder={language === 'DE' ? 'Antwort' : 'Ответ'}
                onFocus={() => setActiveIndex(index)}
                onChange={(event) => changeAnswer(index, event.target.value)}
                inputMode="text"
                autoComplete="off"
                style={gradedItem ? { borderColor: gradedItem.correct ? '#16a34a' : '#dc2626', fontSize: 18 } : { fontSize: 18 }}
              />
            </label>
          );
        })}
      </div>

      <div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {language === 'DE'
            ? `Mathe-Tastatur · Aufgabe ${activeIndex + 1}`
            : `Математическая клавиатура · задание ${activeIndex + 1}`}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(40px, 1fr))', gap: 7 }}>
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="btn btn--secondary"
              style={{ minHeight: 46, minWidth: 0, padding: '8px 4px', fontSize: 18 }}
              onClick={() => appendKey(key)}
            >
              {key}
            </button>
          ))}
          <button type="button" className="btn btn--secondary" style={{ minHeight: 46, gridColumn: 'span 2' }} onClick={backspace}>⌫</button>
          <button type="button" className="btn btn--ghost" style={{ minHeight: 46, gridColumn: 'span 4' }} onClick={clearActive}>
            {language === 'DE' ? 'Aktive Antwort löschen' : 'Очистить выбранный ответ'}
          </button>
        </div>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {result && (
        <div className={result.allCorrect ? 'banner banner--success' : 'banner banner--error'}>
          <strong>
            {language === 'DE'
              ? `${result.correctCount} von ${result.totalCount} richtig.`
              : `Правильно: ${result.correctCount} из ${result.totalCount}.`}
          </strong>
          {!result.allCorrect && (
            <div style={{ marginTop: 4 }}>
              {language === 'DE' ? 'Prüfe die rot markierten Antworten und versuche es noch einmal.' : 'Проверь ответы, отмеченные красным, и попробуй ещё раз.'}
            </div>
          )}
        </div>
      )}

      {!result?.allCorrect ? (
        <button className="btn btn--block" type="button" onClick={() => void save()} disabled={saving || !allFilled}>
          {saving
            ? (language === 'DE' ? 'Wird geprüft…' : 'Проверяем…')
            : (language === 'DE' ? 'Antworten prüfen' : 'Проверить ответы')}
        </button>
      ) : (
        <button className="btn btn--block" type="button" onClick={onCompleted}>
          {language === 'DE' ? 'Fertig' : 'Готово'}
        </button>
      )}
    </section>
  );
}
