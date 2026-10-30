import {createClient} from 'npm:@supabase/supabase-js@2.108.2';
import {createControlPlane} from '../_art-shared/control-plane.mjs';
import {createCompanionChat} from '../_art-shared/companion-chat.mjs';
import {createOnlineAiCharge} from '../_art-shared/online-ai-charge.mjs';
import {createFeatureCreditPorts} from '../_art-shared/feature-credits.mjs';
import {RELEASE_VERSION} from '../_art-shared/release.mjs';
import {createRunningHubServerConfig} from '../_art-shared/runninghub-server-config.mjs';
const env=(key:string)=>String(Deno.env.get(key)||'').trim();
const client=createClient(env('NOVAFLOW_SUPABASE_URL')||env('SUPABASE_URL'),env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY')||env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const unwrap=({data,error}:any)=>{if(error)throw error;return Array.isArray(data)?data[0]:data;};
const rpc=async(name:string,args:any)=>unwrap(await client.rpc(name,args));
const serverProvider=createRunningHubServerConfig({rpc:(name:string,args:any)=>client.rpc(name,args),env});
const charge=createOnlineAiCharge(createFeatureCreditPorts(rpc));
const creditConfig=(()=>{try{const raw=JSON.parse(env('NOVAFLOW_XIAOTAO_ONLINE')||'');return raw&&typeof raw==='object'?{xiaotao_online:raw}:undefined;}catch{return undefined;}})();
const companion={async reply(request:any){const provider=await serverProvider.refresh();return createCompanionChat({provider:{...provider,creditConfig},charge}).reply(request);}};
const store={getUserById:async(id:string)=>unwrap(await client.from('users').select('id,status,role,expires_at').eq('id',id).maybeSingle()),getUserSession:async(id:string)=>unwrap(await client.from('user_sessions').select('id,user_id,revoked_at').eq('id',id).maybeSingle())};
const plane=createControlPlane({store,secrets:{sessionSecret:env('NOVAFLOW_SESSION_SECRET')},companion});
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,GET,OPTIONS','cache-control':'no-store'};
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const url=new URL(request.url),path=url.pathname.replace(/^\/(?:functions\/v1\/)?novaflow-companion/,'');
 if(request.method==='GET'&&path==='/health'){try{const provider=await serverProvider.refresh();return json(200,{ok:true,service:'novaflow-companion',releaseVersion:RELEASE_VERSION,visionConfigured:provider.configured,model:provider.model,providerConfig:serverProvider.status()});}catch{return json(503,{ok:false,error:'服务器 RunningHub 配置读取失败'});}}
 if(request.method!=='POST'||path!=='/api/web/companion/chat')return json(404,{ok:false,error:'unknown companion route'});
 if(Number(request.headers.get('content-length'))>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 try{const text=await request.text();if(new TextEncoder().encode(text).length>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 const response=await plane.handle({method:request.method,path,headers:Object.fromEntries(request.headers),query:{},body:JSON.parse(text)});return json(response.status,response.body);
 }catch{return json(400,{ok:false,error:'对话请求无效'});}
});
