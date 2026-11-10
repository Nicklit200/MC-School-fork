#!/usr/bin/env node
/**
 * Mindcrafti A4 worksheet generator.
 * Input: lesson.json. Output: an editable HTML master and 2 ready-to-print PDFs.
 * Mathematical formulas: MathJax 4 TeX -> inline vector SVG.
 * Graphs, geometry and fraction diagrams: native vector SVG.
 * PDF: WeasyPrint default, Chromium optional. See README.md for React/KaTeX integration.
 * Usage: node generate.mjs          (creates HTML + PDF)
 *        node generate.mjs --html-only
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { renderDiagram, computeIntersections, graphWarnings } from './diagrams.mjs';
import { primeMath, renderMath as math, richText } from './math.mjs';
import { validateLesson, normalizeLessonMath, length, integer, columns } from './schema.mjs';
import { autoPaginatePages, preflightPages, repackOverflowPages } from './pagination.mjs';
import { prepareVisualTasks, mergeVisualQa } from './visual-tasks.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const value = args.find(x => x.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}
const lessonPath = resolve(option('lesson', join(root, 'lesson.sample.json')));
const out = resolve(option('out', join(root, 'out')));
const plain = args.includes('--plain');
const lesson = JSON.parse(await readFile(lessonPath, 'utf8'));
// Match the teacher/admin ChatGPT contract before strict schema and math QA.
// This changes only representation, never mathematical content or answers.
normalizeLessonMath(lesson);
validateLesson(lesson);
const visualQa = prepareVisualTasks(lesson);
const css = await readFile(join(root, 'styles.css'), 'utf8');
validateLesson(lesson);

function callout(b, tall = false) {
  return `<div class="block callout ${tall ? 'tall' : ''}"><div class="eyebrow">${richText(b.label)}</div><p>${richText(b.text)}</p></div>`;
}
function stripes(b) {
  function strip(f) {
    const n = Number(f.numerator);
    const d = Number(f.denominator);
    if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0 || n < 0 || n > d) {
      throw new TypeError('Fraction strip needs 0 <= numerator <= denominator, with positive integers');
    }
    // 25/100 is visually 1/4, not 100 unreadable hair-thin lines.
    const common = Number(gcd(BigInt(n), BigInt(d)));
    const simplifiedDenominator = d / common;
    const divisions = simplifiedDenominator <= 12 ? simplifiedDenominator : 10;
    const filled = 320 * n / d;
    const orange = '<rect x="0" y="0.5" width="' + filled.toFixed(3) + '" height="39" fill="#ffead7"/>';
    const dividers = Array.from({ length: divisions - 1 }, (_, i) => {
      const x = 320 * (i + 1) / divisions;
      return `<line x1="${x.toFixed(3)}" y1="0.5" x2="${x.toFixed(3)}" y2="39.5" stroke="#bdc9d8" stroke-width="1.1"/>`;
    }).join('');
    const diagram = `<rect x="0.5" y="0.5" width="319" height="39" fill="white" stroke="#bdc9d8" stroke-width="1.1"/>${orange}${dividers}<rect x="0.5" y="0.5" width="319" height="39" fill="none" stroke="#bdc9d8" stroke-width="1.1"/>`;
    return `<div class="strip-block"><svg viewBox="0 0 320 40" preserveAspectRatio="none" role="img" aria-label="${n} von ${d} Teilen markiert">${diagram}</svg>${n}/${d}</div>`;
  }
  return `<div class="block fraction-strips"><div class="example-eyebrow">${richText(b.label)}</div><div class="fraction-strip-diagram">${strip(b.left)}<span class="strip-relation">${richText(b.relation)}</span>${strip(b.right)}</div></div>`;
}

function example(b) {
  // Each expression occupies an independent centered cell; no inline SVG collisions.
  const formulas = `<div class="example-inner">${b.expressions.map(expr => `<div class="example-math-item">${math(expr)}</div>`).join('')}</div>`;
  if (b.text) {
    return `<div class="block example-split"><div class="callout"><div class="eyebrow">${richText(b.label)}</div><p>${richText(b.text)}</p></div><div class="example-box">${formulas}</div></div>`;
  }
  return `<div class="block example-box"><div class="example-eyebrow">${richText(b.label)}</div>${formulas}</div>`;
}
function studentTaskRow(row) {
  return `<div class="task-row"><span class="item-label">${richText(row.label)}</span><div class="expression-wrap">${plain && row.text ? `<p class="task-description">${richText(row.text)}</p>` : ''}${math(row.math)}</div>${row.work ? '<div class="workline"></div>' : ''}</div>`;
}

function factsBlock(b) {
  const box = (title, items = [], accent = '') => {
    const lis = (items || []).map(item => `<li>${richText(item)}</li>`).join('');
    return `<div class="facts-card ${accent}"><div class="facts-title">${richText(title)}</div><ul>${lis}</ul></div>`;
  };
  const notes = (b.notes || []).map(x => `<div class="facts-note">${richText(x)}</div>`).join('');
  return `<section class="block facts-block">${b.label ? `<div class="diagram-eyebrow">${richText(b.label)}</div>` : ''}<div class="facts-grid">${box(b.givenTitle || 'GEGEBEN', b.given, 'given')}${box(b.findTitle || 'GESUCHT', b.find, 'find')}</div>${notes}</section>`;
}

function exercise(b) {
  const isExit = b.variant === 'exit';
  const isError = b.number === '10';
  const classes = ['block','exercise', ['relaxed','compact'].includes(b.size) ? b.size : '', isExit ? 'exit' : '', isError ? 'error-detective' : ''].join(' ');
  const head = b.title ? `<div class="exercise-head"><div class="exercise-number">${richText(b.number)}</div><div class="exercise-head-text"><div class="exercise-title">${richText(b.title)}</div>${b.subtitle ? `<div class="exercise-subtitle">${richText(b.subtitle)}</div>` : ''}</div></div>` : '';
  const rows = (b.rows ?? []).map(studentTaskRow).join('');
  // Render one measured blank writing area rather than N decorative rules.
  // Retain the exact previous height, including full handwriting spacing.
  const n = Number(b.writeLines ?? 0);
  if(!Number.isInteger(n) || n<0 || n>30)throw new TypeError('Invalid writing line count');
  const gap = lesson.meta.homeworkMode===true && !plain ? 5.6 : 7.2;
  const height = n ? (2.4*n + gap*(n-1) + (lesson.meta.homeworkMode===true && !plain ? 0 : 1)) : 0;
  const lines = n ? `<div class="response-lines" data-qa="blank-workspace" style="height:${height.toFixed(2)}mm"></div>` : '';
  const mini = b.extra ? `<div class="mini-check"><span class="small-pill">${richText(b.extra.label)}</span>${math(b.extra.math)}</div>` : '';
  const selfRating = b.selfRating ? (() => {
    const [intro,...choices] = b.selfRating.split('□');
    return `<div class="self-rating"><span>${richText(intro.trim())}</span>${choices.map(t=>`<span class="rating-choice"><i class="rating-check"></i>${richText(t.trim())}</span>`).join('')}</div>`;
  })() : '';
  return `<div class="${classes}" data-qa="task">${head}<div class="exercise-content">${b.description ? `<p class="task-description">${richText(b.description)}</p>` : ''}${rows}${isError ? '<div class="correction-line"></div>' : ''}${lines}${mini}${selfRating}${b.explanation ? `<p class="rich-text">${richText(b.explanation)}</p>` : ''}</div></div>`;
}
function* flattenBlocks(blocks) {
  for(const b of blocks) {
    yield b;
    for(const key of ['children','left','right']) if(Array.isArray(b[key]) && b.type !== 'matching')yield* flattenBlocks(b[key]);
  }
}
function renderLayout(b, render, teacher=false) {
  const children = () => (b.children || []).map(render).join('');
  const gap = () => length(b.gap,'4mm',20);
  switch(b.type) {
    case 'richText': return `<p class="block rich-text">${richText(b)}</p>`;
    case 'text': case 'explanation': return `<p class="block rich-text">${richText(b.text)}</p>`;
    case 'math': return `<div class="block math-block">${math(b.expression ?? b.math)}</div>`;
    case 'row': case 'grid': {
      const cols = b.type==='grid' ? integer(b.columns,2,1,4) : integer(b.children?.length,1,1,8);
      return `<div class="block layout-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap()}" data-qa="layout">${children()}</div>`;
    }
    case 'column': case 'stack': return `<div class="block layout-stack" style="gap:${gap()}" data-qa="layout">${children()}</div>`;
    case 'split': return `<div class="block layout-grid layout-split" style="grid-template-columns:${columns(b.columns)};gap:${gap()}" data-qa="layout"><div class="layout-stack">${(b.left || []).map(render).join('')}</div><div class="layout-stack">${(b.right || []).map(render).join('')}</div></div>`;
    case 'taskCard': return `<section class="block task-card" data-qa="task">${b.title ? `<div class="task-card-title">${b.number ? `<span class="task-card-number">${richText(b.number)}</span>` : ''}${richText(b.title)}</div>` : ''}${b.subtitle ? `<div class="task-card-subtitle">${richText(b.subtitle)}</div>` : ''}${b.description ? `<p class="task-description">${richText(b.description)}</p>` : ''}${children()}</section>`;
    case 'answerLines': {
      const count=integer(b.lines ?? b.count,3,1,15), spacing=length(b.spacing,'8mm',20,6);
      return `<div class="block answer-lines" data-qa="answer" data-min-height-mm="${count * parseFloat(spacing)}">${b.label ? `<div class="answer-label">${richText(b.label)}</div>` : ''}${Array.from({length:count},()=>`<div class="answer-line" style="height:${spacing}"></div>`).join('')}</div>`;
    }
    case 'answerBox': return `<div class="block answer-box" data-qa="answer" style="min-height:${length(b.height,'24mm',120,12)}">${b.label ? `<div class="answer-label">${richText(b.label)}</div>` : ''}${b.text ? `<p>${richText(b.text)}</p>` : ''}</div>`;
    case 'studentHeader': {
      const fields=b.fields || ['Name','Klasse','Datum'];
      integer(fields.length,3,1,6);
      return `<div class="block student-header" data-qa="header" style="grid-template-columns:repeat(${fields.length},minmax(0,1fr))">${fields.map(label=>`<div><span>${richText(label)}:</span><span class="student-field-line">&nbsp;</span></div>`).join('')}</div>`;
    }
    case 'conclusionBox': return `<section class="block conclusion-box" data-qa="task"><div class="task-card-title">${richText(b.title || b.label || 'Mein Fazit')}</div>${b.text ? `<p class="rich-text">${richText(b.text)}</p>` : ''}${b.children ? children() : render({type:'answerLines',lines:b.lines ?? 2})}</section>`;
    case 'spacer': return `<div class="layout-spacer" style="height:${length(b.height,'4mm',60)}" aria-hidden="true"></div>`;
    case 'divider': return '<hr class="block layout-divider">';
    case 'matching': {
      const left=b.left || [], right=b.right || [], rows=Math.max(left.length,right.length);
      if(!rows || rows>12 || !left.length || !right.length)throw new TypeError('matching needs 1 to 12 items in each column');
      const item=value=>richText(value?.content && value.type==='richText' ? value : value?.text ?? value);
      const side=(list,name)=>`<div class="matching-column matching-${name}" style="grid-template-rows:repeat(${rows},14mm)">${Array.from({length:rows},(_,i)=>`<div class="matching-item">${i<list.length ? `<span class="matching-text">${item(list[i])}</span><span class="matching-dot"></span>` : ''}</div>`).join('')}</div>`;
      const connections=teacher && b.showConnections ? (b.matches || []).map(pair=>{
        if(!Array.isArray(pair) || pair.length!==2 || !pair.every(Number.isInteger) || pair[0]<0 || pair[0]>=left.length || pair[1]<0 || pair[1]>=right.length)throw new TypeError('Invalid matching index');
        return `<line x1="0" y1="${14*(pair[0]+.5)}" x2="100" y2="${14*(pair[1]+.5)}" stroke="#FF6A00" stroke-width="0.8"/>`;
      }).join('') : '';
      return `<section class="block matching" data-qa="task">${b.title ? `<div class="task-card-title">${richText(b.title)}</div>` : ''}<div class="matching-body" style="height:${14*rows}mm">${side(left,'left')}<svg class="matching-connections" height="${14*rows}mm" style="height:${14*rows}mm" viewBox="0 0 100 ${14*rows}" preserveAspectRatio="none" aria-hidden="true">${connections}</svg>${side(right,'right')}</div></section>`;
    }
    case 'intersectionResult': {
      if(!b.graph || !Array.isArray(b.graph.series))throw new TypeError('intersectionResult requires a structured graph');
      const points=computeIntersections(b.graph), fmt=n=>Number(n.toFixed(6));
      return `<div class="block intersection-result">${richText(b.label || 'Schnittpunkte')}: ${points.length ? points.map(p=>`S(${fmt(p.x)} | ${fmt(p.y)})`).join('; ') : 'keine im dargestellten Bereich'}</div>`;
    }
    default:return null;
  }
}
function renderWorkbookBlock(b, idx, pageIndex) {
  const layout=renderLayout(b, child=>renderWorkbookBlock(child,1,pageIndex));
  if(layout!==null)return layout;
  switch (b.type) {
    case 'callout': return callout(b, pageIndex === 0 && idx === 0);
    case 'strips': return stripes(b);
    case 'graph': case 'geometry': case 'coordinateGrid': return renderDiagram(b);
    case 'facts': return factsBlock(b);
    case 'example': return example(b);
    case 'exercise': return exercise(b);
    default: throw new TypeError(`Unknown workbook block: ${b.type}`);
  }
}
function teacherBlock(b) {
  const layout=renderLayout(b,teacherBlock,true);
  if(layout!==null)return layout;
  switch (b.type) {
    case 'teacherNote': {
      const title = b.title ? `<div class="teacher-section-title">${richText(b.title)}</div>` : '';
      const text = (b.paragraphs || (b.text ? [b.text] : [])).map(p => `<p class="teacher-paragraph">${richText(p)}</p>`).join('');
      return `<section class="teacher-block teacher-note"><div class="teacher-section-label">${richText(b.label)}</div>${title}${text}</section>`;
    }
    case 'schedule':
      return `<section class="teacher-block teacher-schedule"><div class="teacher-section-label">${richText(b.label)}</div><div class="teacher-section-title">${richText(b.title)}</div>${(b.rows || []).map(([time,text])=> `<div class="schedule-row"><span class="schedule-time">${richText(time)}</span><span>${richText(text)}</span></div>`).join('')}</section>`;
    case 'graph': case 'geometry': case 'coordinateGrid': return renderDiagram(b);
    case 'callout': return callout(b);
    case 'example': return example(b);
    case 'exercise': return exercise(b);
    case 'facts': return factsBlock(b);
    case 'solutions': {
      const rows = b.items.map(x => `<div class="solution-row"><span class="solution-label">${richText(x.label)}</span>${x.math ? math(x.math) : `<span class="solution-text">${richText(x.text)}</span>`}${x.note ? `<span class="solution-note">${richText(x.note)}</span>` : ''}</div>${x.explanation ? `<p class="rich-text">${richText(x.explanation)}</p>` : ''}`).join('');
      return `<section class="teacher-block solution-group"><div class="teacher-section-label">${richText(b.section)}</div><div class="teacher-section-title">${richText(b.title)}</div>${rows}${b.footerNote ? `<div class="solution-footnote">${richText(b.footerNote)}</div>` : ''}</section>`;
    }
    default: throw new TypeError(`Unknown teacher block: ${b.type}`);
  }
}
function pad2(n) { return String(n).padStart(2,'0'); }
function pageChrome({ index, count, title, subtitle, time, teacher }) {
  const meta = lesson.meta;
  const homeworkStudent = lesson.meta.homeworkMode === true && !teacher;
  const subjectLabel = teacher ? 'LEHRERLÖSUNGEN' : homeworkStudent ? 'HAUSAUFGABEN' : 'ARBEITSHEFT';
  // School branding stays as text and the orange header; image logo is temporarily disabled.
  const top = `<div class="brandbar"><div class="brand-lines"><div class="school-name">${richText(meta.school)}</div><div class="school-kind">${richText(meta.subject)} &nbsp;/&nbsp; ${subjectLabel}</div></div></div>`;
  const heading = `<div class="page-heading"><h1>${richText(title)}</h1><p class="page-subtitle">${richText(subtitle)}</p></div>`;
  // Page index remains in the footer; omit the per-page progress bar and time badge.
  const progress = '';
  const pill = '';
  const footer = homeworkStudent
    ? `<footer class="footer"><span>${richText(meta.school)} &nbsp;/&nbsp; MATHEMATIK</span><span class="page-index">${pad2(index+1)} / ${pad2(count)}</span></footer>`
    : `<footer class="footer"><span>${richText(meta.school)} &nbsp;/&nbsp; ${richText(meta.group)}</span><span class="page-index">${pad2(index+1)} / ${pad2(count)} &nbsp; • &nbsp; ${richText(meta.date)}</span></footer>`;
  return { top, heading, progress, pill, footer };
}
function workbookPage(p, idx, pages) {
  if (plain) return `<article class="sheet student plain" data-page="${idx+1}"><main class="paper-content">${p.blocks.map((b,i)=>renderWorkbookBlock(b,i,idx)).join('')}</main></article>`;
  const c = pageChrome({index: idx, count: pages.length, title:p.title,subtitle:p.subtitle,time:p.time,teacher:false});
  return `<article class="sheet student${lesson.meta.homeworkMode===true ? ' homework' : ''}" data-page="${idx+1}">${c.top}${c.heading}${c.pill}${c.progress}<main class="paper-content">${p.blocks.map((b,i)=>renderWorkbookBlock(b,i,idx)).join('')}</main>${c.footer}</article>`;
}
function teacherPage(p, idx, pages) {
  if (plain) return `<article class="sheet teacher plain" data-page="${idx+1}"><main class="paper-content">${p.blocks.map(teacherBlock).join('')}</main></article>`;
  const c = pageChrome({index:idx,count:pages.length,title:p.title,subtitle:p.subtitle,time:null,teacher:true});
  return `<article class="sheet teacher" data-page="${idx+1}">${c.top}${c.heading}<main class="paper-content">${p.blocks.map(teacherBlock).join('')}</main>${c.footer}</article>`;
}
function doc(body, title) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${richText(title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
}

// Independent exact-rational verification of the teacher-answer chains.
// This prevents a beautifully laid-out PDF from hiding wrong arithmetic.
function gcd(a,b) { a=a<0n?-a:a; b=b<0n?-b:b; while(b!==0n){const t=a%b;a=b;b=t;}return a; }
class Fraction {
  constructor(n,d=1n){n=BigInt(n);d=BigInt(d);if(d===0n)throw Error('zero denominator');if(d<0n){n=-n;d=-d;}const g=gcd(n,d)||1n;this.n=n/g;this.d=d/g;}
  add(o){return new Fraction(this.n*o.d+o.n*this.d,this.d*o.d);}
  sub(o){return new Fraction(this.n*o.d-o.n*this.d,this.d*o.d);}
  cmp(o){const delta=this.n*o.d-o.n*this.d;return delta<0n?-1:delta>0n?1:0;}
}
function tokenFraction(s){const parts=String(s).split('/');return new Fraction(parts[0],parts[1]??'1');}
function arithmetic(tokens){let x=tokenFraction(tokens[0]);for(let i=1;i<tokens.length;i+=2){const y=tokenFraction(tokens[i+1]);if(tokens[i]==='+')x=x.add(y);else if(tokens[i]==='-')x=x.sub(y);else throw Error('Bad arithmetic operator '+tokens[i]);}return x;}
function checkChain(tokens,label){
  const comparisons=[];const groups=[];let start=0;
  for(let i=0;i<tokens.length;i++)if(['=','<','>'].includes(tokens[i])){groups.push(tokens.slice(start,i));comparisons.push(tokens[i]);start=i+1;}
  groups.push(tokens.slice(start));
  for(let i=0;i<comparisons.length;i++) {
    const left=arithmetic(groups[i]),right=arithmetic(groups[i+1]),cmp=left.cmp(right);
    const valid=comparisons[i]==='='?cmp===0:comparisons[i]==='<'?cmp<0:cmp>0;
    if(!valid)throw Error(`Incorrect math in ${label}: ${tokens.join(' ')}`);
  }
}
function checkAnswerMath(data){
  let checked=0;
  for(const p of data.teacherPages)for(const b of flattenBlocks(p.blocks))if(b.type==='solutions')for(const item of b.items) {
    const tokens = Array.isArray(item.math) ? item.math : item.math?.tokens;
    if(!tokens || !tokens.every(t => /^-?\d+(?:\/-?\d+)?$/.test(t) || ['+','-','=','<','>'].includes(t)))continue;
    checkChain(tokens,item.label);
    checked++;
  }
  console.log(`Verified ${checked} mathematical answer chains exactly.`);
  return checked;
}

function runProcess(command, args, timeoutMs, errorPrefix) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', stdoutBytes=0, settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectPromise(new Error(`${errorPrefix} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if(settled)return;
      stdoutBytes+=Buffer.byteLength(chunk,'utf8');
      if(stdoutBytes>1024*1024){
        settled=true;clearTimeout(timer);child.kill('SIGKILL');
        rejectPromise(new Error(`${errorPrefix}: process output exceeded 1 MiB`));
      } else stdout+=chunk;
    });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on('error', error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      rejectPromise(new Error(`${errorPrefix}: ${error.message}`));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code !== 0) rejectPromise(new Error(`${errorPrefix}: ${(stderr || stdout).slice(-4000)}`));
      else resolvePromise({stdout, stderr});
    });
  });
}

function findChromium(){
  for(const cmd of [process.env.CHROMIUM_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','chromium','chromium-browser','google-chrome'].filter(Boolean)) {
    const found=spawnSync(cmd,['--version'],{encoding:'utf8',timeout:5000,stdio:'pipe'});
    if(found.status===0)return cmd;
  }
  return null;
}
await mkdir(out,{recursive:true});
if (!plain) {
  // A HOMEWORK day is exactly one A4 pupil PDF. Never silently split it into
  // two physical pages: preflight plus WeasyPrint/PDF geometry QA must either
  // confirm it fits or reject the draft for revision.
  if (lesson.meta.homeworkMode !== true)
    lesson.workbookPages = autoPaginatePages(lesson.workbookPages, false);
  lesson.teacherPages = autoPaginatePages(lesson.teacherPages, true);
}
// The conservative branded-page estimator is not valid for compact one-page
// homework or Kolin's intentionally plain, full-height worksheet format.
// Those routes still undergo real WeasyPrint geometry QA and homework stays
// restricted to exactly one physical student A4 page.
if (!plain && lesson.meta.homeworkMode !== true)
  preflightPages(lesson.workbookPages, false);
if (!plain)
  preflightPages(lesson.teacherPages, true);
const arithmeticChains = checkAnswerMath(lesson);
const dateKey = String(lesson.meta.date || 'undated').replace(/[^0-9]/g,'') || 'undated';
const groupKey = String(lesson.meta.group || 'Gruppe').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,50) || 'Gruppe';
const base = basename(option('basename', `Mindcrafti_${groupKey}_${dateKey}`))
  .replace(/[^A-Za-z0-9_-]/g,'_').slice(0,90);
const checkedLessonPath=join(out,`${base}_checked-source.json`);
await writeFile(checkedLessonPath,JSON.stringify(lesson),'utf8');
const algebraRun=await runProcess(process.env.PYTHON_BIN || 'python3',[join(root,'algebra_qa.py'),checkedLessonPath],45000,'Algebra QA failed');
const graphQaWarnings=[...lesson.workbookPages,...lesson.teacherPages].flatMap(p=>[...flattenBlocks(p.blocks)]).filter(b=>b.type==='graph').flatMap(graphWarnings);
const mathQa={...mergeVisualQa(JSON.parse(algebraRun.stdout),visualQa),arithmeticChains,graphWarnings:graphQaWarnings};
if(mathQa.passed!==true)throw new Error('Algebra QA did not pass');
await primeMath(lesson);
await writeFile(join(out,`${base}_math-qa.json`),JSON.stringify(mathQa,null,2),'utf8');
const durationMinutes = Number(lesson.meta.durationMinutes);
if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 240) throw Error('Invalid meta.durationMinutes');
const targets=[
  {key:'Arbeitsheft_'+durationMinutes+'min',title:lesson.meta.homeworkMode===true ? 'Mindcrafti / Mathematik / Hausaufgaben' : 'Mindcrafti / Arbeitsheft',student:true},
  {key:'Lehrerloesungen_'+durationMinutes+'min',title:'Mindcrafti / Lehrerloesungen',student:false},
];
const writeHtml = async () => {
  for(const target of targets){
    const pages=target.student ? lesson.workbookPages : lesson.teacherPages;
    target.html=doc(pages.map((p,i)=>target.student ? workbookPage(p,i,pages) : teacherPage(p,i,pages)).join(''),target.title);
    target.htmlPath=join(out,base+'_'+target.key+'.html');
    target.pdfPath=join(out,base+'_'+target.key+'.pdf');
    await writeFile(target.htmlPath,target.html,'utf8');
  }
};
const engineArg = process.argv.find(v => v.startsWith('--engine='));
const engine = engineArg ? engineArg.slice('--engine='.length) : 'weasyprint';
if(process.argv.includes('--html-only')) {
  await writeHtml();
  console.log('HTML only mode: ready to preview in any modern browser.');
} else if(engine === 'weasyprint') {
  const helper = join(root,'render_pdf.py');
  // A retry is internal to this same generation job, preserving its idempotency key,
  // its lesson content, the original logo, and every handwriting line.
  let rendered=false;
  // Never re-render an already verified PDF when only its sibling overflows.
  // Both PDF reports are still checked and hash-bound by verify_pdf.py.
  let pendingTargets=targets;
  for(let attempt=0;attempt<4;attempt++){
    await writeHtml();
    const renderArgs=[helper,...pendingTargets.flatMap(t=>[t.htmlPath,t.pdfPath])];
    try{
      await runProcess(process.env.PYTHON_BIN || 'python3',renderArgs,120000,'WeasyPrint PDF failed');
      rendered=true;
      break;
    }catch(error){
      // Only recover demonstrable vertical layout failures. Math/SVG, logo,
      // missing resources, engine version and other errors must still fail.
      const reports=await Promise.all(targets.map(async t=>{
        try{return JSON.parse(await readFile(t.pdfPath+'.layout.json','utf8'));}
        catch{return null;}
      }));
      if(attempt===3 || reports.some(x=>!x))throw error;
      const studentReport=reports[0],teacherReport=reports[1];
      const studentRecovery=lesson.meta.homeworkMode===true
        ? {changed:false,pages:lesson.workbookPages}
        : repackOverflowPages(lesson.workbookPages,studentReport,false);
      const teacherRecovery=repackOverflowPages(lesson.teacherPages,teacherReport,true);
      if(!studentRecovery.changed && !teacherRecovery.changed)throw error;
      lesson.workbookPages=studentRecovery.pages;
      lesson.teacherPages=teacherRecovery.pages;
      pendingTargets=targets.filter((t,i)=>i===0 ? studentRecovery.changed : teacherRecovery.changed);
      preflightPages(lesson.workbookPages,false);
      preflightPages(lesson.teacherPages,true);
      await writeFile(checkedLessonPath,JSON.stringify(lesson),'utf8');
      console.log('Auto-reflow after measured A4 layout error; attempt '+(attempt+1));
    }
  }
  if(!rendered)throw new Error('A4 page packing exhausted');
  for(const t of targets)console.log('Created '+t.pdfPath);
} else if(engine==='chromium'){
  await writeHtml();
  const chromium=findChromium();
  if(!chromium)throw Error('Chromium not found. Set CHROMIUM_PATH.');
  await Promise.all(targets.map(async t=>{
    const args=['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--allow-file-access-from-files','--no-pdf-header-footer','--virtual-time-budget=2000','--print-to-pdf='+resolve(t.pdfPath),pathToFileURL(resolve(t.htmlPath)).href];
    await runProcess(chromium,args,90000,'Chromium printing failed');
  }));
} else throw Error('Unknown engine: '+engine);
if (!process.argv.includes('--html-only')) {
  // Prevent export of a document with overlapping mathematical symbols or
  // cropped A4 content. Always verify PDF geometry automatically before success.
  const check = await runProcess(process.env.PYTHON_BIN || 'python3', [join(root, 'verify_pdf.py'), checkedLessonPath, out, `--basename=${base}`, ...(plain ? ['--plain'] : [])],120000,'Generated PDF failed the mandatory layout check');
  console.log(check.stdout.trim());
}
console.log(`Done. Source: ${lessonPath}. Change lesson JSON for exercises; styles.css controls design.`);
