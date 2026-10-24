// Local document geometry. All coordinates are normalized camera coordinates.
export const UNIT_QUAD = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
const copyQuad = q => q.map(p=>({x:p.x,y:p.y}));
export function signedArea(q){return q.reduce((a,p,i)=>{const n=q[(i+1)%q.length];return a+p.x*n.y-n.x*p.y;},0)/2;}
export function validQuad(q){
 if(!Array.isArray(q)||q.length!==4||q.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))return false;
 if(Math.abs(signedArea(q))<0.008)return false;
 let sign=0;
 for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4],c=q[(i+2)%4];const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<0.00008)return false;const s=Math.sign(cross);if(sign&&sign!==s)return false;sign=s;}
 return true;
}
export function orderQuad(points){
 if(!Array.isArray(points)||points.length!==4)return null;
 const cx=points.reduce((s,p)=>s+p.x,0)/4,cy=points.reduce((s,p)=>s+p.y,0)/4;
 let q=copyQuad(points).sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
 if(signedArea(q)<0)q.reverse();
 // Choose a stable screen-top-left start, including a page tilted by 45 degrees.
 const start=q.reduce((best,p,i)=>p.x+p.y<q[best].x+q[best].y?i:best,0);
 q=q.map((_,i)=>q[(i+start)%4]);return validQuad(q)?q:null;
}
export function validateDocumentView(v){
 if(!v||v.type!=='document-view'||v.version!==1||!Number.isInteger(v.turn)||v.turn<0||v.turn>3)return null;
 if(!Number.isFinite(v.sourceAspect)||v.sourceAspect<0.1||v.sourceAspect>10)return null;
 if(v.corners!==null&&!validQuad(v.corners))return null;
 if(v.corners&&(!Number.isFinite(v.ratio)||v.ratio<0.25||v.ratio>4))return null;
 return {type:'document-view',version:1,corners:v.corners?copyQuad(v.corners):null,ratio:v.corners?v.ratio:null,turn:v.turn,sourceAspect:v.sourceAspect};
}
export function rawDocumentView(aspect=1){return {type:'document-view',version:1,corners:null,ratio:null,turn:0,sourceAspect:aspect||1};}
// Fixed notebook mount faces the pupil: apply a half-turn on every fresh session.
// Keep rawDocumentView as the identity for geometry and unrotated source coordinates.
export const DEFAULT_NOTEBOOK_TURN=2;
export function defaultDocumentView(aspect=1){return {...rawDocumentView(aspect),turn:DEFAULT_NOTEBOOK_TURN};}
export function estimatedRatio(q,w,h){
 const d=(a,b)=>Math.hypot((a.x-b.x)*w,(a.y-b.y)*h);
 return Math.max(.25,Math.min(4,(d(q[0],q[1])+d(q[3],q[2]))/(d(q[0],q[3])+d(q[1],q[2]))));
}
function solve(a,b){
 const n=b.length,m=a.map((r,i)=>[...r,b[i]]);
 for(let c=0;c<n;c++){
  let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[pivot][c]))pivot=r;
  if(Math.abs(m[pivot][c])<1e-12)throw Error('Degenerate perspective');
  [m[c],m[pivot]]=[m[pivot],m[c]];const v=m[c][c];for(let j=c;j<=n;j++)m[c][j]/=v;
  for(let r=0;r<n;r++){if(r===c)continue;const s=m[r][c];for(let j=c;j<=n;j++)m[r][j]-=s*m[c][j];}
 }
 return m.map(r=>r[n]);
}
export function homography(from,to){
 const a=[],b=[];from.forEach((p,i)=>{const q=to[i];a.push([p.x,p.y,1,0,0,0,-p.x*q.x,-p.y*q.x]);b.push(q.x);a.push([0,0,0,p.x,p.y,1,-p.x*q.y,-p.y*q.y]);b.push(q.y);});
 return [...solve(a,b),1];
}
export function project(h,p){const d=h[6]*p.x+h[7]*p.y+h[8];if(!Number.isFinite(d)||Math.abs(d)<1e-10)return {x:NaN,y:NaN};return {x:(h[0]*p.x+h[1]*p.y+h[2])/d,y:(h[3]*p.x+h[4]*p.y+h[5])/d};}
export function makeDocumentMap(config,sourceWidth,sourceHeight){
 const rawAspect=sourceWidth/sourceHeight||1,v=validateDocumentView(config)||rawDocumentView(rawAspect);
 const base=v.corners||UNIT_QUAD,quad=base.map((_,i)=>base[(i-v.turn+4)%4]);
 const toCamera=homography(UNIT_QUAD,quad),toOutput=homography(quad,UNIT_QUAD);
 const baseRatio=v.corners?v.ratio:rawAspect;
 return {view:v,quad,aspect:v.turn%2?1/baseRatio:baseRatio,toCamera,toOutput,outputToCamera:p=>project(toCamera,p),cameraToOutput:p=>project(toOutput,p)};
}
export function outputSize(aspect,max=1600){return aspect>=1?{width:max,height:Math.max(2,Math.round(max/aspect))}:{width:Math.max(2,Math.round(max*aspect)),height:max};}

function hull(points){
 const p=points.sort((a,b)=>a.x-b.x||a.y-b.y);if(p.length<4)return p;
 const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lo=[],hi=[];
 for(const point of p){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),point)<=0)lo.pop();lo.push(point);}
 for(let i=p.length-1;i>=0;i--){const point=p[i];while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),point)<=0)hi.pop();hi.push(point);}
 return lo.slice(0,-1).concat(hi.slice(0,-1));
}
function simplifyQuad(poly){
 const p=poly.slice();while(p.length>28){let best=-1,min=Infinity;for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));if(area<min){min=area;best=i;}}p.splice(best,1);}
 let best=p.slice(0,4),area=0;const cross=(a,b)=>a.x*b.y-b.x*a.y;
 for(let a=0;a<p.length-3;a++)for(let b=a+1;b<p.length-2;b++)for(let c=b+1;c<p.length-1;c++)for(let d=c+1;d<p.length;d++){
  const value=Math.abs(cross(p[a],p[b])+cross(p[b],p[c])+cross(p[c],p[d])+cross(p[d],p[a]));
  if(value>area){area=value;best=[p[a],p[b],p[c],p[d]];}
 }return best;
}
// Fit straight page edges and intersect them, avoiding rounded pixel corners.
function refineQuad(q,boundary){
 const lines=[];
 for(let i=0;i<4;i++){
  const a=q[i],b=q[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
  const points=boundary.filter(p=>{const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(len*len);return t>.1&&t<.9&&Math.abs(dx*(p.y-a.y)-dy*(p.x-a.x))/len<.012;});
  if(points.length<4)return q;
  const x=points.reduce((s,p)=>s+p.x,0)/points.length,y=points.reduce((s,p)=>s+p.y,0)/points.length;
  let xx=0,xy=0,yy=0;for(const p of points){xx+=(p.x-x)**2;xy+=(p.x-x)*(p.y-y);yy+=(p.y-y)**2;}
  const angle=.5*Math.atan2(2*xy,xx-yy);lines.push({x,y,dx:Math.cos(angle),dy:Math.sin(angle)});
 }
 const result=[];for(let i=0;i<4;i++){const a=lines[(i+3)%4],b=lines[i],den=a.dx*b.dy-a.dy*b.dx;if(Math.abs(den)<.05)return q;const t=((b.x-a.x)*b.dy-(b.y-a.y)*b.dx)/den;result.push({x:Math.max(0,Math.min(1,a.x+t*a.dx)),y:Math.max(0,Math.min(1,a.y+t*a.dy))});}
 return validQuad(result)&&Math.abs(signedArea(result)/signedArea(q)-1)<.16?result:q;
}
// Conservative bright-paper detector. It deliberately has a manual-corner fallback.
// It detects page boundaries, not text direction, and does not perform OCR.
export function detectDocument(image){
 const {width:w,height:h,data}=image,n=w*h;if(!w||!h||!data||data.length<n*4)return null;
 const lum=new Uint8Array(n),chroma=new Uint8Array(n);
 for(let i=0;i<n;i++){const j=i*4,r=data[j],g=data[j+1],b=data[j+2];lum[i]=.299*r+.587*g+.114*b;chroma[i]=Math.max(r,g,b)-Math.min(r,g,b);}
 let best=null;
 for(const threshold of [95,125,155,185,210]){
  const mask=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);
  for(let i=0;i<n;i++)mask[i]=lum[i]>threshold&&chroma[i]<Math.max(28,lum[i]*.25)?1:0;
  for(let start=0;start<n;start++){
   if(!mask[start]||seen[start])continue;
   let head=0,tail=1;queue[0]=start;seen[start]=1;const boundary=[];
   while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);let edge=false;
    const neighbors=[x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1];
    for(const j of neighbors){if(j<0||!mask[j])edge=true;else if(!seen[j]){seen[j]=1;queue[tail++]=j;}}
    if(edge)boundary.push({x:x/(w-1),y:y/(h-1)});
   }
   if(tail<n*.045||boundary.length<8)continue;
   const poly=hull(boundary),ha=Math.abs(signedArea(poly));if(poly.length<4||ha<.07||ha>.96)continue;
   let q=orderQuad(simplifyQuad(poly));if(!q)continue;q=refineQuad(q,boundary);
   const qa=Math.abs(signedArea(q)),rectangularity=qa/ha;if(rectangularity<.83)continue;
   // Reject a bright background spanning three or four borders.
   const touching=[q.some(p=>p.x<.008),q.some(p=>p.x>.992),q.some(p=>p.y<.008),q.some(p=>p.y>.992)].filter(Boolean).length;
   if(touching>=3)continue;
   const fill=tail/(n*ha);if(fill<.5)continue;
   const score=qa*rectangularity*fill*(touching?0.82:1);
   if(!best||score>best.score)best={corners:q,score,coverage:qa,threshold};
  }
 }
 return best;
}
export function detectVideoDocument(video){
 const scale=Math.min(1,440/Math.max(video.videoWidth,video.videoHeight));
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(video.videoWidth*scale));c.height=Math.max(1,Math.round(video.videoHeight*scale));
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(video,0,0,c.width,c.height);return detectDocument(ctx.getImageData(0,0,c.width,c.height));
}


// Runtime camera controls are capability-gated. No camera permission is requested here.
export const QUALITY_PROFILES = Object.freeze({
 detail: Object.freeze({width:1920,height:1080,fps:24,bitrate:8000000,render:1920}),
 balanced: Object.freeze({width:1280,height:720,fps:20,bitrate:3000000,render:1280}),
});
function finiteRange(v){
 if(!v||!Number.isFinite(v.min)||!Number.isFinite(v.max)||v.max<=v.min)return null;
 return {min:v.min,max:v.max,step:Number.isFinite(v.step)&&v.step>0?v.step:(v.max-v.min)/100};
}
export function inspectCamera(track){
 let c={},s={};try{c=track?.getCapabilities?.()||{};s=track?.getSettings?.()||{};}catch{}
 const modes=Array.isArray(c.focusMode)?c.focusMode.filter(m=>['manual','continuous','single-shot','none'].includes(m)):[];
 const distance=finiteRange(c.focusDistance);
 const settings={};for(const key of ['width','height','frameRate','focusDistance'])if(Number.isFinite(s[key]))settings[key]=s[key];
 if(typeof s.focusMode==='string')settings.focusMode=s.focusMode.slice(0,32);
 return {settings,focus:{modes,distance,canAuto:modes.includes('continuous'),canManual:modes.includes('manual')&&!!distance,canLock:modes.includes('manual')&&!!distance&&Number.isFinite(s.focusDistance)}};
}
export function cameraConstraints(profile='detail',portrait=false){
 const p=QUALITY_PROFILES[profile];if(!p)throw Error('Unknown camera quality');
 return {width:{ideal:portrait?p.height:p.width},height:{ideal:portrait?p.width:p.height},frameRate:{ideal:p.fps,max:30},resizeMode:{ideal:'none'}};
}
export async function setCameraFocus(track,action,value){
 if(!track||track.readyState==='ended')throw Error('CAMERA_OFF');
 const before=inspectCamera(track);let constraint;
 if(action==='auto'&&before.focus.canAuto)constraint={focusMode:'continuous'};
 else if(action==='lock'&&before.focus.canLock)constraint={focusMode:'manual',focusDistance:before.settings.focusDistance};
 else if(action==='distance'&&before.focus.canManual&&Number.isFinite(value)){
  const r=before.focus.distance;
  if(value<r.min||value>r.max)throw Error('FOCUS_RANGE');
  const snapped=Math.max(r.min,Math.min(r.max,r.min+Math.round((value-r.min)/r.step)*r.step));
  constraint={focusMode:'manual',focusDistance:snapped};
 }else throw Error('FOCUS_UNSUPPORTED');
 // Image Capture camera properties belong in advanced constraints in browsers
 // exposing this extension. Verify the returned mode instead of claiming success.
 await track.applyConstraints({...track.getConstraints?.(),advanced:[constraint]});
 const after=inspectCamera(track);
 if(after.settings.focusMode!==constraint.focusMode)throw Error('FOCUS_UNCONFIRMED');
 if('focusDistance' in constraint){
  const r=before.focus.distance,tolerance=Math.max(r.step*.55,(r.max-r.min)*.005,1e-8);
  if(!Number.isFinite(after.settings.focusDistance)||Math.abs(after.settings.focusDistance-constraint.focusDistance)>tolerance)throw Error('FOCUS_UNCONFIRMED');
 }
 return after;
}

// Full source frame is kept. CPU mode lowers cadence, not pixel dimensions.
export class LiveDocumentRenderer {
 constructor(video,canvas,{maxDimension=1920,onError=()=>{},onCanvasReplace=()=>{},onFrame=()=>{},force2D=false}={}){
  Object.assign(this,{video,canvas,maxDimension,onError,onCanvasReplace,onFrame,view:rawDocumentView(),running:false,job:0,last:0,map:null,lastError:'',configKey:'',lookup:null,renderCount:0,renderMs:0,lastRenderAt:0});
  this.gl=null;
  try{if(!force2D)this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});if(this.gl)this.setupGL();}catch{this.use2DCanvas();}
  if(!this.gl&&!this.ctx)this.use2DCanvas(false);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(this.canvas!==canvas)return;const wasRunning=this.running;this.stop();this.use2DCanvas();this.configKey='';this.configure();if(wasRunning)this.start();});
 }
 use2DCanvas(replace=true){
  // A canvas that acquired WebGL cannot acquire a 2D context, even after a
  // shader failure or context loss. Preserve its attributes on a fresh node.
  if(replace){const previous=this.canvas,next=previous.cloneNode(false);previous.replaceWith(next);this.canvas=next;this.onCanvasReplace(next);}
  this.gl=null;this.ctx=this.canvas.getContext('2d',{alpha:false});
  this.scratch=document.createElement('canvas');this.sourceCtx=this.scratch.getContext('2d',{willReadFrequently:true});
  if(!this.ctx||!this.sourceCtx)throw Error('Canvas rendering is unavailable');
  this.lookup=null;
 }
 setupGL(){
  const gl=this.gl;const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const vs=compile(gl.VERTEX_SHADER,'attribute vec2 position; varying vec2 uv; void main(){gl_Position=vec4(position,0.0,1.0);uv=vec2((position.x+1.0)/2.0,(1.0-position.y)/2.0);}');
  const fs=compile(gl.FRAGMENT_SHADER,'precision highp float; varying vec2 uv; uniform sampler2D frame; uniform mat3 mapping; void main(){vec3 p=mapping*vec3(uv,1.0);vec2 t=p.xy/p.z;if(t.x<0.0||t.y<0.0||t.x>1.0||t.y>1.0){gl_FragColor=vec4(0.95,0.96,0.97,1.0);}else{gl_FragColor=texture2D(frame,t);}}');
  this.program=gl.createProgram();gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error('Shader link failed');gl.useProgram(this.program);
  this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(this.program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  this.mapUniform=gl.getUniformLocation(this.program,'mapping');gl.uniform1i(gl.getUniformLocation(this.program,'frame'),0);
 }
 setMaxDimension(value){this.maxDimension=Math.max(640,Math.min(2560,value));this.configKey='';this.configure();}
 setView(view){this.view=validateDocumentView(view)||rawDocumentView(this.video.videoWidth/this.video.videoHeight);this.configure();if(this.video.readyState>=2)this.render();}
 configure(){
  const w=this.video.videoWidth,h=this.video.videoHeight;if(!w||!h)return;
  const key=JSON.stringify([w,h,this.maxDimension,this.view]);if(key===this.configKey)return;
  this.configKey=key;this.lookup=null;
  this.map=makeDocumentMap(this.view,w,h);
  const s=outputSize(this.map.aspect,Math.min(this.maxDimension,Math.max(w,h)));
  if(this.canvas.width!==s.width)this.canvas.width=s.width;if(this.canvas.height!==s.height)this.canvas.height=s.height;
  const m=this.map.toCamera;this.glMatrix=new Float32Array([m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]]);
 }
 prepareLookup(){
  const sw=this.video.videoWidth,sh=this.video.videoHeight,c=this.canvas,m=this.map.toCamera;
  const n=c.width*c.height,indices=new Int32Array(n),fx=new Float32Array(n),fy=new Float32Array(n);
  for(let y=0,k=0;y<c.height;y++)for(let x=0;x<c.width;x++,k++){
   const nx=(x+.5)/c.width,ny=(y+.5)/c.height,den=m[6]*nx+m[7]*ny+m[8];
   // Match WebGL LINEAR texel centres. The previous CPU path was half a pixel off.
   const sx=Math.max(0,Math.min(sw-1,(m[0]*nx+m[1]*ny+m[2])/den*sw-.5));
   const sy=Math.max(0,Math.min(sh-1,(m[3]*nx+m[4]*ny+m[5])/den*sh-.5));
   const x0=Math.floor(sx),y0=Math.floor(sy);indices[k]=(y0*sw+x0)*4;fx[k]=sx-x0;fy[k]=sy-y0;
  }
  this.lookup={indices,fx,fy,sw,sh,image:this.ctx.createImageData(c.width,c.height)};
  this.scratch.width=sw;this.scratch.height=sh;
 }
 render(){
  if(this.video.readyState<2||!this.video.videoWidth)return;
  const start=performance.now();
  try{
   this.configure();const c=this.canvas;
   if(this.gl){const gl=this.gl;gl.viewport(0,0,c.width,c.height);gl.useProgram(this.program);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.video);gl.uniformMatrix3fv(this.mapUniform,false,this.glMatrix);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}
   else if(!this.view.corners){
    // Rotation alone needs no per-pixel perspective sampler and loses no detail.
    const ctx=this.ctx,t=this.view.turn;
    ctx.save();ctx.translate(c.width/2,c.height/2);ctx.rotate(t*Math.PI/2);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    const w=t%2?c.height:c.width,h=t%2?c.width:c.height;
    ctx.drawImage(this.video,-w/2,-h/2,w,h);ctx.restore();
   }else{
    if(!this.lookup)this.prepareLookup();const {indices,fx,fy,sw,sh,image}=this.lookup;
    this.sourceCtx.drawImage(this.video,0,0,sw,sh);
    const source=this.sourceCtx.getImageData(0,0,sw,sh).data,d=image.data,row=sw*4;
    for(let k=0,i=0;k<indices.length;k++,i+=4){
     const j=indices[k],right=j%row<row-4?4:0,down=j<row*(sh-1)?row:0;
     const a=(1-fx[k])*(1-fy[k]),b=fx[k]*(1-fy[k]),e=(1-fx[k])*fy[k],f=fx[k]*fy[k];
     d[i]=source[j]*a+source[j+right]*b+source[j+down]*e+source[j+down+right]*f;
     d[i+1]=source[j+1]*a+source[j+right+1]*b+source[j+down+1]*e+source[j+down+right+1]*f;
     d[i+2]=source[j+2]*a+source[j+right+2]*b+source[j+down+2]*e+source[j+down+right+2]*f;d[i+3]=255;
    }
    this.ctx.putImageData(image,0,0);
   }
   this.renderCount++;this.lastRenderAt=performance.now();this.renderMs=this.lastRenderAt-start;this.onFrame(this.canvas);
  }catch(e){if(e.message!==this.lastError){this.lastError=e.message;this.onError(e.message);}}
 }
 start(){
  if(this.running)return;this.running=true;
  const schedule=()=>{if(!this.running)return;this.videoJob=!!this.video.requestVideoFrameCallback;this.job=this.videoJob?this.video.requestVideoFrameCallback(tick):requestAnimationFrame(tick);};
  const tick=t=>{if(!this.running)return;const interval=!this.gl&&this.view.corners?Math.max(100,this.renderMs*1.6):30;if(t-this.last>=interval){this.last=t;this.render();}schedule();};
  schedule();
 }
 stop(){this.running=false;if(this.videoJob)this.video.cancelVideoFrameCallback?.(this.job);else cancelAnimationFrame(this.job);}
}
