/** Numeric template definitions. The model never supplies executable markup or formulas. */
import {parseMathScene,renderMathScene,type MathScene} from './mathScene';
import {parseMathSolid,renderMathSolid,type MathSolid} from './mathSolid';
export type InteractiveSpec =
  | MathScene
  | MathSolid
  | { template: 'graph'; language: 'ru' | 'de'; function: 'linear' | 'quadratic'; coefficients: number[] }
  | { template: 'triangle'; language: 'ru' | 'de'; vertices: [number, number][] }
  | { template: 'cube'; language: 'ru' | 'de'; unfold: number; yaw: number; pitch: number }
  | { template: 'fractionCircle'; language: 'ru' | 'de'; parts: number; selected: number[] };
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
export const triangleArea = (v: [number, number][]) => Math.abs((v[1][0]-v[0][0])*(v[2][1]-v[0][1])-(v[2][0]-v[0][0])*(v[1][1]-v[0][1]))/2;
export function parseInteractiveSpec(value: unknown): InteractiveSpec | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  try {if(JSON.stringify(value).length>14000)return;}catch{return;}
  const s = value as Record<string, unknown>;
  if (s.language !== 'ru' && s.language !== 'de') return;
  if (s.template==='scene') return parseMathScene(s);
  if (s.template==='solid') return parseMathSolid(s);
  const keys = (...expected: string[]) => Object.keys(s).sort().join('|') === expected.sort().join('|');
  if (s.template === 'cube' && keys('template','language','unfold','yaw','pitch')
    && finite(s.unfold,0,1) && finite(s.yaw,-180,180) && finite(s.pitch,-90,90))
    return {template:'cube',language:s.language,unfold:s.unfold,yaw:s.yaw,pitch:s.pitch};
  if (s.template === 'graph' && keys('template','language','function','coefficients')
    && (s.function === 'linear' || s.function === 'quadratic') && Array.isArray(s.coefficients)
    && s.coefficients.length === (s.function === 'linear' ? 2 : 3) && s.coefficients.every(n => finite(n,-10,10)))
    return { template:s.template, language:s.language, function:s.function, coefficients:[...s.coefficients] };
  if (s.template === 'triangle' && keys('template','language','vertices') && Array.isArray(s.vertices) && s.vertices.length === 3
    && s.vertices.every(p => Array.isArray(p) && p.length === 2 && p.every(n => finite(n,-5,5)))) {
    const vertices = s.vertices.map(p => [...p] as [number,number]);
    if (triangleArea(vertices) >= .05) return {template:s.template,language:s.language,vertices};
  }
  if (s.template === 'fractionCircle' && keys('template','language','parts','selected') && finite(s.parts,1,24) && Number.isInteger(s.parts)
    && Array.isArray(s.selected) && s.selected.length <= (s.parts as number)*4
    && s.selected.every(n => finite(n,0,(s.parts as number)*4-1) && Number.isInteger(n))
    && new Set(s.selected).size === s.selected.length)
    return {template:s.template,language:s.language,parts:s.parts,selected:[...s.selected]};
}
export function templateTitle(spec: InteractiveSpec) {
  const de=spec.language==='de';
  if(spec.template==='scene'||spec.template==='solid') return spec.title;
  if(spec.template==='cube') return de?'Würfel und sein Netz':'Куб и его развёртка';
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
export const MAX_PIZZA_CIRCLES = 4;
export function fractionFromInputs(numerator:string,denominator:string):{parts:number;selected:number[]}|undefined {
  if(!/^\d{1,3}$/.test(numerator.trim()) || !/^\d{1,2}$/.test(denominator.trim())) return;
  const n=Number(numerator.trim()),parts=Number(denominator.trim());
  if(!Number.isSafeInteger(n) || !Number.isSafeInteger(parts) || parts<1 || parts>24 || n>parts*MAX_PIZZA_CIRCLES) return;
  return {parts,selected:Array.from({length:n},(_,index)=>index)};
}
export function fractionLabel(spec: Extract<InteractiveSpec,{template:'fractionCircle'}>) {
  const n=spec.selected.length,divisor=gcd(n,spec.parts);
  const reduced=n/divisor,denominator=spec.parts/divisor;
  if(n>spec.parts && n%spec.parts!==0) {
    const whole=Math.floor(n/spec.parts),remainder=(n%spec.parts)/gcd(n%spec.parts,spec.parts);
    const remainingDenominator=spec.parts/gcd(n%spec.parts,spec.parts);
    return `${n}/${spec.parts} = ${whole} ${remainder}/${remainingDenominator}`;
  }
  return `${n}/${spec.parts} = ${reduced}/${denominator}`;
}
export type Primitive =
  | {kind:'path'; d:string; stroke:string; fill?:string; width?:number; clip?:boolean}
  | {kind:'text'; x:number;y:number;text:string;size?:number;fill?:string;anchor?:'start'|'middle'}
  | {kind:'circle';x:number;y:number;r:number;fill:string;stroke?:string};
export const plot = {cx:250,cy:210,scale:25,left:50,top:70,width:400,height:280};
export const graphPoint=(x:number,y:number):[number,number]=>[plot.cx+x*plot.scale,plot.cy-y*plot.scale];
const coord=(n:number)=>Math.round(n*1000)/1000;
export function fractionDiscs(spec:Extract<InteractiveSpec,{template:'fractionCircle'}>) {
  const highest=spec.selected.length ? Math.max(...spec.selected) : -1;
  const count=Math.min(MAX_PIZZA_CIRCLES,Math.max(1,Math.floor(highest/spec.parts)+1));
  const positions=count===1?[[250,210,110]]:
    count===2?[[138,210,101],[362,210,101]]:
    [[138,145,72],[362,145,72],[138,303,72],[362,303,72]].slice(0,count);
  return positions.map(([cx,cy,r],index)=>({cx,cy,r,offset:index*spec.parts,pizza:index+1}));
}
export function sectorPath(index:number,parts:number,cx=250,cy=210,r=110) {
  if(parts===1) return `M ${cx} ${coord(cy-r)} A ${r} ${r} 0 1 1 ${cx} ${coord(cy+r)} A ${r} ${r} 0 1 1 ${cx} ${coord(cy-r)} Z`;
  const a=-Math.PI/2+index*2*Math.PI/parts,b=a+2*Math.PI/parts;
  return `M ${cx} ${cy} L ${coord(cx+r*Math.cos(a))} ${coord(cy+r*Math.sin(a))} A ${r} ${r} 0 ${b-a>Math.PI?1:0} 1 ${coord(cx+r*Math.cos(b))} ${coord(cy+r*Math.sin(b))} Z`;
}
/** Six rigid unit squares joined along hinges, not a morph between pictures. */
export function cubeFaces(unfold:number): [number,number,number][][] {
  const a=(1-unfold)*Math.PI/2,c=Math.cos(a),s=Math.sin(a);
  const square=[[0,0],[1,0],[1,1],[0,1]];
  const faces: [number,number,number][][]=[
    square.map(([u,v])=>[u-.5,v-.5,0]),
    square.map(([u,v])=>[.5+u*c,v-.5,u*s]),
    square.map(([u,v])=>[-.5-u*c,v-.5,u*s]),
    square.map(([u,v])=>[u-.5,.5+v*c,v*s]),
    square.map(([u,v])=>[u-.5,-.5-v*c,v*s]),
    square.map(([u,v])=>[u-.5,.5+c+v*Math.cos(2*a),s+v*Math.sin(2*a)]),
  ];
  return faces.map(face=>face.map(([x,y,z])=>[x,y-.5*unfold,z-.5*(1-unfold)]));
}
/** One scene feeds both the editable SVG and the board/PDF canvas snapshot. */
export function templateScene(spec:InteractiveSpec):Primitive[] {
  if(spec.template==='scene') return renderMathScene(spec);
  if(spec.template==='solid') return renderMathSolid(spec);
  const result:Primitive[]=[{kind:'text',x:25,y:30,text:templateTitle(spec),size:19}];
  const text=(x:number,y:number,value:string,size=15) => result.push({kind:'text',x,y,text:value,size});
  const path=(d:string,stroke='#dce3e9',width=1,fill='none',clip=false)=>result.push({kind:'path',d,stroke,width,fill,clip});
  if(spec.template==='cube') {
    const yaw=spec.yaw*Math.PI/180,pitch=spec.pitch*Math.PI/180;
    const projected=cubeFaces(spec.unfold).map((face,index)=>({index,points:face.map(([x,y,z])=>{
      const rx=x*Math.cos(yaw)+z*Math.sin(yaw),rz=-x*Math.sin(yaw)+z*Math.cos(yaw);
      return [rx,y*Math.cos(pitch)-rz*Math.sin(pitch),y*Math.sin(pitch)+rz*Math.cos(pitch)];
    })}));
    projected.sort((a,b)=>a.points.reduce((n,p)=>n+p[2],0)-b.points.reduce((n,p)=>n+p[2],0));
    const colors=['#fde68a','#fdba74','#93c5fd','#a7f3d0','#c4b5fd','#fca5a5'];
    for(const face of projected) {
      const scale=110-45*spec.unfold;
      const points=face.points.map(([x,y])=>[250+x*scale,235-y*scale]);
      path(points.map(([x,y],i)=>`${i?'L':'M'} ${coord(x)} ${coord(y)}`).join(' ')+' Z','#334155',1.5,colors[face.index]);
    }
    text(25,410,spec.language==='de'?'6 Flächen · 12 Kanten · 8 Ecken':'6 граней · 12 рёбер · 8 вершин');
    return result;
  }
  if(spec.template==='fractionCircle') {
    for(const pizza of fractionDiscs(spec))
      for(let i=0;i<spec.parts;i++) path(sectorPath(i,spec.parts,pizza.cx,pizza.cy,pizza.r),
        '#88552f',1.6,spec.selected.includes(pizza.offset+i)?'#f9a66d':'#fff7e8');
    text(25,419,fractionLabel(spec),23);
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
    else {if(p.clip) {ctx.beginPath();ctx.rect(plot.left,spec.template==='scene'?100:plot.top,plot.width,spec.template==='scene'?240:plot.height);ctx.clip();}
      const path=new Path2D(p.d);if(p.fill && p.fill!=='none') {ctx.fillStyle=p.fill;ctx.fill(path);}ctx.strokeStyle=p.stroke;ctx.lineWidth=p.width??1;ctx.stroke(path);}
    ctx.restore();
  }
  ctx.restore();
}
