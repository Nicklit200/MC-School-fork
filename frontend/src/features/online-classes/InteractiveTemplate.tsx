import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmt, MAX_PIZZA_CIRCLES, fractionDiscs, fractionFromInputs, graphPoint, parseInteractiveSpec, plot, sectorPath, templateScene, templateTitle, type InteractiveSpec } from './interactiveTemplates';
import './interactive-template.css';
import {checkSceneAnswer,scenePoint,sceneProjection,setSceneParameter} from './mathScene';
import {checkSolidAnswer} from './mathSolid';

export function InteractiveTemplate({spec,revision='',onCommit,disabled=false}: {
  spec:InteractiveSpec; revision?:string; onCommit?:(spec:InteractiveSpec,baseRevision:string)=>Promise<string|undefined>; disabled?:boolean;
}) {
  const [value,setValue]=useState(spec),[status,setStatus]=useState<'idle'|'saving'|'error'>('idle');
  const current=useRef(value),base=useRef(revision),dirty=useRef(false),flight=useRef(false);
  const drag=useRef<{id:number;vertex:number}|null>(null),svg=useRef<SVGSVGElement>(null);
  const clip=useId().replace(/:/g,'');
  const de=value.language==='de';
  const [answer,setAnswer]=useState(''),[answerStatus,setAnswerStatus]=useState<string|null>(null);
  const [numerator,setNumerator]=useState(spec.template==='fractionCircle'?String(spec.selected.length):'0');
  const [denominator,setDenominator]=useState(spec.template==='fractionCircle'?String(spec.parts):'4');
  const [fractionError,setFractionError]=useState<string|null>(null);
  const activeParts=value.template==='fractionCircle'?value.parts:0;
  const activeNumerator=value.template==='fractionCircle'?value.selected.length:0;
  useEffect(()=>{
    if(value.template==='fractionCircle') {
      setNumerator(String(value.selected.length));setDenominator(String(value.parts));setFractionError(null);
    }
  },[activeNumerator,activeParts,value.template]);
  useEffect(()=>setAnswerStatus(null),[value]);
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
  const setFraction=(parts:number,amount:number)=>{
    const next=fractionFromInputs(String(amount),String(parts));
    const v=current.current;
    if(v.template!=='fractionCircle'||!next)return;
    // Step buttons should preserve manually selected sectors wherever possible.
    // Direct numerator/denominator entry deliberately creates the first n sectors.
    const selected=v.parts===parts?[...v.selected]:[];
    while(selected.length>amount) selected.pop();
    for(let i=0;selected.length<amount&&i<parts*4;i++)
      if(!selected.includes(i))selected.push(i);
    setFractionError(null);
    change({...v,parts,selected});
    void commit();
  };
  const applyFraction=(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const next=fractionFromInputs(numerator,denominator);
    if(!next) {
      setFractionError(de?'Nenner 1–24, Zähler 0–4 × Nenner.':'Знаменатель 1–24, числитель от 0 до четырёх целых.');
      return;
    }
    const v=current.current;
    if(v.template!=='fractionCircle')return;
    setFractionError(null);
    change({...v,...next});
    void commit();
  };
  const moveVertex=(index:number,x:number,y:number)=>{
    const v=current.current;
    if(v.template==='scene') {
      const p=v.points[index];let next=v;
      if(p.dragX)next=setSceneParameter(next,p.dragX,x);
      if(p.dragY)next=setSceneParameter(next,p.dragY,y);
      change(next);return;
    }
    if(v.template!=='triangle')return;
    const clamp=(n:number)=>Math.round(Math.max(-5,Math.min(5,n))*10)/10;
    change({...v,vertices:v.vertices.map((p,i)=>i===index?[clamp(x),clamp(y)]:p)});
  };
  const move=(event:React.PointerEvent<SVGSVGElement>)=>{
    const active=drag.current;if(!active||active.id!==event.pointerId||!svg.current)return;
    const box=svg.current.getBoundingClientRect(),scale=Math.min(box.width/500,box.height/440);
    const x=(event.clientX-box.left-(box.width-500*scale)/2)/scale;
    const y=(event.clientY-box.top-(box.height-440*scale)/2)/scale;
    if(current.current.template==='scene')moveVertex(active.vertex,...sceneProjection(current.current).fromPixel(x,y));
    else moveVertex(active.vertex,(x-plot.cx)/plot.scale,(plot.cy-y)/plot.scale);
  };
  const release=(event:React.PointerEvent<SVGSVGElement>)=>{
    if(drag.current?.id===event.pointerId){drag.current=null;void commit();}
  };
  const locked=disabled||status==='saving'||status==='error';
  return <div className="interactive-template" data-template={value.template}>
    <svg ref={svg} viewBox="0 0 500 440" role={disabled?'img':'group'} aria-label={templateTitle(value)}
      onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
      <defs><clipPath id={clip}><rect x={plot.left} y={value.template==='scene'?100:plot.top} width={plot.width} height={value.template==='scene'?240:plot.height}/></clipPath></defs>
      {templateScene(value).map((p,i)=>p.kind==='text'?<text key={i} x={p.x} y={p.y} fontSize={p.size??15} fill={p.fill??'#172033'}>{p.text}</text>
        :p.kind==='circle'?<circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.fill}/>
        :<path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.width??1} fill={p.fill??'none'} clipPath={p.clip?`url(#${clip})`:undefined}/>)}
      {!locked&&value.template==='fractionCircle'&&fractionDiscs(value).flatMap(pizza=>
        Array.from({length:value.parts},(_,index)=>{
          const sector=pizza.offset+index;
          return <path key={sector} d={sectorPath(index,value.parts,pizza.cx,pizza.cy,pizza.r)}
            fill="transparent" role="button" tabIndex={0}
            aria-label={`${de?'Pizza':'Пицца'} ${pizza.pizza}, ${de?'Teil':'кусочек'} ${index+1}`}
            aria-pressed={value.selected.includes(sector)}
            onClick={()=>{const v=current.current;if(v.template!=='fractionCircle')return;
              change({...v,selected:v.selected.includes(sector)?v.selected.filter(n=>n!==sector):[...v.selected,sector]});
              void commit();}}
            onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.dispatchEvent(new MouseEvent('click',{bubbles:true}));}}}/>;
        }))}
      {!locked&&value.template==='triangle'&&value.vertices.map((v,index)=>{const [x,y]=graphPoint(...v);return <circle key={index} cx={x} cy={y} r={17}
        fill="transparent" className="interactive-template__handle" role="button" tabIndex={0} aria-label={`${de?'Punkt':'Точка'} ${'ABC'[index]}`}
        onPointerDown={event=>{event.preventDefault();if(drag.current)return;drag.current={id:event.pointerId,vertex:index};svg.current?.setPointerCapture(event.pointerId);}}
        onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]};
          const d=delta[event.key];if(d){event.preventDefault();moveVertex(index,v[0]+d[0],v[1]+d[1]);}}}
        onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>;})}
      {!locked&&value.template==='scene'&&value.points.map((p,index)=>{
        if(!p.dragX&&!p.dragY)return null;const point=scenePoint(value,p),[x,y]=sceneProjection(value).toPixel(...point);
        if(!Number.isFinite(x)||!Number.isFinite(y)||x<50||x>450||y<100||y>340)return null;
        return <circle key={p.id} cx={x} cy={y} r={15} fill="transparent" className="interactive-template__handle" role="button" tabIndex={0}
          aria-label={`${de?'Punkt':'Точка'} ${p.id}`}
          onPointerDown={event=>{event.preventDefault();if(drag.current)return;drag.current={id:event.pointerId,vertex:index};svg.current?.setPointerCapture(event.pointerId);}}
          onKeyDown={event=>{const delta:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
            const d=delta[event.key];if(d){event.preventDefault();const dx=value.parameters.find(v=>v.name===p.dragX)?.step??0,dy=value.parameters.find(v=>v.name===p.dragY)?.step??0;
              moveVertex(index,point[0]+d[0]*dx,point[1]+d[1]*dy);}}}
          onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>;
      })}
    </svg>
    {!disabled&&(value.template==='scene'||value.template==='solid')&&<div className="math-scene-controls">
      <div className="math-scene-sliders">{value.parameters.map(p=><label key={p.name}><span>{p.label}: {fmt(p.value)}</span>
        <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={p.value} disabled={locked}
          onChange={event=>change(setSceneParameter(value,p.name,Number(event.target.value)))}
          onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/></label>)}</div>
      {value.answer!==null&&<form className="math-scene-answer" onSubmit={event=>{event.preventDefault();setAnswerStatus(value.template==='solid'?checkSolidAnswer(value,answer):checkSceneAnswer(value,answer));}}>
        <label>{de?'Deine Zahl':'Ваш числовой ответ'}<input inputMode="decimal" value={answer} onChange={event=>{setAnswer(event.target.value);setAnswerStatus(null);}} maxLength={40}/></label>
        <button type="submit" disabled={locked}>{de?'Prüfen':'Проверить'}</button>
        <small>{de?'Bei Bedarf auf 3 Nachkommastellen runden.':'При необходимости округлите до 3 знаков.'}</small>
        {answerStatus&&<span role="status">{answerStatus==='correct'?(de?'Richtig':'Верно'):answerStatus==='incorrect'?(de?'Noch einmal versuchen':'Попробуйте ещё'):(de?'Zahl oder Parameter prüfen':'Проверьте число или параметры')}</span>}
      </form>}
    </div>}
    {!disabled&&value.template==='solid'&&<div className="interactive-template__controls">{(['yaw','pitch'] as const).map(field=><label key={field}>
      {field==='yaw'?(de?'Drehen':'Поворот'):(de?'Neigen':'Наклон')}: {fmt(value[field])}
      <input type="range" min={field==='yaw'?-180:-90} max={field==='yaw'?180:90} step={1} value={value[field]} disabled={locked}
        aria-label={field==='yaw'?'Поворот / Drehen':'Наклон / Neigen'} onChange={event=>change({...value,[field]:Number(event.target.value)})}
        onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>
    </label>)}</div>}
    {!disabled&&value.template==='cube'&&<div className="interactive-template__controls">{(['unfold','yaw','pitch'] as const).map(field=><label key={field}>
      <span>{field==='unfold'?(de?'Entfalten':'Раскрыть'):field==='yaw'?(de?'Drehen':'Поворот'):(de?'Neigen':'Наклон')}: {fmt(value[field])}</span>
      <input type="range" aria-label={field==='unfold'?'Раскрыть / Entfalten':field==='yaw'?'Поворот / Drehen':'Наклон / Neigen'}
        min={field==='unfold'?0:field==='yaw'?-180:-90} max={field==='unfold'?1:field==='yaw'?180:90}
        step={field==='unfold'?.01:1} value={value[field]} disabled={locked}
        onChange={event=>change({...value,[field]:Number(event.target.value)})}
        onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>
    </label>)}</div>}
    {!disabled&&value.template==='graph'&&<div className="interactive-template__controls">{value.coefficients.map((coefficient,index)=><label key={index}>
      <span>{value.function==='linear'?['m','b'][index]:['a','b','c'][index]} = {fmt(coefficient)}</span>
      <input type="range" min={-10} max={10} step={.1} value={coefficient} disabled={locked}
        aria-label={value.function==='linear'?['m','b'][index]:['a','b','c'][index]}
        onChange={event=>change({...value,coefficients:value.coefficients.map((n,i)=>i===index?Number(event.target.value):n)})}
        onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/>
    </label>)}</div>}
    {!disabled&&value.template==='fractionCircle'&&<div className="interactive-template__fractions">
      <form noValidate className="interactive-template__fraction-form" onSubmit={applyFraction}>
        <label>{de?'Zähler':'Числитель'}
          <input type="number" min={0} max={MAX_PIZZA_CIRCLES*24} step={1} inputMode="numeric" pattern="[0-9]*"
            value={numerator} disabled={locked} aria-label={de?'Zähler':'Числитель'}
            onChange={event=>{setNumerator(event.target.value);setFractionError(null);}}/></label>
        <span className="interactive-template__fraction-slash" aria-hidden="true">/</span>
        <label>{de?'Nenner':'Знаменатель'}
          <input type="number" min={1} max={24} step={1} inputMode="numeric" pattern="[0-9]*"
            value={denominator} disabled={locked} aria-label={de?'Nenner':'Знаменатель'}
            onChange={event=>{setDenominator(event.target.value);setFractionError(null);}}/></label>
        <button type="submit" disabled={locked}>{de?'Anwenden':'Применить дробь'}</button>
      </form>
      <div className="interactive-template__fraction-sliders">
        <label>{de?'Teile pro Pizza':'Частей в пицце'}: {value.parts}
          <input type="range" min={1} max={24} step={1} value={value.parts} disabled={locked}
            aria-label={de?'Teile pro Pizza':'Частей в пицце'}
            onChange={event=>{const parts=Number(event.target.value);change({...value,parts,
              selected:Array.from({length:Math.min(value.selected.length,parts*4)},(_,i)=>i)});}}
            onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/></label>
        <label>{de?'Gefärbte Stücke':'Закрашенных кусочков'}: {value.selected.length}
          <input type="range" min={0} max={value.parts*4} step={1} value={value.selected.length} disabled={locked}
            aria-label={de?'Gefärbte Stücke':'Закрашенных кусочков'}
            onChange={event=>change({...value,selected:Array.from({length:Number(event.target.value)},(_,i)=>i)})}
            onPointerUp={()=>void commit()} onPointerCancel={()=>void commit()} onKeyUp={()=>void commit()} onBlur={()=>void commit()}/></label>
      </div>
      <div className="interactive-template__fraction-actions">
        <button type="button" disabled={locked||value.selected.length===0}
          onClick={()=>setFraction(value.parts,Math.max(0,value.selected.length-1))}>{de?'− 1 Stück':'− 1 кусочек'}</button>
        <button type="button" disabled={locked||value.selected.length>=value.parts*4}
          onClick={()=>setFraction(value.parts,value.selected.length+1)}>{de?'+ 1 Stück':'+ 1 кусочек'}</button>
        <button type="button" disabled={locked||value.selected.length===0}
          onClick={()=>setFraction(value.parts,0)}>{de?'Alles löschen':'Очистить'}</button>
        <button type="button" disabled={locked||value.selected.length>=value.parts*4}
          onClick={()=>setFraction(value.parts,Math.min(value.parts*4,value.selected.length+value.parts))}>
          {de?'+ 1 Pizza':'+ 1 пицца'}</button>
      </div>
      <p className="interactive-template__fraction-hint">
        {de?'Eigene Brüche, auch 7/4, sind möglich. Bis zu 4 Pizzen.':'Введите любую дробь, например 3/8 или 7/4. До 4 пицц.'}
      </p>
      {fractionError&&<p role="alert">{fractionError}</p>}
    </div>}
    {!disabled&&value.template==='triangle'&&<p>{de?'Punkte ziehen oder mit den Pfeiltasten bewegen.':'Перетаскивайте точки или двигайте их стрелками клавиатуры.'}</p>}
    {status==='saving'&&<p role="status">{de?'Wird gespeichert…':'Сохраняем…'}</p>}
    {status==='error'&&<p role="alert">{de?'Nicht gespeichert. Laden Sie den aktuellen Stand.':'Изменение не сохранено. Загрузите актуальное состояние.'}
      <button type="button" onClick={()=>{current.current=spec;setValue(spec);base.current=revision;dirty.current=false;setStatus('idle');}}>
        {de?'Aktuellen Stand laden':'Загрузить актуальное'}</button></p>}
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
