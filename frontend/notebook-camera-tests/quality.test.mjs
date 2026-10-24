import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCamera,cameraConstraints,setCameraFocus,QUALITY_PROFILES} from '../public/notebook-camera/signal.mjs';
import {readFileSync} from 'node:fs';
function camera({modes=['continuous','manual'],distance={min:.1,max:10,step:.1},ignore=false}={}){
 let settings={width:1920,height:1080,frameRate:24,focusMode:'continuous',focusDistance:2};
 let constraints={width:{ideal:1920},frameRate:{ideal:24,max:30}};
 return {kind:'video',readyState:'live',calls:[],getSettings:()=>({...settings}),getCapabilities:()=>({focusMode:modes,focusDistance:distance}),getConstraints:()=>constraints,async applyConstraints(c){this.calls.push(c);constraints=c;if(!ignore)Object.assign(settings,c.advanced?.[0]);}};
}
test('missing capabilities does not invent manual focus',()=>{
 const info=inspectCamera({getSettings:()=>({width:1280,height:720})});
 assert.deepEqual(info.settings,{width:1280,height:720});assert.equal(info.focus.canAuto,false);assert.equal(info.focus.canLock,false);
});
test('a camera that exposes no focus property rejects lock without touching it',async()=>{
 const t=camera({modes:[],distance:null});await assert.rejects(setCameraFocus(t,'lock'),/FOCUS_UNSUPPORTED/);assert.equal(t.calls.length,0);
});
test('focus lock keeps current distance and capture constraints',async()=>{
 const t=camera();const result=await setCameraFocus(t,'lock');assert.equal(result.settings.focusMode,'manual');assert.equal(result.settings.focusDistance,2);assert.deepEqual(t.calls[0].width,{ideal:1920});assert.deepEqual(t.calls[0].frameRate,{ideal:24,max:30});
});
test('automatic focus can be re-enabled after manual focus',async()=>{
 const t=camera();await setCameraFocus(t,'lock');await setCameraFocus(t,'auto');assert.equal(t.getSettings().focusMode,'continuous');
});
test('ignored focus setting is reported, not silently counted as success',async()=>{
 const t=camera({ignore:true});await assert.rejects(setCameraFocus(t,'lock'),/FOCUS_UNCONFIRMED/);
});
test('manual focus rounds to device increments and validates range',async()=>{
 const t=camera();const r=await setCameraFocus(t,'distance',3.04);assert.ok(Math.abs(r.settings.focusDistance-3)<1e-8);
 for(const bad of [-1,100,NaN,Infinity,'3'])await assert.rejects(setCameraFocus(t,'distance',bad));
});
test('ended camera track is never changed',async()=>{const t=camera();t.readyState='ended';await assert.rejects(setCameraFocus(t,'auto'),/CAMERA_OFF/);assert.equal(t.calls.length,0);});
test('camera quality honours portrait and landscape without forcing crop',()=>{
 assert.equal(cameraConstraints('detail').width.ideal,1920);assert.equal(cameraConstraints('detail',true).height.ideal,1920);
 assert.equal(cameraConstraints('balanced').width.ideal,1280);assert.equal(cameraConstraints().resizeMode.ideal,'none');assert.throws(()=>cameraConstraints('unknown'));
});
