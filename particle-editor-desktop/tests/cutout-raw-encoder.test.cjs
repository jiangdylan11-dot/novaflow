const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Writable,PassThrough}=require('node:stream');
const {createCutoutRawEncoder}=require('../main/cutout-raw-encoder');
function fixture(){let args,bytes=0,chunks=[];const spawnProcess=(_exe,a)=>{args=a;const p=new EventEmitter();p.stderr=new PassThrough();p.stdin=new Writable({write(chunk,_,cb){bytes+=chunk.length;chunks.push(Buffer.from(chunk));setTimeout(cb,5)}});p.stdin.on('finish',()=>setImmediate(()=>p.emit('close',0)));p.kill=()=>setImmediate(()=>p.emit('close',-1));return p;};const service=createCutoutRawEncoder({ffmpegPath:'test',validate:p=>p.internal===true,spawnProcess});const sender=new EventEmitter();sender.id=1;return{service,event:{sender},payload:{internal:true,dir:'temp',outPath:'temp/result.webm',width:16,height:16,fps:24,frames:2},args:()=>args,bytes:()=>bytes,content:()=>Buffer.concat(chunks)};}
test('raw encoder streams ordered exact bytes and finishes only after all frames',async()=>{
 const f=fixture(),{sessionId}=await f.service.start(f.event,f.payload);const frame=new Uint8ClampedArray(1024).fill(127);
 await assert.rejects(f.service.finish(f.event,{...f.payload,rawSessionId:sessionId}),/Incomplete/);
 const pending=f.service.write(f.event,{sessionId,frameIndex:0,bytes:frame});
 await assert.rejects(f.service.write(f.event,{sessionId,frameIndex:1,bytes:frame}),/ordering/);await pending;
 await f.service.write(f.event,{sessionId,frameIndex:1,bytes:frame});await f.service.finish(f.event,{...f.payload,rawSessionId:sessionId});
 assert.equal(f.bytes(),2048);assert(f.args().includes('pipe:0'));assert(f.args().includes('yuva420p'));assert(!f.args().some(x=>String(x).endsWith('.png')));
 await assert.rejects(f.service.write(f.event,{sessionId,frameIndex:2,bytes:frame}),/unavailable/);
});
test('raw sessions reject another window, invalid sizes and mismatched destinations; abort releases ownership',async()=>{
 const f=fixture();await assert.rejects(f.service.start(f.event,{...f.payload,internal:false}),/Invalid/);
 const {sessionId}=await f.service.start(f.event,f.payload);
 await assert.rejects(f.service.write({sender:{id:2}},{sessionId,frameIndex:0,bytes:new Uint8Array(1024)}),/unavailable/);
 await assert.rejects(f.service.write(f.event,{sessionId,frameIndex:0,bytes:new Uint8Array(1)}),/size/);
 await assert.rejects(f.service.finish(f.event,{...f.payload,rawSessionId:sessionId,outPath:'other'}),/mismatched/);
 await f.service.abort(f.event,{sessionId});const next=await f.service.start(f.event,f.payload);await f.service.abort(f.event,next);
});

test('PNG compatibility mapping preserves alpha and applies colors before raw encoding',async()=>{
 const sharp=require('sharp'),data=Buffer.alloc(256*256*4);for(let a=0;a<256;a++)for(let v=0;v<256;v++){const i=(a*256+v)*4;data[i]=data[i+1]=data[i+2]=Math.floor(v/2);data[i+3]=a;}
 const pngRoundTrip=await sharp(data,{raw:{width:256,height:256,channels:4}}).png().toBuffer(),f=fixture(),p={...f.payload,frames:1,pngRoundTrip};const {sessionId}=await f.service.start(f.event,p);
 const bytes=Buffer.alloc(1024);for(let i=0;i<bytes.length;i+=4){bytes[i]=80;bytes[i+1]=100;bytes[i+2]=120;bytes[i+3]=128;}await f.service.write(f.event,{sessionId,frameIndex:0,bytes});await f.service.finish(f.event,{...p,rawSessionId:sessionId});assert.deepEqual([...f.content().subarray(0,4)],[40,50,60,128]);assert.deepEqual([...bytes.subarray(0,4)],[80,100,120,128]);
});
