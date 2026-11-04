const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture({ race = false, missingRpc = false, networkFailure = false, readFailure = false } = {}) {
  const filename=path.resolve(__dirname,'../license-admin-gui/admin-data.js');
  const realRequire=createRequire(filename);
  let value={prices:{image:4},credits_per_usd:211,token_billing:{markup:1.5},xiaotao_online:{markup:1.5,model_rates:{grok:{input:1.7}}}};
  const other=new Map(); let writes=0,rpcCalls=0;
  const client={
    from(table) {
      assert.equal(table,'system_settings'); let action,record,key;
      const q={
        select(){return q}, eq(name,v){if(name==='key')key=v;return q},
        upsert(v){action='upsert';record=v;return q},
        async maybeSingle(){
          if(!action) return readFailure?{error:new Error('fixture read failed')}:{data:key==='feature_credit_config'?{value:structuredClone(value)}:null};
          writes++;
          if(record.key==='feature_credit_config') value=structuredClone(record.value); else other.set(record.key,structuredClone(record.value));
          return {data:{key:record.key,value:structuredClone(record.value),updated_at:record.updated_at}};
        }
      };return q;
    },
    async rpc(name,args){
      rpcCalls++;assert.equal(name,'foart_update_feature_credit_config_candidate_v1');
      if(missingRpc)return {error:{code:'PGRST202'}};
      if(networkFailure)throw Error('synthetic timeout');
      if(race)value.prices.image=8;
      if(!require('node:util').isDeepStrictEqual(args.p_expected,value))return {error:{code:'40001'}};
      writes++;value=structuredClone(args.p_next);
      return {data:{key:'feature_credit_config',value:structuredClone(value),updated_at:'fixture'}};
    }
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    module,exports:module.exports,process:{env:{NOVAFLOW_SUPABASE_URL:'https://fixture.invalid',NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},platform:'linux'},
    console:{log(){},warn(){}},require:name=>name==='@supabase/supabase-js'?{createClient:()=>client}:realRequire(name)
  },{filename});
  return {api:module.exports,getValue:()=>structuredClone(value),getOther:key=>other.get(key),getWrites:()=>writes,getRpcCalls:()=>rpcCalls};
}
const changed = value => ({...value,prices:{image:9},xiaotao_online:{...value.xiaotao_online,markup:2}});

test('explicit policy with no snapshot is rejected before any write',async()=>{
  const f=fixture(),before=f.getValue();
  const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:changed(before)});
  assert.equal(r.ok,false);assert.match(r.error,/快照/);assert.deepEqual(f.getValue(),before);assert.equal(f.getWrites(),0);assert.equal(f.getRpcCalls(),0);
});
test('stale or incomplete snapshot is rejected before any write',async()=>{
  for(const expected of [{}, {prices:{image:4}}]){
    const f=fixture(),before=f.getValue();
    const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:changed(before),expected_config:expected});
    assert.equal(r.ok,false);assert.match(r.error,/快照/);assert.deepEqual(f.getValue(),before);assert.equal(f.getWrites(),0);assert.equal(f.getRpcCalls(),0);
  }
});
test('explicit policy and unrelated price commit together through one CAS RPC',async()=>{
  const f=fixture(),before=f.getValue(),next=changed(before);
  const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next,expected_config:before});
  assert.equal(r.ok,true);assert.deepEqual(f.getValue(),next);assert.deepEqual(r.record.value,next);assert.equal(f.getWrites(),1);assert.equal(f.getRpcCalls(),1);
});
test('race after snapshot is rejected by database with no partial update',async()=>{
  const f=fixture({race:true}),before=f.getValue();
  const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:changed(before),expected_config:before});
  assert.equal(r.ok,false);assert.match(r.error,/变化/);assert.equal(f.getWrites(),0);assert.equal(f.getValue().prices.image,8);assert.equal(f.getValue().xiaotao_online.markup,1.5);
});
test('missing RPC or indeterminate transport never falls back to upsert',async()=>{
  for(const [options,expected] of [[{missingRpc:true},/尚未安装/],[{networkFailure:true},/未确认/]]){
    const f=fixture(options),before=f.getValue();
    const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:changed(before),expected_config:before});
    assert.equal(r.ok,false);assert.match(r.error,expected);assert.equal(f.getWrites(),0);assert.equal(f.getRpcCalls(),1);assert.deepEqual(f.getValue(),before);
  }
});
test('explicit nested compatibility policy also requires snapshot and CAS',async()=>{
  const f=fixture(),before=f.getValue();const next={...before,token_billing:{...before.token_billing,xiaotao_online:{markup:3}}};
  const rejected=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next});
  assert.equal(rejected.ok,false);assert.equal(f.getWrites(),0);
  const ok=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next,expected_config:before});
  assert.equal(ok.ok,true);assert.equal(f.getWrites(),1);assert.equal(f.getRpcCalls(),1);assert.deepEqual(f.getValue(),next);
});
test('unchanged policy and other settings keep normal upsert behavior',async()=>{
  const f=fixture(),before=f.getValue(),next={...before,prices:{image:6}};
  assert.equal((await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next})).ok,true);
  assert.deepEqual(f.getValue(),next);assert.equal(f.getRpcCalls(),0);
  assert.equal((await f.api.upsertAdminSystemSetting({key:'another_setting',value:{enabled:true}})).ok,true);
  assert.deepEqual(f.getOther('another_setting'),{enabled:true});assert.equal(f.getWrites(),2);
});
test('failed read stops policy write',async()=>{
  const f=fixture({readFailure:true}),before=f.getValue();
  const r=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:changed(before),expected_config:before});
  assert.equal(r.ok,false);assert.equal(f.getWrites(),0);assert.equal(f.getRpcCalls(),0);
});
test('explicit global rate and rounding edits require and honor a full configuration snapshot',async()=>{
  for(const patch of [{credits_per_usd:250},{token_billing:{markup:1.5,round:'floor'}}]){
    const f=fixture(),before=f.getValue(),next={...before,...patch};
    const rejected=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next});
    assert.equal(rejected.ok,false);assert.equal(f.getWrites(),0);
    const result=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next,expected_config:before});
    assert.equal(result.ok,true);assert.equal(f.getRpcCalls(),1);assert.deepEqual(f.getValue(),next);
  }
});

test('generic editor rejects invalid explicit billing values before CAS or upsert',async()=>{
  for(const patch of [
    {credits_per_usd:-1},
    {prices:{image:1.4}},
    {token_billing:{markup:-1}},
    {token_billing:{markup:1.5,round:'nonsense'}},
    {xiaotao_online:{markup:1.5,model_rates:{grok:{input:-1}}}},
    {xiaotao_online:{markup:1.5,model_rates:{grok:{output:'invalid'}}}}
  ]){
    const f=fixture(),before=f.getValue(),next={...before,...patch};
    const result=await f.api.upsertAdminSystemSetting({key:'feature_credit_config',value:next,expected_config:before});
    assert.equal(result.ok,false);assert.match(result.error,/无效/);assert.equal(f.getWrites(),0);assert.equal(f.getRpcCalls(),0);
  }
});
