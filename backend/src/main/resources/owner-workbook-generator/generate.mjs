#!/usr/bin/env node
/**
 * Mindcrafti A4 worksheet generator (no npm dependencies).
 * Input: lesson.json. Output: an editable HTML master and 2 ready-to-print PDFs.
 * Fractions: true vector SVG, not screenshots; safe in Chromium/WeasyPrint.
 * Graphs and fraction diagrams: native vector SVG.
 * PDF: WeasyPrint default, Chromium optional. See README.md for React/KaTeX integration.
 * Usage: node generate.mjs          (creates HTML + PDF)
 *        node generate.mjs --html-only
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { renderDiagram } from './diagrams.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const value = args.find(x => x.startsWith(`--${name}=`));
  return value ? value.slice(name.length + 3) : fallback;
}
const lessonPath = resolve(option('lesson', join(root, 'lesson.sample.json')));
const logoPath = resolve(option('logo', join(root, 'assets', 'logo-m.png')));
const out = resolve(option('out', join(root, 'out')));
const lesson = JSON.parse(await readFile(lessonPath, 'utf8'));
const css = await readFile(join(root, 'styles.css'), 'utf8');
const logo = (await readFile(logoPath)).toString('base64');
if (!lesson.meta || !Array.isArray(lesson.workbookPages) || !Array.isArray(lesson.teacherPages) ||
    lesson.workbookPages.length === 0 || lesson.teacherPages.length === 0 ||
    lesson.workbookPages.length > 35 || lesson.teacherPages.length > 20) {
  throw Error('Invalid lesson: meta, workbookPages and teacherPages are required');
}

const htmlEscape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
function fractionSvg(n, d) {
  // Vector fraction - zooms perfectly on an iPad and in print.
  const cols = Math.max(String(n).length, String(d).length);
  const w = Math.max(31, 15 + cols * 13);
  const mid = w / 2;
  return `<svg class="math-fraction" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 57" width="${w}" height="57" role="img" aria-label="${htmlEscape(n)} durch ${htmlEscape(d)}"><text x="${mid}" y="20" text-anchor="middle" font-size="29" font-family="Arial, Liberation Sans, sans-serif" fill="#070a20">${htmlEscape(n)}</text><line x1="2" y1="28" x2="${w-2}" y2="28" stroke="#070a20" stroke-width="2"/><text x="${mid}" y="53" text-anchor="middle" font-size="29" font-family="Arial, Liberation Sans, sans-serif" fill="#070a20">${htmlEscape(d)}</text></svg>`;
}
function mathToken(token) {
  const t = String(token);
  const fraction = /^(-?\d+|\?)\/(-?\d+|\?)$/.exec(t);
  if (fraction) {
    const [, n, d] = fraction;
    return fractionSvg(n,d);
  }
  if (t === '□') return '<span class="op empty-op" aria-label="Zeichen einsetzen">□</span>';
  if (t === '_____') return '<span class="blank-formula" aria-label="Antwortlinie">________</span>';
  if (['+', '-', '=', '<', '>'].includes(t)) return `<span class="op">${htmlEscape(t)}</span>`;
  return `<span class="op">${htmlEscape(t)}</span>`;
}
function math(tokens) {
  if (!Array.isArray(tokens)) throw new TypeError('An expression must be an array of tokens');
  return `<span class="formula">${tokens.map(mathToken).join('')}</span>`;
}
function callout(b, tall = false) {
  return `<div class="block callout ${tall ? 'tall' : ''}"><div class="eyebrow">${htmlEscape(b.label)}</div><p>${htmlEscape(b.text)}</p></div>`;
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
  return `<div class="block fraction-strips"><div class="example-eyebrow">${htmlEscape(b.label)}</div><div class="fraction-strip-diagram">${strip(b.left)}<span class="strip-relation">${htmlEscape(b.relation)}</span>${strip(b.right)}</div></div>`;
}

function example(b) {
  const formulas = `<div class="example-inner">${b.expressions.map(math).join('')}</div>`;
  if (b.text) {
    return `<div class="block example-split"><div class="callout"><div class="eyebrow">${htmlEscape(b.label)}</div><p>${htmlEscape(b.text)}</p></div><div class="example-box">${formulas}</div></div>`;
  }
  return `<div class="block example-box"><div class="example-eyebrow">${htmlEscape(b.label)}</div>${formulas}</div>`;
}
function studentTaskRow(row) {
  return `<div class="task-row"><span class="item-label">${htmlEscape(row.label)}</span><div class="expression-wrap">${math(row.math)}</div>${row.work ? '<div class="workline"></div>' : ''}</div>`;
}

function factsBlock(b) {
  const box = (title, items = [], accent = '') => {
    const lis = (items || []).map(item => `<li>${htmlEscape(item)}</li>`).join('');
    return `<div class="facts-card ${accent}"><div class="facts-title">${htmlEscape(title)}</div><ul>${lis}</ul></div>`;
  };
  const notes = (b.notes || []).map(x => `<div class="facts-note">${htmlEscape(x)}</div>`).join('');
  return `<section class="block facts-block">${b.label ? `<div class="diagram-eyebrow">${htmlEscape(b.label)}</div>` : ''}<div class="facts-grid">${box(b.givenTitle || 'GEGEBEN', b.given, 'given')}${box(b.findTitle || 'GESUCHT', b.find, 'find')}</div>${notes}</section>`;
}

function exercise(b) {
  const isExit = b.variant === 'exit';
  const isError = b.number === '10';
  const classes = ['block','exercise', b.size ?? '', isExit ? 'exit' : '', isError ? 'error-detective' : ''].join(' ');
  const head = b.title ? `<div class="exercise-head"><div class="exercise-number">${htmlEscape(b.number)}</div><div class="exercise-head-text"><div class="exercise-title">${htmlEscape(b.title)}</div>${b.subtitle ? `<div class="exercise-subtitle">${htmlEscape(b.subtitle)}</div>` : ''}</div></div>` : '';
  const rows = (b.rows ?? []).map(studentTaskRow).join('');
  const lines = b.writeLines ? `<div class="response-lines">${Array.from({length:b.writeLines}, ()=>'<div></div>').join('')}</div>` : '';
  const mini = b.extra ? `<div class="mini-check"><span class="small-pill">${htmlEscape(b.extra.label)}</span>${math(b.extra.math)}</div>` : '';
  const selfRating = b.selfRating ? (() => {
    const [intro,...choices] = b.selfRating.split('□');
    return `<div class="self-rating"><span>${htmlEscape(intro.trim())}</span>${choices.map(t=>`<span class="rating-choice"><i class="rating-check"></i>${htmlEscape(t.trim())}</span>`).join('')}</div>`;
  })() : '';
  return `<div class="${classes}">${head}<div class="exercise-content">${rows}${isError ? '<div class="correction-line"></div>' : ''}${lines}${mini}${selfRating}</div></div>`;
}
function renderWorkbookBlock(b, idx, pageIndex) {
  switch (b.type) {
    case 'callout': return callout(b, pageIndex === 0 && idx === 0);
    case 'strips': return stripes(b);
    case 'graph': case 'geometry': return renderDiagram(b);
    case 'facts': return factsBlock(b);
    case 'example': return example(b);
    case 'exercise': return exercise(b);
    default: throw new TypeError(`Unknown workbook block: ${b.type}`);
  }
}
function teacherBlock(b) {
  switch (b.type) {
    case 'teacherNote': {
      const title = b.title ? `<div class="teacher-section-title">${htmlEscape(b.title)}</div>` : '';
      const text = (b.paragraphs || (b.text ? [b.text] : [])).map(p => `<p class="teacher-paragraph">${htmlEscape(p)}</p>`).join('');
      return `<section class="teacher-block teacher-note"><div class="teacher-section-label">${htmlEscape(b.label)}</div>${title}${text}</section>`;
    }
    case 'schedule':
      return `<section class="teacher-block teacher-schedule"><div class="teacher-section-label">${htmlEscape(b.label)}</div><div class="teacher-section-title">${htmlEscape(b.title)}</div>${b.rows.map(([time,text])=> `<div class="schedule-row"><span class="schedule-time">${htmlEscape(time)}</span><span>${htmlEscape(text)}</span></div>`).join('')}</section>`;
    case 'graph': case 'geometry': return renderDiagram(b);
    case 'facts': return factsBlock(b);
    case 'solutions': {
      const rows = b.items.map(x => `<div class="solution-row"><span class="solution-label">${htmlEscape(x.label)}</span>${x.math ? math(x.math) : `<span class="solution-text">${htmlEscape(x.text)}</span>`}${x.note ? `<span class="solution-note">${htmlEscape(x.note)}</span>` : ''}</div>`).join('');
      return `<section class="teacher-block solution-group"><div class="teacher-section-label">${htmlEscape(b.section)}</div><div class="teacher-section-title">${htmlEscape(b.title)}</div>${rows}${b.footerNote ? `<div class="solution-footnote">${htmlEscape(b.footerNote)}</div>` : ''}</section>`;
    }
    default: throw new TypeError(`Unknown teacher block: ${b.type}`);
  }
}
function pad2(n) { return String(n).padStart(2,'0'); }
function pageChrome({ index, count, title, subtitle, time, teacher }) {
  const meta = lesson.meta;
  const subjectLabel = teacher ? 'LEHRERLÖSUNGEN' : 'ARBEITSHEFT';
  const top = `<div class="brandbar"><img src="data:image/png;base64,${logo}" alt="Original Mindcrafti M logo"><div class="brand-lines"><div class="school-name">${htmlEscape(meta.school)}</div><div class="school-kind">${htmlEscape(meta.subject)} &nbsp;/&nbsp; ${subjectLabel}</div></div></div>`;
  const heading = `<div class="page-heading"><h1>${htmlEscape(title)}</h1><p class="page-subtitle">${htmlEscape(subtitle)}</p></div>`;
  const progress = teacher ? '' : `<div class="progress" style="grid-template-columns:repeat(${Math.max(1,count)},1fr)" aria-hidden="true">${Array.from({length:count}, (_,i) => `<span class="${i === index ? 'current' : i < index ? 'done' : ''}"></span>`).join('')}</div>`;
  const pill = time ? `<div class="time-pill">${htmlEscape(time)}</div>` : '';
  const footer = `<footer class="footer"><span>${htmlEscape(meta.school)} &nbsp;/&nbsp; ${htmlEscape(meta.group)}</span><span class="page-index">${pad2(index+1)} / ${pad2(count)} &nbsp; • &nbsp; ${htmlEscape(meta.date)}</span></footer>`;
  return { top, heading, progress, pill, footer };
}
function workbookPage(p, idx, pages) {
  const c = pageChrome({index: idx, count: pages.length, title:p.title,subtitle:p.subtitle,time:p.time,teacher:false});
  return `<article class="sheet student" data-page="${idx+1}">${c.top}${c.heading}${c.pill}${c.progress}<main class="paper-content">${p.blocks.map((b,i)=>renderWorkbookBlock(b,i,idx)).join('')}</main>${c.footer}</article>`;
}
function teacherPage(p, idx, pages) {
  const c = pageChrome({index:idx,count:pages.length,title:p.title,subtitle:p.subtitle,time:null,teacher:true});
  return `<article class="sheet teacher" data-page="${idx+1}">${c.top}${c.heading}<main class="paper-content">${p.blocks.map(teacherBlock).join('')}</main>${c.footer}</article>`;
}
function doc(body, title) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
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
  for(const p of data.teacherPages)for(const b of p.blocks)if(b.type==='solutions')for(const item of b.items) {
    if(!item.math)continue;
    checkChain(item.math,item.label);
    checked++;
  }
  console.log(`Verified ${checked} mathematical answer chains exactly.`);
}

function blockWeight(block, teacher = false) {
  const type = String(block?.type || '');
  switch (type) {
    case 'callout': return 1.4;
    case 'strips': return 2.3;
    case 'graph': return 5.0;
    case 'geometry': return 4.8;
    case 'facts': return 2.2;
    case 'example': return 2.2;
    case 'exercise': {
      const rows = Array.isArray(block.rows) ? block.rows.length : 0;
      const writeLines = Number(block.writeLines || 0);
      return 1.0 + rows * 0.9 + writeLines * 0.42 + (block.extra ? 0.7 : 0) + (block.selfRating ? 0.55 : 0);
    }
    case 'teacherNote': return 1.2 + (Array.isArray(block.paragraphs) ? block.paragraphs.length * 0.55 : 0.55);
    case 'schedule': return 1.2 + (Array.isArray(block.rows) ? block.rows.length * 0.55 : 0);
    case 'solutions': return 1.3 + (Array.isArray(block.items) ? block.items.length * 0.62 : 0);
    default:
      if (teacher) throw new TypeError('Unknown teacher block in preflight: ' + type);
      throw new TypeError('Unknown workbook block in preflight: ' + type);
  }
}
function preflightPages(pages, teacher = false) {
  const maxUnits = teacher ? 18 : 16;
  const maxBlocks = teacher ? 14 : 10;
  pages.forEach((page, index) => {
    if (!page || !Array.isArray(page.blocks)) throw new TypeError(`Page ${index + 1} must contain blocks[]`);
    if (page.blocks.length > maxBlocks) throw new Error(`Page ${index + 1} has too many blocks for A4 preflight (${page.blocks.length} > ${maxBlocks})`);
    const units = page.blocks.reduce((sum, block) => sum + blockWeight(block, teacher), 0);
    if (units > maxUnits) throw new Error(`Page ${index + 1} is likely to overflow A4 before rendering (layout weight ${units.toFixed(1)} > ${maxUnits})`);
  });
}
function runProcess(command, args, timeoutMs, errorPrefix) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectPromise(new Error(`${errorPrefix} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 12000) stdout = stdout.slice(-12000); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
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
function pdfFromHtml(chromium,source,dest){
  const args=['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--allow-file-access-from-files','--no-pdf-header-footer','--virtual-time-budget=2000',`--print-to-pdf=${resolve(dest)}`,pathToFileURL(resolve(source)).href];
  const run=spawnSync(chromium,args,{encoding:'utf8',timeout:90000,stdio:'pipe'});
  if(run.status!==0)throw Error(`Chromium printing failed: ${run.stderr?.slice(-2500)}`);
  console.log(`Created ${dest}`);
}
await mkdir(out,{recursive:true});
preflightPages(lesson.workbookPages, false);
preflightPages(lesson.teacherPages, true);
checkAnswerMath(lesson);
const dateKey = String(lesson.meta.date || 'undated').replace(/[^0-9]/g,'') || 'undated';
const groupKey = String(lesson.meta.group || 'Gruppe').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,50) || 'Gruppe';
const base = basename(option('basename', `Mindcrafti_${groupKey}_${dateKey}`))
  .replace(/[^A-Za-z0-9_-]/g,'_').slice(0,90);
const durationMinutes = Number(lesson.meta.durationMinutes);
if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 240) throw Error('Invalid meta.durationMinutes');
const targets=[
  {key:`Arbeitsheft_${durationMinutes}min`,html:doc(lesson.workbookPages.map((p,i)=>workbookPage(p,i,lesson.workbookPages)).join(''),'Mindcrafti / Gruppe 1 / Arbeitsheft')},
  {key:`Lehrerloesungen_${durationMinutes}min`,html:doc(lesson.teacherPages.map((p,i)=>teacherPage(p,i,lesson.teacherPages)).join(''),'Mindcrafti / Gruppe 1 / Lehrerloesungen')},
];
for(const target of targets){target.htmlPath=join(out,`${base}_${target.key}.html`);target.pdfPath=join(out,`${base}_${target.key}.pdf`);await writeFile(target.htmlPath,target.html,'utf8');}
const engineArg = process.argv.find(v => v.startsWith('--engine='));
const engine = engineArg ? engineArg.slice('--engine='.length) : 'weasyprint';
if(process.argv.includes('--html-only')) {
  console.log('HTML only mode: ready to preview in any modern browser.');
} else if(engine === 'weasyprint') {
  const helper = join(root,'render_pdf.py');
  const renderArgs = [helper, ...targets.flatMap(t => [t.htmlPath, t.pdfPath])];
  await runProcess('python3',renderArgs,120000,'WeasyPrint PDF failed');
  for (const t of targets) console.log('Created '+t.pdfPath);
} else if(engine === 'chromium') {
  const chromium=findChromium();
  if(!chromium)throw Error('Chromium not found. Set CHROMIUM_PATH.');
  await Promise.all(targets.map(async target => {
    const args=['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--allow-file-access-from-files','--no-pdf-header-footer','--virtual-time-budget=2000',`--print-to-pdf=${resolve(target.pdfPath)}`,pathToFileURL(resolve(target.htmlPath)).href];
    await runProcess(chromium,args,90000,'Chromium printing failed');
    console.log('Created '+target.pdfPath);
  }));
} else throw Error('Unknown engine: '+engine);
if (!process.argv.includes('--html-only')) {
  // Prevent export of a document with overlapping mathematical symbols or
  // cropped A4 content. Always verify PDF geometry automatically before success.
  const check = spawnSync('python3', [join(root, 'verify_pdf.py'), lessonPath, out, `--basename=${base}`], {
    encoding: 'utf8', timeout: 120000, stdio: 'pipe',
  });
  if (check.status !== 0) {
    throw new Error('Generated PDF failed the mandatory layout check: ' + (check.stderr || check.stdout).slice(-3500));
  }
  console.log(check.stdout.trim());
}
console.log(`Done. Source: ${lessonPath}. Change lesson JSON for exercises; styles.css controls design.`);
