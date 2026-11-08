import {compileMath,mathReserved} from './mathExpression';
import {sceneValue,type SceneParameter} from './mathScene';
import type {Primitive} from './interactiveTemplates';
type Vec=[number,number,number];
export type MathSolid={template:'solid';language:'ru'|'de';title:string;prompt:string;parameters:SceneParameter[];
  vertices:{id:string;x:string;y:string;z:string}[];faces:string[][];segments:{a:string;b:string;label:string}[];
  measurements:('volume'|'surfaceArea')[];answer:'volume'|'surfaceArea'|null;yaw:number;pitch:number};
const sub=(a:Vec,b:Vec):Vec=>a.map((n,i)=>n-b[i]) as Vec;
const cross=(a:Vec,b:Vec):Vec=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:Vec,b:Vec)=>a.reduce((n,x,i)=>n+x*b[i],0);
const mean=(vs:Vec[]):Vec=>[0,1,2].map(i=>vs.reduce((n,v)=>n+v[i],0)/vs.length) as Vec;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,k:string):v is Record<string,unknown>=>record(v)&&Object.keys(v).sort().join(',')===k.split(',').sort().join(',');
const num=(v:unknown,lo=-1000,hi=1000):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f<>]/.test(v);
const array=(v:unknown,min:number,max:number):v is unknown[]=>Array.isArray(v)&&v.length>=min&&v.length<=max;
/** Closed convex polyhedra only. All displayed measures come from the actual vertices. */
export function solidGeometry(s:MathSolid){
  const points=new Map(s.vertices.map(v=>[v.id,[sceneValue(s,v.x),sceneValue(s,v.y),sceneValue(s,v.z)] as Vec]));
  if([...points.values()].some(p=>p.some(n=>!num(n))))throw Error('Invalid vertex');
  const hullIds=[...new Set(s.faces.flat())],center=mean(hullIds.map(id=>points.get(id)!));
  const size=Math.max(1,...[...points.values()].map(v=>Math.hypot(...sub(v,center)))),epsilon=size*1e-7;
  const edges=new Map<string,{a:string;b:string;faces:number[]}>();let area=0,volume=0;
  const faces=s.faces.map((ids,index)=>{
    const vs=ids.map(id=>points.get(id)!);let normal=cross(sub(vs[1],vs[0]),sub(vs[2],vs[0]));
    const length=Math.hypot(...normal);if(length<1e-8)throw Error('Degenerate face');
    normal=normal.map(n=>n/length) as Vec;
    if(vs.some(v=>Math.abs(dot(normal,sub(v,vs[0])))>epsilon))throw Error('Nonplanar face');
    // Every edge must bound the entire face. This also excludes self-intersecting vertex order.
    vs.forEach((a,i)=>{const b=vs[(i+1)%vs.length],edge=sub(b,a);
      if(Math.hypot(...edge)<epsilon||vs.some(v=>dot(cross(edge,sub(v,a)),normal)<-epsilon))throw Error('Nonconvex face');
      const id=[ids[i],ids[(i+1)%ids.length]].sort().join(':');const e=edges.get(id)??{a:ids[i],b:ids[(i+1)%ids.length],faces:[]};e.faces.push(index);edges.set(id,e);
    });
    if(dot(normal,sub(vs[0],center))<0)normal=normal.map(n=>-n) as Vec;
    if([...points.values()].some(v=>dot(normal,sub(v,vs[0]))>epsilon))throw Error('Nonconvex solid');
    for(let i=1;i<vs.length-1;i++){
      const triangleArea=Math.hypot(...cross(sub(vs[i],vs[0]),sub(vs[i+1],vs[0])))/2;
      area+=triangleArea;volume+=triangleArea*Math.abs(dot(normal,sub(vs[0],center)))/3;
    }
    return {ids,vertices:vs,normal,center:mean(vs)};
  });
  if([...edges.values()].some(e=>e.faces.length!==2)||hullIds.length-edges.size+faces.length!==2||volume<1e-8)throw Error('Open or degenerate solid');
  return {points,faces,edges:[...edges.values()],center,volume,surfaceArea:area,vertexCount:hullIds.length};
}
export function parseMathSolid(v:unknown):MathSolid|undefined{
  try{
    if(!keys(v,'template,language,title,prompt,parameters,vertices,faces,segments,measurements,answer,yaw,pitch')||v.template!=='solid'||!['ru','de'].includes(String(v.language))
      ||!text(v.title,48)||!v.title||!text(v.prompt,160)||!num(v.yaw,-180,180)||!num(v.pitch,-90,90)
      ||!array(v.parameters,0,6)||!array(v.vertices,4,24)||!array(v.faces,4,24)||!array(v.segments,0,6)||!array(v.measurements,0,2))return;
    const names=new Set<string>();
    for(const p of v.parameters){if(!keys(p,'name,label,min,max,step,value')||typeof p.name!=='string'||! /^[a-z][a-z0-9_]{0,11}$/.test(p.name)||names.has(p.name)||mathReserved.has(p.name)
      ||!text(p.label,32)||!num(p.min)||!num(p.max)||p.max<=p.min||!num(p.step,.001,p.max-p.min)||!num(p.value,p.min,p.max))return;names.add(p.name);}
    const ids=new Set<string>();
    for(const p of v.vertices){if(!keys(p,'id,x,y,z')||typeof p.id!=='string'||! /^[A-Z][A-Z0-9]{0,3}$/.test(p.id)||ids.has(p.id))return;ids.add(p.id);
      for(const axis of ['x','y','z']){if(typeof p[axis]!=='string')return;compileMath(p[axis],names);}}
    for(const f of v.faces)if(!array(f,3,8)||new Set(f).size!==f.length||!f.every(id=>ids.has(String(id))))return;
    for(const e of v.segments)if(!keys(e,'a,b,label')||!ids.has(String(e.a))||!ids.has(String(e.b))||e.a===e.b||!text(e.label,24))return;
    if(new Set(v.measurements).size!==v.measurements.length||!v.measurements.every(m=>['volume','surfaceArea'].includes(String(m)))
      ||(v.answer!==null&&(!['volume','surfaceArea'].includes(String(v.answer))||v.measurements.includes(v.answer)||!v.prompt)))return;
    const result=structuredClone(v) as MathSolid;solidGeometry(result);return result;
  }catch{return;}
}
export function checkSolidAnswer(s:MathSolid,input:string){
  if(!s.answer||!input.trim())return 'invalid';
  try{const expected=solidGeometry(s)[s.answer],answer=Number(input.replace(',','.'));
    return !Number.isFinite(answer)?'invalid':Math.abs(expected-answer)<=.000500001?'correct':'incorrect';}catch{return 'invalid';}
}
export function renderMathSolid(s:MathSolid):Primitive[]{
  const g=solidGeometry(s),out:Primitive[]=[];const de=s.language==='de';
  const label=(x:number,y:number,text:string,size=13)=>out.push({kind:'text',x,y,text,size});
  const path=(d:string,stroke:string,fill='none',width=1.4)=>out.push({kind:'path',d,stroke,fill,width});
  const y=s.yaw*Math.PI/180,p=s.pitch*Math.PI/180;
  const rotate=([a,b,c]:Vec):Vec=>{const u=a*Math.cos(y)-b*Math.sin(y),v=a*Math.sin(y)+b*Math.cos(y);return [u,v*Math.sin(p)-c*Math.cos(p),v*Math.cos(p)+c*Math.sin(p)];};
  const rotated=[...g.points.values()].map(rotate),xmin=Math.min(...rotated.map(v=>v[0])),xmax=Math.max(...rotated.map(v=>v[0])),ymin=Math.min(...rotated.map(v=>v[1])),ymax=Math.max(...rotated.map(v=>v[1]));
  const scale=Math.min(380/Math.max(.001,xmax-xmin),210/Math.max(.001,ymax-ymin));
  const project=(v:Vec):[number,number]=>{const r=rotate(v);return [250+(r[0]-(xmin+xmax)/2)*scale,210+(r[1]-(ymin+ymax)/2)*scale];};
  label(25,26,s.title,17);let line='',row=0;for(const word of s.prompt.split(/\s+/)){if((line+' '+word).length>58){label(25,49+row++*16,line,12);line='';}line+=(line?' ':'')+word;}if(line)label(25,49+row*16,line,12);
  const visible=g.faces.map(f=>rotate(f.normal)[2]>1e-9),colors=['#ffcf99','#b8d8fa','#b8e5d9','#dfc5f2','#f5c6cb','#f6e1a5'];
  const linePath=(a:Vec,b:Vec,dashed=false)=>{const [x1,y1]=project(a),[x2,y2]=project(b);if(!dashed)return `M ${x1} ${y1} L ${x2} ${y2}`;
    return Array.from({length:12},(_,i)=>{const t=i/12,u=(i+.55)/12;return `M ${x1+(x2-x1)*t} ${y1+(y2-y1)*t} L ${x1+(x2-x1)*u} ${y1+(y2-y1)*u}`;}).join(' ');};
  g.faces.map((f,i)=>({...f,index:i,depth:rotate(f.center)[2]})).filter(f=>visible[f.index]).sort((a,b)=>a.depth-b.depth).forEach(f=>path(f.vertices.map((v,i)=>`${i?'L':'M'} ${project(v).join(' ')}`).join(' ')+' Z','#526074',colors[f.index%colors.length]));
  for(const e of g.edges){const front=e.faces.some(i=>visible[i]);path(linePath(g.points.get(e.a)!,g.points.get(e.b)!,!front),front?'#374151':'#94a3b8','none',front?1.7:1);}
  for(const e of s.segments){const a=g.points.get(e.a)!,b=g.points.get(e.b)!;path(linePath(a,b,true),'#d14e1a','none',2);const [x,y]=project(mean([a,b]));label(x+5,y-5,e.label,12);}
  for(const [id,v] of g.points){const [x,y]=project(v);out.push({kind:'circle',x,y,r:3,fill:'#374151'});label(x+5,y-6,id,11);}
  label(25,350,`${g.vertexCount} ${de?'Ecken':'вершин'} · ${g.edges.length} ${de?'Kanten':'рёбер'} · ${g.faces.length} ${de?'Flächen':'граней'}`);
  s.measurements.forEach((m,i)=>label(25,376+i*20,`${m==='volume'?(de?'Volumen':'Объём'):(de?'Oberfläche':'Площадь поверхности')}: ${Math.round(g[m]*1000)/1000}`));
  return out;
}
