const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),sharp=require('sharp'),crypto=require('crypto');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]};
const base=arg('--baseline'),root=path.resolve(__dirname,'../..'),fixture=path.resolve(arg('--fixture',path.join(root,'docs/cutout-key-parity-20260914/gloweyes/backend/job-IRKD3t'))),output=path.resolve(arg('--output',path.join(root,'logs/cutout-performance-20260914/matting-parity.json')));
assert(base,'Supply the previous matting source with --baseline');
const load=file=>{const m={exports:{}};new Function('module',fs.readFileSync(file,'utf8'))(m);return m.exports};
(async()=>{const before=load(base),after=load(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js')),frames=new Map,masks=new Map;
 const files=fs.readdirSync(path.join(fixture,'frames_in')).filter(f=>/^f_\d+\.png$/.test(f)).sort();
 for(const [index,file] of files.entries()){const {data,info}=await sharp(path.join(fixture,'frames_in',file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});frames.set(index,{frame:{data,width:info.width,height:info.height}});masks.set(index,await sharp(path.join(fixture,'frames_out',file)).ensureAlpha().extractChannel(3).raw().toBuffer());}
 const results=[];for(const i of [...new Set([0,1,Math.floor(files.length/4),Math.floor(files.length/2),files.length-2,files.length-1])]){
  const frame=frames.get(i).frame,options={enabled:true,preserveShadow:true,requireSubjectMask:true,subjectMask:{data:masks.get(i),width:frame.width,height:frame.height},sequence:{frames,masks,maskWidth:frame.width,maskHeight:frame.height}};
  const t0=performance.now(),a=before.matte(frame,options),t1=performance.now(),b=after.matte(frame,options),t2=performance.now();
  assert(Buffer.from(a.data).equals(Buffer.from(b.data)),'RGBA differs at frame '+i);assert(Buffer.from(a.alpha).equals(Buffer.from(b.alpha)),'alpha differs at frame '+i);assert.deepEqual(a.materialStats,b.materialStats);
  results.push({frame:i,beforeMs:t1-t0,afterMs:t2-t1,rgbaSha256:crypto.createHash('sha256').update(b.data).digest('hex')});console.log('PASS frame '+i);
 }
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({pixelIdentical:true,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
