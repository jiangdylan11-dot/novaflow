import test from 'node:test';
import assert from 'node:assert/strict';
import {parse286Execute,validateMigrationRows,validateImageAcceptance,validateControlProtocolProof,execute286} from './release-execute-286.mjs';
const cmd=['--local-qwen-286','--execute'];
test('each production stage requires exact sequence and pins prior source versions',()=>{
 const expected={control:['2.0.285','2.0.263','2.0.263','2.0.285'],backend:['2.0.285','2.0.286','2.0.263','2.0.285'],companion:['2.0.285','2.0.286','2.0.286','2.0.285'],site:['2.0.285','2.0.286','2.0.286','2.0.286']};
 for(const [component,want] of Object.entries(expected)){const {phase}=parse286Execute(component,cmd),v=phase.versions;assert.deepEqual([v.web,v.control,v.backend,v.companion],want);assert.match(phase.output,/^[0-9a-f]{64}$/);}
 const enabled=parse286Execute('control',[...cmd,'--enable-image']);assert.equal(enabled.name,'enable');assert.equal(enabled.phase.versions.web,'2.0.286');
});
test('wrong stage or extra/missing arguments fail before any external work',async()=>{
 for(const [component,args] of [['site',[...cmd,'--enable-image']],['control',['--local-qwen-286']],['backend',[...cmd,'--extra']],['unknown',cmd],['control',[...cmd,'--execute']]]){
  assert.throws(()=>parse286Execute(component,args));await assert.rejects(execute286(component,args));
 }
});
test('unapplied or incomplete migration proof is never accepted',()=>{
 const complete={ownership_column:true,ownership_trigger:true,image_lease_function:true,image_lease_permissions:true,ownership_body_md5:'982735e20483857e0868233fd65c5af7',image_lease_body_md5:'46f205d47eeccd0875faef878180bf6d'};validateMigrationRows(complete);
 for(const key of Object.keys(complete))assert.throws(()=>validateMigrationRows({...complete,[key]:false}));
 assert.throws(()=>validateMigrationRows(null));
});
test('enabling image scope requires all real-model cases including ordered reference result',()=>{
 const hashes={installerSha256:'f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083',imagePolicySha256:'15df47b615b92c00e99bbd65ba3891556ae0602d6798200a70212efbdd5713e8',textPolicySha256:'9646f627a48c07066989d6086f2904c7ac469c89e8f60826240df61fc4379b4b',serviceSha256:'b06649f31d2a7905a6f4d8ac92c709002da9d768752966335457441a6d246f4e',audioPolicySha256:'b9ead47f4d4ad45385fe5cbf428bb0fbefefa5d1f23aa6ce434963a4b5261296'};
 const good=[{ok:true},{ok:true},{ok:true,role_check:true},...['txt2img-v3','h3-text-protocol','audio-music','audio-sfx'].map(c=>({ok:true,case:c,model_calls:2}))].map(x=>({...x,...hashes}));
 validateImageAcceptance(good);assert.throws(()=>validateImageAcceptance([]));
 assert.throws(()=>validateImageAcceptance(good.map((x,i)=>i===2?{...x,role_check:false}:x)));
 assert.throws(()=>validateImageAcceptance(good.map(x=>x.case==='audio-sfx'?{...x,ok:false}:x)));
});

test('later stages require a fresh matching real worker login, natural heartbeat, and visible policy proof',()=>{
 const now=Date.now(),t=new Date(now).toISOString(),policy={enabled:true,owner_enabled:true,sharing_enabled:false,pending_approval:false,sharing_scope:'selected',allowed_user_ids:[]};
 const proof={controlDeployment:'live-286',controlSourceSha256:'46e6821d422fb6c1cab60aeb2f2816ee5fab29425c6f175b51b7e133b54f57ed',loginHttpStatus:200,loginWorkerId:'worker-1',heartbeatWorkerId:'worker-1',uiOnline:true,uiPolicyConfirmed:true,checkedAt:t,heartbeatAt:t,policy};
 validateControlProtocolProof(proof,'live-286',now);
 for(const bad of [{...proof,controlDeployment:'old'}, {...proof,heartbeatWorkerId:'different'}, {...proof,heartbeatAt:new Date(now-121000).toISOString()}, {...proof,uiOnline:false}, {...proof,policy:{...policy,owner_enabled:undefined}}])assert.throws(()=>validateControlProtocolProof(bad,'live-286',now));
});
