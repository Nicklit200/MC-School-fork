import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,readdir,rm,copyFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=dirname(fileURLToPath(import.meta.url));
const python=process.env.PYTHON_BIN || 'python3';
const example=join(root,'examples','plain-tasks-demo.json');
async function workspace(action) {
  const parent=join(root,'out');
  await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(join(parent,'plain-test-'));
  try { await action(directory); }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(parent)+sep),'Cleanup stays inside renderer test output');
    await rm(directory,{recursive:true,force:true});
  }
}
function generate(input,output,options=[]) {
  return spawnSync(process.execPath,[join(root,'generate.mjs'),`--lesson=${input}`,`--out=${output}`,
    '--basename=Kolin_Plain','--plain',`--logo=${join(output,'MISSING-LOGO.png')}`,...options],
    {encoding:'utf8',timeout:115000,env:process.env});
}

test('Kolin diagrams render with checked references, all pages and no answer leakage',async()=>workspace(async directory=>{
  const source=join(root,'examples','kolin-visual-tasks.json');
  const rendered=generate(source,directory);
  assert.equal(rendered.status,0,rendered.stderr || rendered.stdout || rendered.error?.message);
  const qa=JSON.parse(await readFile(join(directory,'Kolin_Plain_math-qa.json'),'utf8'));
  assert.equal(qa.passed,true);assert.equal(qa.checked,5);assert.equal(qa.visualChecked,5);
  assert.deepEqual(qa.results.map(r=>r.answer),['x ≈ -2; x ≈ 2','≈ 24 cm²','≈ 113.097336 cm³','1/2','f(x) = x^2 - 4']);
  const layout=JSON.parse(await readFile(join(directory,'Kolin_Plain_layout-qa.json'),'utf8'));
  assert.equal(layout.passed,true);assert.equal(layout.documents[0].pageCount,3);
  const html=await readFile(join(directory,'Kolin_Plain_Arbeitsheft_30min.html'),'utf8');
  assert.equal((html.match(/class="block task-card"/g)||[]).length,5);
  assert.match(html,/fraction-sector selected/);assert.match(html,/cylinder/);
  assert.doesNotMatch(html,/Private automated answer|113\.097336|≈ 24|<footer|<img|data-mjx-error/);
  const artifacts=process.env.PLAIN_WORKSHEET_ARTIFACT_DIR;
  if(artifacts){await mkdir(artifacts+'-visuals',{recursive:true});for(const name of await readdir(directory))if(/\.(pdf|png|json|html)$/.test(name))await copyFile(join(directory,name),join(artifacts+'-visuals',name));}
}));

test('plain PDF keeps five conditions, domains and vector math without branding or answers',async()=>workspace(async directory=>{
  const result=generate(example,directory);
  assert.equal(result.status,0,result.stderr || result.stdout || result.error?.message);
  const student=join(directory,'Kolin_Plain_Arbeitsheft_60min.pdf');
  const preview=join(directory,'Kolin_Plain_preview.png');
  const html=await readFile(join(directory,'Kolin_Plain_Arbeitsheft_60min.html'),'utf8');
  assert.equal((html.match(/class="task-row"/g)||[]).length,5);
  assert.match(html,/Вычисли\./);
  assert.match(html,/x != 3/);
  assert.match(html,/class="sheet student plain"/);
  assert.doesNotMatch(html,/<footer|<div class="brandbar">|PRIVATE ANSWERS|<img/);
  assert.doesNotMatch(html,/data-mml-node="merror"|data-mjx-error/);
  const math=JSON.parse(await readFile(join(directory,'Kolin_Plain_math-qa.json'),'utf8'));
  const layout=JSON.parse(await readFile(join(directory,'Kolin_Plain_layout-qa.json'),'utf8'));
  assert.equal(math.checked,5);
  assert.equal(math.passed,true);
  assert.equal(layout.passed,true);
  assert.equal(layout.documents[0].pageCount,1);
  const inspect=spawnSync(python,['-c',[
    'import sys,fitz',
    'pdf=fitz.open(sys.argv[1]); assert len(pdf)==1',
    'page=pdf[0]; text=page.get_text()',
    'assert "PRIVATE ANSWERS" not in text and "MINDCRAFTI SCHOOL" not in text',
    'assert "x != 3" in text and not page.get_images()',
    'assert abs(page.rect.height-841.89)<0.6',
    'assert max(b[3] for b in page.get_text("blocks"))<450, "A4 retains ample handwriting space"',
    'image=fitz.Pixmap(sys.argv[2]); assert max(image.width,image.height)<=802',
    'assert image.height<image.width, "Preview crops blank solving space rather than shrinking the full A4"',
  ].join('; '),student,preview],{encoding:'utf8',timeout:10000,env:process.env});
  assert.equal(inspect.status,0,inspect.stderr || inspect.stdout || inspect.error?.message);
  const artifacts=process.env.PLAIN_WORKSHEET_ARTIFACT_DIR;
  if(artifacts) {
    await mkdir(artifacts,{recursive:true});
    for(const name of await readdir(directory)) if(/\.(pdf|png|json|html)$/.test(name))
      await copyFile(join(directory,name),join(artifacts,name));
  }
}));

test('a wrong visible task assertion stops generation before any PDF or preview exists',async()=>workspace(async directory=>{
  const lesson=JSON.parse(await readFile(example,'utf8'));
  lesson.qa.algebra[0].answer='1/4';
  const source=join(directory,'invalid.json');
  await writeFile(source,JSON.stringify(lesson));
  const result=generate(source,directory,['--html-only']);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Algebra QA failed/);
  assert.ok(!(await readdir(directory)).some(name=>/\.(pdf|png)$/.test(name)));
}));

test('derived reference answers come from the unchanged visible expressions in assertion order',async()=>workspace(async directory=>{
  const source=join(root,'examples','kolin-five-fractions.json');
  const result=generate(source,directory);
  assert.equal(result.status,0,result.stderr || result.stdout || result.error?.message);
  const qa=JSON.parse(await readFile(join(directory,'Kolin_Plain_math-qa.json'),'utf8'));
  assert.equal(qa.passed,true);
  assert.deepEqual(qa.results.map(item=>[item.index,item.answer]),
    [[0,'11/12'],[1,'7/6'],[2,'31/35'],[3,'31/36'],[4,'25/24']]);
  const layout=JSON.parse(await readFile(join(directory,'Kolin_Plain_layout-qa.json'),'utf8'));
  assert.equal(layout.passed,true);
  assert.equal(layout.documents[0].pageCount,1);
  const html=await readFile(join(directory,'Kolin_Plain_Arbeitsheft_30min.html'),'utf8');
  assert.equal((html.match(/class="task-row"/g)||[]).length,5);
  assert.match(html,/Вычислите сумму дробей/);
  assert.doesNotMatch(html,/Private automated answer validation|11\/12|<footer|<div class="brandbar">|<img/);
  const preview=await readFile(join(directory,'Kolin_Plain_preview.png'));
  assert.ok(preview.length>0 && preview.length<3*1024*1024);
  const artifacts=process.env.PLAIN_WORKSHEET_ARTIFACT_DIR;
  if(artifacts) {
    const derived=artifacts+'-derived';
    await mkdir(derived,{recursive:true});
    for(const name of await readdir(directory)) if(/\.(pdf|png|json|html)$/.test(name))
      await copyFile(join(directory,name),join(derived,name));
  }
}));

test('a real fraction worksheet with generated TeX division passes math and PDF QA',async()=>workspace(async directory=>{
  const source=join(root,'examples','kolin-fraction-division.json');
  const result=generate(source,directory);
  assert.equal(result.status,0,result.stderr || result.stdout || result.error?.message);
  const qa=JSON.parse(await readFile(join(directory,'Kolin_Plain_math-qa.json'),'utf8'));
  assert.equal(qa.passed,true);
  assert.equal(qa.checked,5);
  assert.deepEqual(qa.results.map(item=>item.answer),['23/20','13/24','5/8','4','5/8']);
  const layout=JSON.parse(await readFile(join(directory,'Kolin_Plain_layout-qa.json'),'utf8'));
  assert.equal(layout.passed,true);
  assert.equal(layout.documents[0].pageCount,1);
  const html=await readFile(join(directory,'Kolin_Plain_Arbeitsheft_30min.html'),'utf8');
  assert.equal((html.match(/class="task-row"/g)||[]).length,5);
  assert.match(html,/Вычислить частное дробей/);
  assert.doesNotMatch(html,/data-mml-node="merror"|data-mjx-error|Private automated answer validation|<footer|<div class="brandbar">|<img/);
  assert.ok((await readFile(join(directory,'Kolin_Plain_preview.png'))).length>0);
  const artifacts=process.env.PLAIN_WORKSHEET_ARTIFACT_DIR;
  if(artifacts) {
    const division=artifacts+'-division';
    await mkdir(division,{recursive:true});
    for(const name of await readdir(directory)) if(/\.(pdf|png|json|html)$/.test(name))
      await copyFile(join(directory,name),join(division,name));
  }
}));


test('Kolyn text problems render as real German stories without exposing their private arithmetic',async()=>workspace(async directory=>{
  const source=join(root,'examples','kolin-word-problems.json');
  const run=generate(source,directory);
  assert.equal(run.status,0,run.stderr || run.stdout || run.error?.message);
  const math=JSON.parse(await readFile(join(directory,'Kolin_Plain_math-qa.json'),'utf8'));
  assert.equal(math.passed,true);
  assert.equal(math.checked,2);
  assert.deepEqual(math.results.map(item=>item.answer),['12','90']);
  const layout=JSON.parse(await readFile(join(directory,'Kolin_Plain_layout-qa.json'),'utf8'));
  assert.equal(layout.passed,true);
  assert.equal(layout.documents[0].pageCount,1);
  const html=await readFile(join(directory,'Kolin_Plain_Arbeitsheft_30min.html'),'utf8');
  assert.match(html,/Lena kauft 3 Hefte/);
  assert.match(html,/Ein Fahrrad kostet 120 Euro/);
  assert.match(html,/Wie viel kostet es nach dem Rabatt/);
  assert.equal((html.match(/class="block exercise\b/g)||[]).length,2);
  assert.doesNotMatch(html,/3\*4|120\*\(100-25\)\/100|Private automated answer validation|data-mjx-error/);
  assert.ok((await readFile(join(directory,'Kolin_Plain_preview.png'))).length>0);
}));
