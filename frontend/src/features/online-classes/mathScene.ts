import {compileMath,mathReserved} from './mathExpression';
import type {Primitive} from './interactiveTemplates';
export type SceneParameter={name:string;label:string;min:number;max:number;step:number;value:number};
export type ScenePoint={id:string;x:string;y:string;dragX:string|null;dragY:string|null};
export type SceneObject=
  |{kind:'segment';a:string;b:string}
  |{kind:'polygon';points:string[]}
  |{kind:'circle';center:string;radius:string}
  |{kind:'function';expression:string}
  |{kind:'bars';values:{label:string;expression:string}[]};
export type MathScene={template:'scene';language:'ru'|'de';title:string;prompt:string;
  bounds:{xMin:number;xMax:number;yMin:number;yMax:number};parameters:SceneParameter[];points:ScenePoint[];
  objects:SceneObject[];metrics:{label:string;expression:string}[];answer:string|null};
const number=(v:unknown,lo=-1000,hi=1000):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function keys(v:unknown,fields:string):asserts v is Record<string,unknown> {
  if(!record(v)||Object.keys(v).sort().join(',')!==fields.split(',').sort().join(','))throw Error('Invalid scene fields');
}
const label=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f<>]/.test(v);
const array=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max;
export function parseMathScene(value:unknown):MathScene|undefined {
  try {
    keys(value,'template,language,title,prompt,bounds,parameters,points,objects,metrics,answer');
    if(value.template!=='scene'||!['ru','de'].includes(String(value.language))||!label(value.title,48)||!value.title||!label(value.prompt,120))return;
    keys(value.bounds,'xMin,xMax,yMin,yMax');const b=value.bounds;
    if(!Object.values(b).every(n=>number(n))||Number(b.xMax)-Number(b.xMin)<.1||Number(b.yMax)-Number(b.yMin)<.1)return;
    if(!array(value.parameters,6)||!array(value.points,12)||!array(value.objects,12)||!array(value.metrics,3))return;
    const names=new Set<string>();
    for(const p of value.parameters) {
      keys(p,'name,label,min,max,step,value');
      if(typeof p.name!=='string'||! /^[a-z][a-z0-9_]{0,11}$/.test(p.name)||mathReserved.has(p.name)||names.has(p.name)
        ||!label(p.label,32)||!number(p.min)||!number(p.max)||Number(p.max)<=Number(p.min)||!number(p.value,Number(p.min),Number(p.max))
        ||!number(p.step,.001,Number(p.max)-Number(p.min)))return;
      names.add(p.name);
    }
    const expression=(s:unknown,graph=false)=>{if(typeof s!=='string')throw Error('Invalid expression');compileMath(s,new Set([...names,...(graph?['x']:[])]));};
    const ids=new Set<string>();
    for(const p of value.points) {
      keys(p,'id,x,y,dragX,dragY');
      if(typeof p.id!=='string'||! /^[A-Z][A-Z0-9]{0,3}$/.test(p.id)||ids.has(p.id))return;
      ids.add(p.id);expression(p.x);expression(p.y);
      for(const [axis,drag] of [['x','dragX'],['y','dragY']])if(p[drag]!==null&&(!names.has(String(p[drag]))||p[axis]!==p[drag]))return;
    }
    let bars=0;
    for(const o of value.objects) {
      if(!record(o))return;
      if(o.kind==='segment'){keys(o,'kind,a,b');if(!ids.has(String(o.a))||!ids.has(String(o.b))||o.a===o.b)return;}
      else if(o.kind==='polygon'){keys(o,'kind,points');if(!array(o.points,12)||o.points.length<3||new Set(o.points).size!==o.points.length||!o.points.every(p=>ids.has(String(p))))return;}
      else if(o.kind==='circle'){keys(o,'kind,center,radius');if(!ids.has(String(o.center)))return;expression(o.radius);}
      else if(o.kind==='function'){keys(o,'kind,expression');expression(o.expression,true);}
      else if(o.kind==='bars'){keys(o,'kind,values');if(++bars>1||!array(o.values,8)||!o.values.length)return;for(const v of o.values){keys(v,'label,expression');if(!label(v.label,12))return;expression(v.expression);}}
      else return;
    }
    if(value.points.length+value.objects.length===0)return;
    for(const m of value.metrics){keys(m,'label,expression');if(!label(m.label,32))return;expression(m.expression);}
    if(value.answer!==null){expression(value.answer);if(!value.prompt)return;}
    return structuredClone(value) as MathScene;
  }catch{return;}
}
const cache=new Map<string,ReturnType<typeof compileMath>>();
export function sceneValue(scene:MathScene,expression:string,x?:number):number {
  const values=Object.fromEntries(scene.parameters.map(p=>[p.name,p.value]));if(x!==undefined)values.x=x;
  const key=Object.keys(values).sort().join(',')+':'+expression;
  try{let fn=cache.get(key);if(!fn){fn=compileMath(expression,new Set(Object.keys(values)));if(cache.size>=256)cache.clear();cache.set(key,fn);}const n=fn(values);return Number.isFinite(n)&&Math.abs(n)<=1e9?n:NaN;}catch{return NaN;}
}
function sceneBounds(scene:MathScene) {
  if(scene.objects.length!==1||scene.objects[0].kind!=='bars')return scene.bounds;
  const values=scene.objects[0].values.map(v=>sceneValue(scene,v.expression)).filter(Number.isFinite);
  return {...scene.bounds,xMin:Math.min(0,scene.bounds.xMin),xMax:Math.max(scene.bounds.xMax,values.length+1),
    yMin:Math.min(scene.bounds.yMin,0,...values.map(v=>v<0?v*1.1:0)),
    yMax:Math.max(scene.bounds.yMax,0,...values.map(v=>v>0?v*1.1:0))};
}
export function sceneProjection(scene:MathScene) {
  const b=sceneBounds(scene),s=Math.min(400/(b.xMax-b.xMin),240/(b.yMax-b.yMin));
  const barsOnly=scene.objects.length>0&&scene.objects.every(o=>o.kind==='bars');
  const sx=barsOnly?400/(b.xMax-b.xMin):s,sy=barsOnly?240/(b.yMax-b.yMin):s;
  const cx=(b.xMin+b.xMax)/2,cy=(b.yMin+b.yMax)/2;
  return {s,toPixel:(x:number,y:number):[number,number]=>[250+(x-cx)*sx,220-(y-cy)*sy],
    fromPixel:(x:number,y:number):[number,number]=>[(x-250)/sx+cx,(220-y)/sy+cy]};
}
export function scenePoint(scene:MathScene,p:ScenePoint):[number,number]{return [sceneValue(scene,p.x),sceneValue(scene,p.y)];}
export function setSceneParameter(scene:MathScene,name:string,value:number):MathScene {
  return {...scene,parameters:scene.parameters.map(p=>p.name===name?{...p,value:Math.max(p.min,Math.min(p.max,
    Number((p.min+Math.round((value-p.min)/p.step)*p.step).toFixed(9))))}:p)};
}
export function checkSceneAnswer(scene:MathScene,input:string):'correct'|'incorrect'|'invalid' {
  if(!scene.answer||input.trim()==='')return 'invalid';
  const expected=sceneValue(scene,scene.answer),received=Number(input.replace(',','.'));
  if(!Number.isFinite(expected)||!Number.isFinite(received))return 'invalid';
  return Math.abs(received-expected)<=.000500001?'correct':'incorrect';
}
export function renderMathScene(scene:MathScene):Primitive[] {
  const out:Primitive[]=[],projection=sceneProjection(scene),to=projection.toPixel;
  const text=(x:number,y:number,text:string,size=14)=>out.push({kind:'text',x,y,text,size});
  const path=(d:string,color='#526074',fill='none')=>out.push({kind:'path',d,stroke:color,fill,width:1.5,clip:true});
  const format=(n:number)=>Number.isFinite(n)?String(Math.round(n*1000)/1000):scene.language==='de'?'nicht definiert':'не определено';
  text(25,26,scene.title,17);
  const words=scene.prompt.split(/\s+/);let line='',row=0;
  for(const word of words){if((line+' '+word).length>58){text(25,49+row++*16,line,12);line='';}line+=(line?' ':'')+word;}if(line)text(25,49+row*16,line,12);
  const b=sceneBounds(scene);
  for(let i=0;i<=4;i++){
    const x=b.xMin+(b.xMax-b.xMin)*i/4,y=b.yMin+(b.yMax-b.yMin)*i/4;
    const [px]=to(x,0),[,py]=to(0,y),[left,bottom]=to(b.xMin,b.yMin),[right,top]=to(b.xMax,b.yMax);
    path(`M ${px} ${top} V ${bottom}`,'#e4e9ee');path(`M ${left} ${py} H ${right}`,'#e4e9ee');
    text(px-8,bottom+15,format(x),10);text(left-36,py+3,format(y),10);
  }
  const [zx,zy]=to(0,0);path(`M 50 ${zy} H 450`);path(`M ${zx} 100 V 340`);
  const pointMap=new Map(scene.points.map(p=>[p.id,scenePoint(scene,p)]));
  const valid=(p:number[])=>p.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6);
  let invalid=false;
  const colors=['#e8722d','#2563eb','#0d9488','#9333ea'];
  scene.objects.forEach((o,index)=>{
    const color=colors[index%colors.length];
    if(o.kind==='segment'||o.kind==='polygon'){
      const vertices=(o.kind==='segment'?[o.a,o.b]:o.points).map(id=>to(...pointMap.get(id)!));
      if(vertices.every(valid))path(vertices.map(([x,y],i)=>`${i?'L':'M'} ${x} ${y}`).join(' ')+(o.kind==='polygon'?' Z':''),color,o.kind==='polygon'?'#fff5eb':'none');else invalid=true;
    }else if(o.kind==='circle'){
      const [x,y]=to(...pointMap.get(o.center)!),r=sceneValue(scene,o.radius)*projection.s;
      if(valid([x,y,r])&&r>0)path(`M ${x-r} ${y} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0`,color);else invalid=true;
    }else if(o.kind==='function'){
      let d='',pen=false,last=0;
      for(let i=0;i<=320;i++){
        const x=b.xMin+(b.xMax-b.xMin)*i/320,y=sceneValue(scene,o.expression,x),[px,py]=to(x,y);
        if(!Number.isFinite(y)||y<b.yMin||y>b.yMax){pen=false;continue;}
        d+=`${pen&&Math.abs(y-last)<(b.yMax-b.yMin)/2?' L':' M'} ${px} ${py}`;pen=true;last=y;
      }if(d)path(d,color);
    }else {
      o.values.forEach((v,i)=>{const n=sceneValue(scene,v.expression),[x,y]=to(i+1,n),[left,base]=to(i+.65,0),[right]=to(i+1.35,0);
        if(valid([x,y,left,base,right])){path(`M ${left} ${base} V ${y} H ${right} V ${base} Z`,color,'#fed7aa');text(x-18,Math.max(110,Math.min(338,base+15)),v.label,10);}else invalid=true;
      });
    }
  });
  for(const p of scene.points){const [x,y]=to(...pointMap.get(p.id)!);if(valid([x,y])&&x>=50&&x<=450&&y>=100&&y<=340){out.push({kind:'circle',x,y,r:5,fill:'#e8722d'});text(x+7,y-7,p.id,12);}else if(!valid([x,y]))invalid=true;}
  scene.metrics.forEach((m,i)=>text(25,375+i*19,`${m.label}: ${format(sceneValue(scene,m.expression))}`,14));
  if(invalid)text(25,435,scene.language==='de'?'Ein Objekt ist bei diesen Werten nicht definiert.':'Объект не определён при этих значениях.',11);
  return out;
}
