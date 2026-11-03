import test from 'node:test';
import assert from 'node:assert/strict';
import {parse288Package,parse288Execute,compare288Trees,validate288Manifest,validate288Phase,assert288SafeAsset,validate288ControlProof} from './release-288.mjs';

const base='https://cjakoblszlmbmotchzva.supabase.co/functions/v1';
const packageArgs=['--local-qwen-288','--package-only','--control-url='+base+'/novaflow-web','--auth-url='+base+'/novaflow-backend'];
const executeArgs=['--local-qwen-288','--execute'];
const hash=character=>character.repeat(64);

test('package requires exactly both production endpoints and the explicit package action',()=>{
  assert.doesNotThrow(()=>parse288Package(packageArgs));
  assert.doesNotThrow(()=>parse288Package([...packageArgs].reverse()));
  for(const args of [[],packageArgs.slice(0,-1),[...packageArgs,'--package-only'],[...packageArgs,'--other'],
    packageArgs.map(x=>x.replace(base,'https://attacker.example/functions/v1')),
    packageArgs.map(x=>x.replace('/novaflow-web','/novaflow-backend'))])assert.throws(()=>parse288Package(args));
});

test('only the four known deployment stages and explicit arguments pass parsing',()=>{
  for(const component of ['control','backend','companion','site'])assert.doesNotThrow(()=>parse288Execute(component,executeArgs));
  for(const [component,args] of [['unknown',executeArgs],['site',[]],['control',['--local-qwen-288']],['backend',[...executeArgs,'--execute']],['companion',[...executeArgs,'--other']]])
    assert.throws(()=>parse288Execute(component,args));
});

test('deployment sequence rejects every out-of-order live version tuple',()=>{
  const phases={control:{web:'2.0.287',control:'2.0.287',backend:'2.0.287',companion:'2.0.287'},
    backend:{web:'2.0.287',control:'2.0.288',backend:'2.0.287',companion:'2.0.287'},
    companion:{web:'2.0.287',control:'2.0.288',backend:'2.0.288',companion:'2.0.287'},
    site:{web:'2.0.287',control:'2.0.288',backend:'2.0.288',companion:'2.0.288'}};
  for(const [component,versions] of Object.entries(phases)){
    assert.doesNotThrow(()=>validate288Phase(component,versions));
    for(const key of Object.keys(versions))assert.throws(()=>validate288Phase(component,{...versions,[key]:versions[key]==='2.0.287'?'2.0.288':'2.0.287'}),`${component} must reject stale ${key}`);
    assert.throws(()=>validate288Phase(component,{}));
  }
  assert.throws(()=>validate288Phase('unknown',phases.control));
});

test('frozen asset trees may differ only in the four reviewed paths',()=>{
  const allowed=['editor.html','index.html','novaflow-web-runtime.js','release.json'];
  const oldRows=[...allowed,'assets/logo.png'].map(name=>[name,hash('a')]);
  const newRows=oldRows.map(([name,sha])=>[name,allowed.includes(name)?hash('b'):sha]);
  assert.deepEqual(compare288Trees(oldRows,newRows),allowed);
  assert.throws(()=>compare288Trees(oldRows,newRows.map(([name,sha])=>[name,name==='assets/logo.png'?hash('c'):sha])));
  assert.throws(()=>compare288Trees(oldRows,newRows.filter(([name])=>name!=='editor.html')));
  assert.throws(()=>compare288Trees(oldRows,[...newRows,['editor.html',hash('b')]]));
  assert.throws(()=>compare288Trees(oldRows,newRows.map(([name,sha])=>[name,name==='release.json'?hash('a'):sha])));
});

test('manifest pins version, inventory, components and verified ZIP exactly',()=>{
  const manifest={version:'2.0.288',baselineTreeSha256:hash('a'),treeSha256:hash('b'),files:739,
    componentSha256:{control:hash('c'),backend:hash('d'),companion:hash('e')},zipSha256:hash('f')};
  assert.doesNotThrow(()=>validate288Manifest(manifest,structuredClone(manifest)));
  for(const bad of [{...manifest,version:'2.0.287'},{...manifest,baselineTreeSha256:hash('b')},
    {...manifest,treeSha256:hash('c')},{...manifest,files:738},{...manifest,zipSha256:hash('e')},
    {...manifest,componentSha256:{...manifest.componentSha256,backend:hash('a')}}])
    assert.throws(()=>validate288Manifest(manifest,bad));
  assert.throws(()=>validate288Manifest(null,manifest));
});

test('published asset paths reject traversal, hidden credentials, and private model files',()=>{
  assert.doesNotThrow(()=>assert288SafeAsset('assets/logo.png'));
  for(const name of ['../escape.js','assets/../../escape.js','.env','secrets.json','credentials.json','models/private.gguf'])
    assert.throws(()=>assert288SafeAsset(name),name);
});

test('later stages require fresh matching 288 node login, natural heartbeat, deployment and complete policy evidence',()=>{
  // The deployment identifier here is synthetic: a real proof must be bound
  // to the identifier returned by the actual 288 control-plane health route.
  const now=Date.now(),time=new Date(now).toISOString(),deployment='cjakoblszlmbmotchzva_0435a343-622a-4e1c-8091-30a3fa01f8ac_109';
  const policy={enabled:true,owner_enabled:true,sharing_enabled:true,pending_approval:false,sharing_scope:'selected',allowed_user_ids:[]};
  const proof={controlDeployment:deployment,controlSourceSha256:hash('c'),loginHttpStatus:200,
    loginWorkerId:'synthetic-worker',heartbeatWorkerId:'synthetic-worker',uiOnline:true,uiPolicyConfirmed:true,checkedAt:time,heartbeatAt:time,policy};
  assert.doesNotThrow(()=>validate288ControlProof(proof,deployment,now,hash('c')));
  assert.throws(()=>validate288ControlProof(proof,deployment,now,'PENDING_REVIEW'),'unreviewed control candidate must fail closed');
  for(const key of Object.keys(policy)){const missing={...policy};delete missing[key];assert.throws(()=>validate288ControlProof({...proof,policy:missing},deployment,now,hash('c')),key);}
  for(const bad of [{...proof,controlDeployment:deployment+'-old'}, {...proof,controlSourceSha256:hash('a')},
    {...proof,loginHttpStatus:401},{...proof,heartbeatWorkerId:'other'}, {...proof,loginWorkerId:''},
    {...proof,checkedAt:new Date(now-300001).toISOString()}, {...proof,heartbeatAt:new Date(now-120001).toISOString()},
    {...proof,heartbeatAt:new Date(now+30001).toISOString()}, {...proof,uiOnline:false},{...proof,uiPolicyConfirmed:false},
    {...proof,policy:{...policy,enabled:false}}, {...proof,policy:{...policy,owner_enabled:false}},
    {...proof,policy:{...policy,pending_approval:true}}, {...proof,policy:{...policy,sharing_scope:'unknown'}},
    {...proof,policy:{...policy,allowed_user_ids:'not-an-array'}}])assert.throws(()=>validate288ControlProof(bad,deployment,now,hash('c')));
  assert.throws(()=>validate288ControlProof(proof,'',now,hash('c')));
});
