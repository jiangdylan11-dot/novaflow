import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fullPlan,prepareFullStage,omitFullAsset,assertFullDestinations,assertNoSensitiveSource,loadReviewedOverrides} from '../../tools/isolated-full-site-policy.mjs';

test('full stage requires explicit fresh, bounded, offline versioned options', async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-full-test-'));
 try{
  const repo=join(root,'repo'),project=join(repo,'novaflow-web');await mkdir(project,{recursive:true});await mkdir(join(repo,'work'));
  const args=['node','package-site.mjs','--check','--isolated-full-stage=site-264','--isolated-version=2.0.264'];
  const p=fullPlan(project,args,{});assert.equal(p.stage,join(repo,'work','site-264'));
  assert.throws(()=>fullPlan(project,args.filter(a=>a!=='--check'),{}));
  assert.throws(()=>fullPlan(project,args.map(a=>a==='--isolated-full-stage=site-264'?'--isolated-full-stage=../escape':a),{}));
  assert.throws(()=>fullPlan(project,args,{NOVAFLOW_EMBED_SESSION_SECRET:'private'}));
  assert.equal(omitFullAsset('D:/renderer','D:/renderer/vendor/matting/model.bin'),true);
  assert.equal(omitFullAsset('D:/renderer','D:/renderer/vendor/ffmpeg/core/ffmpeg-core.js'),false);
  await prepareFullStage(p);await writeFile(join(p.stage,'sentinel'),'preserve');
  await assert.rejects(()=>prepareFullStage(p));assert.equal(await readFile(join(p.stage,'sentinel'),'utf8'),'preserve');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('full package accepts only the approved exact production destinations',()=>{
 const good={controlUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web',authUrl:'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'};
 assert.doesNotThrow(()=>assertFullDestinations(good));
 for(const change of [
  {controlUrl:'https://other.example/functions/v1/novaflow-web'},
  {authUrl:'https://other.example/functions/v1/novaflow-backend'},
  {controlUrl:'http://127.0.0.1:4890'},
  {controlUrl:good.controlUrl+'?other=true'},
  {authUrl:''},{artKnowledgeUrl:'https://other.example'},
  {artKnowledgeEnabled:true},{allowLocal:true},{out:'elsewhere.zip'}
 ])assert.throws(()=>assertFullDestinations({...good,...change}));
});

test('265 reviewed overrides are explicit, fixed and refuse unknown input or secrets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'foart-override-test-'));
 try{
  const repo=join(root,'repo'),project=join(repo,'novaflow-web');await mkdir(project,{recursive:true});await mkdir(join(repo,'work'));
  const common=['node','package-site.mjs','--check','--isolated-full-stage=site-265','--isolated-version=2.0.265'];
  const p=fullPlan(project,[...common,'--use-reviewed-overrides-265'],{});assert.equal(p.reviewedOverrides,true);
  assert.equal(fullPlan(project,common.map(a=>a==='--isolated-version=2.0.265'?'--isolated-version=2.0.264':a),{}).reviewedOverrides,false);
  assert.throws(()=>fullPlan(project,common,{}));
  assert.throws(()=>fullPlan(project,['--use-reviewed-overrides-265'],{}));
  assert.throws(()=>fullPlan(project,[...common,'--isolated-source-override=private'],{}));
  assert.throws(()=>fullPlan(project,[...common,'--use-reviewed-overrides-265','--use-reviewed-overrides-265'],{}));
  assert.throws(()=>fullPlan(project,[...common.map(a=>a==='--isolated-version=2.0.265'?'--isolated-version=2.0.264':a),'--use-reviewed-overrides-265'],{}));
  await assert.rejects(()=>loadReviewedOverrides(p));
  const bad=join(p.work,'site-265-overrides-20261102','novaflow-web','renderer','spine-skeleton-editor.js');await mkdir(join(p.work,'site-265-overrides-20261102','novaflow-web','renderer'),{recursive:true});await writeFile(bad,'untrusted');
  await assert.rejects(()=>loadReviewedOverrides(p),/hash mismatch/);
  assert.doesNotThrow(()=>assertNoSensitiveSource('const mode = "chat";'));
  assert.throws(()=>assertNoSensitiveSource('-----BEGIN PRIVATE KEY-----'));
  assert.throws(()=>assertNoSensitiveSource('sk-'+'a'.repeat(32)));
 }finally{await rm(root,{recursive:true,force:true});}
});
