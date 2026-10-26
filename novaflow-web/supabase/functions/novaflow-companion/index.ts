import {createClient} from 'npm:@supabase/supabase-js@2.108.2';
import {createControlPlane} from '../_art-shared/control-plane.mjs';
import {createCompanionChat,CompanionError} from '../_art-shared/companion-chat.mjs';
import {RELEASE_VERSION} from '../_art-shared/release.mjs';
const env=(key:string)=>String(Deno.env.get(key)||'').trim();
const client=createClient(env('NOVAFLOW_SUPABASE_URL')||env('SUPABASE_URL'),env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY')||env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
const unwrap=({data,error}:any)=>{if(error)throw error;return Array.isArray(data)?data[0]:data;};
const rpc=async(name:string,args:any)=>unwrap(await client.rpc(name,args));
const companion=createCompanionChat({provider:{apiKey:env('NOVAFLOW_GROK_API_KEY'),baseUrl:env('NOVAFLOW_GROK_BASE_URL')||'https://api.x.ai/v1',model:env('NOVAFLOW_GROK_MODEL')||'grok-4.3'},
 reserve:async(id:string,key:string)=>{try{return await rpc('reserve_grok_quota',{p_user_id:id,p_usage_key:key,p_feature:'xiaotao-vision',p_min_calls:1,p_max_calls:1,p_metadata:{imageAnalysis:true}});}catch{throw new CompanionError(402,'在线AI次数不足或暂时不可用');}},
 settle:(id:string,key:string,metadata:any)=>rpc('settle_grok_quota',{p_user_id:id,p_usage_key:key,p_actual_calls:1,p_success:true,p_call_records:[],p_metadata:metadata}),
 release:(id:string,key:string)=>rpc('release_grok_quota',{p_user_id:id,p_usage_key:key,p_reason:'companion analysis incomplete',p_metadata:{}})
});
const store={getUserById:async(id:string)=>unwrap(await client.from('users').select('id,status,role,expires_at').eq('id',id).maybeSingle()),getUserSession:async(id:string)=>unwrap(await client.from('user_sessions').select('id,user_id,revoked_at').eq('id',id).maybeSingle())};
const plane=createControlPlane({store,secrets:{sessionSecret:env('NOVAFLOW_SESSION_SECRET')},companion});
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST,GET,OPTIONS','cache-control':'no-store'};
const json=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}});
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const url=new URL(request.url),path=url.pathname.replace(/^\/(?:functions\/v1\/)?novaflow-companion/,'');
 if(request.method==='GET'&&path==='/health')return json(200,{ok:true,service:'novaflow-companion',releaseVersion:RELEASE_VERSION,visionConfigured:Boolean(env('NOVAFLOW_GROK_API_KEY'))});
 if(request.method!=='POST'||path!=='/api/web/companion/chat')return json(404,{ok:false,error:'unknown companion route'});
 if(Number(request.headers.get('content-length'))>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 try{const text=await request.text();if(new TextEncoder().encode(text).length>28*1024*1024)return json(413,{ok:false,error:'参考资料过大'});
 const response=await plane.handle({method:request.method,path,headers:Object.fromEntries(request.headers),query:{},body:JSON.parse(text)});return json(response.status,response.body);
 }catch{return json(400,{ok:false,error:'对话请求无效'});}
});
