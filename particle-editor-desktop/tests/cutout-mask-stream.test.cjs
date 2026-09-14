const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {createCutoutMaskStream}=require('../main/cutout-mask-stream');
async function fixture(t){const outDir=fs.mkdtempSync(path.join(os.tmpdir(),'nf-mask-stream-'));t.after(()=>{assert.equal(path.dirname(path.resolve(outDir)),path.resolve(os.tmpdir()));assert(path.basename(outDir).startsWith('nf-mask-stream-'));fs.rmSync(outDir,{recursive:true,force:true});});const chunks=[],frames=Array.from({length:7},(_,i)=>({decodedFrameIndex:i,outputFilename:`f${i}.png`}));const stream=createCutoutMaskStream({jobId:'test',sender:{send:(channel,p)=>{assert.equal(channel,'ai-seq-rembg-mask-chunk');chunks.push(p)}},frames,duplicates:[{duplicateName:'f6.png',sourceName:'f0.png'}],outDir,width:2,height:2});const write=async(name,w=2)=>sharp({create:{width:w,height:2,channels:4,background:{r:10,g:20,b:30,alpha:.5}}}).png().toFile(path.join(outDir,name));return{outDir,chunks,stream,write};}
test('mask streaming publishes only completed files, batches at four, handles aliases and never repeats frames',async t=>{
 const f=await fixture(t);await f.write('f0.png.pending');await f.stream.pump();assert.equal(f.chunks.length,0);
 fs.renameSync(path.join(f.outDir,'f0.png.pending'),path.join(f.outDir,'f0.png'));await Promise.all([f.stream.pump(),f.stream.pump()]);assert.deepEqual(f.chunks[0].decodedFrameIndices,[0,6]);assert.equal(f.chunks[0].alphaBytes.length,8);
 for(let i=1;i<6;i++)await f.write(`f${i}.png`);await f.stream.pump(true);await f.stream.pump(true);
 assert.equal(f.stream.count,7);assert.deepEqual(f.chunks.map(c=>c.decodedFrameIndices.length),[2,4,1]);assert(f.chunks.every(c=>c.alphaBytes.every(a=>a===128)));
});
test('cancellation prevents deliveries and malformed dimensions reject instead of streaming corrupt masks',async t=>{
 const f=await fixture(t);await f.write('f0.png',3);await assert.rejects(f.stream.pump(),/dimensions/);assert.equal(f.chunks.length,0);f.stream.stop();await f.stream.pump(true);assert.equal(f.stream.count,0);
});
