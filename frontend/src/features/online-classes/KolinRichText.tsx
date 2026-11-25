import { memo, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

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

/**
 * A provider can accidentally delimit a complete derivation with inline
 * math delimiters. Promote multiline math to display math before splitting
 * Markdown into lines. Keep existing display math, code and prose intact.
 */
function normalizeMultilineMath(value: string): string {
  const tokens = /\x60[^\x60]*\x60|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\(([\s\S]*?)\\\)|\\\$|\$((?:\\[^\r\n]|[^\\$])+)\$/g;
  return value.replace(tokens, (match, parens: string | undefined, dollars: string | undefined) => {
    const source = parens ?? dollars;
    if (!source || !source.includes('\n') || /\n[ \t]*\n/.test(source)) return match;
    // Don't consume ordinary prose between accidental currency signs.
    if (dollars && !/\\[a-zA-Z]+|[=^_{}]/.test(source)) return match;
    const rows = source.trim().split('\n').map(row => row.trim()).filter(Boolean);
    if (!rows.length) return match;
    const chain = rows.length > 1 && rows.slice(1).every(row => row.startsWith('='))
      && !/\\begin\s*\{|\\\\|&/.test(source);
    // Align equality chains vertically so they fit the narrow feedback pane.
    const math = chain
      ? '\\begin{aligned}' + rows.map(row => '&' + row).join('\\\\') + '\\end{aligned}'
      : rows.join(' ');
    return '\\[' + math + '\\]';
  });
}

/** Parse only our small, safe Markdown subset. Never use HTML from a model response. */
export function parseKolinBlocks(value: string): KolinBlock[] {
  const lines = normalizeMultilineMath(value.replace(/\r\n?/g, '\n')).split('\n');
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

    // Consume a whole TeX display block, including formulas spanning several lines.
    // Without this, model responses expose literal \[ ... \] in the teacher chat.
    const opening = trimmed.startsWith('\\[') ? '\\[' : trimmed.startsWith('$$') ? '$$' : null;
    if (opening) {
      flush();
      const closing = opening === '$$' ? '$$' : '\\]';
      const captured: string[] = [trimmed.slice(opening.length)];
      let joined = captured[0];
      while (!joined.includes(closing) && i + 1 < lines.length) {
        captured.push(lines[++i]);
        joined = captured.join('\n');
      }
      const end = joined.indexOf(closing);
      if (end >= 0) {
        const expression = joined.slice(0, end).trim();
        if (expression) blocks.push({ kind: 'formula', text: expression });
        const remainder = joined.slice(end + closing.length).trim();
        if (remainder) paragraph.push(remainder);
      } else {
        // Unclosed delimiters remain visible as text, never interpreted as HTML.
        blocks.push({ kind: 'paragraph', text: opening + joined });
      }
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


/** KaTeX safely escapes model-provided math and refuses dangerous HTML extensions. */
function KolinMath({ source, displayMode = false }: { source: string; displayMode?: boolean }) {
  if (source.length > 4000) return <code className="kolin-rich__math-fallback">{source}</code>;
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
      maxExpand: 300,
      maxSize: 12,
      output: 'htmlAndMathml',
    });
    return <span className="kolin-rich__typeset" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // Invalid TeX is kept as escaped React text, never rendered as model HTML.
    return <code className="kolin-rich__math-fallback">{source}</code>;
  }
}

function inlineText(value: string): ReactNode[] {
  const tokens = /(\*\*[^*]+\*\*|\x60[^\x60\n]+\x60|\\\([^\n]+?\\\)|\$[^$\n]+\$)/g;
  return value.split(tokens).map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**'))
      return <strong key={index}>{inlineText(piece.slice(2, -2))}</strong>;
    if (piece.charCodeAt(0) === 96 && piece.charCodeAt(piece.length - 1) === 96)
      return <code key={index}>{piece.slice(1, -1)}</code>;
    if (piece.startsWith('\\(') && piece.endsWith('\\)'))
      return <span className="kolin-rich__math" key={index}><KolinMath source={piece.slice(2, -2)} /></span>;
    if (piece.startsWith('$') && piece.endsWith('$') && piece.length > 2)
      return <span className="kolin-rich__math" key={index}><KolinMath source={piece.slice(1, -1)} /></span>;
    return piece;
  });
}

/** Recognize complete multi-line display equations even inside feedback callouts. */
function richContent(value: string): ReactNode[] {
  const displays = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  const addText = (segment: string) => {
    const text = segment.trim();
    if (text) nodes.push(<p className="kolin-rich__text" key={key++}>{inlineText(text)}</p>);
  };
  while ((match = displays.exec(value)) !== null) {
    addText(value.slice(last, match.index));
    const source = (match[1] || match[2] || '').trim();
    if (source) nodes.push(
      <div className="kolin-rich__formula" key={key++}><KolinMath source={source} displayMode /></div>,
    );
    last = match.index + match[0].length;
  }
  addText(value.slice(last));
  return nodes;
}

const toneLabels: Record<'correct' | 'incorrect' | 'tip' | 'warning', string> = {
  correct: '✓',
  incorrect: '✕',
  tip: '💡',
  warning: '!',
};

/** Rich teacher-only display for mathematical explanations; model text stays untrusted. */
export const KolinRichText = memo(function KolinRichText({ text }: { text: string }) {
  return <div className="kolin-rich">
    {parseKolinBlocks(text).map((block, index) => {
      if (block.kind === 'heading') return <h4 key={index}>{inlineText(block.text)}</h4>;
      if (block.kind === 'formula') return <div className="kolin-rich__formula" key={index}><KolinMath source={block.text} displayMode /></div>;
      if (block.kind === 'bullet') return <div className="kolin-rich__list-item" key={index}><span aria-hidden="true">•</span><div className="kolin-rich__list-body">{richContent(block.text)}</div></div>;
      if (block.kind === 'numbered') return <div className="kolin-rich__list-item" key={index}>
        <span aria-hidden="true">{block.number}.</span><div className="kolin-rich__list-body">{richContent(block.text)}</div>
      </div>;
      if (block.kind === 'correct' || block.kind === 'incorrect' || block.kind === 'tip' || block.kind === 'warning') {
        return <div className={'kolin-rich__callout kolin-rich__callout--' + block.kind} key={index}>
          <span className="kolin-rich__callout-icon" aria-hidden="true">{toneLabels[block.kind]}</span>
          <div className="kolin-rich__callout-body">{richContent(block.text)}</div>
        </div>;
      }
      return <div className="kolin-rich__paragraph" key={index}>{richContent(block.text)}</div>;
    })}
  </div>;
});
