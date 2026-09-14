const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const source=fs.readFileSync(process.env.NOVAFLOW_CUTOUT_TEST_BUNDLE||path.join(__dirname,'../../particle-editor/assets/index-BbIa-2NM.js'),'utf8'),ast=ts.createSourceFile('bundle',source,99,true),codes={};
function walk(n){if(ts.isVariableDeclaration(n)&&['nfArmVerifiedVideoFrame','Lt'].includes(n.name.getText(ast))&&ts.isArrowFunction(n.initializer))codes[n.name.getText(ast)]=n.initializer.getText(ast);ts.forEachChild(n,walk);}walk(ast);
const context={performance,window:{setTimeout,clearTimeout},requestAnimationFrame:f=>setImmediate(f),Number,Math};
const arm=vm.runInNewContext('('+codes.nfArmVerifiedVideoFrame+')',context);
test('snapshot is captured in the verified callback before pause can advance the media clock',async()=>{
 let callback,captured=0;const video={currentTime:.818332,pause(){this.currentTime=2},requestVideoFrameCallback:f=>(callback=f,1),cancelVideoFrameCallback(){}};
 const pending=arm(video,19/24,.5/24,200,()=>{captured++;return {canvas:{},frame:{clock:video.currentTime}}});pending.start();
 callback(0,{mediaTime:19/24,presentedFrames:20});const result=await pending.promise;
 assert(result.verified);assert.equal(captured,1);assert.equal(result.capturedFrame.frame.clock,.818332);assert.equal(video.currentTime,2);
});
test('wrong frame and snapshot failures never become accepted captures',async()=>{
 let callback,captured=0;const video={pause(){},requestVideoFrameCallback:f=>(callback=f,1),cancelVideoFrameCallback(){}};
 const pending=arm(video,1,.01,200,()=>{captured++;throw Error('capture failed')});pending.start();
 callback(0,{mediaTime:.5});assert.equal(captured,0);callback(0,{mediaTime:1});const result=await pending.promise;
 assert.equal(result.verified,false);assert.match(result.error,/capture failed/);
});
test('strict seek accepts clock drift only when verified pixels were frozen, rejects clock-only and wrong-frame paths',async()=>{
 const run=async(capture,verified)=>{
  const video={currentTime:0,duration:5,readyState:4,pause(){},requestVideoFrameCallback(){}};
  const ctx={...context,wt:async(e,t)=>{e.currentTime=t},nfDriveVideoFrameForPresentation:()=>({stop(){}}),nfArmVerifiedVideoFrame:()=>({start(){video.currentTime=.818332;return true},cancel(){},promise:Promise.resolve({mediaTime:verified?19/24:1,verified,capturedFrame:capture?{canvas:{}}:null})})};
  return vm.runInNewContext('('+codes.Lt+')',ctx)(video,19/24,{strict:true,requireRvfcVerified:true,toleranceSec:.5/24,captureFrame:capture?()=>({canvas:{}}):null});
 };
 assert((await run(true,true)).capturedFrame.canvas);
 await assert.rejects(run(false,true),/currentTime drift/);
 await assert.rejects(run(true,false),/currentTime drift|callback drift/);
});
test('ended tail capture seeks to the preceding frame before presenting the target again',async()=>{
 const seeks=[],arms=[];let count=0;
 const video={currentTime:0,duration:5,readyState:4,ended:false,pause(){},requestVideoFrameCallback(){}};
 const ctx={...context,wt:async(e,t)=>{seeks.push(t);e.currentTime=t;e.ended=t>=4.833333},nfDriveVideoFrameForPresentation:()=>({stop(){}}),nfArmVerifiedVideoFrame:(e,t)=>{
  arms.push({target:t,ended:e.ended});const last=++count===2;
  return {start(){e.currentTime=last?4.84:0;return true},cancel(){},promise:Promise.resolve({mediaTime:t,verified:last,capturedFrame:last?{canvas:{}}:null})};
 }};
 const result=await vm.runInNewContext('('+codes.Lt+')',ctx)(video,116/24,{strict:true,requireRvfcVerified:true,toleranceSec:.5/24,captureFrame:()=>({canvas:{}})});
 assert(result.capturedFrame.canvas);assert.equal(arms.length,2);assert.equal(arms[1].ended,false);assert(Math.abs(seeks.at(-1)-115/24)<1e-6);
});
