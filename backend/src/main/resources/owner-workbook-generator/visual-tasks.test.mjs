import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVisual,prepareVisualTasks,mergeVisualQa} from './visual-tasks.mjs';
import {geometrySvg} from './diagrams.mjs';
const graph=(kind,parameters,objective='value',extra={})=>({type:'graph',language:'ru',objective,series:[{kind,parameters,denominator:[]}],at:2,xRange:[-5,5],yRange:[-5,15],...extra});
const geo=(figure,objective,parameters=[],vertices=[],index=0)=>({type:'geometry',language:'de',figure,objective,parameters,vertices,index});
const tri=[[0,0],[6,0],[0,8]], rect=[[0,0],[8,0],[8,4],[0,4]];

test('all declared graph families use the existing evaluator and canonical conditions',()=>{
  for(const [kind,p,at,answer] of [
    ['constant',[3],2,3],['linear',[2,1],2,5],['quadratic',[1,0,-4],2,0],['polynomial',[1,2,1],2,9],
    ['sine',[2,1,0,0],0,0],['cosine',[2,1,0,0],0,2],['absolute',[2,1,-1],2,1],['reciprocal',[4,1,0],2,4],
    ['sqrt',[2,1,0],2,2],['exponential',[2,0,0,2],2,8],['logarithmic',[2,0,0,2],2,2]]) {
    const r=compileVisual(graph(kind,p,'value',{at}));
    assert.equal(r.answer,`f(${at}) ≈ ${answer}`);assert.equal(r.blocks[1].type,'graph');
  }
  assert.equal(compileVisual(graph('rational',[1],'value',{series:[{kind:'rational',parameters:[1],denominator:[0,1]}]})).answer,'f(2) ≈ 0.5');
});
test('zeros, intersections and construction keep solutions out of pupil diagrams',()=>{
  const z=compileVisual(graph('quadratic',[1,0,-4],'zeros'));
  assert.equal(z.answer,'x ≈ -2; x ≈ 2');assert.equal(z.blocks[1].showIntersections,undefined);
  const cross=compileVisual(graph('linear',[2,-1],'intersections',{series:[{kind:'linear',parameters:[2,-1],denominator:[]},{kind:'linear',parameters:[-1,5],denominator:[]}]}));
  assert.equal(cross.answer,'(2; 3)');
  const draw=compileVisual(graph('quadratic',[1,0,-4],'draw'));
  assert.equal(draw.blocks[2].type,'coordinateGrid');assert.equal(draw.blocks[2].series,undefined);
  assert.match(draw.blocks[1].text,/x\^2 - 4/);
});
test('coordinate geometry and solids have independently known reference results',()=>{
  for(const [spec,answer] of [
    [geo('triangle','area',[],tri),'≈ 24 cm²'],[geo('triangle','perimeter',[],tri),'≈ 24 cm'],
    [geo('triangle','side',[],tri,1),'≈ 10 cm'],[geo('triangle','angle',[],tri,0),'≈ 90 °'],
    [geo('rectangle','area',[],rect),'≈ 32 cm²'],[geo('rectangle','perimeter',[],rect),'≈ 24 cm'],
    [geo('quadrilateral','area',[],[[0,0],[6,0],[4,4],[0,4]]),'≈ 20 cm²'],
    // Bottom trapezoid area 10 plus roof triangle area 9.
    [geo('polygon','area',[],[[0,0],[4,0],[5,2],[2,5],[-1,2]]),'≈ 19 cm²'],
    [geo('circle','area',[3]),'≈ 28.274334 cm²'],[geo('circle','perimeter',[3]),'≈ 18.849556 cm'],
    [geo('cube','volume',[4]),'≈ 64 cm³'],[geo('cube','surface',[4]),'≈ 96 cm²'],
    [geo('cuboid','volume',[3,4,5]),'≈ 60 cm³'],[geo('cuboid','surface',[3,4,5]),'≈ 94 cm²'],
    [geo('cylinder','volume',[3,4]),'≈ 113.097336 cm³'],[geo('cylinder','surface',[3,4]),'≈ 131.946891 cm²'],
    [geo('cone','volume',[3,4]),'≈ 37.699112 cm³'],[geo('cone','surface',[3,4]),'≈ 75.398224 cm²'],
    [geo('sphere','volume',[3]),'≈ 113.097336 cm³'],[geo('sphere','surface',[3]),'≈ 113.097336 cm²']]) {
    assert.equal(compileVisual(spec).answer,answer,`${spec.figure}/${spec.objective}`);
  }
});
test('pizza sectors count and reduce correctly including empty and whole circles',()=>{
  for(const [selected,answer] of [[0,'0/1'],[6,'1/2'],[12,'1/1']]) {
    const r=compileVisual({type:'fractionCircle',language:'ru',parts:12,selected});
    assert.equal(r.answer,answer);
    const svg=geometrySvg(r.blocks[1]);
    assert.equal((svg.match(/class="fraction-sector/g)||[]).length,12);
    assert.equal((svg.match(/fraction-sector selected/g)||[]).length,selected);
    assert.ok(!JSON.stringify(r.blocks).includes(answer));
  }
});

test('visual tasks accept minimal ChatGPT graph and geometry specs without irrelevant optional fields',()=>{
  const draw=compileVisual({type:'graph',language:'de',objective:'draw',
    series:[{kind:'linear',parameters:[2,1]}],xRange:[-5,5],yRange:[-5,5]});
  assert.equal(draw.blocks[2].type,'coordinateGrid');
  assert.ok(!JSON.stringify(draw.blocks).includes('polyline'));
  assert.equal(draw.teacherDiagram.type,'graph');
  const tri=compileVisual({type:'geometry',language:'de',figure:'triangle',objective:'area',
    vertices:[[0,0],[6,0],[0,8]]});
  assert.equal(tri.answer,'≈ 24 cm²');
  assert.equal(tri.teacherDiagram.type,'geometry');
  const circle=compileVisual({type:'geometry',language:'de',figure:'circle',objective:'area',parameters:[3]});
  assert.equal(circle.teacherDiagram.figure,'circle');
  assert.throws(()=>compileVisual({type:'graph',language:'de',objective:'value',
    series:[{kind:'linear',parameters:[2,1]}],xRange:[-5,5],yRange:[-5,5]}),/Invalid visual number/);
});

test('teacher gets computed solution diagrams, student receives no answer markers',()=>{
  const drawSpec={type:'graph',language:'de',objective:'draw',
    series:[{kind:'linear',parameters:[2,1]}],xRange:[-5,5],yRange:[-5,5]};
  const crossSpec={type:'graph',language:'de',objective:'intersections',
    series:[{kind:'linear',parameters:[2,-1]},{kind:'linear',parameters:[-1,5]}],
    xRange:[-5,5],yRange:[-5,6]};
  const geoSpec={type:'geometry',language:'de',figure:'triangle',objective:'area',
    vertices:[[0,0],[6,0],[0,8]]};
  const lesson={
    workbookPages:[{title:'Konstruktion',blocks:[
      {type:'visualTask',number:1,spec:drawSpec},
      {type:'visualTask',number:2,spec:crossSpec},
      {type:'visualTask',number:3,spec:geoSpec}
    ]}],
    teacherPages:[{title:'Bestehende Lösungen',blocks:[{type:'teacherNote',label:'',text:'Bestehende Inhalte bleiben erhalten.'}]}],
    qa:{algebra:[{kind:'visualValue',number:1},{kind:'visualValue',number:2},{kind:'visualValue',number:3}]}
  };
  const before=lesson.teacherPages[0].blocks;
  const visual=prepareVisualTasks(lesson);
  assert.equal(visual.results.size,3);
  assert.strictEqual(lesson.teacherPages[0].blocks,before);
  assert.equal(lesson.teacherPages.length,3);
  assert.equal(lesson.qa.algebra.length,0);
  const student=JSON.stringify(lesson.workbookPages);
  assert.ok(student.includes('"type":"coordinateGrid"'));
  assert.ok(!student.includes('MUSTERLÖSUNG') && !student.includes('"points"') && !student.includes('"showIntersections":true'));
  const teachers=lesson.teacherPages.slice(1).flatMap(page=>page.blocks);
  assert.equal(teachers.filter(b=>b.type==='graph').length,2);
  assert.equal(teachers.filter(b=>b.type==='geometry').length,1);
  assert.equal(teachers.filter(b=>b.type==='callout').length,3);
  assert.equal(teachers[1].series[0].m,2);
  assert.equal(teachers[3].points.length,1);
  assert.equal(teachers[3].points[0].x,2);
  assert.equal(teachers[3].points[0].y,3);
  assert.ok(teachers[5].vertices.length===3);
  assert.ok(JSON.stringify(teachers).includes('≈ 24 cm²'));
  const graphSvgRef=teachers.filter(b=>b.type==='graph');
  assert.ok(graphSvgRef.every(g=>g.label.includes('MUSTERLÖSUNG')));
  assert.ok(visual.results.get(2)==='(2; 3)');
});

test('invalid shapes, hidden answer channels, unsafe inputs and undefined graph tasks fail closed',()=>{
  for(const s of [
    geo('triangle','area',[],[[0,0],[1,1],[2,2]]),geo('rectangle','area',[],[[0,0],[8,0],[7,4],[0,4]]),
    geo('quadrilateral','area',[],[[0,0],[4,4],[0,4],[4,0]]),geo('circle','area',[-1]),geo('sphere','volume',[0]),
    geo('triangle','side',[],tri,3),geo('cone','area',[3,4]),
    graph('reciprocal',[1,2,0]),graph('sqrt',[1,3,0]),graph('logarithmic',[1,0,0,1]),
    graph('linear',[100,0]),graph('sine',[1,100,0,0]),graph('sine',[1,1,0,0],'zeros'),
    graph('linear',[1,0],'intersections'),graph('quadratic',[1,0,1],'zeros'),
    {...graph('linear',[1,0]),html:'<script>secret()</script>'},graph('javascript',[1]),
    {type:'fractionCircle',language:'ru',parts:4,selected:5}
  ])assert.throws(()=>compileVisual(s),JSON.stringify(s));
});
test('mixed worksheet QA stays ordered and each visible diagram requires its own check',()=>{
  const lesson={workbookPages:[{blocks:[{type:'taskCard',children:[{type:'visualTask',number:2,spec:geo('triangle','area',[],tri)}]}]}],qa:{algebra:[{kind:'expressionValue',expression:'1+1'},{kind:'visualValue',number:2}]}};
  const visual=prepareVisualTasks(lesson);
  assert.equal(lesson.qa.algebra.length,1);
  assert.ok(!JSON.stringify(lesson.workbookPages).includes('visualTask'));
  const qa=mergeVisualQa({passed:true,checked:1,results:[{index:0,passed:true,answer:'2'}]},visual);
  assert.deepEqual(qa.results.map(r=>r.answer),['2','≈ 24 cm²']);assert.equal(qa.checked,2);assert.equal(qa.visualChecked,1);
  assert.throws(()=>prepareVisualTasks({workbookPages:[],qa:{algebra:[{kind:'visualValue',number:2}]}}));
  assert.throws(()=>prepareVisualTasks({workbookPages:[{blocks:[{type:'visualTask',number:2,spec:geo('triangle','area',[],tri)}]}]}));
});
