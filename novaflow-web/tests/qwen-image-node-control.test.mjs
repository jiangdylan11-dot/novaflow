import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',node='cccccccc-cccc-4ccc-8ccc-cccccccccccc',other='dddddddd-dddd-4ddd-8ddd-dddddddddddd',secret='fixture-secret';
const part=Buffer.from(JSON.stringify({sub:uid,sid,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),token='nfs_'+part+'.'+createHmac('sha256',secret).update(part).digest('base64url');
test('standard and turbo capability counts use the same selected node and user authorization',async()=>{
 const calls=[],store={getUserById:async()=>({id:uid,status:'active',plan:'pro'}),getUserSession:async()=>({id:sid,user_id:uid,revoked_at:null}),countCapableWorkers:async(...a)=>{calls.push(a);return a[3]===node&&a[5]===uid?(a[0]==='qwen-image-2.1'?1:a[0]==='qwen-image-2.1-turbo'?2:0):0;},getWorkerById:async()=>null};
 const plane=createControlPlane({store,secrets:{sessionSecret:secret}}),get=worker=>plane.handle({method:'GET',path:'/api/web/capabilities',query:{worker},headers:{authorization:'Bearer '+token}});
 let result=await get(node);assert.equal(result.status,200);assert.equal(result.body.features.qwenImage21,true);assert.equal(result.body.features.qwenImage21Workers,1);assert.equal(result.body.features.qwenImage21Turbo,true);assert.equal(result.body.features.qwenImage21TurboWorkers,2);
 for(const name of ['qwen-image-2.1','qwen-image-2.1-turbo']){const call=calls.find(c=>c[0]===name);assert.equal(call[1],16000);assert.equal(call[3],node);assert.equal(call[5],uid);}
 result=await get(other);assert.equal(result.body.features.qwenImage21Workers,0);assert.equal(result.body.features.qwenImage21TurboWorkers,0);
});
