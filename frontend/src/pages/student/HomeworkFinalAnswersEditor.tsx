import { useMemo, useState } from 'react';
import {
  saveHomeworkFinalAnswers,
  type HomeworkFinalAnswer,
} from '../../api/homeworkAnswers';
import { useI18n } from '../../i18n/I18nContext';
import './homework-final-answers.css';

type EntryMode = 'text' | 'fraction' | 'mixed';
type KeyboardTab = 'letters' | 'basic' | 'functions' | 'trig' | 'advanced';
type FractionPart = 'whole' | 'numerator' | 'denominator';
type CursorPart = FractionPart | 'after';

type Draft = {
  label: string;
  mode: EntryMode;
  text: string;
  whole: string;
  numerator: string;
  denominator: string;
};

type Key = {
  label: string;
  value?: string;
  action?: 'fraction' | 'mixed';
  className?: string;
};

const BASIC_KEYS: Key[] = [
  { label: '(□)', value: '()' },
  { label: '>', value: '>' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: '÷', value: '÷' },
  { label: '□⁄□', action: 'fraction' },
  { label: '√□', value: '√(' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
  { label: '×', value: '×' },
  { label: '□²', value: '^2' },
  { label: 'x', value: 'x' },
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '−', value: '−' },
  { label: 'π', value: 'π' },
  { label: '%', value: '%' },
  { label: '0', value: '0' },
  { label: ',', value: ',' },
  { label: '=', value: '=' },
  { label: '+', value: '+' },
];

const FUNCTION_KEYS: Key[] = [
  { label: '|□|', value: 'abs(' },
  { label: 'f(x)', value: 'f(' },
  { label: 'log₁₀', value: 'log(' },
  { label: 'A▧', value: 'A(' },
  { label: 'i', value: 'i' },
  { label: '▧,▧,▧', value: ',' },
  { label: '□₍□₎', value: '_' },
  { label: '▧(▧)', value: '(' },
  { label: 'log₂', value: 'log2(' },
  { label: '□P□', value: 'P(' },
  { label: 'z', value: 'z' },
  { label: '!', value: '!' },
  { label: 'e', value: 'e' },
  { label: 'f(x,y)', value: 'f(' },
  { label: 'log▧', value: 'log_(' },
  { label: '□C□', value: 'C(' },
  { label: 'z̄', value: 'z̄' },
  { label: '[▧]', value: '[' },
  { label: 'exp', value: 'exp(' },
  { label: 'n((x,y))', value: 'n(' },
  { label: 'ln', value: 'ln(' },
  { label: '(▧⁄▧)', action: 'fraction' },
  { label: 'sign', value: 'sign(' },
  { label: '▦', value: 'matrix(' },
];

const TRIG_KEYS: Key[] = [
  { label: 'rad', value: 'rad' },
  { label: 'sin', value: 'sin(' },
  { label: 'cos', value: 'cos(' },
  { label: 'tan', value: 'tan(' },
  { label: 'cot', value: 'cot(' },
  { label: 'sec', value: 'sec(' },
  { label: '□°', value: '°' },
  { label: 'arcsin', value: 'arcsin(' },
  { label: 'arccos', value: 'arccos(' },
  { label: 'arctan', value: 'arctan(' },
  { label: 'arccot', value: 'arccot(' },
  { label: 'arcsec', value: 'arcsec(' },
  { label: '□°□′', value: '°' },
  { label: 'sinh', value: 'sinh(' },
  { label: 'cosh', value: 'cosh(' },
  { label: 'tanh', value: 'tanh(' },
  { label: 'coth', value: 'coth(' },
  { label: 'sech', value: 'sech(' },
  { label: '□°□′□″', value: '°' },
  { label: 'arsinh', value: 'arsinh(' },
  { label: 'arcosh', value: 'arcosh(' },
  { label: 'artanh', value: 'artanh(' },
  { label: 'arcoth', value: 'arcoth(' },
  { label: 'arsech', value: 'arsech(' },
];

const ADVANCED_KEYS: Key[] = [
  { label: 'lim\n□→□', value: 'lim(' },
  { label: 'd/dx □', value: 'd/dx(' },
  { label: '∫□dx', value: '∫' },
  { label: 'dy/dx', value: 'dy/dx' },
  { label: 'aₙ', value: 'a_n' },
  { label: 'lim⁺\n□→□', value: 'lim+(' },
  { label: 'd/d□ □', value: 'd/d(' },
  { label: '∫□d□', value: '∫' },
  { label: 'dx', value: 'dx' },
  { label: '▧,▧,▧…', value: ',' },
  { label: 'lim⁻\n□→□', value: 'lim-(' },
  { label: 'dⁿ/d□ⁿ', value: 'd^n/d(' },
  { label: '∫∫', value: '∫∫' },
  { label: 'dy', value: 'dy' },
  { label: '∞', value: '∞' },
  { label: 'Σ', value: 'Σ(' },
  { label: "y′", value: "y'" },
];

const LETTER_KEYS = [
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h',
  'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
  'q', 'r', 's', 't', 'u', 'v', 'w', 'x',
  'y', 'z', 'α', 'β', 'θ', 'ρ', 'Φ',
];

function storageKey(homeworkId: string) {
  return `mindcrafti-final-answers-v4:${homeworkId}`;
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

function cloneDrafts(drafts: Draft[]) {
  return drafts.map((draft) => ({ ...draft }));
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

  if (draft.mode === 'fraction') return `${draft.numerator}/${draft.denominator}${draft.text}`;

  const whole = Number(draft.whole.replace(',', '.'));
  if (!Number.isFinite(whole)) return '';
  const sign = whole < 0 ? -1 : 1;
  const improper = Math.abs(whole) * denominator + numerator;
  return `${sign * improper}/${denominator}${draft.text}`;
}

function visibleDraft(draft: Draft) {
  if (draft.mode === 'text') return draft.text;
  if (draft.mode === 'fraction') return `${draft.numerator || '□'}/${draft.denominator || '□'}${draft.text}`;
  return `${draft.whole || '□'} ${draft.numerator || '□'}/${draft.denominator || '□'}${draft.text}`;
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
  const [history, setHistory] = useState<Draft[][]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activePart, setActivePart] = useState<CursorPart>('numerator');
  const [cursorPos, setCursorPos] = useState(0);
  const [keyboardTab, setKeyboardTab] = useState<KeyboardTab>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFilled = useMemo(() => drafts.every(isFilled), [drafts]);
  const activeDraft = drafts[activeIndex] ?? drafts[0];

  function activeFieldValue(draft = activeDraft, part = activePart) {
    if (!draft) return '';
    if (draft.mode === 'text' || part === 'after') return draft.text;
    return draft[part];
  }

  function clampCursor(value: string, position: number) {
    return Math.max(0, Math.min(position, value.length));
  }

  function setPart(part: CursorPart) {
    if (!activeDraft || activeDraft.mode === 'text') return;
    setActivePart(part);
    setCursorPos(part === 'after' ? activeDraft.text.length : activeDraft[part].length);
  }

  function commit(next: Draft[], keepHistory = true) {
    if (keepHistory) {
      setHistory((current) => [...current.slice(-24), cloneDrafts(drafts)]);
    }
    setDrafts(next);
    setError(null);
    localStorage.setItem(storageKey(homeworkId), JSON.stringify(next));
  }

  function updateDraft(index: number, patch: Partial<Draft>) {
    commit(drafts.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function activate(index: number) {
    if (index < 0 || index >= drafts.length) return;
    setActiveIndex(index);
    const draft = drafts[index];
    const mode = draft?.mode ?? 'text';
    const part: CursorPart = mode === 'mixed' ? 'whole' : 'numerator';
    setActivePart(part);
    setCursorPos(mode === 'text' ? (draft?.text.length ?? 0) : (draft?.[part as FractionPart].length ?? 0));
  }

  function setMode(mode: EntryMode) {
    if (!activeDraft) return;
    updateDraft(activeIndex, { mode });
    const part: CursorPart = mode === 'mixed' ? 'whole' : 'numerator';
    setActivePart(part);
    setCursorPos(mode === 'text' ? activeDraft.text.length : activeDraft[part as FractionPart].length);
  }

  function switchToTextAndAppend(value: string) {
    if (!activeDraft) return;
    const current = serializeDraft(activeDraft);
    const position = clampCursor(current, cursorPos);
    const next = `${current.slice(0, position)}${value}${current.slice(position)}`;
    updateDraft(activeIndex, { mode: 'text', text: next });
    setCursorPos(position + value.length);
  }

  function appendValue(value: string) {
    if (!activeDraft) return;
    const normalized = value === '−' ? '-' : value;

    if (activeDraft.mode === 'text') {
      const position = clampCursor(activeDraft.text, cursorPos);
      const next = `${activeDraft.text.slice(0, position)}${normalized}${activeDraft.text.slice(position)}`;
      updateDraft(activeIndex, { text: next });
      setCursorPos(position + normalized.length);
      return;
    }

    if (activePart === 'after') {
      const position = clampCursor(activeDraft.text, cursorPos);
      const next = `${activeDraft.text.slice(0, position)}${normalized}${activeDraft.text.slice(position)}`;
      updateDraft(activeIndex, { text: next });
      setCursorPos(position + normalized.length);
      return;
    }

    if (/^[0-9.,-]$/.test(normalized)) {
      const field = activePart;
      const current = activeDraft[field];
      const position = clampCursor(current, cursorPos);
      const next = `${current.slice(0, position)}${normalized}${current.slice(position)}`;
      updateDraft(activeIndex, { [field]: next });
      setCursorPos(position + normalized.length);
      return;
    }

    switchToTextAndAppend(normalized);
  }

  function handleKey(key: Key) {
    if (key.action === 'fraction') {
      if (activeDraft?.mode === 'text' && /^-?\d+(?:[.,]\d+)?$/.test(activeDraft.text.trim())) {
        updateDraft(activeIndex, {
          mode: 'mixed',
          whole: activeDraft.text.trim(),
          text: '',
          numerator: '',
          denominator: '',
        });
        setActivePart('numerator');
        setCursorPos(0);
      } else {
        setMode('fraction');
        setCursorPos(0);
      }
      return;
    }
    if (key.action === 'mixed') {
      setMode('mixed');
      setCursorPos(0);
      return;
    }
    if (key.value != null) appendValue(key.value);
  }

  function backspace() {
    if (!activeDraft) return;
    if (activeDraft.mode === 'text' || activePart === 'after') {
      if (cursorPos <= 0) {
        if (activeDraft.mode !== 'text' && activePart === 'after') {
          setActivePart('denominator');
          setCursorPos(activeDraft.denominator.length);
        }
        return;
      }
      const current = activeDraft.text;
      const position = clampCursor(current, cursorPos);
      updateDraft(activeIndex, { text: `${current.slice(0, position - 1)}${current.slice(position)}` });
      setCursorPos(position - 1);
      return;
    }
    if (cursorPos <= 0) return;
    const field = activePart;
    const current = activeDraft[field];
    const position = clampCursor(current, cursorPos);
    updateDraft(activeIndex, { [field]: `${current.slice(0, position - 1)}${current.slice(position)}` });
    setCursorPos(position - 1);
  }

  function moveCursor(direction: -1 | 1) {
    if (!activeDraft) return;
    const current = activeFieldValue();
    const position = clampCursor(current, cursorPos);
    const next = position + direction;
    if (next >= 0 && next <= current.length) {
      setCursorPos(next);
      return;
    }

    if (activeDraft.mode === 'text') return;
    const parts: CursorPart[] = activeDraft.mode === 'mixed'
      ? ['whole', 'numerator', 'denominator', 'after']
      : ['numerator', 'denominator', 'after'];
    const partIndex = parts.indexOf(activePart);
    const nextPartIndex = partIndex + direction;
    if (nextPartIndex < 0 || nextPartIndex >= parts.length) return;
    const nextPart = parts[nextPartIndex];
    setActivePart(nextPart);
    const nextValue = nextPart === 'after' ? activeDraft.text : activeDraft[nextPart];
    setCursorPos(direction > 0 ? 0 : nextValue.length);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    commit(cloneDrafts(previous), false);
    const restored = previous[activeIndex];
    if (restored) {
      const value = restored.mode === 'text' || activePart === 'after' ? restored.text : restored[activePart];
      setCursorPos(value.length);
    }
  }

  function enterNext() {
    if (!activeDraft) return;
    if (activeDraft.mode === 'mixed') {
      if (activePart === 'whole') setPart('numerator');
      else if (activePart === 'numerator') setPart('denominator');
      else if (activePart === 'denominator') setPart('after');
      else if (activeIndex < drafts.length - 1) activate(activeIndex + 1);
      return;
    }
    if (activeDraft.mode === 'fraction') {
      if (activePart === 'numerator') setPart('denominator');
      else if (activePart === 'denominator') setPart('after');
      else if (activeIndex < drafts.length - 1) activate(activeIndex + 1);
      return;
    }
    if (activeIndex < drafts.length - 1) activate(activeIndex + 1);
  }

  function useTab(tab: KeyboardTab) {
    setKeyboardTab(tab);
    if (tab === 'letters') setMode('text');
  }

  async function submit() {
    setError(null);
    if (!allFilled) {
      setError(language === 'DE' ? 'Bitte alle Antworten ausfüllen.' : 'Заполни все ответы.');
      return;
    }

    const answers: HomeworkFinalAnswer[] = drafts.map((draft) => ({
      label: draft.label,
      answer: serializeDraft(draft),
    }));

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
    <section className="math-answer-editor">
      <div className="math-answer-editor__header">
        <div className="math-answer-editor__title">
          {language === 'DE' ? 'Rechner' : 'Калькулятор'}
        </div>
        <div className="math-answer-editor__counter">
          {language === 'DE' ? 'Aufgabe' : 'Задание'} {activeIndex + 1} / {drafts.length}
        </div>
      </div>

      <div className="math-answer-editor__answers">
        {drafts.map((draft, index) => (
          <button
            key={draft.label}
            type="button"
            className={`math-answer-editor__answer-tab ${activeIndex === index ? 'is-active' : ''}`}
            onClick={() => activate(index)}
          >
            <span>{index + 1}</span>
            <strong>{visibleDraft(draft) || (language === 'DE' ? 'Antwort' : 'Ответ')}</strong>
          </button>
        ))}
      </div>

      <div className="math-answer-editor__display" onClick={() => activate(activeIndex)}>
        {activeDraft?.mode === 'text' ? (
          <div className={`math-answer-editor__text-value ${activeDraft.text ? '' : 'is-placeholder'}`}>
            {activeDraft.text ? (
              <CaretText value={activeDraft.text} cursorPos={cursorPos} />
            ) : (
              <><span className="math-caret" />{language === 'DE' ? 'Antwort eingeben…' : 'Введите ответ…'}</>
            )}
          </div>
        ) : (
          <MathFractionInput
            draft={activeDraft}
            activePart={activePart}
            cursorPos={cursorPos}
            onPart={(part) => setPart(part)}
          />
        )}
      </div>

      {error && <div className="math-answer-editor__error">{error}</div>}

      <div className="math-keyboard">
        <div className="math-keyboard__utility-row">
          <button type="button" className={keyboardTab === 'letters' ? 'is-selected' : ''} onClick={() => useTab('letters')}>abc</button>
          <button type="button" onClick={undo} disabled={history.length === 0}>↶</button>
          <button type="button" onClick={() => moveCursor(-1)}>←</button>
          <button type="button" onClick={() => moveCursor(1)}>→</button>
          <button type="button" onClick={enterNext}>↵</button>
          <button type="button" onClick={backspace}>⌫</button>
        </div>

        <div className="math-keyboard__tabs">
          <button type="button" className={keyboardTab === 'basic' ? 'is-active' : ''} onClick={() => useTab('basic')}>
            <span>+ −</span><span>× ÷</span>
          </button>
          <button type="button" className={keyboardTab === 'functions' ? 'is-active' : ''} onClick={() => useTab('functions')}>
            <span>f(x)&nbsp; e</span><span>log&nbsp; ln</span>
          </button>
          <button type="button" className={keyboardTab === 'trig' ? 'is-active' : ''} onClick={() => useTab('trig')}>
            <span>sin&nbsp; cos</span><span>tan&nbsp; cot</span>
          </button>
          <button type="button" className={keyboardTab === 'advanced' ? 'is-active' : ''} onClick={() => useTab('advanced')}>
            <span>lim&nbsp; dx</span><span>∫ Σ ∞</span>
          </button>
        </div>

        {keyboardTab === 'letters' ? (
          <div className="math-keyboard__letters">
            {LETTER_KEYS.map((letter) => (
              <button key={letter} type="button" onClick={() => appendValue(letter)}>{letter}</button>
            ))}
          </div>
        ) : (
          <KeyGrid
            keys={keyboardTab === 'basic'
              ? BASIC_KEYS
              : keyboardTab === 'functions'
                ? FUNCTION_KEYS
                : keyboardTab === 'trig'
                  ? TRIG_KEYS
                  : ADVANCED_KEYS}
            tab={keyboardTab}
            onKey={handleKey}
          />
        )}
      </div>

      <div className="math-answer-editor__submit-wrap">
        <button
          className="math-answer-editor__submit"
          type="button"
          onClick={() => void submit()}
          disabled={!allFilled || saving}
        >
          {saving
            ? (language === 'DE' ? 'Wird abgegeben…' : 'Сдаём…')
            : (language === 'DE' ? 'Abgeben' : 'Сдать')}
        </button>
      </div>
    </section>
  );
}

function KeyGrid({ keys, tab, onKey }: { keys: Key[]; tab: Exclude<KeyboardTab, 'letters'>; onKey: (key: Key) => void }) {
  return (
    <div className={`math-keyboard__grid math-keyboard__grid--${tab}`}>
      {keys.map((key, index) => (
        <button
          key={`${key.label}-${index}`}
          type="button"
          className={key.className ?? ''}
          onClick={() => onKey(key)}
        >
          {key.action === 'fraction' ? (
            <span className="math-keyboard__fraction-icon" aria-label="fraction">
              <span className="math-placeholder">□</span>
              <span className="math-keyboard__fraction-bar" />
              <span className="math-placeholder">□</span>
            </span>
          ) : key.label.split('\n').map((line, lineIndex) => (
            <span key={`${line}-${lineIndex}`}>{line}</span>
          ))}
        </button>
      ))}
    </div>
  );
}

function CaretText({ value, cursorPos }: { value: string; cursorPos: number }) {
  const position = Math.max(0, Math.min(cursorPos, value.length));
  return (
    <>
      {value.slice(0, position)}
      <span className="math-caret" />
      {value.slice(position)}
    </>
  );
}

function MathPlaceholder() {
  return <span className="math-placeholder">□</span>;
}

function MathFractionInput({
  draft,
  activePart,
  cursorPos,
  onPart,
}: {
  draft: Draft;
  activePart: CursorPart;
  cursorPos: number;
  onPart: (part: CursorPart) => void;
}) {
  function fieldValue(part: FractionPart) {
    const value = draft[part];
    if (activePart !== part) return value || <MathPlaceholder />;
    if (!value) return <><span className="math-caret" /><MathPlaceholder /></>;
    return <CaretText value={value} cursorPos={cursorPos} />;
  }

  return (
    <div className={`structured-number ${draft.mode === 'mixed' ? 'structured-number--mixed' : ''}`}>
      {draft.mode === 'mixed' && (
        <button
          type="button"
          className={`structured-number__whole ${activePart === 'whole' ? 'is-active' : ''}`}
          onClick={(event) => { event.stopPropagation(); onPart('whole'); }}
        >
          {fieldValue('whole')}
        </button>
      )}
      <span className="structured-number__fraction">
        <button
          type="button"
          className={activePart === 'numerator' ? 'is-active' : ''}
          onClick={(event) => { event.stopPropagation(); onPart('numerator'); }}
        >
          {fieldValue('numerator')}
        </button>
        <span className="structured-number__bar" />
        <button
          type="button"
          className={activePart === 'denominator' ? 'is-active' : ''}
          onClick={(event) => { event.stopPropagation(); onPart('denominator'); }}
        >
          {fieldValue('denominator')}
        </button>
      </span>
      <button
        type="button"
        className={`structured-number__after ${activePart === 'after' ? 'is-active' : ''}`}
        onClick={(event) => { event.stopPropagation(); onPart('after'); }}
        aria-label="Continue expression after fraction"
      >
        {activePart === 'after'
          ? (draft.text ? <CaretText value={draft.text} cursorPos={cursorPos} /> : <span className="math-caret" />)
          : draft.text}
      </button>
    </div>
  );
}
