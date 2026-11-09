/** Kolin's closed task compiler. Conditions, figures and reference answers share numeric data. */
import {functionAt,functionLabel,computeIntersections,graphSvg,geometrySvg} from './diagrams.mjs';

const num=(v)=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000)throw Error('Invalid visual number');return v;};
const fmt=v=>Number(v.toFixed(6)).toString();
const list=(v,min,max)=>{if(!Array.isArray(v)||v.length<min||v.length>max)throw Error('Invalid visual list');return v.map(num);};
const positive=v=>{num(v);if(v<=0||v>100)throw Error('Invalid visual dimension');return v;};
const keys=(v,allowed)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Unknown visual property');};
const range=v=>{const [a,b]=list(v,2,2);if(b-a<1||b-a>20)throw Error('Invalid graph range');return [a,b];};
const array=(v,min,max)=>{if(!Array.isArray(v)||v.length<min||v.length>max)throw Error('Invalid visual collection');return v;};
const text=t=>({type:'text',text:t});
const result=(blocks,answer,teacherDiagram=null)=>({blocks,answer,teacherDiagram});

export function seriesDefinition(s) {
  keys(s,['kind','parameters','denominator']);
  const p=list(s.parameters,1,5), d=list(s.denominator ?? [],0,5);
  const spec={kind:s.kind};
  const fields={constant:['value'],linear:['m','b'],quadratic:['a','b','c'],sine:['amplitude','frequency','phase','offset'],
    cosine:['amplitude','frequency','phase','offset'],absolute:['a','h','k'],reciprocal:['a','h','k'],sqrt:['a','h','k'],exponential:['a','h','k','base'],logarithmic:['a','h','k','base']};
  if(s.kind==='rational') {if(!d.length)throw Error('Missing denominator');spec.numerator=p;spec.denominator=d;}
  else {
    if(d.length)throw Error('Unexpected denominator');
    if(s.kind==='polynomial')spec.coefficients=p;
    else {const names=fields[s.kind];if(!names||p.length!==names.length)throw Error('Invalid function parameters');names.forEach((n,i)=>spec[n]=p[i]);}
  }
  if(['sine','cosine'].includes(s.kind)&&Math.abs(spec.frequency)>10)throw Error('Frequency exceeds readable graph limit');
  functionAt(spec,0); // Validate even when the first sample is outside the real domain.
  return spec;
}

function graphTask(s,de) {
  keys(s,['type','language','objective','series','at','xRange','yRange']);
  const series=array(s.series,1,2).map(seriesDefinition), xRange=range(s.xRange), yRange=range(s.yRange);
  const graph={type:'graph',label:'',series,xRange,yRange,gridStep:Math.max(1,Math.ceil(Math.max(xRange[1]-xRange[0],yRange[1]-yRange[0])/10))};
  graphSvg(graph); // The same domain, clipping and function checks used to draw the PDF.
  // Only value-at-x tasks need an evaluation point. A drawing or
  // intersection exercise should not fail because ChatGPT omitted at.
  if(s.at!==undefined)num(s.at);
  if(s.objective==='draw') {
    if(series.length!==1)throw Error('Draw requires one function');
    return result([text(de?'Zeichne den Graphen der Funktion.':'Построй график функции.'),text(functionLabel(series[0])),
      {type:'coordinateGrid',label:'',xRange,yRange,gridStep:graph.gridStep}],functionLabel(series[0]),{...graph,label:'MUSTERLÖSUNG – GRAPH'});
  }
  if(s.objective==='value') {
    if(series.length!==1||s.at<xRange[0]||s.at>xRange[1])throw Error('Invalid graph evaluation point');
    const y=functionAt(series[0],s.at);
    if(y===null||!Number.isFinite(y)||y<yRange[0]||y>yRange[1])throw Error('Requested graph value is not visible');
    return result([text(de?`Bestimme f(${fmt(s.at)}).`:`Найди f(${fmt(s.at)}).`),graph],`f(${fmt(s.at)}) ≈ ${fmt(y)}`,{...graph,label:'MUSTERLÖSUNG – GRAPH',points:[{x:s.at,y,seriesIndex:0,label:`P(${fmt(s.at)} | ${fmt(y)})`}]});
  }
  if(!['zeros','intersections'].includes(s.objective))throw Error('Unknown graph objective');
  if(series.some(f=>!['constant','linear','quadratic','polynomial','rational'].includes(f.kind)))
    throw Error('Complete intersection tasks require polynomial or rational functions');
  if(s.objective==='zeros'&&(series.length!==1||yRange[0]>0||yRange[1]<0))throw Error('Zeros need one function and a visible x axis');
  if(s.objective==='intersections'&&series.length!==2)throw Error('Intersections need two functions');
  const compared=s.objective==='zeros'?[...series,{kind:'constant',value:0}]:series;
  // Identical curves have infinitely many intersections, not an empty answer.
  if(functionLabel(compared[0],0)===functionLabel(compared[1],0))throw Error('Coincident graphs have no isolated answers');
  const points=computeIntersections({...graph,series:compared});
  if(!points.length)throw Error('Select a range containing isolated visible solutions');
  const title=s.objective==='zeros'?(de?'Bestimme die Nullstellen im dargestellten Bereich.':'Найди нули функции в показанной области.'):
    (de?'Bestimme die Schnittpunkte im dargestellten Bereich.':'Найди точки пересечения в показанной области.');
  const answer=points.map(p=>s.objective==='zeros'?`x ≈ ${fmt(p.x)}`:`(${fmt(p.x)}; ${fmt(p.y)})`).join('; ');
  // Visible answers belong in the teacher-only reference diagram, never the
  // student graph. Mark only actual numerically verified visible solutions.
  const teacherPoints=points.slice(0,12).map((p,i)=>({x:p.x,y:p.y,seriesIndex:0,label:points.length<=3?`${s.objective==='zeros'?'N':'S'}${i+1}`:undefined}));
  return result([text(title+' '+(de?'Näherungswerte sind erlaubt.':'Можно записать приближённые значения.')),graph],answer,
    {...graph,label:'MUSTERLÖSUNG – GRAPH',points:teacherPoints});
}

function polygonData(vertices) {
  const pts=array(vertices,3,8).map(v=>list(v,2,2));
  // Convex cyclic order rules out crossings, duplicate edges and reflex angle ambiguity.
  let sign=0;
  for(let i=0;i<pts.length;i++) {
    const a=pts[i],b=pts[(i+1)%pts.length],c=pts[(i+2)%pts.length];
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    if(Math.abs(cross)<1e-7)throw Error('Degenerate polygon');
    const current=Math.sign(cross);if(sign&&sign!==current)throw Error('Polygon must be convex and cyclic');sign=current;
    // Every remaining vertex must lie strictly on the same side of every edge.
    for(let j=0;j<pts.length;j++)if(j!==i&&j!==(i+1)%pts.length) {
      const q=pts[j];if(((b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]))*sign<=1e-7)throw Error('Crossed polygon');
    }
  }
  const lengths=pts.map((p,i)=>Math.hypot(p[0]-pts[(i+1)%pts.length][0],p[1]-pts[(i+1)%pts.length][1]));
  const area=Math.abs(pts.reduce((sum,p,i)=>sum+p[0]*pts[(i+1)%pts.length][1]-p[1]*pts[(i+1)%pts.length][0],0))/2;
  return {pts,lengths,area};
}

function geometryTask(s,de) {
  keys(s,['type','language','figure','objective','vertices','parameters','index']);
  const p=list(s.parameters ?? [],0,3), figure=s.figure, objective=s.objective;
  const index=s.index ?? 0;
  if(!Number.isInteger(index)||index<0||index>7)throw Error('Invalid geometry index');
  let diagram={type:'geometry',figure,label:'',unit:'cm'}, facts='',value,unit='';
  const names='ABCDEFGH';
  if(['triangle','rectangle','quadrilateral','polygon'].includes(figure)) {
    if(p.length)throw Error('Polygon needs coordinates only');
    const {pts,lengths,area}=polygonData(s.vertices);
    if((figure==='triangle'&&pts.length!==3)||(['rectangle','quadrilateral'].includes(figure)&&pts.length!==4))throw Error('Incorrect vertex count');
    if(index>=pts.length)throw Error('Geometry index outside figure');
    diagram={...diagram,vertices:pts.map((q,i)=>({x:q[0],y:q[1],label:names[i]})),showSideLabels:false,showAngleLabels:false};
    facts=pts.map((q,i)=>`${names[i]}(${fmt(q[0])}; ${fmt(q[1])})`).join(', ')+'. '+(de?'Koordinaten in cm.':'Координаты в см.');
    if(objective==='area'){value=area;unit='cm²';}
    else if(objective==='perimeter'){value=lengths.reduce((a,b)=>a+b,0);unit='cm';}
    else if(objective==='side'){value=lengths[index];unit='cm';}
    else if(objective==='angle') {
      const n=pts.length,a=pts[(index+n-1)%n],b=pts[index],c=pts[(index+1)%n];
      const dot=(a[0]-b[0])*(c[0]-b[0])+(a[1]-b[1])*(c[1]-b[1]);
      value=Math.acos(Math.max(-1,Math.min(1,dot/(lengths[(index+n-1)%n]*lengths[index]))))*180/Math.PI;unit='°';
    } else throw Error('Unsupported polygon objective');
  } else {
    if(!Array.isArray(s.vertices ?? [])||(s.vertices ?? []).length||index!==0)throw Error('Unexpected geometry coordinates');
    p.forEach(positive);
    const dimensions={circle:1,cube:1,cuboid:3,cylinder:2,cone:2,sphere:1};
    if(p.length!==dimensions[figure])throw Error('Invalid geometry dimensions');
    const [r,h]=p;
    if(figure==='circle') {
      diagram={...diagram,center:{x:0,y:0},radius:r};facts=`r = ${r} cm`;
      if(objective==='area'){value=Math.PI*r*r;unit='cm²';}
      else if(objective==='perimeter'){value=2*Math.PI*r;unit='cm';}
      else throw Error('Unsupported circle objective');
    } else {
      if(!['volume','surface'].includes(objective))throw Error('Unsupported solid objective');
      const volume=objective==='volume';unit=volume?'cm³':'cm²';
      if(figure==='cube'){diagram.side=r;facts=`a = ${r} cm`;value=volume?r**3:6*r*r;}
      if(figure==='cuboid'){diagram={...diagram,width:p[0],depth:p[1],height:p[2]};facts=`a = ${p[0]} cm, b = ${p[1]} cm, c = ${p[2]} cm`;value=volume?p[0]*p[1]*p[2]:2*(p[0]*p[1]+p[1]*p[2]+p[0]*p[2]);}
      if(figure==='cylinder'){diagram={...diagram,radius:r,height:h};facts=`r = ${r} cm, h = ${h} cm`;value=volume?Math.PI*r*r*h:2*Math.PI*r*(r+h);}
      if(figure==='cone'){diagram={...diagram,radius:r,height:h};facts=`r = ${r} cm, h = ${h} cm`;value=volume?Math.PI*r*r*h/3:Math.PI*r*(r+Math.hypot(r,h));}
      if(figure==='sphere'){diagram.radius=r;facts=`r = ${r} cm`;value=volume?4*Math.PI*r**3/3:4*Math.PI*r*r;}
      facts+=' ('+(de?'schematische Darstellung':'схематический рисунок')+')';
    }
  }
  if(!Number.isFinite(value)||value<=0)throw Error('Invalid geometry result');
  geometrySvg(diagram);
  const labels=de?{area:'Bestimme den Flächeninhalt.',perimeter:'Bestimme den Umfang.',volume:'Bestimme das Volumen.',surface:'Bestimme den gesamten Oberflächeninhalt.',
    side:`Bestimme die Länge ${names[index]}${names[(index+1)%s.vertices.length]}.`,angle:`Bestimme den Innenwinkel bei ${names[index]}.`}:
    {area:'Найди площадь фигуры.',perimeter:'Найди периметр.',volume:'Найди объём.',surface:'Найди площадь полной поверхности.',
      side:`Найди длину ${names[index]}${names[(index+1)%s.vertices.length]}.`,angle:`Найди внутренний угол при вершине ${names[index]}.`};
  return result([text(labels[objective]),text(facts),diagram],`≈ ${fmt(value)} ${unit}`,
    {...diagram,label:'MUSTERLÖSUNG – GEOMETRIE'});
}

function fractionTask(s,de) {
  keys(s,['type','language','parts','selected']);
  if(!Number.isInteger(s.parts)||s.parts<2||s.parts>24||!Number.isInteger(s.selected)||s.selected<0||s.selected>s.parts)throw Error('Invalid fraction circle');
  let a=s.selected,b=s.parts;while(b){const t=a%b;a=b;b=t;}
  return result([text(de?'Welcher Bruchteil ist gefärbt? Kürze den Bruch.':'Какая доля круга закрашена? Сократи дробь.'),
    {type:'geometry',figure:'fractionCircle',label:'',parts:s.parts,selected:s.selected}],`${s.selected/safeGcd(a)}/${s.parts/safeGcd(a)}`,
    {type:'geometry',figure:'fractionCircle',label:'MUSTERLÖSUNG – BRÜCHE',parts:s.parts,selected:s.selected});
}
const safeGcd=a=>a||1;

export function compileVisual(s) {
  if(!s||!['ru','de'].includes(s.language))throw Error('Invalid visual language');
  if(s.type==='graph')return graphTask(s,s.language==='de');
  if(s.type==='geometry')return geometryTask(s,s.language==='de');
  if(s.type==='fractionCircle')return fractionTask(s,s.language==='de');
  throw Error('Unsupported visual task');
}

/** Replace placeholders with ordinary renderer blocks. No model answer is ever trusted. */
export function prepareVisualTasks(lesson) {
  const results=new Map();
  const referenceDiagrams=[];
  function walk(items) {
    return items.flatMap(block=>{
      if(block.type==='visualTask') {
        if(!Number.isInteger(block.number)||block.number<1||block.number>20||results.has(block.number))throw Error('Invalid visual task identity');
        const compiled=compileVisual(block.spec);results.set(block.number,compiled.answer);
        referenceDiagrams.push({number:block.number,answer:compiled.answer,diagram:compiled.teacherDiagram});
        compiled.blocks[0].text=`${block.number}. ${compiled.blocks[0].text}`;
        return compiled.blocks;
      }
      if(block.children)block.children=walk(block.children);
      if(block.type==='split'){block.left=walk(block.left);block.right=walk(block.right);}
      return [block];
    });
  }
  for(const p of lesson.workbookPages)p.blocks=walk(p.blocks);
  const assertions=lesson.qa?.algebra||[], seen=new Set();
  for(const check of assertions)if(check.kind==='visualValue') {
    if(!results.has(check.number)||seen.has(check.number))throw Error('Visual check does not match exactly one visible task');seen.add(check.number);
  }
  if(results.size!==seen.size)throw Error('Missing visual checks');
  if(results.size)lesson.qa.algebra=assertions.filter(c=>c.kind!=='visualValue');
  // Only private teacher pages contain the plotted answer markers and
  // reference geometry. Rendered by the same SVG generator as student work.
  // Group four references into one logical page; A4 auto-pagination safely
  // splits these blocks further when needed.
  if(referenceDiagrams.length && Array.isArray(lesson.teacherPages)){
    for(let start=0;start<referenceDiagrams.length;start+=4){
      const chunk=referenceDiagrams.slice(start,start+4);
      lesson.teacherPages.push({title:'Grafik & Geometrie – Musterlösungen',
        subtitle:'Automatisch aus den Aufgabendaten berechnet · nur Lehrkräfte',
        blocks:chunk.flatMap(({number,answer,diagram})=>[
          {type:'callout',label:`AUFGABE ${number}`,text:answer},
          diagram
        ])});
    }
  }
  return {results,assertions};
}

export function mergeVisualQa(math,visual) {
  if(!visual.results.size)return math;
  let at=0;
  const results=visual.assertions.map((check,index)=>check.kind==='visualValue'
    ?{index,kind:'visualValue',passed:true,answer:visual.results.get(check.number)}:{...math.results[at++],index});
  if(at!==math.results.length)throw Error('Unexpected algebra check count');
  return {...math,results,checked:results.length,visualChecked:visual.results.size,coverage:'checked algebra and parameter-derived visual tasks'};
}
