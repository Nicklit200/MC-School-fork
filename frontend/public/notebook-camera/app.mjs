import {defaultDocumentView, rawDocumentView, validateDocumentView, validQuad, estimatedRatio, detectVideoDocument, makeDocumentMap, LiveDocumentRenderer, QUALITY_PROFILES} from './signal.mjs?v=shared-notebook-1';

const TEXT={"qualityOk": "\u0420\u0435\u0436\u0438\u043c \u0437\u0430\u043f\u0440\u043e\u0448\u0435\u043d. \u0424\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u043f\u043e\u043a\u0430\u0437\u0430\u043d\u043e \u043d\u0438\u0436\u0435.", "focusOk": "\u041a\u0430\u043c\u0435\u0440\u0430 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043b\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0443 \u0444\u043e\u043a\u0443\u0441\u0430.", "failed": "\u041a\u0430\u043c\u0435\u0440\u0430 \u043d\u0435 \u043f\u0440\u0438\u043c\u0435\u043d\u0438\u043b\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0443.", "FOCUS_UNSUPPORTED": "\u042d\u0442\u043e\u0442 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u043d\u0435 \u0434\u0430\u0451\u0442 \u0443\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c \u0444\u043e\u043a\u0443\u0441\u043e\u043c. \u0422\u0435\u043b\u0435\u0444\u043e\u043d \u043d\u0430\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0435\u0442 \u0435\u0433\u043e \u0441\u0430\u043c.", "FOCUS_UNCONFIRMED": "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043b \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0444\u043e\u043a\u0443\u0441\u0430.", "BUSY": "\u041a\u0430\u043c\u0435\u0440\u0430 \u0437\u0430\u043d\u044f\u0442\u0430. \u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u043e\u0441\u043b\u0435 \u043f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043a.", "waitCamera": "\u0414\u0430\u043d\u043d\u044b\u0435 \u043a\u0430\u043c\u0435\u0440\u044b \u043f\u043e\u044f\u0432\u044f\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f.", "manual": "\u0420\u0443\u0447\u043d\u043e\u0439 \u0444\u043e\u043a\u0443\u0441 \u0432\u043a\u043b\u044e\u0447\u0451\u043d. \u0422\u0435\u043b\u0435\u0444\u043e\u043d \u0438 \u043b\u0438\u0441\u0442 \u043d\u0435 \u0434\u0432\u0438\u0433\u0430\u0442\u044c.", "continuous": "\u041d\u0435\u043f\u0440\u0435\u0440\u044b\u0432\u043d\u044b\u0439 \u0430\u0432\u0442\u043e\u0444\u043e\u043a\u0443\u0441 \u0432\u043a\u043b\u044e\u0447\u0451\u043d.", "available": "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043c\u044b\u0435 \u043a\u0430\u043c\u0435\u0440\u043e\u0439 \u043a\u043d\u043e\u043f\u043a\u0438.", "returnView": "\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u0432\u0438\u0434 \u0441\u0432\u0435\u0440\u0445\u0443", "compare": "\u0421\u0440\u0430\u0432\u043d\u0438\u0442\u044c \u0441 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u043c", "original": "\u0418\u0441\u0445\u043e\u0434\u043d\u044b\u0439 \u043a\u0430\u0434\u0440 / \u043f\u043e\u0432\u043e\u0440\u043e\u0442 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d", "noChannel": "\u041d\u0435\u0442 \u043a\u0430\u043d\u0430\u043b\u0430 \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f. \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0442\u0435\u043b\u0435\u0444\u043e\u043d \u0437\u0430\u043d\u043e\u0432\u043e.", "timeout": "\u0422\u0435\u043b\u0435\u0444\u043e\u043d \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b. Страница камеры должна оставаться открытой.", "applying": "\u041f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u043c \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0443 \u043d\u0430 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0435...", "cpu": "\u0411\u0435\u0437 GPU: \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e, \u043a\u0430\u0434\u0440\u044b \u043e\u0431\u043d\u043e\u0432\u043b\u044f\u044e\u0442\u0441\u044f \u0440\u0435\u0436\u0435.", "fullFrame": "\u041a\u0430\u0434\u0440 \u0432\u043f\u0438\u0441\u0430\u043d \u0432 \u044d\u043a\u0440\u0430\u043d \u0431\u0435\u0437 \u043e\u0431\u0440\u0435\u0437\u043a\u0438.", "fps": "\u043a\u0430\u0434\u0440/\u0441", "mbps": "\u041c\u0431\u0438\u0442/\u0441"};
const $ = id => document.getElementById(id);
const video = $('remote'), ink = $('ink'), ctx = ink.getContext('2d');
let room=null,hasVideo=false,bridgeConnected=false;
// Media and authentication stay in the lesson React component. Only typed
// camera commands cross this bridge; media is assigned by the same-origin parent.
const rtc={dataChannel:{readyState:'closed'},sendData(value){
 if(!bridgeConnected||window.parent===window)return false;
 try{if(JSON.stringify(value).length>4096)return false;window.parent.postMessage({type:'mindcrafti-notebook-command',value},location.origin);return true;}catch{return false;}
}};
let strokes = [], undone = [], current = null, pointerId = null;
let tool = 'pen', paintJob = 0, lastAspect = 0;
let documentView = defaultDocumentView(), mapping = makeDocumentMap(documentView, 1, 1);
let flattened = $('flattened');
const renderer = new LiveDocumentRenderer(video, flattened, {onCanvasReplace:canvas=>{flattened=canvas;},onError:()=>status('Не удалось обработать видео. Переподключите камеру в уроке.')});

let editor = null, cameraDevices = [];
let comparing=false,cameraState=null,pendingCommand=null,statsPrevious=null,statsBusy=false,notebookCompact=false;
const CORNER_GUTTER=26;
// The processor edits canonical document geometry; only committed views cross
// the parent bridge. Corner drafts and Compare remain local presentation state.
function visibleDocumentView() {
  return editor?.editing || comparing ? {...rawDocumentView(video.videoWidth / video.videoHeight), turn: documentView.turn} : documentView;
}
function transformed() { const view=visibleDocumentView(); return !!view.corners || view.turn !== 0; }
function rememberView() {
  if (!room) return;
  try { sessionStorage.setItem(`camera-document-${room.id}`, JSON.stringify({view: documentView, format: $('pageFormat').value})); } catch {}
}
function shareDocumentView() {
  if(!room||window.parent===window)return;
  const value=validateDocumentView(documentView);if(!value)return;
  try{window.parent.postMessage({type:'mindcrafti-notebook-view',value},location.origin);}catch{}
}
function applyDocumentView(value,notify=true) {
  const validated=validateDocumentView(value); if(!validated) return false;
  const previous=JSON.stringify(documentView);
  finishStroke(); documentView=validated; rememberView(); syncVideoSize(false); drawInk();
  if(notify&&JSON.stringify(documentView)!==previous)shareDocumentView();
  return true;
}
function receiveData(value) {
  receiveCameraData(value);
  // Ignore document-view from older phones: it must never overwrite viewer settings.
  if (value?.type==='camera-list' && Array.isArray(value.devices)) {
    cameraDevices=value.devices.slice(0,8).filter(d=>d && typeof d.id==='string' && d.id.length>0 && d.id.length<=256 && typeof d.label==='string');
    $('cameraDevice').replaceChildren(...cameraDevices.map((d,i)=>{
      const o=document.createElement('option');o.value=d.id;o.textContent=d.label.slice(0,80)||`Camera ${i+1}`;o.selected=d.id===value.selected;return o;
    }));
    controls();
  }
  if (value?.type==='camera-status' && typeof value.message==='string') status(value.message.slice(0,240));
}
$('cameraDevice').onchange=()=>{
  const deviceId=$('cameraDevice').value;
  if(cameraDevices.some(d=>d.id===deviceId) && rtc?.sendData({type:'camera-select',deviceId})) {
    status('\u041f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0435\u043c \u043a\u0430\u043c\u0435\u0440\u0443\u2026');
  } else status('\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430 \u0438 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0435\u0433\u043e \u0437\u0430\u043d\u043e\u0432\u043e.');
};


function status(text) { $('status').textContent = text; }
function canDraw() {
  return hasVideo && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
}
function controls() {
  const enabled = canDraw() && !editor?.editing && !editor?.detecting;
  for (const id of ['pen', 'eraser', 'color', 'stylusOnly', 'save']) $(id).disabled = !enabled;
  $('undo').disabled = !enabled || strokes.length === 0;
  $('redo').disabled = !enabled || undone.length === 0;
  $('clear').disabled = !enabled || strokes.length === 0;
  $('mode').textContent = enabled
    ? '\u041f\u0420\u042f\u041c\u041e\u0419 \u042d\u0424\u0418\u0420 + \u041f\u041e\u041c\u0415\u0422\u041a\u0418'
    : '\u041e\u0416\u0418\u0414\u0410\u041d\u0418\u0415 \u041a\u0410\u041c\u0415\u0420\u042b';
  if (enabled && documentView.corners) $('mode').textContent = 'ВИД СВЕРХУ + ПОМЕТКИ';
  $('viewState').textContent = enabled ? (documentView.corners ? 'Лист выровнен' : 'Весь кадр') + ' / ' + documentView.turn * 90 + '°' : '';
  $('mode').classList.toggle('live', enabled);
  ink.hidden = !enabled;
  $('cameraDevice').disabled = !enabled || cameraDevices.length === 0;
  editor?.refreshControls(); refreshCameraControls();
}
function fit() {
  const {width, height} = $('stage').getBoundingClientRect();
  const w = ink.width, h = ink.height;
  if (!canDraw() || !w || !h) return;
  const horizontalSpace = notebookCompact ? 12 : 2 * CORNER_GUTTER + 24;
  const verticalSpace = notebookCompact ? 12 : 2 * CORNER_GUTTER + 100;
  const scale = Math.max(1 / Math.max(w, h), Math.min((width - horizontalSpace) / w, (height - verticalSpace) / h));
  $('surface').style.width = `${w * scale}px`;
  $('surface').style.height = `${h * scale}px`;
  editor?.drawCorners();
}
// Coordinates belong to the camera image, not the tablet's viewport. Resizing
// the viewer does not move marks relative to the video. No video is paused or
// painted onto the ink canvas: it continues playing on a separate lower layer.
// Strokes stay in original camera coordinates across cropping and rotation.
function strokeScale(point) {
  const w=video.videoWidth||1,h=video.videoHeight||1,short=Math.min(w,h),e=.0001;
  const p=mapping.cameraToOutput(point);
  const x=mapping.cameraToOutput({x:point.x+e*short/w,y:point.y});
  const y=mapping.cameraToOutput({x:point.x,y:point.y+e*short/h});
  const scale=(Math.hypot((x.x-p.x)*ink.width,(x.y-p.y)*ink.height)+Math.hypot((y.x-p.x)*ink.width,(y.y-p.y)*ink.height))/(2*e);
  return Number.isFinite(scale)&&scale>0?Math.min(scale,100000):Math.min(ink.width,ink.height);
}
function drawInk() {
  ctx.clearRect(0,0,ink.width,ink.height);
  for(const stroke of strokes){
    const width=stroke.width*strokeScale(stroke.points[0]);
    ctx.globalCompositeOperation=stroke.tool==='eraser'?'destination-out':'source-over';
    ctx.strokeStyle=ctx.fillStyle=stroke.color;ctx.lineWidth=width;ctx.lineCap=ctx.lineJoin='round';
    ctx.beginPath();let started=false;
    for(const point of stroke.points){const p=mapping.cameraToOutput(point);if(!Number.isFinite(p.x)||!Number.isFinite(p.y)){started=false;continue;}if(started)ctx.lineTo(p.x*ink.width,p.y*ink.height);else ctx.moveTo(p.x*ink.width,p.y*ink.height);started=true;}
    if(stroke.points.length===1){const p=mapping.cameraToOutput(stroke.points[0]);if(Number.isFinite(p.x)&&Number.isFinite(p.y)){ctx.beginPath();ctx.arc(p.x*ink.width,p.y*ink.height,width/2,0,Math.PI*2);ctx.fill();}}else ctx.stroke();
  }
  ctx.globalCompositeOperation='source-over';
}
function queuePaint() {
  if (!paintJob) paintJob = requestAnimationFrame(() => { paintJob = 0; drawInk(); });
}
function syncVideoSize(notify=true) {
  if(!hasVideo||!video.videoWidth||!video.videoHeight){renderer.stop();controls();return;}
  const sourceAspect=video.videoWidth/video.videoHeight;
  let changed=false;
  if(documentView.corners&&Math.abs(sourceAspect/documentView.sourceAspect-1)>.06){
    documentView={...defaultDocumentView(sourceAspect),turn:documentView.turn};
    if(editor){editor.editing=false;editor.releaseDrag();editor.note('\u0424\u043e\u0440\u043c\u0430\u0442 \u043a\u0430\u043c\u0435\u0440\u044b \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f. \u0412\u044b\u0440\u043e\u0432\u043d\u044f\u0439\u0442\u0435 \u043b\u0438\u0441\u0442 \u0437\u0430\u043d\u043e\u0432\u043e \u0437\u0434\u0435\u0441\u044c.');}
    changed=true;
  }
  if(!documentView.corners&&documentView.sourceAspect!==sourceAspect){documentView={...documentView,sourceAspect};changed=true;}
  if(changed){rememberView();if(notify!==false)shareDocumentView();}
  const view=visibleDocumentView();
  mapping=makeDocumentMap(view,video.videoWidth,video.videoHeight);
  flattened.hidden=!transformed();
  if(transformed()){renderer.setView(view);renderer.start();}else renderer.stop();
  const w=transformed()?flattened.width:video.videoWidth,h=transformed()?flattened.height:video.videoHeight;
  if(ink.width!==w||ink.height!==h){ink.width=w;ink.height=h;}
  lastAspect=sourceAspect;drawInk();fit();controls();updateQualityDisplay();
}
new ResizeObserver(fit).observe($('stage'));
for (const event of ['loadedmetadata', 'loadeddata', 'resize', 'playing', 'emptied']) {
  video.addEventListener(event, syncVideoSize);
}
function point(event) {
  const b = ink.getBoundingClientRect();
  return mapping.outputToCamera({
    x: Math.max(0, Math.min(1, (event.clientX - b.left) / b.width)),
    y: Math.max(0, Math.min(1, (event.clientY - b.top) / b.height)),
  });
}
function finishStroke(cancel = false) {
  if (current && cancel) strokes = strokes.filter(stroke => stroke !== current);
  const id = pointerId;
  current = null; pointerId = null;
  if (id !== null && ink.hasPointerCapture(id)) ink.releasePointerCapture(id);
  queuePaint(); controls();
}
ink.addEventListener('pointerdown', event => {
  if (!canDraw() || editor?.editing || editor?.detecting || event.button > 0 || pointerId !== null) return;
  if ($('stylusOnly').checked && event.pointerType !== 'pen') return;
  if (event.isPrimary === false) return;
  event.preventDefault();
  pointerId = event.pointerId;
  const first=point(event);
  current={tool,color:$('color').value,width:(tool==='eraser'?7:1)/300*Math.min(ink.width,ink.height)/strokeScale(first),points:[first]};
  strokes.push(current); undone = [];
  try { ink.setPointerCapture(event.pointerId); } catch { /* Synthetic test events have no OS pointer. */ }
  queuePaint(); controls();
});
ink.addEventListener('pointermove', event => {
  if (!current || event.pointerId !== pointerId) return;
  event.preventDefault();
  const batch = event.getCoalescedEvents?.();
  for (const sample of batch?.length ? batch : [event]) current.points.push(point(sample));
  queuePaint();
});
ink.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  if (current && current.points.length > 1) current.points.push(point(event));
  finishStroke();
});
ink.addEventListener('pointercancel', event => { if (event.pointerId === pointerId) finishStroke(true); });
ink.addEventListener('lostpointercapture', event => { if (event.pointerId === pointerId) finishStroke(); });
ink.addEventListener('contextmenu', event => event.preventDefault());

for (const name of ['pen', 'eraser']) $(name).onclick = () => {
  finishStroke(); tool = name;
  for (const t of ['pen', 'eraser']) {
    $(t).classList.toggle('selected', t === tool);
    $(t).setAttribute('aria-pressed', String(t === tool));
  }
};
$('stylusOnly').onchange = () => finishStroke();
$('undo').onclick = () => { finishStroke(); if (strokes.length) undone.push(strokes.pop()); drawInk(); controls(); };
$('redo').onclick = () => { finishStroke(); if (undone.length) strokes.push(undone.pop()); drawInk(); controls(); };
$('clear').onclick = () => { finishStroke(); strokes = []; undone = []; drawInk(); controls(); };

// A still image may be downloaded, but taking it NEVER pauses the live video.
$('save').onclick = () => {
  if (!canDraw() || editor?.editing || editor?.detecting) return;
  finishStroke(); drawInk();
  const canvas = document.createElement('canvas');
  canvas.width=ink.width;canvas.height=ink.height;
  const exportCtx = canvas.getContext('2d');
  if(transformed())renderer.render();
  exportCtx.drawImage(transformed()?flattened:video,0,0,canvas.width,canvas.height);
  exportCtx.drawImage(ink, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) { status('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u0430\u0434\u0440.'); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `mindcrafti-notebook-${Date.now()}.png`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'image/png');
};

class ViewerDocument {
  constructor(){
    this.overlay=$('corners');this.context=this.overlay.getContext('2d');this.editing=false;this.detecting=false;this.draft=[];this.drag=null;this.generation=0;
    $('alignPage').onclick=()=>this.detect();$('adjustCorners').onclick=()=>this.edit();
    $('applyCorners').onclick=()=>this.applyDraft();$('cancelCorners').onclick=()=>this.cancel();
    $('viewerRotate90').onclick=()=>this.rotate(1);$('viewerRotate180').onclick=()=>this.rotate(2);
    $('originalView').onclick=()=>this.reset();
    $('pageFormat').onchange=()=>{
      if(documentView.corners)applyDocumentView({...documentView,ratio:this.ratio(documentView.corners)});else rememberView();
    };
    this.overlay.addEventListener('pointerdown',e=>{
      if(!this.editing||this.drag||e.isPrimary===false||e.button>0)return;
      const b=$('surface').getBoundingClientRect();let best=-1,distance=Infinity;
      this.draft.forEach((p,i)=>{const q=mapping.cameraToOutput(p),d=Math.hypot(q.x*b.width+b.left-e.clientX,q.y*b.height+b.top-e.clientY);if(d<distance){distance=d;best=i;}});
      if(distance>50||best<0)return;
      e.preventDefault();const point=mapping.cameraToOutput(this.draft[best]);this.drag={id:e.pointerId,index:best,offsetX:e.clientX-b.left-point.x*b.width,offsetY:e.clientY-b.top-point.y*b.height};try{this.overlay.setPointerCapture(e.pointerId);}catch{}this.drawCorners();
    });
    this.overlay.addEventListener('pointermove',e=>{if(this.drag?.id===e.pointerId)this.move(e);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.overlay.addEventListener(event,e=>{if(this.drag?.id===e.pointerId)this.releaseDrag();});
    this.resetNote();
  }
  note(text){$('documentStatus').textContent=text;}
  resetNote(){this.note('\u041f\u043e\u0432\u043e\u0440\u043e\u0442 180\u00b0 \u0432\u043a\u043b\u044e\u0447\u0451\u043d \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e. \u0412\u0441\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043b\u0438\u0441\u0442\u0430 \u0437\u0434\u0435\u0441\u044c, \u043d\u0435 \u043d\u0430 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0435.');}
  refreshControls(){
    const ready=canDraw(),locked=!ready||this.editing||this.detecting||comparing;
    for(const id of ['alignPage','adjustCorners','viewerRotate90','viewerRotate180','originalView','pageFormat'])$(id).disabled=locked;
    $('applyCorners').disabled=!ready||!validQuad(this.draft);$('cancelCorners').disabled=!ready;
    $('cornerActions').hidden=!this.editing;this.overlay.hidden=!ready||!this.editing;
    $('stage').classList.toggle('editing-corners',this.editing);
    const q=this.editing?this.draft:documentView.corners;
    $('cropWarning').hidden=!ready||!q?.some(p=>p.x<.014||p.x>.986||p.y<.014||p.y>.986);
    if(this.editing)$('mode').textContent='\u0423\u0413\u041b\u042b \u041b\u0418\u0421\u0422\u0410 \u00b7 \u042d\u0424\u0418\u0420 \u0418\u0414\u0401\u0422';
  }
  ratio(q){const r=estimatedRatio(q,video.videoWidth,video.videoHeight);return $('pageFormat').value==='a4'?(r>=1?Math.SQRT2:1/Math.SQRT2):$('pageFormat').value==='square'?1:r;}
  async detect(){
    if(!canDraw()||this.editing||this.detecting||comparing)return;
    finishStroke();this.detecting=true;const generation=++this.generation,source=video.srcObject;
    controls();this.note('\u0418\u0449\u0435\u043c \u0433\u0440\u0430\u043d\u0438\u0446\u044b \u043b\u0438\u0441\u0442\u0430\u2026');
    try{
      await new Promise(r=>setTimeout(r,35));if(!canDraw()||source!==video.srcObject||generation!==this.generation)return;
      const found=detectVideoDocument(video);
      if(found){applyDocumentView({...documentView,corners:found.corners,ratio:this.ratio(found.corners),sourceAspect:video.videoWidth/video.videoHeight});this.note('\u041b\u0438\u0441\u0442 \u0432\u044b\u0440\u043e\u0432\u043d\u0435\u043d. \u041c\u043e\u0436\u043d\u043e \u043f\u0438\u0441\u0430\u0442\u044c \u043f\u043e\u0432\u0435\u0440\u0445 \u0436\u0438\u0432\u043e\u0433\u043e \u0432\u0438\u0434\u0435\u043e.');}
      else{this.detecting=false;this.edit();this.note('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0443\u0432\u0435\u0440\u0435\u043d\u043d\u043e \u043d\u0430\u0439\u0442\u0438 \u043b\u0438\u0441\u0442. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0447\u0435\u0442\u044b\u0440\u0435 \u0442\u043e\u0447\u043a\u0438 \u043a \u0435\u0433\u043e \u0443\u0433\u043b\u0430\u043c \u043d\u0430 \u044d\u0442\u043e\u043c \u044d\u043a\u0440\u0430\u043d\u0435.');}
    }catch{this.note('\u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u041f\u043e\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0443\u0433\u043b\u044b\u00bb \u0438 \u0432\u044b\u0434\u0435\u043b\u0438\u0442\u0435 \u043b\u0438\u0441\u0442 \u0432\u0440\u0443\u0447\u043d\u0443\u044e.');}
    finally{if(generation===this.generation){this.detecting=false;controls();}}
  }
  edit(){
    if(!canDraw()||this.detecting||comparing)return;finishStroke();
    this.draft=(documentView.corners||[{x:.12,y:.12},{x:.88,y:.12},{x:.88,y:.88},{x:.12,y:.88}]).map(p=>({...p}));
    this.editing=true;this.note('\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0442\u043e\u0447\u043a\u0438 \u043d\u0430 \u0443\u0433\u043b\u044b \u043b\u0438\u0441\u0442\u0430. \u0417\u0430\u0442\u0435\u043c \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u0413\u043e\u0442\u043e\u0432\u043e\u00bb. \u0412\u0438\u0434\u0435\u043e \u043d\u0435 \u043e\u0441\u0442\u0430\u043d\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u0442\u0441\u044f.');
    syncVideoSize();this.drawCorners();
  }
  applyDraft(){
    if(!this.editing||!validQuad(this.draft)||!canDraw())return;
    const view={...documentView,corners:this.draft.map(p=>({...p})),ratio:this.ratio(this.draft),sourceAspect:video.videoWidth/video.videoHeight};
    this.editing=false;this.releaseDrag();applyDocumentView(view);
    this.note('\u0413\u043e\u0442\u043e\u0432\u043e. \u0412\u0438\u0434 \u0441\u0432\u0435\u0440\u0445\u0443 \u0432 \u043f\u0440\u044f\u043c\u043e\u043c \u044d\u0444\u0438\u0440\u0435.');
  }
  cancel(){this.editing=false;this.releaseDrag();syncVideoSize();this.note('\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f \u0443\u0433\u043b\u043e\u0432 \u043e\u0442\u043c\u0435\u043d\u0435\u043d\u044b.');}
  rotate(turn){if(!canDraw()||this.editing||this.detecting||comparing)return;applyDocumentView({...documentView,turn:(documentView.turn+turn)%4});this.note('\u041f\u043e\u0432\u043e\u0440\u043e\u0442 '+documentView.turn*90+'\u00b0. \u041f\u043e\u043c\u0435\u0442\u043a\u0438 \u043f\u043e\u0432\u043e\u0440\u0430\u0447\u0438\u0432\u0430\u044e\u0442\u0441\u044f \u0432\u043c\u0435\u0441\u0442\u0435 \u0441 \u043b\u0438\u0441\u0442\u043e\u043c.');}
  reset(){if(!canDraw()||this.editing||this.detecting||comparing)return;$('pageFormat').value='auto';applyDocumentView(defaultDocumentView(video.videoWidth/video.videoHeight));this.resetNote();}
  move(e){
    if(!this.drag)return;e.preventDefault();
    const b=$('surface').getBoundingClientRect();
    const x=Math.max(0,Math.min(1,(e.clientX-b.left-this.drag.offsetX)/b.width));
    const y=Math.max(0,Math.min(1,(e.clientY-b.top-this.drag.offsetY)/b.height));
    const p=mapping.outputToCamera({x,y});
    this.draft[this.drag.index]={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};
    this.drawCorners();this.refreshControls();
  }
  releaseDrag(){const id=this.drag?.id;this.drag=null;if(id!==undefined&&this.overlay.hasPointerCapture(id))this.overlay.releasePointerCapture(id);}
  drawCorners(){
    if(!this.editing||!canDraw())return;
    const c=this.overlay,b=c.getBoundingClientRect(),surface=$('surface').getBoundingClientRect();if(!b.width)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    c.width=Math.round(b.width*dpr);c.height=Math.round(b.height*dpr);
    const ctx=this.context;ctx.setTransform(dpr,0,0,dpr,0,0);
    const dx=surface.left-b.left,dy=surface.top-b.top;
    const q=this.draft.map(p=>{const v=mapping.cameraToOutput(p);return {x:dx+v.x*surface.width,y:dy+v.y*surface.height};});
    ctx.clearRect(0,0,b.width,b.height);
    ctx.beginPath();ctx.rect(dx,dy,surface.width,surface.height);ctx.moveTo(q[0].x,q[0].y);for(const p of q.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fillStyle='rgba(10,24,34,.40)';ctx.fill('evenodd');
    ctx.beginPath();q.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.strokeStyle=validQuad(this.draft)?'#159f85':'#d44949';ctx.lineWidth=2;ctx.stroke();
    q.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,18,0,Math.PI*2);ctx.fillStyle=this.drag?.index===i?'#dff5ed':'white';ctx.fill();ctx.stroke();ctx.fillStyle='#196d65';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),p.x,p.y);});
  }

}
editor=new ViewerDocument();

function receiveCameraData(value){
 if(value?.type==='camera-state'&&value.version===1&&value.settings&&value.focus){
  const st=value.settings,f=value.focus;
  const modes=Array.isArray(f.modes)?f.modes.filter(m=>['continuous','manual','single-shot','none'].includes(m)):[];
  const d=f.distance,distance=d&&Number.isFinite(d.min)&&Number.isFinite(d.max)&&Number.isFinite(d.step)&&d.max>d.min&&d.step>0?{min:d.min,max:d.max,step:d.step}:null;
  cameraState={settings:{},focus:{modes,distance},quality:Object.hasOwn(QUALITY_PROFILES,value.quality)?value.quality:'detail'};
  for(const k of ['width','height','frameRate','focusDistance'])if(Number.isFinite(st[k]))cameraState.settings[k]=st[k];
  if(modes.includes(st.focusMode))cameraState.settings.focusMode=st.focusMode;
  const max=QUALITY_PROFILES[cameraState.quality].render;
  if(renderer.maxDimension!==max){renderer.setMaxDimension(max);syncVideoSize();}
  refreshCameraControls();updateQualityDisplay();
 }
 if(value?.type==='camera-result'&&pendingCommand?.id===value.requestId){
  const pending=pendingCommand;clearTimeout(pending.timer);pendingCommand=null;
  $('cameraMessage').textContent=value.ok?(pending.action==='quality'?TEXT.qualityOk:TEXT.focusOk):TEXT[value.error]||TEXT.failed;
  refreshCameraControls();
 }
}
function refreshCameraControls(){
 const ready=canDraw(),connected=ready&&rtc?.dataChannel?.readyState==='open';
 const locked=!connected||!!pendingCommand,focus=cameraState?.focus,modes=focus?.modes||[],st=cameraState?.settings||{};
 $('qualityMode').disabled=locked||!cameraState||!!editor?.editing;
 if(cameraState&&!pendingCommand)$('qualityMode').value=cameraState.quality;
 $('focusAuto').disabled=locked||!modes.includes('continuous');
 $('focusLock').disabled=locked||!modes.includes('manual')||!focus?.distance||!Number.isFinite(st.focusDistance);
 const manual=modes.includes('manual')&&focus?.distance;
 $('focusDistanceField').hidden=!manual;$('focusDistance').disabled=locked||!manual;
 if(manual){const field=$('focusDistance'),r=focus.distance;field.min=r.min;field.max=r.max;field.step=r.step;if(document.activeElement!==field&&Number.isFinite(st.focusDistance))field.value=st.focusDistance;}
 $('focusStatus').textContent=!cameraState?TEXT.waitCamera:!modes.some(m=>m==='continuous'||m==='manual')?TEXT.FOCUS_UNSUPPORTED:st.focusMode==='manual'?TEXT.manual:st.focusMode==='continuous'?TEXT.continuous:TEXT.available;
 $('compareSource').disabled=!ready||!!editor?.editing||!!editor?.detecting;
 $('compareSource').setAttribute('aria-pressed',String(comparing));$('compareSource').textContent=comparing?TEXT.returnView:TEXT.compare;
 if(comparing)$('viewState').textContent=TEXT.original;
}
function sendCameraCommand(action,value){
 if(pendingCommand||!canDraw())return;const id=crypto.randomUUID();
 if(!rtc?.sendData({type:'camera-control',requestId:id,action,value})){$('cameraMessage').textContent=TEXT.noChannel;return;}
 const timer=setTimeout(()=>{if(pendingCommand?.id!==id)return;pendingCommand=null;$('cameraMessage').textContent=TEXT.timeout;refreshCameraControls();},10000);
 pendingCommand={id,timer,action,value};$('cameraMessage').textContent=TEXT.applying;refreshCameraControls();
}
$('qualityMode').onchange=()=>sendCameraCommand('quality',$('qualityMode').value);
$('focusAuto').onclick=()=>sendCameraCommand('auto');$('focusLock').onclick=()=>sendCameraCommand('lock');
$('focusDistance').onchange=()=>sendCameraCommand('distance',Number($('focusDistance').value));
$('compareSource').onclick=()=>{finishStroke();comparing=!comparing;syncVideoSize();};
function updateQualityDisplay(){
 const size=(w,h)=>Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0?`${Math.round(w)} x ${Math.round(h)}`:'...';
 const st=cameraState?.settings||{};$('captureSize').textContent=size(st.width,st.height);
 $('receiveSize').textContent=canDraw()?size(video.videoWidth,video.videoHeight):'...';
 $('renderSize').textContent=canDraw()?size(ink.width,ink.height):'...';
 $('renderInfo').textContent=canDraw()?(!renderer.gl&&documentView.corners?TEXT.cpu:TEXT.fullFrame):'';
}
const statsTimer=setInterval(updateQualityDisplay,2500);

async function playVideo() {
  const source = video.srcObject;
  try {
    await video.play();
    if (video.srcObject === source) $('resumeVideo').hidden = true;
  } catch (error) {
    if (video.srcObject === source && source && error.name !== 'AbortError') {
      $('resumeVideo').hidden = false;
      status('\u041d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0432\u0438\u0434\u0435\u043e\u00bb \u0434\u043b\u044f \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u044d\u0444\u0438\u0440\u0430.');
    }
  }
}
$('resumeVideo').onclick = playVideo;
video.onclick = playVideo;
function stream(source) {
  finishStroke();
  if(editor){editor.generation++;editor.editing=false;editor.detecting=false;editor.releaseDrag();}
  video.srcObject = source; hasVideo = !!source;
  statsPrevious=null;comparing=false;
  if(!source){cameraState=null;if(pendingCommand)clearTimeout(pendingCommand.timer);pendingCommand=null;$('cameraMessage').textContent='';$('networkInfo').textContent='';}
  updateQualityDisplay();
  $('surface').hidden = !source; $('empty').hidden = !!source;
  $('resumeVideo').hidden = true;
  if (source) {
    void playVideo();
  }
  syncVideoSize(); controls();
}
function resetCamera(id){
 const next=typeof id==='string'&&id.length<=128?id:null;
 if(room?.id===next)return;
 finishStroke();stream(null);room=next?{id:next}:null;
 strokes=[];undone=[];cameraDevices=[];lastAspect=0;documentView=defaultDocumentView();
 $('pageFormat').value='auto';editor?.resetNote();
 if(room){try{const saved=JSON.parse(sessionStorage.getItem('camera-document-'+room.id)),view=validateDocumentView(saved?.view);if(view){documentView=view;$('pageFormat').value=['auto','a4','square'].includes(saved.format)?saved.format:'auto';}}catch{}}
 drawInk();controls();
}
window.setNotebookCameraId=resetCamera;
window.getNotebookDocumentView=()=>validateDocumentView(documentView);
window.setNotebookDocumentView=value=>{
 if(!room||!validateDocumentView(value))return false;
 finishStroke();comparing=false;
 if(editor){editor.generation++;editor.editing=false;editor.detecting=false;editor.releaseDrag();}
 return applyDocumentView(value,false);
};
window.setNotebookCompact=value=>{
 const next=value===true;if(next===notebookCompact)return;
 finishStroke();editor?.releaseDrag();notebookCompact=next;
 document.body.classList.toggle('notebook-compact',next);fit();
};
window.setNotebookStream=source=>{if(source!==video.srcObject)stream(source);};
window.receiveNotebookData=value=>{try{if(JSON.stringify(value).length<=4096)receiveData(value);}catch{}};
window.setNotebookConnected=connected=>{
 bridgeConnected=connected===true;rtc.dataChannel.readyState=bridgeConnected?'open':'closed';
 if(!bridgeConnected){if(pendingCommand)clearTimeout(pendingCommand.timer);pendingCommand=null;cameraState=null;stream(null);}
 else rtc.sendData({type:'camera-request'});
 refreshCameraControls();
};
window.setNotebookStatus=message=>{if(typeof message==='string')status(message.slice(0,240));};
controls();
window.addEventListener('pagehide',()=>{clearInterval(statsTimer);if(pendingCommand)clearTimeout(pendingCommand.timer);renderer.stop();video.srcObject=null;bridgeConnected=false;});
if(window.parent!==window)window.parent.postMessage({type:'mindcrafti-notebook-ready'},location.origin);
