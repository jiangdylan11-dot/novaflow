import {createClient} from 'npm:@supabase/supabase-js@2.108.2';
import {createControlPlane} from '../_art-shared/control-plane.mjs';
import {createCompanionPricingContext,parseCompanionOnlineOverlay} from '../_art-shared/companion-pricing-context.mjs';
import {createCompanionOperationV3Assembly} from '../_art-shared/companion-operation-v3-assembly.mjs';
import {createXiaotaoV3ArtAdapter} from '../_art-shared/xiaotao-operation-v3-art-adapter.mjs';
import {createXiaotaoOperationV3Status} from '../_art-shared/xiaotao-operation-v3-status.mjs';
import {createOnlineAiCharge} from '../_art-shared/online-ai-charge.mjs';
import {createRunningHubLiveRates} from '../_art-shared/runninghub-live-rates.mjs';
import {xiaotaoModelRatePolicy} from '../_art-shared/xiaotao-model-rates.mjs';
import {createFeatureCreditPorts} from '../_art-shared/feature-credits.mjs';
import {RELEASE_VERSION} from '../_art-shared/release.mjs';
import {XIAOTAO_VISION_MODEL_IDS} from '../_art-shared/xiaotao-online-models.mjs';
import {createRunningHubServerConfig} from '../_art-shared/runninghub-server-config.mjs';
import {artBusinessDependencies} from './art-dependencies.mjs';
import {mergeCapabilityOverrides,OPT_IN_KEYS} from './capability-overrides.mjs';
import {createRecoveryOnly} from './recovery-only.mjs';
import {Buffer} from 'node:buffer';
const env=(key:string)=>String(Deno.env.get(key)||'').trim();
const client=createClient(env('NOVAFLOW_SUPABASE_URL')||env('SUPABASE_URL'),env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY')||env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const unwrap=({data,error}:any)=>{if(error)throw error;return Array.isArray(data)?data[0]:data;};
const rpc=async(name:string,args:any)=>unwrap(await client.rpc(name,args));
const serverProvider=createRunningHubServerConfig({rpc:(name:string,args:any)=>client.rpc(name,args),env});
const charge=createOnlineAiCharge(createFeatureCreditPorts(rpc));
const store={getUserById:async(id:string)=>unwrap(await client.from('users').select('id,status,role,expires_at').eq('id',id).maybeSingle()),getUserSession:async(id:string)=>unwrap(await client.from('user_sessions').select('id,user_id,revoked_at').eq('id',id).maybeSingle())};
// Match the deployed 253 contract: snapshot trusted flags for each request.
// Admitted work keeps its original snapshot, including its recovery route.
const liveRates=createRunningHubLiveRates({base:xiaotaoModelRatePolicy(),log:(marker,value)=>console.info(marker,JSON.stringify(value))});
const createRequestPlane=()=>{
const envOnline=parseCompanionOnlineOverlay(Deno.env.get('NOVAFLOW_XIAOTAO_ONLINE'));
let v3Capabilities=null;
try{v3Capabilities=mergeCapabilityOverrides(Deno.env.get('NOVAFLOW_XIAOTAO_V3_CAPABILITIES'),{
 [OPT_IN_KEYS.audioRewrite]:Deno.env.get(OPT_IN_KEYS.audioRewrite),
 [OPT_IN_KEYS.videoRewrite]:Deno.env.get(OPT_IN_KEYS.videoRewrite),
 [OPT_IN_KEYS.uiDraft]:Deno.env.get(OPT_IN_KEYS.uiDraft),
 [OPT_IN_KEYS.foartGeneral]:Deno.env.get(OPT_IN_KEYS.foartGeneral)});}catch{}
const operationV3Enabled=v3Capabilities?.operation===true;
const operationV3RecoveryEnabled=v3Capabilities?.recovery===true;
// Server-only decimal opt-in is separately guarded by the checked DB RPC and
// immutable pricing config. The existing production V3 flags remain unchanged.
const operationDecimalCreditsEnabled=operationV3Enabled && env('NOVAFLOW_XIAOTAO_DECIMAL_V1')==='true';
const operationV3=createCompanionOperationV3Assembly({enabled:operationV3Enabled,decimalCreditsEnabled:operationDecimalCreditsEnabled,
 visionEnabled:v3Capabilities?.vision===true,audioRewriteEnabled:v3Capabilities?.audioRewrite===true,
 foartOpenEnabled:v3Capabilities?.foartOpen===true,foartGeneralEnabled:v3Capabilities?.foartGeneral===true&&v3Capabilities?.foartOpen===true,
 styleEnabled:v3Capabilities?.vision===true,styleVisionModels:v3Capabilities?.vision===true?[...XIAOTAO_VISION_MODEL_IDS]:[],videoRewriteEnabled:v3Capabilities?.videoRewrite===true,uiDraftEnabled:v3Capabilities?.uiDraft===true,
 secret:Buffer.from(env('NOVAFLOW_SESSION_SECRET'),'utf8')});
const operationV3Status=createXiaotaoOperationV3Status({enabled:operationV3RecoveryEnabled,rpc});
const operationV3ArtEnabled=v3Capabilities?.art===true;
// Each operation uses one refreshed provider/config snapshot. Versioned
// billing remains closed until the database can atomically bind that snapshot
// to reservation and settlement.
const currentChat=async()=>{
 if(!v3Capabilities || !operationV3Enabled)throw Object.assign(new Error('operation-billing-unavailable'),{status:503,code:'operation-billing-unavailable'});
 if(operationV3Enabled && !operationV3RecoveryEnabled)throw Object.assign(new Error('operation-billing-recovery-required'),{status:503,code:'operation-billing-unavailable'});
 if(operationV3ArtEnabled && !operationV3Enabled)throw Object.assign(new Error('operation-art-requires-operation-billing'),{status:503,code:'operation-billing-unavailable'});
 const provider=await serverProvider.refresh();let dbSnapshot;
 try{dbSnapshot=await rpc('get_xiaotao_pricing_cap_v2',{});}catch{dbSnapshot=null;}
 return createCompanionPricingContext({liveRates:await liveRates.current(),provider,dbSnapshot,envOnline,legacyCharge:charge,rpc,operationV3,
  artBusiness:artBusinessDependencies(Buffer.from(env('NOVAFLOW_SESSION_SECRET'),'utf8'),
   {operationV3Enabled:operationV3ArtEnabled,createOperationV3Adapter:createXiaotaoV3ArtAdapter})});};
const operationDisabled=()=>{throw Object.assign(new Error('operation-billing-disabled'),{statusCode:503,code:'operation-billing-disabled'});};
const recoveryOnly=()=>createRecoveryOnly({secret:Buffer.from(env('NOVAFLOW_SESSION_SECRET'),'utf8'),rpc});
const companion={async pricing(){return (await currentChat()).pricing();},async quote(request:any){return (await currentChat()).quote(request);},async reply(request:any){return (await currentChat()).reply(request);},
 async artQuote(request:any){return (await currentChat()).artQuote(request);},async artExecute(request:any){return (await currentChat()).artExecute(request);},async artCancel(request:any){if(!operationV3RecoveryEnabled)return operationDisabled();return recoveryOnly().artCancel(request);},
 async prepareXiaotaoOperationV3(request:any){const ctx=await currentChat();return typeof ctx.prepareXiaotaoOperationV3==='function'?ctx.prepareXiaotaoOperationV3(request):operationDisabled();},
 async executeXiaotaoOperationV3(request:any){const ctx=await currentChat();return typeof ctx.executeXiaotaoOperationV3==='function'?ctx.executeXiaotaoOperationV3(request):operationDisabled();},
 async getXiaotaoOperationV3Status(request:any){return operationV3Status(request);},
 foartOperation:{
  async prepare(request:any){const ctx=await currentChat();return typeof ctx.foartOperation?.prepare==='function'?ctx.foartOperation.prepare(request):operationDisabled();},
  async start(request:any){const ctx=await currentChat();return typeof ctx.foartOperation?.start==='function'?ctx.foartOperation.start(request):operationDisabled();},
  async resume(request:any){const ctx=await currentChat();return typeof ctx.foartOperation?.resume==='function'?ctx.foartOperation.resume(request):operationDisabled();},
  async cancel(request:any){if(!operationV3RecoveryEnabled)return operationDisabled();return recoveryOnly().foartCancel(request);}
 }};
return createControlPlane({store,secrets:{sessionSecret:env('NOVAFLOW_SESSION_SECRET')},companion});
};
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,GET,OPTIONS','cache-control':'no-store'};
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','x-foart-deployment':env('DENO_DEPLOYMENT_ID')||'unknown'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const url=new URL(request.url),path=url.pathname.replace(/^\/(?:functions\/v1\/)?novaflow-companion/,'');
 if(request.method==='GET'&&path==='/health'){try{const provider=await serverProvider.refresh();return json(200,{ok:true,service:'novaflow-companion',liveRates:liveRates.status(),releaseVersion:RELEASE_VERSION,visionConfigured:provider.configured,model:provider.model,providerConfig:serverProvider.status()});}catch{return json(503,{ok:false,error:'服务器 RunningHub 配置读取失败'});}}
 let plane;
 try{plane=createRequestPlane();}catch{return json(503,{ok:false,code:'operation-billing-unavailable',error:'在线服务配置暂不可用'});}
 if(request.method==='GET'&&path==='/api/web/companion/pricing'){
  const response=await plane.handle({method:request.method,path,headers:Object.fromEntries(request.headers),query:{},body:{}});return json(response.status,response.body);
 }
 if(request.method!=='POST'||!['/api/web/companion/chat','/api/web/companion/quote','/api/web/companion/art/quote','/api/web/companion/art/execute','/api/web/companion/art/cancel','/api/web/companion/operation/prepare','/api/web/companion/operation/execute','/api/web/companion/operation/status','/api/web/companion/operation/foart/prepare','/api/web/companion/operation/foart/start','/api/web/companion/operation/foart/resume','/api/web/companion/operation/foart/cancel'].includes(path))return json(404,{ok:false,error:'unknown companion route'});
 if(Number(request.headers.get('content-length'))>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 try{const text=await request.text();if(new TextEncoder().encode(text).length>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 const response=await plane.handle({method:request.method,path,headers:Object.fromEntries(request.headers),query:{},body:JSON.parse(text),signal:request.signal});return json(response.status,response.body);
 }catch{return json(400,{ok:false,error:'对话请求无效'});}
});
