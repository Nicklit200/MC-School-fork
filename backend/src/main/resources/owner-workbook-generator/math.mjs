import {formatPlainMathText} from './math-typography.mjs';
import MathJax from 'mathjax';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

export const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
let engine;
const cache = new Map();

export function normalizeMath(value) {
  if (Array.isArray(value)) value = {tokens: value};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected {latex}, {tokens}, or a legacy token array');
  const latex = Object.hasOwn(value, 'latex'), tokens = Object.hasOwn(value, 'tokens');
  if (latex === tokens) throw new TypeError('Math requires exactly one of latex or tokens');
  if (latex) {
    if (typeof value.latex !== 'string' || !value.latex.trim() || value.latex.length > 2000) throw new TypeError('LaTeX must contain 1 to 2000 characters');
    if (/\\\\(?:frac|sqrt|begin|quad|ne)\b/.test(value.latex)) throw new TypeError('TeX commands require one backslash, not two');
    // Rendering is offline. User TeX must never request resources or inject HTML/CSS.
    if (/\\(?:href|url|style|class|cssId|html\w*|require|includegraphics|def|gdef|edef|newcommand|renewcommand)\b/.test(value.latex)) throw new TypeError('Unsafe or unsupported TeX command');
    return {latex: value.latex.trim()};
  }
  if (!Array.isArray(value.tokens) || value.tokens.length < 1 || value.tokens.length > 100 || value.tokens.some(t => typeof t !== 'string' || t.length > 200)) throw new TypeError('Math tokens must be 1 to 100 short strings');
  return {tokens: value.tokens};
}

function collect(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result;
  if (!Array.isArray(value) && Object.hasOwn(value, 'latex')) result.add(normalizeMath(value).latex);
  if (!Array.isArray(value) && Object.hasOwn(value, 'math') && typeof value.math === 'string') result.add(normalizeMath({latex:value.math}).latex);
  for (const child of Object.values(value)) collect(child, result);
  return result;
}

export async function primeMath(data) {
  const expressions = collect(data);
  if (!expressions.size) return;
  // MathJax 4 otherwise splits inline math at operators into several SVGs.
  // A single standalone SVG must contain the complete expression.
  engine ??= await MathJax.init({loader:{load:['input/tex', 'output/svg'],require:file=>import(isAbsolute(file) ? pathToFileURL(file).href : file)}, tex:{maxBuffer:2000, maxMacros:1000}, output:{linebreaks:{inline:false}}, svg:{fontCache:'local'}});
  if(!engine)throw new Error('MathJax initialization failed');
  const adaptor = engine.startup.adaptor;
  for (const tex of expressions) {
    if (cache.has(tex)) continue;
    const node = await engine.tex2svgPromise(tex, {display:false, em:16, ex:8, containerWidth:1280});
    const svgs=adaptor.tags(node, 'svg');
    if(svgs.length!==1)throw new Error('MathJax must return exactly one complete SVG');
    const svgNode = svgs[0];
    const svg = svgNode ? adaptor.serializeXML(svgNode) : '';
    if (!svgNode || /data-mml-node="merror"|data-mjx-error|<script\b|<foreignObject\b/i.test(svg)) throw new Error('Invalid LaTeX expression: ' + tex);
    cache.set(tex, svg);
  }
}

function token(t) {
  const fraction = /^(-?\d+|\?)\/(-?\d+|\?)$/.exec(t);
  if (fraction) {
    const [,n,d] = fraction, w = Math.max(31, 15 + Math.max(n.length,d.length) * 13), mid = w/2;
    if (d === '0') throw new TypeError('Zero denominator');
    return `<svg class="math-fraction" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 57" width="${w}" height="57" role="img" aria-label="${escapeHtml(n)} durch ${escapeHtml(d)}"><text x="${mid}" y="20" text-anchor="middle" font-size="29" font-family="Arial, sans-serif" fill="#070a20">${escapeHtml(n)}</text><line x1="2" y1="28" x2="${w-2}" y2="28" stroke="#070a20" stroke-width="2"/><text x="${mid}" y="53" text-anchor="middle" font-size="29" font-family="Arial, sans-serif" fill="#070a20">${escapeHtml(d)}</text></svg>`;
  }
  if (t === '_____') return '<span class="blank-formula" aria-label="Antwortlinie">________</span>';
  return `<span class="op${t === '□' ? ' empty-op' : ''}">${formatPlainMathText(t)}</span>`;
}

export function renderMath(value, inline = false) {
  const expression = normalizeMath(value);
  if (expression.latex) {
    const svg = cache.get(expression.latex);
    if (!svg) throw new Error('Math must be prepared before rendering');
    return `<span class="${inline ? 'inline-math' : 'formula formula-latex'}" data-qa="math"><span class="math-latex" role="img" aria-label="${escapeHtml(expression.latex)}">${svg}</span></span>`;
  }
  return `<span class="formula${inline ? ' inline-math' : ''}" data-qa="math">${expression.tokens.map(token).join('')}</span>`;
}

export function richText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return formatPlainMathText(value);
  const content = Array.isArray(value) ? value : value.type === 'richText' ? value.content : null;
  if (!Array.isArray(content) || content.length > 100) throw new TypeError('Text must be a string or richText content');
  return content.map(segment => {
    if (!segment || typeof segment !== 'object' || Object.hasOwn(segment,'text') === Object.hasOwn(segment,'math')) throw new TypeError('Rich text segment requires exactly one of text or math');
    if (Object.hasOwn(segment,'text')) {
      if (typeof segment.text !== 'string') throw new TypeError('Rich text text must be a string');
      return formatPlainMathText(segment.text);
    }
    return renderMath(typeof segment.math === 'string' ? {latex:segment.math} : segment.math, true);
  }).join('');
}
