import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateLesson,normalizeLessonMath,columns,length} from './schema.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const rich={type:'richText',content:[{text:'Prüfe '},{math:'x+1=2'},{text:'.'}]};
const basic=()=>({meta:{school:'MINDCRAFTI SCHOOL',subject:'MATHEMATIK',group:'Test',date:'05.11.2026',durationMinutes:60},workbookPages:[{title:'Test',blocks:[]}],teacherPages:[{title:'Antworten',blocks:[]}]});


test('ChatGPT plain math strings normalize without touching solutions or algebra assertions', async()=>{
  const lesson=basic();
  lesson.workbookPages[0].blocks=[{type:'exercise',number:'1',title:'Berechne.',rows:[
    {label:'a)',math:'\\frac{1}{2}+\\frac{1}{3}',work:true}
  ],writeLines:8}];
  lesson.teacherPages[0].blocks=[{type:'solutions',title:'Antworten',items:[
    {label:'1a',math:'\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}'}
  ]}];
  lesson.qa={algebra:[{kind:'equivalence',expression:'1/2+1/3',answer:'5/6',restrictions:[]}]};
  const source=JSON.stringify(lesson.qa);
  normalizeLessonMath(lesson);
  assert.deepEqual(lesson.workbookPages[0].blocks[0].rows[0].math,{latex:'\\frac{1}{2}+\\frac{1}{3}'});
  assert.deepEqual(lesson.teacherPages[0].blocks[0].items[0].math,{latex:'\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}'});
  assert.equal(JSON.stringify(lesson.qa),source,'normalization never edits math QA proofs');
  const {workbook,teacher}=await render(lesson);
  assert.match(workbook,/class="[^"]*math-latex/);
  assert.match(teacher,/class="[^"]*math-latex/);
});

test('ChatGPT math normalization does not bypass strict formula safety or invalid math QA', async()=>{
  const lesson=basic();
  lesson.workbookPages[0].blocks=[{type:'exercise',number:'1',rows:[
    {label:'a)',math:'\\href{https://invalid.example}{x}',work:true}
  ],writeLines:8}];
  assert.throws(()=>normalizeLessonMath(lesson),/Unsafe or unsupported TeX/);
  const wrong=basic();
  wrong.workbookPages[0].blocks=[{type:'exercise',number:'1',rows:[{label:'a)',math:'1+1',work:true}],writeLines:8}];
  wrong.teacherPages[0].blocks=[{type:'solutions',items:[{label:'1a',math:'1+1=3'}]}];
  wrong.qa={algebra:[{kind:'equivalence',expression:'1+1',answer:'3',restrictions:[]}]};
  await assert.rejects(()=>render(wrong),/Algebra QA failed|Incorrect math/);
});

test('bounded layout schema rejects unsafe CSS and ambiguous math',()=>{
  assert.equal(columns(['42%','58%']),'42fr 58fr');
  assert.throws(()=>columns(['60%','60%']),/total/);
  assert.throws(()=>length('1mm; background:url(https://example.com)'),/Invalid/);
  const lesson=basic();
  lesson.workbookPages[0].blocks=[{type:'grid',columns:999,children:[]}];
  assert.throws(()=>validateLesson(lesson),/integer/);
  lesson.workbookPages[0].blocks=[{type:'math',expression:{latex:'x',tokens:['x']}}];
  assert.throws(()=>validateLesson(lesson),/exactly one/);
});

async function render(source, options=[]) {
  await mkdir(join(root,'out'),{recursive:true});
  const dir=await mkdtemp(join(root,'out','layout-test-'));
  try {
    const lesson=typeof source==='string' ? source : join(dir,'lesson.json');
    if(typeof source!=='string')await writeFile(lesson,JSON.stringify(source));
    const run=spawnSync(process.execPath,[join(root,'generate.mjs'),`--lesson=${lesson}`,`--out=${dir}`,'--basename=Test','--html-only',...options],{encoding:'utf8',timeout:60000,env:process.env});
    assert.equal(run.status,0,run.stderr || run.stdout || run.error?.message);
    const files=await readdir(dir);
    const workbook=await readFile(join(dir,files.find(f=>/_Arbeitsheft_\d+min\.html$/.test(f))),'utf8');
    const teacher=await readFile(join(dir,files.find(f=>/_Lehrerloesungen_\d+min\.html$/.test(f))),'utf8');
    const qa=JSON.parse(await readFile(join(dir,'Test_math-qa.json'),'utf8'));
    assert.equal(qa.passed,true);
    return {workbook,teacher};
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
}

test('nested layouts and rich text render through the production pipeline',async()=>{
  const lesson=basic();
  lesson.workbookPages[0].subtitle=rich;
  lesson.workbookPages[0].blocks=[
    {type:'studentHeader'},
    {type:'split',columns:['42%','58%'],gap:'6mm',left:[{type:'taskCard',title:'Aufgabe',description:rich,children:[{type:'answerLines',lines:2,label:rich}]}],right:[{type:'coordinateGrid',xRange:[-5,5],yRange:[-5,5],gridStep:1,showAxisLabels:true}]},
    {type:'grid',columns:2,children:[{type:'answerBox',height:'18mm',label:rich},{type:'column',children:[{type:'callout',text:rich},{type:'spacer',height:'2mm'},{type:'divider'}]}]},
    {type:'row',children:[{type:'text',text:rich},{type:'stack',children:[{type:'richText',content:rich.content}]}]},
    {type:'matching',left:[rich,'B'],right:['C',rich],matches:[[0,1]],showConnections:true},
    {type:'conclusionBox',text:rich,lines:2},
    {type:'facts',given:[rich],find:[rich],notes:[rich]},
    {type:'example',label:rich,text:rich,expressions:[{latex:'x^2'}]}
  ];
  // Exercise every component without putting an entire component catalog on
  // one A4 page. The fast preflight also applies to HTML-only previews.
  lesson.workbookPages.push({title:'Weitere Aufgaben',blocks:lesson.workbookPages[0].blocks.splice(5)});
  lesson.teacherPages[0].blocks=[{type:'solutions',title:rich,items:[{label:rich,text:rich,note:rich}]},{type:'matching',left:['A'],right:['B'],matches:[[0,0]],showConnections:true}];
  const {workbook,teacher}=await render(lesson);
  assert.match(workbook,/grid-template-columns:42fr 58fr;gap:6mm/);
  assert.match(workbook,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  for(const cls of ['student-header','answer-lines','answer-box','matching','conclusion-box','layout-stack','inline-math'])assert.ok(new RegExp(`class="[^"]*\\b${cls}\\b`).test(workbook),cls);
  assert.equal((workbook.match(/class="matching-item"/g)||[]).length,4);
  assert.equal((workbook.match(/<line x1="0" y1="7" x2="100" y2="21"/g)||[]).length,0,'student matching never displays answer connections');
  assert.match(teacher,/<line x1="0" y1="7" x2="100" y2="7"/);
  assert.ok((workbook.match(/data-qa="math"/g)||[]).length>=10,'inline math in all supported text fields');
  assert.match(teacher,/inline-math/);
});

test('crowded top-level workbook content is repaginated instead of rejected',async()=>{
  const lesson=basic();
  lesson.workbookPages[0].blocks=Array.from({length:12},(_,index)=>({
    type:'callout',label:'SCHRITT '+(index+1),text:'Kurze Erklärung für diese Aufgabe.'
  }));
  const {workbook}=await render(lesson);
  assert.equal((workbook.match(/class="sheet student"/g)||[]).length,2);
  assert.match(workbook,/SCHRITT 1/);
  assert.match(workbook,/SCHRITT 12/);
});

test('preflight counts parallel columns by maximum and stacked rows by sum',async()=>{
  const graph=()=>({type:'coordinateGrid',xRange:[-5,5],yRange:[-5,5]});
  for(const block of [
    {type:'row',children:Array.from({length:4},graph)},
    {type:'grid',columns:2,children:Array.from({length:4},graph)},
    {type:'split',left:[graph(),graph()],right:[graph(),graph()]}
  ]) {
    const lesson=basic();lesson.workbookPages[0].blocks=[block];
    await render(lesson);
  }
  const lesson=basic();
  lesson.workbookPages[0].blocks=[{type:'stack',children:Array.from({length:4},graph)}];
  await assert.rejects(()=>render(lesson),/(?:likely to overflow A4|one block too large for A4)/);
  lesson.workbookPages[0].blocks=Array.from({length:20},()=>({type:'divider'}));
  await render(lesson);
});

test('legacy v3 lessons and corrected MathJax example still render',async()=>{
  for(const filename of ['lesson.sample.json','examples/graphs-geometry-demo.json','examples/clean-tasks-demo.json','examples/latex-math-demo.json','examples/production-layout-demo.json']) {
    const {workbook,teacher}=await render(join(root,filename));
    assert.match(workbook,/class="sheet student"/);
    assert.match(teacher,/class="sheet teacher"/);
    assert.doesNotMatch(workbook,/data-mml-node="merror"/);
  }
});


test('Sonja two-point equations keep long MathJax expressions in isolated cells',async()=>{
  const lesson=basic();
  lesson.workbookPages[0].blocks=[
    {type:'example',label:'BEISPIEL: SCHRITT FÜR SCHRITT',expressions:[
      {latex:'A(0\\mid 1),\\ B(2\\mid 5)'},
      {latex:'m=\\frac{5-1}{2-0}=2,\\quad t=1'},
      {latex:'y=2x+1'}
    ]},
    {type:'exercise',number:'04',title:'Bestimme m, t und die Funktionsgleichung.',rows:[
      {label:'a.',math:{latex:'A(-2\\mid 5),\\quad B(2\\mid -3)'},work:true},
      {label:'b.',math:{latex:'A(-1\\mid 0),\\quad B(3\\mid 8)'},work:true}
    ],writeLines:3}
  ];
  const {workbook}=await render(lesson);
  assert.equal((workbook.match(/class="example-math-item"/g)||[]).length,3);
  assert.equal((workbook.match(/class="task-row"/g)||[]).length,2);
  assert.equal((workbook.match(/class="workline"/g)||[]).length,2);
  assert.match(workbook,/expression-wrap/);
  assert.doesNotMatch(workbook,/data-mml-node="merror"/);
});
