/** Local visual acceptance fixture. No accounts, production APIs, or model calls. */
import {createRoot} from 'react-dom/client';
import {useEffect,useRef,useState} from 'react';
import {WhiteboardCanvas} from '../src/features/online-classes/WhiteboardCanvas';
import {DEFAULT_VIEW} from '../src/features/online-classes/boardView';
import sceneExamples from './math-scenes.json';
import {drawInteractive,parseInteractiveSpec,type InteractiveSpec} from '../src/features/online-classes/interactiveTemplates';
const samples:InteractiveSpec[]=[
  ...sceneExamples as InteractiveSpec[],
  {template:'cube',language:'ru',unfold:0,yaw:-30,pitch:25},
  {template:'graph',language:'ru',function:'quadratic',coefficients:[1,-2,-2]},
  {template:'triangle',language:'ru',vertices:[[-3,-2],[3,-2],[0,3]]},
  {template:'fractionCircle',language:'ru',parts:12,selected:[0,1,2,3,4,5]},
];
function Sheet({spec,revision,save}:{spec:InteractiveSpec;revision:string;save:(s:InteractiveSpec,r:string)=>Promise<string|undefined>}) {
  const [view,setView]=useState(DEFAULT_VIEW);
  return <div style={{position:'relative',height:720,overflow:'hidden',background:'white'}}>
    <WhiteboardCanvas shapes={[{operationId:'fixture',layerOwnerId:'teacher',sequence:1,interactionRevision:revision,
      shape:{kind:'interactive',x:.08,y:.06,w:.84,h:.55,interactive:spec}}]} tool="pen" color="#172033" strokeWidth={2}
      sourceAspect={595/842} paperColor="white" view={view} onViewChange={setView} onCommit={()=>{}}
      onInteractiveCommit={(_id,next,base)=>save(next,base)}/>
  </div>;
}
function App(){
  const [index,setIndex]=useState(0),[spec,setSpec]=useState(samples[0]),[revision,setRevision]=useState('initial'),[commits,setCommits]=useState(0);
  const server=useRef({spec:samples[0],revision:'initial'}),canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{const ctx=canvas.current?.getContext('2d');if(ctx){ctx.clearRect(0,0,1000,880);drawInteractive(ctx,spec,0,0,1000,880);}},[spec]);
  const choose=(n:number)=>{const id=crypto.randomUUID();server.current={spec:samples[n],revision:id};setSpec(samples[n]);setRevision(id);setIndex(n);};
  const save=async(next:InteractiveSpec,base:string)=>{
    if(base!==server.current.revision||!parseInteractiveSpec(next))return;
    const id=crypto.randomUUID();server.current={spec:next,revision:id};setSpec(next);setRevision(id);setCommits(n=>n+1);return id;
  };
  return <main><header><div><small>MINDCRAFTI · KOLIN</small><h1>Один шаблон. Много объяснений.</h1><p>Двигайте точки и ползунки. Изменения видны обеим сторонам, AI для этого не вызывается.</p></div><span className="badge">Локальная проверка</span></header>
    <nav aria-label="Шаблоны">{['Геометрия','Функции','Данные','Куб 3D','График','Треугольник','Доли круга'].map((label,i)=><button key={label} aria-pressed={index===i} onClick={()=>choose(i)}>{label}</button>)}</nav>
    <section><article aria-label="Учитель"><h2>Учитель</h2><Sheet key={'host'+index} spec={spec} revision={revision} save={save}/></article>
      <article aria-label="Ученица"><h2>Ученица</h2><Sheet key={'pupil'+index} spec={spec} revision={revision} save={save}/></article></section>
    <p role="status">Сохранённых изменений: {commits} · AI-запросов: 0</p>
    <details><summary>Снимок текущего состояния для PDF</summary><canvas ref={canvas} width={1000} height={880} style={{width:'min(500px,100%)',background:'white'}}/></details>
  </main>;
}
const style=document.createElement('style');style.textContent=`*{box-sizing:border-box}body{margin:0;background:#f2f4f6;color:#172033;font:16px/1.5 Arial,sans-serif}main{max-width:1240px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:start;gap:16px}small{letter-spacing:2px;color:#d76b2e;font-weight:bold}h1{font-size:32px;margin:8px 0}header p{color:#586579;max-width:750px}nav{display:flex;gap:10px;margin:20px 0}button{font:inherit;padding:10px 18px;border:1px solid #dce3e9;border-radius:10px;background:white;color:#172033;cursor:pointer}button[aria-pressed=true]{background:#172033;color:white}section{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:white;border-radius:18px;padding:16px;border:1px solid #dce3e9}h2{font-size:15px;margin:0 0 8px;color:#586579}.badge{padding:6px 12px;border-radius:20px;background:#e4eee8;font-size:12px;white-space:nowrap}summary{cursor:pointer;padding:12px 0}@media(max-width:650px){main{padding:16px}header{display:block}h1{font-size:25px}section{grid-template-columns:1fr}nav{flex-wrap:wrap}}`;
style.textContent+=' .whiteboard__surface{position:absolute;inset:0;width:100%;height:100%}';
document.head.appendChild(style);createRoot(document.getElementById('root')!).render(<App/>);
