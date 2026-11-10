import type { ReactNode } from 'react';

export type KolinBlockKind = 'paragraph' | 'heading' | 'correct' | 'incorrect' | 'tip' | 'warning' | 'bullet' | 'numbered' | 'formula';

export interface KolinBlock {
  kind: KolinBlockKind;
  text: string;
  number?: number;
}

const prefixPattern = /^\s*(✅|🟢|✔️|✔|✓|❌|🔴|✗|⛔|💡|ℹ️|⚠️)\s*:?\s*(.*)$/u;
const directPositive = /^(?:правильно|верно|richtig|korrekt)\s*[:：]\s*/i;
const directNegative = /^(?:ошибка|неверно|fehler|falsch)\s*[:：]\s*/i;
const directTip = /^(?:подсказка|совет|tipp|hinweis)\s*[:：]\s*/i;

function statusLine(line: string): { kind: KolinBlockKind; text: string } | null {
  const marked = line.match(prefixPattern);
  if (marked) {
    const marker = marked[1];
    const kind: KolinBlockKind = /^(✅|🟢|✔️|✔|✓)$/u.test(marker) ? 'correct'
      : /^(❌|🔴|✗|⛔)$/u.test(marker) ? 'incorrect'
        : marker === '⚠️' ? 'warning' : 'tip';
    return { kind, text: marked[2] };
  }
  const trimmed = line.trim();
  if (directPositive.test(trimmed)) return { kind: 'correct', text: trimmed };
  if (directNegative.test(trimmed)) return { kind: 'incorrect', text: trimmed };
  if (directTip.test(trimmed)) return { kind: 'tip', text: trimmed };
  return null;
}

/** Parse only our small, safe Markdown subset. Never use HTML from a model response. */
export function parseKolinBlocks(value: string): KolinBlock[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  const blocks: KolinBlock[] = [];
  const paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }

    const tone = statusLine(line);
    if (tone) {
      flush();
      const details = [tone.text];
      while (i + 1 < lines.length && lines[i + 1].trim()
        && !statusLine(lines[i + 1])
        && !/^\s*(?:#{1,4}\s+|[-*]\s+|\d+[.)]\s+)/.test(lines[i + 1])) {
        details.push(lines[++i].trim());
      }
      blocks.push({ kind: tone.kind, text: details.join('\n').trim() });
      continue;
    }

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading) { flush(); blocks.push({ kind: 'heading', text: heading[1] }); continue; }

    const number = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (number) { flush(); blocks.push({ kind: 'numbered', text: number[2], number: Number(number[1]) }); continue; }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) { flush(); blocks.push({ kind: 'bullet', text: bullet[1] }); continue; }

    const formula = trimmed.match(/^(?:\\\[(.+)\\\]|\$\$(.+)\$\$)$/);
    if (formula) { flush(); blocks.push({ kind: 'formula', text: formula[1] || formula[2] }); continue; }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

function normalMath(value: string): string {
  return value
    .replace(/\\(?:cdot|times)/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\pm/g, '±')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\sqrt/g, '√')
    .replace(/\\left|\\right/g, '')
    .replace(/\^\{2\}|\^2/g, '²')
    .replace(/\^\{3\}|\^3/g, '³');
}

function mathParts(value: string): ReactNode[] {
  const frac = /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = frac.exec(value)) !== null) {
    if (match.index > last) parts.push(normalMath(value.slice(last, match.index)));
    parts.push(<span className="kolin-rich__fraction" key={match.index}>
      <span>{normalMath(match[1])}</span><span>{normalMath(match[2])}</span>
    </span>);
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push(normalMath(value.slice(last)));
  return parts.length ? parts : [normalMath(value)];
}

function inlineText(value: string): ReactNode[] {
  const tokens = /(\*\*[^*]+\*\*|\x60[^\x60\n]+\x60|\\\([^\n]+?\\\)|\$[^$\n]+\$)/g;
  return value.split(tokens).map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**'))
      return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.charCodeAt(0) === 96 && piece.charCodeAt(piece.length - 1) === 96)
      return <code key={index}>{piece.slice(1, -1)}</code>;
    if (piece.startsWith('\\(') && piece.endsWith('\\)'))
      return <span className="kolin-rich__math" key={index}>{mathParts(piece.slice(2, -2))}</span>;
    if (piece.startsWith('$') && piece.endsWith('$') && piece.length > 2)
      return <span className="kolin-rich__math" key={index}>{mathParts(piece.slice(1, -1))}</span>;
    return piece;
  });
}

const toneLabels: Record<'correct' | 'incorrect' | 'tip' | 'warning', string> = {
  correct: '✓',
  incorrect: '✕',
  tip: '💡',
  warning: '!',
};

/** Rich teacher-only display for mathematical explanations; model text stays untrusted. */
export function KolinRichText({ text }: { text: string }) {
  return <div className="kolin-rich">
    {parseKolinBlocks(text).map((block, index) => {
      if (block.kind === 'heading') return <h4 key={index}>{inlineText(block.text)}</h4>;
      if (block.kind === 'formula') return <div className="kolin-rich__formula" key={index}>{mathParts(block.text)}</div>;
      if (block.kind === 'bullet') return <div className="kolin-rich__list-item" key={index}><span aria-hidden="true">•</span><p>{inlineText(block.text)}</p></div>;
      if (block.kind === 'numbered') return <div className="kolin-rich__list-item" key={index}>
        <span aria-hidden="true">{block.number}.</span><p>{inlineText(block.text)}</p>
      </div>;
      if (block.kind === 'correct' || block.kind === 'incorrect' || block.kind === 'tip' || block.kind === 'warning') {
        return <div className={'kolin-rich__callout kolin-rich__callout--' + block.kind} key={index}>
          <span className="kolin-rich__callout-icon" aria-hidden="true">{toneLabels[block.kind]}</span>
          <p>{inlineText(block.text)}</p>
        </div>;
      }
      return <p className="kolin-rich__paragraph" key={index}>{inlineText(block.text)}</p>;
    })}
  </div>;
}
