import { useMemo, useState } from 'react';
import {
  saveHomeworkFinalAnswers,
  type HomeworkFinalAnswer,
  type HomeworkFinalAnswersResult,
} from '../../api/homeworkAnswers';
import { useI18n } from '../../i18n/I18nContext';

type EntryMode = 'text' | 'fraction' | 'mixed';
type Draft = {
  label: string;
  mode: EntryMode;
  text: string;
  whole: string;
  numerator: string;
  denominator: string;
};
type FractionPart = 'whole' | 'numerator' | 'denominator';

const KEYS = [
  '7', '8', '9', '%', '€', '⌫',
  '4', '5', '6', '−', '+', '×',
  '1', '2', '3', '.', ',', '÷',
  '0', '(', ')', 'x', '=', '√',
];

function storageKey(homeworkId: string) {
  return `mindcrafti-final-answers-v2:${homeworkId}`;
}

function emptyDrafts(answerCount: number): Draft[] {
  return Array.from({ length: answerCount }, (_, index) => ({
    label: String(index + 1),
    mode: 'text',
    text: '',
    whole: '',
    numerator: '',
    denominator: '',
  }));
}

function loadInitial(homeworkId: string, answerCount: number): Draft[] {
  const fallback = emptyDrafts(answerCount);
  try {
    const raw = localStorage.getItem(storageKey(homeworkId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return fallback.map((row, index) => {
      const source = parsed[index];
      if (!source || typeof source !== 'object') return row;
      const mode: EntryMode = source.mode === 'fraction' || source.mode === 'mixed' ? source.mode : 'text';
      return {
        ...row,
        mode,
        text: typeof source.text === 'string' ? source.text : '',
        whole: typeof source.whole === 'string' ? source.whole : '',
        numerator: typeof source.numerator === 'string' ? source.numerator : '',
        denominator: typeof source.denominator === 'string' ? source.denominator : '',
      };
    });
  } catch {
    return fallback;
  }
}

function isFilled(draft: Draft) {
  if (draft.mode === 'text') return draft.text.trim().length > 0;
  if (draft.mode === 'fraction') return draft.numerator.trim().length > 0 && draft.denominator.trim().length > 0;
  return draft.whole.trim().length > 0 && draft.numerator.trim().length > 0 && draft.denominator.trim().length > 0;
}

function serializeDraft(draft: Draft): string {
  if (draft.mode === 'text') return draft.text.trim();
  const numerator = Number(draft.numerator.replace(',', '.'));
  const denominator = Number(draft.denominator.replace(',', '.'));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return '';
  if (draft.mode === 'fraction') return `${draft.numerator}/${draft.denominator}`;

  const whole = Number(draft.whole.replace(',', '.'));
  if (!Number.isFinite(whole)) return '';
  const sign = whole < 0 ? -1 : 1;
  const improper = Math.abs(whole) * denominator + numerator;
  return `${sign * improper}/${denominator}`;
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
  const [drafts, setDrafts] = useState<Draft[]>(() => loadInitial(homeworkId, answerCount));
  const [activeIndex, setActiveIndex] = useState(0);
  const [activePart, setActivePart] = useState<FractionPart>('numerator');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<HomeworkFinalAnswersResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allFilled = useMemo(() => drafts.every(isFilled), [drafts]);
  const activeDraft = drafts[activeIndex] ?? drafts[0];

  function persist(next: Draft[]) {
    setDrafts(next);
    setResult(null);
    setError(null);
    localStorage.setItem(storageKey(homeworkId), JSON.stringify(next));
  }

  function updateDraft(index: number, patch: Partial<Draft>) {
    persist(drafts.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function activate(index: number) {
    setActiveIndex(index);
    const mode = drafts[index]?.mode ?? 'text';
    setActivePart(mode === 'mixed' ? 'whole' : 'numerator');
  }

  function setMode(mode: EntryMode) {
    updateDraft(activeIndex, { mode });
    setActivePart(mode === 'mixed' ? 'whole' : 'numerator');
  }

  function appendKey(key: string) {
    if (key === '⌫') {
      backspace();
      return;
    }
    const normalized = key === '−' ? '-' : key;
    if (!activeDraft) return;
    if (activeDraft.mode === 'text') {
      updateDraft(activeIndex, { text: `${activeDraft.text}${normalized}` });
      return;
    }
    if (!/^[0-9.,-]$/.test(normalized)) return;
    const field = activePart;
    updateDraft(activeIndex, { [field]: `${activeDraft[field]}${normalized}` });
  }

  function backspace() {
    if (!activeDraft) return;
    if (activeDraft.mode === 'text') {
      updateDraft(activeIndex, { text: activeDraft.text.slice(0, -1) });
      return;
    }
    const field = activePart;
    updateDraft(activeIndex, { [field]: activeDraft[field].slice(0, -1) });
  }

  function clearActive() {
    if (!activeDraft) return;
    if (activeDraft.mode === 'text') updateDraft(activeIndex, { text: '' });
    else updateDraft(activeIndex, { whole: '', numerator: '', denominator: '' });
  }

  async function submit() {
    setError(null);
    if (!allFilled) {
      setError(language === 'DE' ? 'Bitte alle Antworten ausfüllen.' : 'Заполни все ответы.');
      return;
    }

    const answers: HomeworkFinalAnswer[] = drafts.map((draft) => ({ label: draft.label, answer: serializeDraft(draft) }));
    if (answers.some((answer) => !answer.answer)) {
      setError(language === 'DE' ? 'Prüfe die Brüche.' : 'Проверь введённые дроби.');
      return;
    }

    setSaving(true);
    try {
      const graded = await saveHomeworkFinalAnswers(homeworkId, answers);
      setResult(graded);
      if (graded.allCorrect) {
        localStorage.removeItem(storageKey(homeworkId));
        onCompleted?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel stack" style={{ margin: 0, border: 0, borderRadius: 22, boxShadow: '0 22px 60px rgba(15,23,42,.22)' }}>
      <h2 style={{ margin: 0 }}>{language === 'DE' ? 'Antworten' : 'Ответы'}</h2>

      <div style={{ display: 'grid', gap: 14 }}>
        {drafts.map((draft, index) => {
          const gradedItem = result?.items[index];
          return (
            <div key={draft.label} className="field" style={{ margin: 0 }}>
              <span className="field__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {language === 'DE' ? `Aufgabe ${index + 1}` : `Задание ${index + 1}`}
                {gradedItem && <span>{gradedItem.correct ? '✓' : '✕'}</span>}
              </span>
              <button
                type="button"
                onClick={() => activate(index)}
                style={{
                  width: '100%', minHeight: 72, borderRadius: 14, padding: '10px 14px', background: '#fff',
                  border: `2px solid ${activeIndex === index ? '#0f8b66' : gradedItem ? (gradedItem.correct ? '#16a34a' : '#dc2626') : '#dce3ea'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-start', fontSize: 24, color: '#111827',
                }}
              >
                {draft.mode === 'text' ? (
                  <span style={{ color: draft.text ? '#111827' : '#94a3b8' }}>{draft.text || (language === 'DE' ? 'Antwort' : 'Ответ')}</span>
                ) : (
                  <MathFractionInput
                    draft={draft}
                    active={activeIndex === index}
                    activePart={activePart}
                    onPart={(part) => { activate(index); setActivePart(part); }}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <button type="button" className={`btn ${activeDraft?.mode === 'text' ? '' : 'btn--secondary'}`} onClick={() => setMode('text')}>
          {language === 'DE' ? 'Normal' : 'Обычный'}
        </button>
        <button type="button" className={`btn ${activeDraft?.mode === 'fraction' ? '' : 'btn--secondary'}`} onClick={() => setMode('fraction')}>
          <FractionIcon mixed={false} />
        </button>
        <button type="button" className={`btn ${activeDraft?.mode === 'mixed' ? '' : 'btn--secondary'}`} onClick={() => setMode('mixed')}>
          <FractionIcon mixed />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(42px, 1fr))', gap: 7 }}>
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="btn btn--secondary"
            style={{ minHeight: 52, minWidth: 0, padding: '8px 3px', fontSize: 20 }}
            onClick={() => appendKey(key)}
          >
            {key}
          </button>
        ))}
      </div>

      <button type="button" className="btn btn--ghost" onClick={clearActive}>
        {language === 'DE' ? 'Löschen' : 'Очистить'}
      </button>

      {error && <div className="banner banner--error">{error}</div>}
      {result && !result.allCorrect && (
        <div className="banner banner--error">
          {language === 'DE'
            ? `${result.correctCount} von ${result.totalCount} richtig. Korrigiere die markierten Antworten.`
            : `Правильно: ${result.correctCount} из ${result.totalCount}. Исправь отмеченные ответы.`}
        </div>
      )}

      <button className="btn btn--block" type="button" onClick={() => void submit()} disabled={saving || !allFilled} style={{ minHeight: 58, fontSize: 20 }}>
        {saving ? (language === 'DE' ? 'Wird abgegeben…' : 'Сдаём…') : (language === 'DE' ? 'Abgeben' : 'Сдать')}
      </button>
    </section>
  );
}

function MathFractionInput({
  draft,
  active,
  activePart,
  onPart,
}: {
  draft: Draft;
  active: boolean;
  activePart: FractionPart;
  onPart: (part: FractionPart) => void;
}) {
  const cellStyle = (part: FractionPart) => ({
    minWidth: 34,
    minHeight: 30,
    padding: '2px 7px',
    borderRadius: 7,
    background: active && activePart === part ? '#dcf7ee' : 'transparent',
    color: (part === 'whole' ? draft.whole : part === 'numerator' ? draft.numerator : draft.denominator) ? '#111827' : '#94a3b8',
  });
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
      {draft.mode === 'mixed' && (
        <span style={cellStyle('whole')} onClick={(e) => { e.stopPropagation(); onPart('whole'); }}>
          {draft.whole || '□'}
        </span>
      )}
      <span style={{ display: 'inline-grid', gridTemplateRows: '1fr 2px 1fr', alignItems: 'center', minWidth: 50 }}>
        <span style={cellStyle('numerator')} onClick={(e) => { e.stopPropagation(); onPart('numerator'); }}>
          {draft.numerator || '□'}
        </span>
        <span style={{ height: 2, background: '#111827', width: '100%' }} />
        <span style={cellStyle('denominator')} onClick={(e) => { e.stopPropagation(); onPart('denominator'); }}>
          {draft.denominator || '□'}
        </span>
      </span>
    </span>
  );
}

function FractionIcon({ mixed }: { mixed: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 18 }}>
      {mixed && <span>□</span>}
      <span style={{ display: 'inline-grid', gridTemplateRows: '1fr 1px 1fr', minWidth: 20, alignItems: 'center' }}>
        <span>□</span><span style={{ height: 1, background: 'currentColor' }} /><span>□</span>
      </span>
    </span>
  );
}
