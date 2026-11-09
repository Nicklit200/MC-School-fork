import {normalizeMath} from './math.mjs';

export const blockTypes = new Set(['callout','strips','graph','geometry','facts','example','exercise','teacherNote','schedule','solutions','richText','text','explanation','math','row','column','grid','split','stack','taskCard','answerLines','answerBox','coordinateGrid','matching','studentHeader','conclusionBox','spacer','divider','intersectionResult','visualTask']);

export function length(value, fallback='4mm', max=200, min=0) {
  const v = value ?? fallback;
  if (typeof v !== 'string' || !/^(?:\d+(?:\.\d+)?)(?:mm|px|em)$/.test(v)) throw new TypeError('Invalid bounded layout length');
  const millimeters=parseFloat(v)*(v.endsWith('mm') ? 1 : v.endsWith('px') ? 25.4/96 : 16*25.4/96);
  if(millimeters<min || millimeters>max)throw new TypeError('Invalid bounded layout length');
  return v;
}
export function integer(value, fallback, min, max) {
  const v = value ?? fallback;
  if (!Number.isInteger(v) || v < min || v > max) throw new TypeError(`Expected integer ${min} to ${max}`);
  return v;
}
export function columns(value) {
  if (value == null) return '1fr 1fr';
  if (!Array.isArray(value) || value.length !== 2 || value.some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?%$/.test(v) || parseFloat(v) <= 0 || parseFloat(v) > 100)) throw new TypeError('split.columns must contain two positive percentages');
  if (Math.abs(value.reduce((s,v)=>s+parseFloat(v),0)-100)>0.01) throw new TypeError('split.columns must total 100%');
  return value.map(v=>parseFloat(v)+'fr').join(' ');
}
/**
 * Normalize only display-math fields produced by ChatGPT. Do not touch
 * qa.algebra assertions or solve/alter any exercise: the algebra checker must
 * still reject incorrect mathematics and unsafe TeX stays blocked by MathJax.
 * Both TEACHER and ADMIN use this same renderer entrypoint.
 */
export function normalizeLessonMath(data) {
  const asMath = value => typeof value === 'string' ? normalizeMath({latex:value}) : value;
  function visit(value, depth=0) {
    if (depth>24 || !value || typeof value!=='object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child,depth+1);
      return;
    }
    // Canonicalize bare TeX strings only where the renderer expects formulas.
    if (typeof value.math==='string') value.math=asMath(value.math);
    if (value.type==='math' && typeof value.expression==='string')
      value.expression=asMath(value.expression);
    if (value.type==='example' && Array.isArray(value.expressions))
      value.expressions=value.expressions.map(asMath);
    for(const child of Object.values(value)) visit(child,depth+1);
  }
  visit(data?.workbookPages);
  visit(data?.teacherPages);
  return data;
}

export function validateLesson(data) {
  let count=0;
  function walk(v, depth=0) {
    if (++count>12000 || depth>24) throw new TypeError('Lesson complexity limit exceeded');
    if (typeof v === 'string' && v.length>6000) throw new TypeError('Text exceeds 6000 characters');
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if(v.length>200)throw new TypeError('List exceeds 200 entries');
      for (const item of v) walk(item,depth+1);
      return;
    }
    if (Object.hasOwn(v,'latex') || Object.hasOwn(v,'tokens')) normalizeMath(v);
    if(v.type==='richText') {
      if(!Array.isArray(v.content) || v.content.length>100)throw new TypeError('Invalid richText content');
    }
    for(const child of Object.values(v))walk(child,depth+1);
  }
  walk(data);
  if(!data?.meta || !Array.isArray(data.workbookPages) || !Array.isArray(data.teacherPages) || data.workbookPages.length<1 || data.workbookPages.length>35 || data.teacherPages.length<1 || data.teacherPages.length>20)throw new TypeError('Invalid lesson pages');
  integer(data.meta.durationMinutes,undefined,30,240);
  function blocks(items,depth=0) {
    if(!Array.isArray(items) || items.length>80 || depth>12)throw new TypeError('Invalid block list');
    for(const b of items) {
      if(!b || !blockTypes.has(b.type))throw new TypeError('Unknown block: '+b?.type);
      if(b.children)blocks(b.children,depth+1);
      if(b.left && b.type==='split')blocks(b.left,depth+1);
      if(b.right && b.type==='split')blocks(b.right,depth+1);
      if(b.type==='split')columns(b.columns);
      if(b.gap!=null)length(b.gap,'4mm',20);
      if(b.type==='grid')integer(b.columns,2,1,4);
      if(b.type==='answerLines'){integer(b.lines ?? b.count,3,1,15);length(b.spacing,'8mm',20,6);}
      if(b.type==='answerBox')length(b.height,'24mm',120,12);
      if(b.type==='spacer')length(b.height,'4mm',60);
    }
  }
  for(const page of [...data.workbookPages,...data.teacherPages])blocks(page.blocks);
  return data;
}
