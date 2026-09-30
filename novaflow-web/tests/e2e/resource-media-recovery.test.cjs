const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('novaflow-web/renderer/assets/index-BbIa-2NM.js','utf8');
const start=source.indexOf('C=async t=>{');
const end=source.indexOf(',w=async',start);
assert.ok(start>0&&end>start);
(async()=>{
 for(const broken of [true,false]){
  let current=[{id:'video',objectUrl:'blob:old',localPath:'cached.mp4'}],reads=0;
  const ctx={fetch:async()=>{if(broken)throw Error('revoked');return{ok:true}},e:{aiSeqGenerated:current,setAiSeqGenerated:fn=>{current=fn(current)}},g:async()=>{reads++;return{}},i:()=> 'blob:recovered'};
  vm.runInNewContext('resolve='+source.slice(start+2,end),ctx);
  const result=await ctx.resolve(current[0]);
  assert.equal(result,broken?'blob:recovered':'blob:old');
  assert.equal(reads,broken?1:0);
  assert.equal(current[0].objectUrl,result);
 }
 assert.ok(source.includes('objectUrl:d,localPath:e.localPath||s.localPath'));
 assert.ok(source.includes('et.current=Qe;'));
 assert.ok(source.includes('nfMediaRetry===e.id'));
 console.log('PASS: valid URL reuse, revoked URL recovery from cached file, card address replacement, bounded retries');
})().catch(e=>{console.error(e);process.exitCode=1});
