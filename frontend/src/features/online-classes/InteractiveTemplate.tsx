import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmt, graphPoint, parseInteractiveSpec, plot, sectorPath, templateScene, templateTitle, type InteractiveSpec } from './interactiveTemplates';
import './interactive-template.css';

export function InteractiveTemplate({spec,revision='',onCommit,disabled=false}: {
  spec:InteractiveSpec; revision?:string; onCommit?:(spec:InteractiveSpec,baseRevision:string)=>Promise<string|undefined>; disabled?:boolean;
}) {
  const [value,setValue]=useState(spec),[status,setStatus]=useState<'idle'|'saving'|'error'>('idle');
  const current=useRef(value),base=useRef(revision),dirty=useRef(false),flight=useRef(false);
  const drag=useRef<{id:number;vertex:number}|null>(null),svg=useRef<SVGSVGElement>(null);
  const clip=useId().replace(/:/g,'');
  const de=value.language==='de';
  useEffect(()=>{if(!dirty.current&&!flight.current){current.current=spec;setValue(spec);base.current=revision;}},[spec,revision]);
  const change=(next:InteractiveSpec)=>{
    if(disabled || flight.current || !parseInteractiveSpec(next)) return;
    if(JSON.stringify(next)===JSON.stringify(current.current)) return;
    current.current=next;dirty.current=true;setValue(next);
  };
  const commit=async()=>{
    if(!dirty.current||flight.current||disabled) return;
    if(!onCommit){dirty.current=false;return;}
    flight.current=true;setStatus('saving');
    try {const saved=await onCommit(current.current,base.current);
      if(!saved) {setStatus('error');return;}
      base.current=saved;dirty.current=false;setStatus('idle');
    } catch {setStatus('error');} finally {flight.current=false;}
  };
  const moveVertex=(index:number,x:number,y:number)=>{
    const v=current.current;if(v.template!=='triangle')return;
    const clamp=(n:number)=>Math.round(Math.max(-5,Math.min(5,n))*10)/10;
    change({...v,vertices:v.vertices.map((p,i)=>i===index?[clamp(x),clamp(y)]:p)});
  };
  const move=(event:React.PointerEvent<SVGSVGElement>)=>{
    const active=drag.current;if(!active||active.id!==event.pointerId||!svg.current)return;
    const box=svg.current.getBoundingClientRect(),scale=Math.min(box.width/500,box.height/440);
    const x=(event.clientX-box.left-(box.width-500*scale)/2)/scale;
    const y=(event.clientY-box.top-(box.height-440*scale)/2)/scale;
    moveVertex(active.vertex,(x-plot.cx)/plot.scale,(plot.cy-y)/plot.scale);
  };
  const release=(event:React.PointerEvent<SVGSVGElement>)=>{
    if(drag.current?.id===event.pointerId){drag.current=null;void commit();}
  };
  const locked=disabled||status==='saving'||status==='error';
  return <div className="interactive-template" data-template={value.template}>
    <svg ref={svg} viewBox="0 0 500 440" role={disabled?'img':'group'} aria-label={templateTitle(value)}
      onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
      <defs><clipPath id={clip}><rect x={plot.left} y={plot.top} width={plot.width} height={plot.height}/></clipPath></defs>
      {templateScene(value).map((p,i)=>p.kind==='text'?<text key={i} x={p.x} y={p.y} fontSize={p.size??15} fill={p.fill??'#172033'}>{p.text}</text>
        :p.kind==='circle'?<circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.fill}/>
        :<path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.width??1} fill={p.fill??'none'} clipPath={p.clip?`url(#${clip})`:undefined}/>)}
      {!locked&&value.template==='fractionCircle'&&Array.from({length:value.parts},(_,index)=><path key={index} d={sectorPath(index,value.parts)}
        fill="transparent" role="button" tabIndex={0} aria-label={`${de?'Teil':'Доля'} ${index+1}`} aria-pressed={value.selected.includes(index)}
        onClick={()=>{const v=current.current;if(v.template!=='fractionCircle')return;change({...v,selected:v.selected.includes(index)?v.selected.filter(n=>n!==index):[...v.selected,index]});void commit();}}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.dispatchEvent(new MouseEvent('click',{bubbles:true}));}}}/>)}
      {!locked&&value.template==='triangle'&&value.vertices.map((v,index)=>{const [x,y]=graphPoint(...v);return <circle key={index} cx={x} cy={y} r={17}
        fill="transparent" className="interactive-template__handle" role="button" tabIndex={0} aria-label={`${de?'Punkt':'Точка'} ${'ABC'[index]}`}
        onPointerDown={event=>{event.preventDefault();if(drag.current)return;drag.current={id:event.pointerId,vertex:index};svg.current?.setPointerCapture(event.pointerId);}}
        onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]};
          const d=delta[event.key];if(d){event.preventDefault();moveVertex(index,v[0]+d[0],v[1]+d[1]);}}}
        onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>;})}
    </svg>
    {!disabled&&value.template==='graph'&&<div className="interactive-template__controls">{value.coefficients.map((coefficient,index)=><label key={index}>
      <span>{value.function==='linear'?['m','b'][index]:['a','b','c'][index]} = {fmt(coefficient)}</span>
      <input type="range" min={-10} max={10} step={.1} value={coefficient} disabled={locked}
        aria-label={value.function==='linear'?['m','b'][index]:['a','b','c'][index]}
        onChange={event=>change({...value,coefficients:value.coefficients.map((n,i)=>i===index?Number(event.target.value):n)})}
        onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>
    </label>)}</div>}
    {!disabled&&value.template==='fractionCircle'&&<label className="interactive-template__parts">{de?'Anzahl der Teile':'Количество долей'}: {value.parts}
      <input type="range" min={2} max={24} step={1} value={value.parts} disabled={locked} aria-label={de?'Anzahl der Teile':'Количество долей'}
        onChange={event=>{const parts=Number(event.target.value);change({...value,parts,selected:value.selected.filter(n=>n<parts)});}}
        onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/></label>}
    {!disabled&&value.template==='triangle'&&<p>{de?'Punkte ziehen oder mit den Pfeiltasten bewegen.':'Перетаскивайте точки или двигайте их стрелками клавиатуры.'}</p>}
    {status==='saving'&&<p role="status">{de?'Wird gespeichert…':'Сохраняем…'}</p>}
    {status==='error'&&<p role="alert">{de?'Nicht gespeichert. Schließen und erneut öffnen, um den aktuellen Stand zu laden.'
      :'Изменение не сохранено. Закройте и откройте объект, чтобы загрузить актуальное состояние.'}</p>}
  </div>;
}

export function InteractiveDialog({children,title,onClose}: {children:React.ReactNode;title:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{const focus=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return()=>{document.body.style.overflow=overflow;if(focus instanceof HTMLElement&&focus.isConnected)focus.focus();};},[]);
  return createPortal(<div className="interactive-dialog" onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{
      event.stopPropagation();if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='Tab'){const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')??[]);
        const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}><header><strong>{title}</strong><button type="button" onClick={onClose} aria-label="Закрыть / Schließen">×</button></header>{children}</div>
  </div>,document.body);
}
