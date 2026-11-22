import test from 'node:test';
import assert from 'node:assert/strict';
import {handwritingHeightMm,blockHeightMm,autoPaginatePages,preflightPages,repackOverflowPages} from './pagination.mjs';

const task=(n,id)=>({type:'exercise',number:id,title:'Temperatur',subtitle:'Schreibe eine Rechnung mit Zwischenschritt und Antwortsatz.',writeLines:n});

test('real CSS work line height is not underestimated',()=>{
  assert.equal(handwritingHeightMm(12), 4+12*2.4+11*7.2+1);
  assert(blockHeightMm(task(12,'01'))>115);
});

test('two long Sachaufgaben are split before render without shrinking spaces',()=>{
  const original={title:'Textaufgaben',blocks:[task(12,'01'),task(12,'02')]};
  const pages=autoPaginatePages([original]);
  assert.equal(pages.length,2);
  assert.equal(pages[0].blocks[0].writeLines,12);
  assert.equal(pages[1].blocks[0].writeLines,12);
  assert.equal(original.blocks.length,2);
  assert.doesNotThrow(()=>preflightPages(pages));
});

test('four short tasks preserve order and fit',()=>{
  const tasks=[1,2,3,4].map(i=>task(5,String(i)));
  const pages=autoPaginatePages([{title:'Kurz',blocks:tasks}]);
  assert.deepEqual(pages.flatMap(p=>p.blocks.map(b=>b.number)),['1','2','3','4']);
  assert(pages.every(p=>p.blocks.length>0));
});

test('rendered footer overlap triggers automatic repack inside same job',()=>{
  const p={blocks:[task(10,'1'),task(10,'2'),task(10,'3')]};
  const repair=repackOverflowPages([p],{issues:['Page 1: content overlaps footer'],pageCount:1});
  assert.equal(repair.changed,true);
  assert.equal(repair.pages.length,2);
  assert.deepEqual(repair.pages.flatMap(p=>p.blocks.map(b=>b.number)),['1','2','3']);
});

test('horizontal SVG errors cannot be hidden by repacking',()=>{
  const pages=[{blocks:[task(10,'1'),task(10,'2')]}];
  const repair=repackOverflowPages(pages,{issues:['Page 1: text or SVG exceeds its block'],pageCount:1});
  assert.equal(repair.changed,false);
});

test('single oversized task never silently loses required answer space',()=>{
  const pages=[{blocks:[task(12,'1')]}];
  const repair=repackOverflowPages(pages,{issues:['Page 1: task overlaps footer'],pageCount:1});
  assert.equal(repair.changed,false);
});

test('teacher solutions are repacked if measured PDF overflows',()=>{
  const item={type:'solutions',title:'Lösungen',items:Array.from({length:10},(_,i)=>({label:String(i+1),math:'1=1'}))};
  const pages=autoPaginatePages([{blocks:[item,item]}],true);
  assert.equal(pages.length,2);
});

test('graph always stays with exercise 04 in same A4 unit',()=>{
  const graph={type:'graph',xRange:[-5,5],yRange:[-6,7],series:[{kind:'linear',m:2,b:-1}]};
  const page={title:'Lineare Funktionen',blocks:[graph,task(3,'04'),task(8,'05')]};
  const pages=autoPaginatePages([page]);
  assert(pages.length>=2);
  const graphPage=pages.findIndex(p=>p.blocks.some(b=>b.type==='graph'));
  const exercisePage=pages.findIndex(p=>p.blocks.some(b=>b.type==='exercise' && b.number==='04'));
  assert.equal(graphPage,exercisePage,'task 04 must be directly below its graph');
  assert.equal(pages[graphPage].blocks[0].type,'graph');
  assert.equal(pages[graphPage].blocks[1].number,'04');
});

test('short description between graph and first exercise stays together',()=>{
  const graph={type:'coordinateGrid'};
  const desc={type:'text',text:'Zeichne die zwei Geraden.'};
  const pages=autoPaginatePages([{blocks:[graph,desc,task(3,'04'),task(8,'05')]}]);
  assert.deepEqual(pages[0].blocks.slice(0,3).map(b=>b.type),['coordinateGrid','text','exercise']);
  assert.equal(pages[0].blocks[2].number,'04');
});

test('measured repack never separates graph from its first task',()=>{
  const graph={type:'graph'};
  const pages=[{blocks:[graph,task(4,'04'),task(10,'05')]}];
  const repair=repackOverflowPages(pages,{issues:['Page 1: content overlaps footer'],pageCount:1});
  assert.equal(repair.changed,true);
  assert.equal(repair.pages[0].blocks[0].type,'graph');
  assert.equal(repair.pages[0].blocks[1].number,'04');
  assert.equal(repair.pages[1].blocks[0].number,'05');
});

test('oversized visual-task pair fails instead of silently detaching exercise',()=>{
  const graph={type:'graph'};
  assert.throws(()=>autoPaginatePages([{blocks:[graph,task(12,'04')]}]),/diagram and its next task exceed one A4 page/);
});


test('two standard Sachaufgaben from separate logical pages use the same A4',()=>{
  const p1={title:'NOVEMBER · Ganze Zahlen',subtitle:'Klasse 6',blocks:[task(5,'01')]};
  const p2={title:'NOVEMBER · Ganze Zahlen',subtitle:'Klasse 6',blocks:[task(5,'02')]};
  const packed=autoPaginatePages([p1,p2]);
  assert.equal(packed.length,1);
  assert.deepEqual(packed[0].blocks.map(b=>b.number),['01','02']);
  assert.equal(packed[0].blocks[0].writeLines,5);
  assert.equal(packed[0].blocks[1].writeLines,5);
  assert.doesNotThrow(()=>preflightPages(packed));
});

test('no more than two independent ordinary tasks per A4',()=>{
  const input=[{title:'Same topic',blocks:[task(4,'01'),task(4,'02'),task(4,'03'),task(4,'04')]}];
  const pages=autoPaginatePages(input);
  assert.equal(pages.length,2);
  assert.deepEqual(pages.map(p=>p.blocks.map(b=>b.number)),[['01','02'],['03','04']]);
});

test('chapter and month headings are not merged across section boundaries',()=>{
  const pages=autoPaginatePages([
    {title:'November',blocks:[task(4,'01')]},
    {title:'Dezember',blocks:[task(4,'02')]}
  ]);
  assert.equal(pages.length,2);
  assert.deepEqual(pages.map(p=>p.title),['November','Dezember']);
});

test('graph, geometry and visual tasks reserve their own page',()=>{
  const cases=[
    {type:'graph',series:[{kind:'linear',m:2,b:-1}]},
    {type:'coordinateGrid'},
    {type:'geometry',figure:'triangle'},
    {type:'visualTask',figure:'coordinateGrid'}
  ];
  for(const visual of cases){
    const p={title:'Visuelle Aufgaben',blocks:[task(4,'01'),visual,task(4,'02'),task(4,'03')]};
    const pages=autoPaginatePages([p]);
    const index=pages.findIndex(x=>x.blocks.some(b=>b.type===visual.type));
    assert(index>=0);
    assert.equal(pages[index].blocks.filter(b=>b.type==='exercise').length,1);
    assert.equal(pages[index].blocks.find(b=>b.type==='exercise').number,'02');
    assert.notEqual(pages.findIndex(x=>x.blocks.some(b=>b.number==='01')),index);
    assert.notEqual(pages.findIndex(x=>x.blocks.some(b=>b.number==='03')),index);
  }
});

test('oversized pair retains original answer area and splits',()=>{
  const p={title:'Sachaufgaben',blocks:[task(8,'01'),task(8,'02')]};
  const pages=autoPaginatePages([p]);
  assert.equal(pages.length,2);
  assert.equal(pages[0].blocks[0].writeLines,8);
  assert.equal(pages[1].blocks[0].writeLines,8);
});
