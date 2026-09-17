import { useMemo, useState } from 'react';
import {
  saveHomeworkFinalAnswers,
  type HomeworkFinalAnswer,
} from '../../api/homeworkAnswers';
import { useI18n } from '../../i18n/I18nContext';

type EntryMode = 'text' | 'fraction' | 'mixed';
type KeyboardTab = 'basic' | 'functions' | 'trig' | 'advanced';
type Draft = {
  label: string;
  mode: EntryMode;
  text: string;
  whole: string;
  numerator: string;
  denominator: string;
};
type FractionPart = 'whole' | 'numerator' | 'denominator';

type Key = {
  label: string;
  value?: string;
  action?: 'backspace' | 'fraction' | 'mixed' | 'clear';
};

const MAIN_GRID: Key[][] = [
  [
    { label: '(□)', value: '()' },
    { label: '>', value: '>' },
    { label: '7', value: '7' },
    { label: '8', value: '8' },
    { label: '9', value: '9' },
    { label: '÷', value: '÷' },
  ],
  [
    { label: '□⁄□', action: 'fraction' },
    { label: '√□', value: '√' },
    { label: '4', value: '4' },
    { label: '5', value: '5' },
    { label: '6', value: '6' },
    { label: '×', value: '×' },
  ],
  [
    { label: '□²', value: '^2' },
    { label: 'x', value: 'x' },
    { label: '1', value: '1' },
    { label: '2', value: '2' },
    { label: '3', value: '3' },
    { label: '−', value: '−' },
  ],
  [
    { label: 'π', value: 'π' },
    { label: '%', value: '%' },
    { label: '0', value: '0' },
    { label: ',', value: ',' },
    { label: '=', value: '=' },
    { label: '+', value: '+' },
  ],
];

const TAB_KEYS: Record<KeyboardTab, Key[]> = {
  basic: [
    { label: '+', value: '+' }, { label: '−', value: '−' }, { label: '×', value: '×' }, { label: '÷', value: '÷' },
    { label: '(', value: '(' }, { label: ')', value: ')' }, { label: '€', value: '€' }, { label: '<', value: '<' },
  ],
  functions: [
    { label: 'f(x)', value: 'f(' }, { label: 'e', value: 'e' }, { label: 'log', value: 'log(' }, { label: 'ln', value: 'ln(' },
    { label: 'x²', value: '^2' }, { label: 'x³', value: '^3' }, { label: 'xʸ', value: '^' }, { label: '|x|', value: 'abs(' },
  ],
  trig: [
    { label: 'sin', value: 'sin(' }, { label: 'cos', value: 'cos(' }, { label: 'tan', value: 'tan(' }, { label: 'cot', value: 'cot(' },
    { label: 'asin', value: 'asin(' }, { label: 'acos', value: 'acos(' }, { label: 'atan', value: 'atan(' }, { label: '°', value: '°' },
  ],
  advanced: [
    { label: 'lim', value: 'lim(' }, { label: 'dx', value: 'dx' }, { label: '∫', value: '∫' }, { label: 'Σ', value: 'Σ' },
    { label: '∞', value: '∞' }, { label: '√', value: '√' }, { label: '∛', value: '∛' }, { label: '!', value: '!' },
  ],
};

function storageKey(homeworkId: string) {
  return `mindcrafti-final-answers-v3:${homeworkId}`;
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
  const [keyboardTab, setKeyboardTab] = useState<KeyboardTab>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFilled = useMemo(() => drafts.every(isFilled), [drafts]);
  const activeDraft = drafts[activeIndex] ?? drafts[0];

  function persist(next: Draft[]) {
    setDrafts(next);
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

  function appendValue(value: string) {
    if (!activeDraft) return;
    const normalized = value === '−' ? '-' : value;

    if (activeDraft.mode === 'text') {
      updateDraft(activeIndex, { text: `${activeDraft.text}${normalized}` });
      return;
    }

    if (!/^[0-9.,-]$/.test(normalized)) {
      if (value === '%') setMode('text');
      return;
    }
    const field = activePart;
    updateDraft(activeIndex, { [field]: `${activeDraft[field]}${normalized}` });
  }

  function handleKey(key: Key) {
    if (key.action === 'backspace') {
      backspace();
      return;
    }
    if (key.action === 'fraction') {
      setMode('fraction');
      return;
    }
    if (key.action === 'mixed') {
      setMode('mixed');
      return;
    }
    if (key.action === 'clear') {
      clearActive();
      return;
    }
    if (key.value != null) appendValue(key.value);
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
      await saveHomeworkFinalAnswers(homeworkId, answers);
      localStorage.removeItem(storageKey(homeworkId));
      onCompleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="panel"
      style={{
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        border: 0,
        borderRadius: 24,
        background: '#fff',
        boxShadow: '0 22px 60px rgba(15,23,42,.22)',
      }}
    >
      <div style={{ padding: '20px 18px 14px' }}>
        <h2 style={{ margin: '0 0 16px', textAlign: 'center' }}>{language === 'DE' ? 'Antworten' : 'Ответы'}</h2>

        <div style={{ display: 'grid', gap: 12 }}>
          {drafts.map((draft, index) => (
            <button
              key={draft.label}
              type="button"
              onClick={() => activate(index)}
              style={{
                width: '100%',
                minHeight: 70,
                borderRadius: 14,
                padding: '10px 14px',
                background: '#fff',
                border: `2px solid ${activeIndex === index ? '#111827' : '#dce3ea'}`,
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                alignItems: 'center',
                gap: 12,
                textAlign: 'left',
                fontSize: 24,
                color: '#111827',
              }}
            >
              <span style={{ fontSize: 14, color: '#64748b' }}>
                {language === 'DE' ? `Aufgabe ${index + 1}` : `Задание ${index + 1}`}
              </span>
              {draft.mode === 'text' ? (
                <span style={{ color: draft.text ? '#111827' : '#94a3b8', overflowWrap: 'anywhere' }}>
                  {draft.text || (language === 'DE' ? 'Antwort' : 'Ответ')}
                </span>
              ) : (
                <MathFractionInput
                  draft={draft}
                  active={activeIndex === index}
                  activePart={activePart}
                  onPart={(part) => { activate(index); setActivePart(part); }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #e5e7eb', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', alignItems: 'center', padding: '10px 8px 8px', gap: 6 }}>
          <button type="button" onClick={() => setMode('text')} style={toolbarButton(activeDraft?.mode === 'text')}>abc</button>
          <button type="button" onClick={() => setMode('mixed')} style={toolbarButton(activeDraft?.mode === 'mixed')}>□ ¹⁄₂</button>
          <button type="button" onClick={() => activeIndex > 0 && activate(activeIndex - 1)} style={toolbarButton(false)}>←</button>
          <button type="button" onClick={() => activeIndex < drafts.length - 1 && activate(activeIndex + 1)} style={toolbarButton(false)}>→</button>
          <button type="button" onClick={() => activeDraft?.mode !== 'text' && setActivePart(activePart === 'numerator' ? 'denominator' : 'numerator')} style={toolbarButton(false)}>↵</button>
          <button type="button" onClick={backspace} style={toolbarButton(false)}>⌫</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7, padding: '0 8px 10px' }}>
          <button type="button" onClick={() => setKeyboardTab('basic')} style={tabButton(keyboardTab === 'basic')}>+ −<br />× ÷</button>
          <button type="button" onClick={() => setKeyboardTab('functions')} style={tabButton(keyboardTab === 'functions')}>f(x)&nbsp; e<br />log&nbsp; ln</button>
          <button type="button" onClick={() => setKeyboardTab('trig')} style={tabButton(keyboardTab === 'trig')}>sin&nbsp; cos<br />tan&nbsp; cot</button>
          <button type="button" onClick={() => setKeyboardTab('advanced')} style={tabButton(keyboardTab === 'advanced')}>lim&nbsp; dx<br />∫ Σ ∞</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: '#e5e7eb', borderTop: '1px solid #e5e7eb' }}>
          {TAB_KEYS[keyboardTab].map((key) => (
            <button key={`${keyboardTab}-${key.label}`} type="button" onClick={() => handleKey(key)} style={symbolKeyStyle}>
              {key.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1, background: '#e5e7eb', borderTop: '1px solid #e5e7eb' }}>
          {MAIN_GRID.flat().map((key, index) => (
            <button key={`${key.label}-${index}`} type="button" onClick={() => handleKey(key)} style={mainKeyStyle}>
              {key.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 10 }}>
          <button type="button" className="btn btn--secondary" onClick={clearActive}>
            {language === 'DE' ? 'Löschen' : 'Очистить'}
          </button>
          <button className="btn" type="button" onClick={() => void submit()} disabled={saving || !allFilled} style={{ minHeight: 54, fontSize: 19 }}>
            {saving ? (language === 'DE' ? 'Wird abgegeben…' : 'Сдаём…') : (language === 'DE' ? 'Abgeben' : 'Сдать')}
          </button>
        </div>

        {error && <div className="banner banner--error" style={{ margin: '0 10px 10px' }}>{error}</div>}
      </div>
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
    minWidth: 38,
    minHeight: 32,
    padding: '2px 7px',
    borderRadius: 7,
    background: active && activePart === part ? '#fff4f0' : 'transparent',
    color: (part === 'whole' ? draft.whole : part === 'numerator' ? draft.numerator : draft.denominator) ? '#111827' : '#94a3b8',
  });

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, justifySelf: 'start' }}>
      {draft.mode === 'mixed' && (
        <span style={cellStyle('whole')} onClick={(e) => { e.stopPropagation(); onPart('whole'); }}>
          {draft.whole || '□'}
        </span>
      )}
      <span style={{ display: 'inline-grid', gridTemplateRows: '1fr 2px 1fr', alignItems: 'center', minWidth: 52 }}>
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

function toolbarButton(active: boolean): React.CSSProperties {
  return {
    minHeight: 42,
    border: 0,
    borderRadius: 10,
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    fontSize: 17,
    fontWeight: 700,
  };
}

function tabButton(active: boolean): React.CSSProperties {
  return {
    minHeight: 54,
    border: '1px solid #d7dce2',
    borderRadius: 999,
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#111',
    fontSize: 14,
    lineHeight: 1.15,
    fontWeight: 600,
  };
}

const symbolKeyStyle: React.CSSProperties = {
  minHeight: 50,
  border: 0,
  background: '#fff',
  color: '#111',
  fontSize: 19,
  fontWeight: 600,
};

const mainKeyStyle: React.CSSProperties = {
  minHeight: 62,
  border: 0,
  background: '#fff',
  color: '#111',
  fontSize: 25,
  fontWeight: 500,
};
