import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveDocumentRenderer,defaultDocumentView,makeDocumentMap} from '../public/notebook-camera/signal.mjs';

function canvasFixture({shaderFailure=false,noGPU=false}={}){
 const make=()=>{
  const ctx={draws:0,save(){},restore(){},translate(){},rotate(){},drawImage(){this.draws++;}};
  return {width:0,height:0,ctx,listeners:{},
   getContext(type){
    if(type==='webgl')return noGPU?null:{createShader(){if(shaderFailure)throw Error('Unsupported shader');return {};}};
    if(type==='2d'){assert.equal(this.acquiredWebGL,undefined,'WebGL node cannot become a 2D canvas');return ctx;}
   },
   cloneNode(){return make();},replaceWith(next){this.replacement=next;},
   addEventListener(name,callback){this.listeners[name]=callback;},
  };
 };
 const original=make(),get=original.getContext.bind(original);
 original.getContext=type=>{const result=get(type);if(type==='webgl'&&result)original.acquiredWebGL=true;return result;};
 return original;
}
function withDocument(run){
 const old=globalThis.document;
 globalThis.document={createElement:()=>({getContext:()=>({})})};
 try{run();}finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
}
const video={readyState:2,videoWidth:1920,videoHeight:1080};

test('shader failure replaces a WebGL canvas and renders the complete 1080p frame on CPU',()=>withDocument(()=>{
 const original=canvasFixture({shaderFailure:true});let replacement;
 const renderer=new LiveDocumentRenderer(video,original,{onCanvasReplace:next=>{replacement=next;}});
 assert.equal(renderer.canvas,replacement);assert.notEqual(replacement,original);
 renderer.setView(defaultDocumentView(16/9));
 assert.equal(renderer.gl,null);assert.equal(replacement.width,1920);assert.equal(replacement.height,1080);
 assert.equal(replacement.ctx.draws,1);
}));

test('unavailable GPU uses the original 2D canvas and preserves image dimensions',()=>withDocument(()=>{
 const canvas=canvasFixture({noGPU:true});
 const renderer=new LiveDocumentRenderer(video,canvas);
 renderer.setView(defaultDocumentView(16/9));
 assert.equal(renderer.canvas,canvas);assert.equal(canvas.replacement,undefined);
 assert.equal(canvas.width,1920);assert.equal(canvas.height,1080);
}));

test('new notebooks have the prototype non-mirrored 180 degree orientation',()=>{
 for(const aspect of [.75,1,16/9]){
  const view=defaultDocumentView(aspect),map=makeDocumentMap(view,1920,1080);
  assert.equal(view.turn,2);assert.equal(view.sourceAspect,aspect);
  const point=map.cameraToOutput({x:.2,y:.3});
  assert.ok(Math.abs(point.x-.8)<1e-8);assert.ok(Math.abs(point.y-.7)<1e-8);
 }
});
