/** Numeric template definitions. The model never supplies executable markup or formulas. */
export type InteractiveSpec =
  | { template: 'graph'; language: 'ru' | 'de'; function: 'linear' | 'quadratic'; coefficients: number[] }
  | { template: 'triangle'; language: 'ru' | 'de'; vertices: [number, number][] }
  | { template: 'fractionCircle'; language: 'ru' | 'de'; parts: number; selected: number[] };
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export const triangleArea = (v: [number, number][]) => Math.abs((v[1][0]-v[0][0])*(v[2][1]-v[0][1])-(v[2][0]-v[0][0])*(v[1][1]-v[0][1]))/2;
export function parseInteractiveSpec(value: unknown): InteractiveSpec | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const s = value as Record<string, unknown>;
  if (s.language !== 'ru' && s.language !== 'de') return;
  const keys = (...expected: string[]) => Object.keys(s).sort().join('|') === expected.sort().join('|');
  if (s.template === 'graph' && keys('template','language','function','coefficients')
    && (s.function === 'linear' || s.function === 'quadratic') && Array.isArray(s.coefficients)
    && s.coefficients.length === (s.function === 'linear' ? 2 : 3) && s.coefficients.every(n => finite(n,-10,10)))
    return { template:s.template, language:s.language, function:s.function, coefficients:[...s.coefficients] };
  if (s.template === 'triangle' && keys('template','language','vertices') && Array.isArray(s.vertices) && s.vertices.length === 3
    && s.vertices.every(p => Array.isArray(p) && p.length === 2 && p.every(n => finite(n,-5,5)))) {
    const vertices = s.vertices.map(p => [...p] as [number,number]);
    if (triangleArea(vertices) >= .05) return {template:s.template,language:s.language,vertices};
  }
  if (s.template === 'fractionCircle' && keys('template','language','parts','selected') && finite(s.parts,2,24) && Number.isInteger(s.parts)
    && Array.isArray(s.selected) && s.selected.every(n => finite(n,0,(s.parts as number)-1) && Number.isInteger(n))
    && new Set(s.selected).size === s.selected.length)
    return {template:s.template,language:s.language,parts:s.parts,selected:[...s.selected]};
}
export function templateTitle(spec: InteractiveSpec) {
  const de=spec.language==='de';
  return spec.template==='graph' ? de?'Graph untersuchen':'Исследуем график'
    : spec.template==='triangle' ? de?'Dreieck untersuchen':'Исследуем треугольник' : de?'Bruchteile':'Доли круга';
}
export const fmt = (n:number) => String(Math.round(n*100)/100);
export const graphValue = (spec: Extract<InteractiveSpec,{template:'graph'}>,x:number) => spec.coefficients.reduce((sum,c)=>sum*x+c,0);
export function graphFormula(spec: Extract<InteractiveSpec,{template:'graph'}>) {
  const degree=spec.coefficients.length-1;
  const terms=spec.coefficients.flatMap((c,i) => c===0?[]:[`${c<0?'-':'+'}${Math.abs(c)===1 && i<degree?'':fmt(Math.abs(c))}${degree-i===2?'x²':degree-i===1?'x':''}`]);
  return `y = ${(terms.join(' ') || '0').replace(/^\+/, '')}`;
}
export function triangleMeasures(v:[number,number][]) {
  const sides=v.map((p,i)=>Math.hypot(p[0]-v[(i+1)%3][0],p[1]-v[(i+1)%3][1]));
  const angles=v.map((p,i)=>{const a=v[(i+1)%3],b=v[(i+2)%3];
    const dot=(a[0]-p[0])*(b[0]-p[0])+(a[1]-p[1])*(b[1]-p[1]);
    return Math.acos(Math.max(-1,Math.min(1,dot/(sides[i]*sides[(i+2)%3]))))*180/Math.PI;});
  return {sides,angles,area:triangleArea(v),perimeter:sides.reduce((a,b)=>a+b,0)};
}
const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
export function fractionLabel(spec: Extract<InteractiveSpec,{template:'fractionCircle'}>) {
  const n=spec.selected.length,d=gcd(n,spec.parts);
  return `${n}/${spec.parts} = ${n/d}/${spec.parts/d}`;
}
export type Primitive =
  | {kind:'path'; d:string; stroke:string; fill?:string; width?:number; clip?:boolean}
  | {kind:'text'; x:number;y:number;text:string;size?:number;fill?:string;anchor?:'start'|'middle'}
  | {kind:'circle';x:number;y:number;r:number;fill:string;stroke?:string};
export const plot = {cx:250,cy:210,scale:25,left:50,top:70,width:400,height:280};
export const graphPoint=(x:number,y:number):[number,number]=>[plot.cx+x*plot.scale,plot.cy-y*plot.scale];
const coord=(n:number)=>Math.round(n*1000)/1000;
export function sectorPath(index:number,parts:number) {
  const a=-Math.PI/2+index*2*Math.PI/parts,b=a+2*Math.PI/parts,r=110;
  return `M 250 210 L ${coord(250+r*Math.cos(a))} ${coord(210+r*Math.sin(a))} A ${r} ${r} 0 ${b-a>Math.PI?1:0} 1 ${coord(250+r*Math.cos(b))} ${coord(210+r*Math.sin(b))} Z`;
}
/** One scene feeds both the editable SVG and the board/PDF canvas snapshot. */
export function templateScene(spec:InteractiveSpec):Primitive[] {
  const result:Primitive[]=[{kind:'text',x:25,y:30,text:templateTitle(spec),size:19}];
  const text=(x:number,y:number,value:string,size=15) => result.push({kind:'text',x,y,text:value,size});
  const path=(d:string,stroke='#dce3e9',width=1,fill='none',clip=false)=>result.push({kind:'path',d,stroke,width,fill,clip});
  if(spec.template==='fractionCircle') {
    for(let i=0;i<spec.parts;i++) path(sectorPath(i,spec.parts),'#334155',1.5,spec.selected.includes(i)?'#f9a66d':'#ffffff');
    text(25,390,fractionLabel(spec),23);
    return result;
  }
  for(let x=-8;x<=8;x++) {const [px]=graphPoint(x,0);path(`M ${px} 70 V 350`,x===0?'#526074':'#e4e9ee',x===0?1.5:1);
    if(x%2===0 && x!==0) text(px-6,226,String(x),11);}
  for(let y=-5;y<=5;y++) {const [,py]=graphPoint(0,y);path(`M 50 ${py} H 450`,y===0?'#526074':'#e4e9ee',y===0?1.5:1);
    if(y%2===0 && y!==0) text(256,py+4,String(y),11);}
  text(457,215,'x',12);text(256,66,'y',12);text(239,226,'0',11);
  if(spec.template==='graph') {
    let d='';
    for(let i=0;i<=640;i++) {const x=-8+i/40,[px,py]=graphPoint(x,graphValue(spec,x)); d+=`${i?' L':'M'} ${coord(px)} ${coord(py)}`;}
    path(d,'#ef772f',2.5,'none',true);text(25,390,graphFormula(spec),21);
  } else {
    const v=spec.vertices.map(p=>graphPoint(...p));
    path(v.map((p,i)=>`${i?'L':'M'} ${p[0]} ${p[1]}`).join(' ')+' Z','#526074',2,'#fff5eb');
    v.forEach(([x,y],i)=>{result.push({kind:'circle',x,y,r:6,fill:'#ef772f'});text(x+9,y-9,'ABC'[i],16);});
    const m=triangleMeasures(spec.vertices);
    text(25,380,`S = ${fmt(m.area)}   P = ${fmt(m.perimeter)}`,18);
    text(25,408,`A: ${fmt(m.angles[0])}°   B: ${fmt(m.angles[1])}°   C: ${fmt(m.angles[2])}°`,15);
  }
  return result;
}
export function drawInteractive(ctx:CanvasRenderingContext2D,spec:InteractiveSpec,x:number,y:number,w:number,h:number) {
  ctx.save();ctx.translate(x,y);
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
  const scale=Math.min(w/500,h/440);ctx.translate((w-500*scale)/2,(h-440*scale)/2);ctx.scale(scale,scale);
  for(const p of templateScene(spec)) {
    ctx.save();
    if(p.kind==='text') {ctx.fillStyle=p.fill??'#172033';ctx.font=`${p.size??15}px Arial, sans-serif`;ctx.fillText(p.text,p.x,p.y);}
    else if(p.kind==='circle') {ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=p.fill;ctx.fill();}
    else {if(p.clip) {ctx.beginPath();ctx.rect(plot.left,plot.top,plot.width,plot.height);ctx.clip();}
      const path=new Path2D(p.d);if(p.fill && p.fill!=='none') {ctx.fillStyle=p.fill;ctx.fill(path);}ctx.strokeStyle=p.stroke;ctx.lineWidth=p.width??1;ctx.stroke(path);}
    ctx.restore();
  }
  ctx.restore();
}
