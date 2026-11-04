import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {parseV3Capabilities} from '../supabase/functions/novaflow-companion/capabilities.mjs';
import {OPT_IN_KEYS,mergeCapabilityOverrides} from '../supabase/functions/novaflow-companion/capability-overrides.mjs';
import {parseCompanionOnlineOverlay} from '../packages/shared/src/companion-pricing-context.mjs';

// Exercise the actual request-plane closure without starting Deno, using a
// synthetic provider, service-only RPC and in-memory environment. No network.
const source=readFileSync(new URL('../supabase/functions/novaflow-companion/index.ts',import.meta.url),'utf8');
const start=source.indexOf('const createRequestPlane=()=>{'),end=source.indexOf("const cors=",start);
assert.ok(start>=0&&end>start,'request-local plane must exist');
const script=ts.transpileModule(source.slice(start,end)+'\nglobalThis.make=createRequestPlane;',
  {compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText;

function harness(initial={}){
  const envs={...initial},events=[],assemblies=[];
  const get=key=>envs[key];
  const sandbox={Buffer,Deno:{env:{get}},env:key=>String(get(key)||'').trim(),parseV3Capabilities,OPT_IN_KEYS,mergeCapabilityOverrides,parseCompanionOnlineOverlay,
    createCompanionOperationV3Assembly:opts=>{assemblies.push(opts);return {enabled:opts.enabled};},
    createXiaotaoOperationV3Status:opts=>async()=>({enabled:opts.enabled}),
    createXiaotaoV3ArtAdapter:()=>{},legacyH3ReverseDependencies:()=>{},
    artBusinessDependencies:()=>({}),store:{},charge:()=>{},
    serverProvider:{refresh:async()=>{events.push('provider-config');return {}}},
    rpc:async name=>{events.push(name);return {protocol:'xiaotao-pricing-v2'};},
    createCompanionPricingContext:async opts=>{events.push('pricing-context');return {pricing:async()=>opts};},
    createRecoveryOnly:()=>({artCancel:async()=>{events.push('recover-art');return {ok:true};},
      foartCancel:async()=>{events.push('recover-foart');return {ok:true};}}),
    createControlPlane:({companion})=>companion};
  vm.createContext(sandbox);vm.runInContext(script,sandbox);
  return {envs,events,assemblies,make:()=>sandbox.make()};
}

test('253 request plane reads operation/recovery and decimal switches per request',async()=>{
  const h=harness({NOVAFLOW_XIAOTAO_V3_CAPABILITIES:JSON.stringify({operation:true,recovery:true,vision:true,audioRewrite:true,foartOpen:true}),
    NOVAFLOW_XIAOTAO_DECIMAL_V1:'true'});
  const before=h.make(),settings=await before.pricing();
  assert.equal(h.assemblies[0].enabled,true);assert.equal(h.assemblies[0].decimalCreditsEnabled,true);
  assert.equal(h.assemblies[0].visionEnabled,true);assert.equal(h.assemblies[0].audioRewriteEnabled,true);
  assert.equal(h.assemblies[0].foartOpenEnabled,true);assert.equal(settings.envOnline,undefined);
  h.envs.NOVAFLOW_XIAOTAO_V3_CAPABILITIES=JSON.stringify({recovery:true});
  h.envs.NOVAFLOW_XIAOTAO_DECIMAL_V1='false';
  const recoveryOnly=h.make();assert.equal(h.assemblies[1].enabled,false);assert.equal(h.assemblies[1].decimalCreditsEnabled,false);
  await assert.rejects(recoveryOnly.pricing(),e=>e.code==='operation-billing-unavailable');
  assert.deepEqual(await recoveryOnly.artCancel({}),{ok:true});assert.deepEqual(await recoveryOnly.foartOperation.cancel({}),{ok:true});
  assert.deepEqual(h.events.slice(-2),['recover-art','recover-foart']);
  // Existing request retains its own previously admitted snapshot.
  await before.pricing();assert.equal(h.events.filter(x=>x==='pricing-context').length,2);
});

test('invalid capability config fails paid entry and recovery without provider access',async()=>{
  for(const raw of ['{','{"operation":true}','{"operation":true,"recovery":true,"operation":false}']){
    const h=harness({NOVAFLOW_XIAOTAO_V3_CAPABILITIES:raw});const plane=h.make();
    await assert.rejects(plane.pricing(),e=>e.code==='operation-billing-unavailable');
    await assert.rejects(plane.artCancel({}),e=>e.code==='operation-billing-disabled');
    assert.deepEqual(h.events,[]);
  }
});
