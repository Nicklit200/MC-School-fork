import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ReactNode } from 'react';

type Part = { kind: 'text' | 'math'; source: string; latex?: string };

// Teacher feedback contains a mixture of ordinary explanations and math.
// A formula may already be delimited in LaTeX, or be written as 1/2, sqrt(9), x^2.
const DELIMITED = /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;
const MATH_RUN = /[A-Za-z0-9\\√π∞∑∫αβγδθφ≤≥≠±∓×÷·⋅−–+*=<>(){}\[\]_^%:|.,/\s²³⁴⁵⁶⁷⁸⁹⁰⁻⁺ⁿ]+/g;
const MATH_CLUE = /[0-9]\s*\/\s*[0-9a-zA-Z(\\]|[\^√²³⁴⁵⁶⁷⁸⁹⁰⁻⁺ⁿ=<>≤≥≠×÷·⋅∑∫π∞±]|\\[A-Za-z]+|\d\s*[+\-*−:]\s*\d|[a-zA-Z]\s*[+\-*−/]\s*\d/;
const PROSE_WORDS = new Set(['und', 'mit', 'das', 'der', 'die', 'den', 'ist', 'aus', 'von', 'bei', 'für',
  'zum', 'zur', 'als', 'nur', 'ein', 'eine', 'dem', 'des', 'sind', 'wird', 'mal', 'plus', 'minus']);
const MATH_WORDS = new Set(['sqrt', 'frac', 'dfrac', 'tfrac', 'sin', 'cos', 'tan', 'cot',
  'log', 'ln', 'exp', 'abs', 'pi', 'max', 'min', 'lim']);

function splitProse(run: string): string[] {
  const result: string[] = [];
  let start = 0;
  const words = /[A-Za-zÀ-ÿ]{3,}/g;
  for (const match of run.matchAll(words)) {
    const word = match[0], i = match.index;
    const precededBySlash = i > 0 && run[i - 1] === '\\';
    if (precededBySlash || MATH_WORDS.has(word.toLowerCase())) continue;
    if (word.length < 4 && !PROSE_WORDS.has(word.toLowerCase())) continue;
    if (i > start) result.push(run.slice(start, i));
    result.push(word);
    start = i + word.length;
  }
  if (start < run.length) result.push(run.slice(start));
  return result.length ? result : [run];
}

function balanced(source: string, at: number): { body: string; next: number } | null {
  const opening = source[at];
  if (opening !== '(' && opening !== '{') return null;
  const closing = opening === '(' ? ')' : '}';
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    if (source[i] === opening) depth++;
    if (source[i] === closing && --depth === 0) {
      return { body: source.slice(at + 1, i), next: i + 1 };
    }
  }
  return null;
}

// Convert plain root notation without evaluating or changing the expression.
function convertRoots(source: string): string {
  let output = '';
  for (let i = 0; i < source.length;) {
    const unicodeRoot = source[i] === '√';
    const namedRoot = source.slice(i, i + 4).toLowerCase() === 'sqrt'
      && (i === 0 || !/[\\A-Za-z]/.test(source[i - 1]))
      && !/[A-Za-z]/.test(source[i + 4] || '');
    if (!unicodeRoot && !namedRoot) {
      output += source[i++];
      continue;
    }
    const nameLength = unicodeRoot ? 1 : 4;
    let operand = i + nameLength;
    while (source[operand] === ' ') operand++;
    const group = balanced(source, operand);
    if (group) {
      output += '\\sqrt{' + convertRoots(group.body) + '}';
      i = group.next;
      continue;
    }
    const token = /^[A-Za-z0-9]+/.exec(source.slice(operand));
    if (token) {
      output += '\\sqrt{' + token[0] + '}';
      i = operand + token[0].length;
      continue;
    }
    output += source.slice(i, i + nameLength);
    i += nameLength;
  }
  return output;
}

// Keep ^(...) together as a single exponent (KaTeX expects braces).
function convertExponents(source: string): string {
  let output = '';
  for (let i = 0; i < source.length;) {
    if (source[i] === '^' && source[i + 1] === '(') {
      const group = balanced(source, i + 1);
      if (group) {
        output += '^{' + convertExponents(group.body) + '}';
        i = group.next;
        continue;
      }
    }
    output += source[i++];
  }
  return output;
}

export function plainMathToLatex(source: string): string {
  let s = source.replace(/−|–/g, '-').replace(/\*\*/g, '^');
  s = convertRoots(s);
  s = convertExponents(s);

  // Preserve existing TeX fractions; convert raw numerator/denominator notation.
  s = s.replace(/(\d+(?:[.,]\d+)?|[a-zA-Z])\s*\/\s*(\\sqrt\{[^{}]+\})/g,
    (_full, numerator: string, denominator: string) => '\\frac{' + numerator + '}{' + denominator + '}');
  s = s.replace(/(\d+(?:[.,]\d+)?|[a-zA-Z])\s*\/\s*\(([^()]+)\)/g,
    (_full, numerator: string, denominator: string) => '\\frac{' + numerator + '}{' + plainMathToLatex(denominator) + '}');
  s = s.replace(/\(([^()]+)\)\s*\/\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g,
    (_full, numerator: string, denominator: string) => '\\frac{' + plainMathToLatex(numerator) + '}{' + denominator + '}');
  s = s.replace(/(\d+(?:[.,]\d+)?|[a-zA-Z])\s*\/\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g,
    (_full, numerator: string, denominator: string) => '\\frac{' + numerator + '}{' + denominator + '}');

  s = s.replace(/\b(sin|cos|tan|cot|ln|log|exp)\s*\(/g, (_all, fn: string) => '\\' + fn + '(');
  s = s.replace(/[²³⁴⁵⁶⁷⁸⁹⁰⁻⁺ⁿ]+/g, value => {
    const digits: Record<string, string> = {
      '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8',
      '⁹': '9', '⁰': '0', '⁻': '-', '⁺': '+', 'ⁿ': 'n',
    };
    return '^{' + [...value].map(char => digits[char]).join('') + '}';
  });
  const symbols: Record<string, string> = {
    'π': '\\pi ', '∞': '\\infty ', '∑': '\\sum ', '∫': '\\int ',
    'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
    'θ': '\\theta ', 'φ': '\\phi ', '√': '\\sqrt ',
    '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '±': '\\pm ', '∓': '\\mp ',
    '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '⋅': '\\cdot ',
  };
  s = s.replace(/[π∞∑∫αβγδθφ√≤≥≠±∓×÷·⋅]/g, char => symbols[char]);
  s = s.replace(/(\d),(\d)/g, '$1{,}$2');
  s = s.replace(/(\d)%/g, '$1\\%');
  return s;
}

function splitUnmarked(source: string): Part[] {
  const output: Part[] = [];
  let cursor = 0;
  function append(value: string, kind: Part['kind']) {
    if (!value) return;
    if (kind === 'text' && output.at(-1)?.kind === 'text') {
      output[output.length - 1].source += value;
    } else {
      output.push({ kind, source: value, ...(kind === 'math' ? { latex: plainMathToLatex(value) } : {}) });
    }
  }
  for (const match of source.matchAll(MATH_RUN)) {
    const raw = match[0], index = match.index;
    append(source.slice(cursor, index), 'text');
    for (const part of splitProse(raw)) {
      const leading = /^[\s,;:]+/.exec(part)?.[0] || '';
      const rest = part.slice(leading.length);
      const trailing = /[\s,;:.]+$/.exec(rest)?.[0] || '';
      const core = rest.slice(0, rest.length - trailing.length);
      append(leading, 'text');
      append(core, MATH_CLUE.test(core) ? 'math' : 'text');
      append(trailing, 'text');
    }
    cursor = index + raw.length;
  }
  append(source.slice(cursor), 'text');
  return output;
}

/** Return text and math segments; no execution or modification of a student's solution. */
export function homeworkMathSegments(source: string): Part[] {
  const result: Part[] = [];
  let cursor = 0;
  for (const match of source.matchAll(DELIMITED)) {
    result.push(...splitUnmarked(source.slice(cursor, match.index)));
    const delimiter = match[0];
    const inner = delimiter.startsWith('$$') || delimiter.startsWith('\\[') || delimiter.startsWith('\\(')
      ? delimiter.slice(2, -2) : delimiter.slice(1, -1);
    result.push({ kind: 'math', source: delimiter, latex: inner });
    cursor = match.index + delimiter.length;
  }
  result.push(...splitUnmarked(source.slice(cursor)));
  return result;
}

function MathPiece({ part }: { part: Part }): ReactNode {
  if (part.kind === 'text') return part.source;
  try {
    const html = katex.renderToString(part.latex || part.source, {
      displayMode: false, output: 'htmlAndMathml',
      trust: false, throwOnError: true, strict: 'ignore',
      maxExpand: 100, maxSize: 10,
    });
    return <span className="morning-error-katex" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // Never hide or replace a calculation just because the notation is unknown.
    return part.source;
  }
}

export function HomeworkMathText({ value }: { value: string }) {
  return <span className="morning-error-math-text">
    {homeworkMathSegments(value).map((part, i) => <MathPiece key={i} part={part} />)}
  </span>;
}
