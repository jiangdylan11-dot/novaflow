const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
function fixture(error=null){
  const file=path.resolve(__dirname,'../license-admin-gui/admin-data.js'),realRequire=createRequire(file),calls=[];
  const client={rpc:async name=>{calls.push({rpc:name});return {data:[{total_tasks:61}],error};},from(table){
    const call={table,filters:[],orders:[]};calls.push(call);
    return {select(fields,options){call.fields=fields;call.options=options;return this;},eq(key,value){call.filters.push([key,value]);return this;},order(key,options){call.orders.push([key,options]);return this;},async range(from,to){call.range=[from,to];return {data:[{id:'fixture'}],count:61,error};}};
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,console:{log(){},warn(){}},process:{env:{NOVAFLOW_SUPABASE_URL:'https://fixture.supabase.co',NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY:'fixture-only'},platform:'linux'},require:name=>name==='@supabase/supabase-js'?{createClient:()=>client}:realRequire(name)},{filename:file});
  return {api:module.exports,calls};
}
test('per-user usage is paginated and reads only the retained operational record',async()=>{
  const {api,calls}=fixture(),id='11111111-1111-4111-8111-111111111111';
  const result=await api.getAdminWebTaskUsage({userId:id,status:'failed',limit:50,offset:50});
  assert.equal(result.total,61);assert.equal(result.hasMore,true);assert.equal(calls[0].table,'web_compute_usage');
  assert.deepEqual(calls[0].filters,[['user_id',id],['status','failed']]);assert.deepEqual(calls[0].range,[50,99]);
  assert.deepEqual(calls[0].orders.map(x=>x[0]),['created_at','id']);assert.equal(calls[0].options.count,'exact');
  assert.doesNotMatch(calls[0].fields,/input_manifest|output_manifest|prompt_id/);
  assert.equal(typeof api.purgeAdminWebTasks,'undefined');
});
test('usage summary aggregates in the database instead of loading all task payloads',async()=>{
  const {api,calls}=fixture();const result=await api.getAdminComputeUsageSummary();assert.equal(result.records[0].total_tasks,61);assert.deepEqual(calls,[{rpc:'admin_compute_usage_summary'}]);
});
test('invalid detail filters never query the database and migration failures remain visible',async()=>{
  const {api,calls}=fixture();assert.equal((await api.getAdminWebTaskUsage({userId:'invalid'})).status,'error');assert.equal((await api.getAdminWebTaskUsage({status:'invalid'})).status,'error');assert.equal(calls.length,0);
  const missing=fixture({message:'relation web_compute_usage does not exist'});assert.equal((await missing.api.getAdminWebTaskUsage()).status,'error');assert.match((await missing.api.getAdminComputeUsageSummary()).error,/升级记录保留服务/);
});
