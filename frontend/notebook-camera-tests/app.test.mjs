import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import * as signal from '../public/notebook-camera/signal.mjs';

const html=readFileSync(new URL('../public/notebook-camera/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../public/notebook-camera/app.mjs',import.meta.url),'utf8');
const corners=[{x:.22,y:.12},{x:.78,y:.18},{x:.92,y:.91},{x:.09,y:.86}];
const crop=()=>({...signal.defaultDocumentView(16/9),corners:corners.map(p=>({...p})),ratio:1/Math.sqrt(2)});
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(t,settings=false){
 const dom=new JSDOM(html,{url:`https://school.example/notebook-camera/index.html${settings?'?mode=settings':''}`,runScripts:'outside-only'});
 t.after(()=>dom.window.close());
 const {window}=dom,messages=[],contexts=new WeakMap(),frames=[],renderers=[];
 Object.defineProperty(window,'parent',{value:{postMessage:(value,origin)=>messages.push({value:copy(value),origin})}});
 window.ResizeObserver=class{observe(){}};
 window.setInterval=()=>1;window.clearInterval=()=>{};
 window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 window.HTMLMediaElement.prototype.play=async()=>{};
 window.HTMLCanvasElement.prototype.getContext=function(){
  if(!contexts.has(this))contexts.set(this,{arcs:[],clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},closePath(){},rect(){},setTransform(){},fillText(){},arc(...args){this.arcs.push(args);}});
  return contexts.get(this);
 };
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100,right:100,bottom:100});
 window.HTMLElement.prototype.hasPointerCapture=()=>false;
 window.HTMLElement.prototype.setPointerCapture=()=>{};
 class Renderer{
  constructor(video,canvas){this.video=video;this.canvas=canvas;this.gl={};this.running=false;renderers.push(this);}
  setView(view){const map=signal.makeDocumentMap(view,this.video.videoWidth,this.video.videoHeight);Object.assign(this.canvas,signal.outputSize(map.aspect,Math.max(this.video.videoWidth,this.video.videoHeight)));}
  start(){this.running=true;}stop(){this.running=false;}setMaxDimension(){}
 }
 window.__signal={...signal,LiveDocumentRenderer:Renderer};
 // Execute the real app against its complete HTML; only the media renderer is
 // replaced because jsdom does not implement canvas or a decoded video stream.
 const app=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/signal\.mjs(?:\?[^'"]*)?['"];?/m,'const {$1}=window.__signal;');
 assert.notEqual(app,source,'the app module import must be injected');
 window.eval(app);
 const $=id=>window.document.getElementById(id),video=$('remote');
 let width=1920,height=1080;
 Object.defineProperties(video,{videoWidth:{get:()=>width},videoHeight:{get:()=>height},readyState:{get:()=>2}});
 return {window,$,messages,contexts,frames,renderers,
  changes:()=>messages.filter(message=>message.value.type==='mindcrafti-notebook-view'),
  start(id='camera-1'){window.setNotebookCameraId(id);window.setNotebookStream({id});},
  resize(w,h){width=w;height=h;video.dispatchEvent(new window.Event('resize'));},
  view:()=>copy(window.getNotebookDocumentView()),
 };
}

test('lesson settings pause only their preview and keep crop drafts, shared state and quality controls through close/open',async t=>{
 const f=fixture(t,true);f.start();f.messages.length=0;
 assert.equal(f.window.document.body.classList.contains('notebook-settings'),true);
 assert.equal(f.renderers[0].running,false,'a closed settings drawer cannot run a second projection loop');
 assert.equal(f.$('ink').hidden,true);assert.equal(f.$('pen').disabled,true);assert.equal(f.$('save').disabled,true);
 f.window.setNotebookSettingsOpen(true);
 assert.equal(f.renderers[0].running,true);
 f.$('viewerRotate90').click();const committed=f.view();
 assert.equal(committed.turn,3);assert.equal(f.changes().length,1);
 f.$('adjustCorners').click();assert.equal(f.$('corners').hidden,false);
 assert.equal(f.window.setNotebookDocumentView(committed),true);
 assert.equal(f.$('corners').hidden,false,'the ACK of a preceding rotation cannot discard a new corner draft');
 const remote=f.$('remote').srcObject;
 f.window.setNotebookSettingsOpen(false);assert.equal(f.renderers[0].running,false);
 f.window.setNotebookSettingsOpen(true);
 assert.equal(f.renderers[0].running,true);assert.equal(f.$('remote').srcObject,remote);
 assert.equal(f.$('corners').hidden,false);assert.deepEqual(f.view(),committed);
 f.$('applyCorners').click();assert.ok(signal.validQuad(f.view().corners));
 assert.equal(f.changes().length,2);assert.equal(f.$('ink').hidden,true);
 f.window.setNotebookConnected(true);
 f.window.receiveNotebookData({type:'camera-state',version:1,quality:'detail',settings:{width:1920,height:1080},focus:{modes:['continuous']}});
 assert.equal(f.$('qualityMode').disabled,false);assert.equal(f.$('focusAuto').disabled,false);
 f.$('qualityMode').value='balanced';f.$('qualityMode').dispatchEvent(new f.window.Event('change'));
 assert.ok(f.messages.some(message=>message.value.type==='mindcrafti-notebook-command'&&message.value.value.action==='quality'&&message.value.value.value==='balanced'));
 await Promise.resolve();
});

test('lesson settings publish their content height and request close on Escape only while open',t=>{
 const f=fixture(t,true);
 Object.defineProperty(f.window.document.documentElement,'scrollHeight',{configurable:true,value:1640});
 f.window.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(f.messages.some(message=>message.value.type==='mindcrafti-notebook-close-settings'),false);
 f.window.setNotebookSettingsOpen(true);
 for(const callback of f.frames.splice(0))callback(0);
 assert.ok(f.messages.some(message=>message.origin==='https://school.example'&&message.value.type==='mindcrafti-notebook-settings-size'&&message.value.height===1640));
 f.window.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(f.messages.filter(message=>message.value.type==='mindcrafti-notebook-close-settings').length,1);
 f.window.setNotebookSettingsOpen(false);
 f.window.dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 assert.equal(f.messages.filter(message=>message.value.type==='mindcrafti-notebook-close-settings').length,1);
});

test('only committed local rotate, crop, format and reset publish one canonical view each',t=>{
 const f=fixture(t);f.start();f.messages.length=0;
 f.$('viewerRotate90').click();
 assert.equal(f.changes().length,1);assert.equal(f.changes()[0].value.value.turn,3);
 assert.equal(f.changes()[0].origin,'https://school.example');
 f.messages.length=0;
 f.$('adjustCorners').click();
 assert.equal(f.changes().length,0);assert.equal(f.view().corners,null);
 f.$('applyCorners').click();
 assert.equal(f.changes().length,1);assert.ok(signal.validQuad(f.changes()[0].value.value.corners));
 f.messages.length=0;
 f.$('pageFormat').value='square';f.$('pageFormat').dispatchEvent(new f.window.Event('change'));
 assert.equal(f.changes().length,1);assert.equal(f.changes()[0].value.value.ratio,1);
 f.messages.length=0;
 f.$('originalView').click();f.$('originalView').click();
 assert.equal(f.changes().length,1);assert.deepEqual(f.view(),signal.defaultDocumentView(16/9));
});

test('remote geometry requires a camera, validates, persists, and never echoes',t=>{
 const f=fixture(t),value=crop();
 assert.equal(f.window.setNotebookDocumentView(value),false);
 f.start();f.messages.length=0;
 assert.equal(f.window.setNotebookDocumentView(value),true);
 assert.deepEqual(f.view(),value);assert.equal(f.changes().length,0);
 assert.deepEqual(JSON.parse(f.window.sessionStorage.getItem('camera-document-camera-1')).view,value);
 const returned=f.window.getNotebookDocumentView();returned.corners[0].x=.99;
 assert.deepEqual(f.view(),value,'the getter must not expose mutable canonical state');
 assert.equal(f.window.setNotebookDocumentView({...value,turn:4}),false);
 assert.deepEqual(f.view(),value);assert.equal(f.changes().length,0);
});

test('restore and geometry received before metadata survive until the parent requests canonical state',t=>{
 const f=fixture(t),saved=crop();
 f.window.sessionStorage.setItem('camera-document-camera-1',JSON.stringify({view:saved,format:'a4'}));
 f.window.setNotebookCameraId('camera-1');
 assert.deepEqual(f.view(),saved);assert.equal(f.$('pageFormat').value,'a4');assert.equal(f.changes().length,0);
 f.window.setNotebookStream({id:'stream'});
 assert.deepEqual(f.view(),saved);assert.equal(f.changes().length,0);
 f.window.setNotebookCameraId('camera-2');
 assert.equal(f.view().corners,null);assert.equal(f.view().turn,2);
 const remote={...saved,turn:1};
 assert.equal(f.window.setNotebookDocumentView(remote),true);
 f.window.setNotebookStream({id:'stream-2'});
 assert.deepEqual(f.view(),remote);assert.equal(f.changes().length,0);
 f.window.setNotebookCameraId('camera-1');
 assert.deepEqual(f.view(),saved,'camera identities keep separate saved geometry');
});

test('a source aspect change resets incompatible crop once, preserves rotation, and remote apply stays silent',t=>{
 const f=fixture(t);f.start();f.window.setNotebookDocumentView({...crop(),turn:1});f.messages.length=0;
 f.resize(1080,1920);
 assert.equal(f.changes().length,1);
 assert.deepEqual(f.view(),{...signal.defaultDocumentView(9/16),turn:1});
 f.$('remote').dispatchEvent(new f.window.Event('loadedmetadata'));
 f.$('remote').dispatchEvent(new f.window.Event('playing'));
 assert.equal(f.changes().length,1,'repeated media events cannot republish the same reset');
 f.messages.length=0;f.window.setNotebookDocumentView(crop());
 assert.equal(f.view().corners,null);assert.equal(f.view().sourceAspect,9/16);
 assert.equal(f.changes().length,0,'even an incompatible remote crop must not echo');
});

test('Compare and corner drafts never replace canonical state and remote view exits both transient modes',t=>{
 const f=fixture(t),value=crop();f.start();f.window.setNotebookDocumentView(value);f.messages.length=0;
 f.$('compareSource').click();
 assert.equal(f.$('compareSource').getAttribute('aria-pressed'),'true');
 assert.deepEqual(f.view(),value);assert.equal(f.changes().length,0);
 f.window.setNotebookDocumentView({...value,turn:1});
 assert.equal(f.$('compareSource').getAttribute('aria-pressed'),'false');assert.equal(f.changes().length,0);
 f.$('adjustCorners').click();assert.equal(f.$('corners').hidden,false);
 assert.deepEqual(f.view(),{...value,turn:1});
 f.window.setNotebookDocumentView({...value,turn:3});
 assert.equal(f.$('corners').hidden,true);assert.deepEqual(f.view(),{...value,turn:3});assert.equal(f.changes().length,0);
});

test('remote rotation and perspective keep existing pupil ink anchored in raw camera coordinates',t=>{
 const f=fixture(t);f.start();
 const ink=f.$('ink');
 for(const name of ['pointerdown','pointerup']){
  const event=new f.window.MouseEvent(name,{clientX:20,clientY:30,button:0,bubbles:true});
  Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'pen'},isPrimary:{value:true}});
  ink.dispatchEvent(event);
 }
 const value={...crop(),turn:1};f.window.setNotebookDocumentView(value);
 const drawn=f.contexts.get(ink).arcs.at(-1);
 assert.ok(drawn,'the existing dot is redrawn after remote geometry changes');
 // Default 180deg maps the drawn output (.2,.3) to raw camera (.8,.7).
 const expected=signal.makeDocumentMap(value,1920,1080).cameraToOutput({x:.8,y:.7});
 assert.ok(Math.abs(drawn[0]/ink.width-expected.x)<1e-8);
 assert.ok(Math.abs(drawn[1]/ink.height-expected.y)<1e-8);
});
