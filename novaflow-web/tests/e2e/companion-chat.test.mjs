import test from 'node:test';import assert from 'node:assert/strict';
import {createCompanionChat,companionInput} from '../../packages/shared/src/companion-chat.mjs';
import {createControlPlane} from '../../packages/shared/src/control-plane.mjs';
import {createHmac} from 'node:crypto';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const payload=()=>({requestId:'vision-fixture-123',mode:'chat',message:'参考图的鼻子是怎么画的？',history:[],images:[{role:'style',source:2,dataUrl:PNG}],artContext:{surface:'drawing',prompt:'原提示词'}});
test('online vision receives full original bytes and role positions, uses one reserved call and never gains tools',async()=>{
 const events=[];let request;
 const service=createCompanionChat({provider:{baseUrl:'https://provider.test/v1',model:'vision-fixture',apiKey:'fixture-private'},reserve:async()=>{events.push('reserve');return {status:'reserved',idempotent:false};},settle:async()=>{events.push('settle');return {remaining_count:8};},release:async()=>events.push('release'),fetchImpl:async(url,init)=>{events.push('infer');request={url,body:JSON.parse(init.body)};return Response.json({status:'completed',model:'vision-fixture',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'鼻子用很短的一笔表示。'}]}]});}});
 const result=await service.reply({user:{id:'user'},payload:payload()});
 assert.deepEqual(events,['reserve','infer','settle']);assert.equal(result.imageCount,1);assert.equal(result.quota.remaining_count,8);
 assert.equal(request.url,'https://provider.test/v1/responses');assert.equal(request.body.store,false);assert.equal(request.body.tools,undefined);
 const content=request.body.input.at(-1).content;assert.equal(content.find(p=>p.type==='input_image').image_url,PNG);assert(content.some(p=>p.text?.includes('参考位置 2')));
 assert(!JSON.stringify(result).includes('fixture-private'));assert.equal(result.proposal,undefined);
});
test('bad images and replay are rejected before provider access; provider failure releases reservation once',async()=>{
 for(const images of [[{dataUrl:'https://private.test/image.png'}],Array(4).fill({dataUrl:PNG}),[{dataUrl:PNG,role:'system'}]])assert.throws(()=>companionInput({...payload(),images}));
 let count=0,released=0;const service=createCompanionChat({provider:{baseUrl:'https://provider.test',model:'fixture',apiKey:'secret'},reserve:async()=>({status:'reserved'}),settle:async()=>assert.fail('cannot settle failure'),release:async()=>released++,fetchImpl:async()=>{count++;return new Response('secret upstream detail',{status:502});}});
 await assert.rejects(service.reply({user:{id:'user'},payload:payload()}),error=>error.status===502&&!error.message.includes('secret'));assert.equal(count,1);assert.equal(released,1);
 const replay=createCompanionChat({provider:{apiKey:'configured'},reserve:async()=>({status:'reserved',idempotent:true}),fetchImpl:async()=>assert.fail('replay must not infer')});
 await assert.rejects(replay.reply({user:{id:'user'},payload:payload()}),error=>error.status===409);
});
test('vision gateway rejects missing, revoked and disabled user sessions before inference',async()=>{
 let inference=0;const store={getUserById:async()=>({id:'u',status:'disabled'}),getUserSession:async()=>null},plane=createControlPlane({store,secrets:{sessionSecret:'fixture-session-secret'},companion:{reply:async()=>{inference++;}}});
 const call=headers=>plane.handle({method:'POST',path:'/api/web/companion/chat',headers,body:payload()});
 assert.equal((await call({})).status,401);
 const encoded=Buffer.from(JSON.stringify({sub:'u',sid:'s',exp:Math.floor(Date.now()/1000)+60})).toString('base64url');
 const token='nfs_'+encoded+'.'+createHmac('sha256','fixture-session-secret').update(encoded).digest('base64url');
 assert.equal((await call({authorization:'Bearer '+token})).status,403);assert.equal(inference,0);
});
