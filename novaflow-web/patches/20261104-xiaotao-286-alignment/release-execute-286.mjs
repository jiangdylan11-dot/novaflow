// Frozen 286 production cutover. Imported only by official deploy:* branches.
// Nothing is executed by importing this module. Every invocation has an exact
// stage-specific state, requires reviewed migrations, and rechecks live code.
import {readFile,writeFile,mkdir,mkdtemp,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verify286} from './release-preflight-286.mjs';
const repo=resolve('D:/AI_APP/NovaFlow-Web'),work=join(repo,'work/local-qwen-aligned-286-20261104');
const PROJECT='cjakoblszlmbmotchzva',base=`https://${PROJECT}.supabase.co/functions/v1`;
const CLI='C:/Users/jiang/AppData/Local/npm-cache/_npx/91eb58246759989d/node_modules/@supabase/cli-windows-x64/bin/supabase.exe';
const cliSha='f51f287379f72f8d3cdf8469836fd1474141e57f9935a6fb8edd0f60bdb4995e';
const old={control:'2cc9b6d5b4a4e7da3ae48ece93d22b8fcfbdaa91995cfe6becc6dc43db133417',backend:'784c9bb859d3aaac688a1108ba211fd08092b191e6b17b3e70a8964df50e9ea6',companion:'972a33ae00596abc3447d610ce96bb2b59671235a255a98799b9d96889b1c71d'};
const next={control:'46e6821d422fb6c1cab60aeb2f2816ee5fab29425c6f175b51b7e133b54f57ed',backend:'fd6c65ef497d650acb66b52cf6b06fef04588c6c33dc604184c20da6d05fba2d',companion:'b4e226900b6a6a0861a928278b9753a3baef60839b22244dc8d677933b84c2bd'};
const enabled='1113eb83c4bbb5b8a185cf259ef427a9f5a28e0ce7881762565dcd13273a0aaf';
const zipSha='52a384daf74688469e10d2992c3481d7b07d157dd3003ed0e65aa87a6e5b6c25';
const sha=b=>createHash('sha256').update(b).digest('hex');
const phases=Object.freeze({
 control:{versions:{web:'2.0.285',control:'2.0.263',backend:'2.0.263',companion:'2.0.285'},source:old,target:'control',output:next.control},
 backend:{versions:{web:'2.0.285',control:'2.0.286',backend:'2.0.263',companion:'2.0.285'},source:{...old,control:next.control},target:'backend',output:next.backend},
 companion:{versions:{web:'2.0.285',control:'2.0.286',backend:'2.0.286',companion:'2.0.285'},source:{...old,control:next.control,backend:next.backend},target:'companion',output:next.companion},
 site:{versions:{web:'2.0.285',control:'2.0.286',backend:'2.0.286',companion:'2.0.286'},source:next,target:'site',output:zipSha},
 enable:{versions:{web:'2.0.286',control:'2.0.286',backend:'2.0.286',companion:'2.0.286'},source:next,target:'control',output:enabled}
});
const slug={control:'novaflow-web',backend:'novaflow-backend',companion:'novaflow-companion'};
export function parse286Execute(component,args){
 const enable=component==='control'&&args.includes('--enable-image'),name=enable?'enable':component;
 const expected=['--local-qwen-286','--execute',...(enable?['--enable-image']:[])];
 if(!phases[name]||args.length!==expected.length||new Set(args).size!==args.length||expected.some(x=>!args.includes(x)))throw Error('Invalid or unsafe 286 execute arguments');
 return {name,phase:phases[name]};
}
function run(exe,args,cwd){const r=spawnSync(exe,args,{cwd,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw Error('Command failed or outcome unknown; inspect actual live state before retry');return r.stdout;}
function inside(base,p){const rel=relative(base,p);return rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel)}
async function fileHash(p){const s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Expected regular frozen file');const actual=await realpath(p);if(!inside(await realpath(work),actual))throw Error('Frozen file escaped work directory');return sha(await readFile(actual));}
async function stageDir(prefix){const root=await realpath(work),target=join(root,'release-execution-stages');try{await mkdir(target);}catch(e){if(e.code!=='EEXIST')throw e;}const st=await lstat(target),actual=await realpath(target);if(st.isSymbolicLink()||!st.isDirectory()||!inside(root,actual))throw Error('Unsafe execution stages');return mkdtemp(join(actual,prefix));}
async function downloadStage(name,stage){await mkdir(join(stage,'supabase'));await writeFile(join(stage,'supabase/config.toml'),`project_id = "${PROJECT}"\n`,{flag:'wx'});run(CLI,['--workdir',stage,'functions','download',slug[name],'--project-ref',PROJECT,'--use-api'],stage);return join(stage,'supabase/functions',slug[name],'index.ts');}
async function checkLiveSources(expected){for(const name of ['control','backend','companion']){const stage=await stageDir('source-'+name+'-'),entry=await downloadStage(name,stage);if(sha(await readFile(entry))!==expected[name])throw Error('Live '+name+' source changed; no deployment submitted');}}
export function validateMigrationRows(r){
 if(r?.ownership_column!==true||r?.ownership_trigger!==true||r?.image_lease_function!==true||r?.image_lease_permissions!==true||r?.ownership_body_md5!=='982735e20483857e0868233fd65c5af7'||r?.image_lease_body_md5!=='46f205d47eeccd0875faef878180bf6d')throw Error('Ownership/lease migrations are not confirmed');
}
async function checkMigrations(){
 const sql="select exists(select 1 from information_schema.columns where table_schema='public' and table_name='gpu_workers' and column_name='ownership_generation' and data_type='uuid' and is_nullable='NO' and column_default like '%gen_random_uuid%') as ownership_column, exists(select 1 from pg_trigger where tgname='novaflow_worker_ownership_generation' and tgrelid='public.gpu_workers'::regclass and not tgisinternal and tgenabled in ('O','A') and tgtype=23 and tgfoid=to_regprocedure('public.novaflow_worker_ownership_generation()') and tgattr::text=((select attnum::text from pg_attribute where attrelid='public.gpu_workers'::regclass and attname='owner_id')||' '||(select attnum::text from pg_attribute where attrelid='public.gpu_workers'::regclass and attname='ownership_generation'))) as ownership_trigger, exists(select 1 from pg_proc where oid=to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)') and prosecdef and provolatile='s' and proconfig=ARRAY['search_path=pg_catalog, public'] and pg_get_functiondef(oid) like '%ownership_generation%' and pg_get_functiondef(oid) like '%user_sessions%' and pg_get_functiondef(oid) like '%attempt_count%' and pg_get_functiondef(oid) like '%request_sha256%') as image_lease_function, coalesce(has_function_privilege('service_role',to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)'),'EXECUTE') and not has_function_privilege('anon',to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)'),'EXECUTE') and not has_function_privilege('authenticated',to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)'),'EXECUTE') and not exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)') and acl.privilege_type='EXECUTE' and acl.grantee not in (p.proowner,(select oid from pg_roles where rolname='service_role'))),false) as image_lease_permissions, (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.novaflow_worker_ownership_generation()') and not prosecdef and provolatile='v' and proconfig=ARRAY['search_path=pg_catalog, public']) as ownership_body_md5, (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.novaflow_qwen_image_edit_authorize_v1(uuid,uuid,uuid,uuid,integer,text,text,integer)')) as image_lease_body_md5";
 const out=run(CLI,['--workdir',join(work,'control'),'db','query','--linked','--project-ref',PROJECT,'--output','json',sql],join(work,'control'));const start=out.indexOf('{'),end=out.lastIndexOf('}');if(start<0||end<start)throw Error('Migration query not verified');validateMigrationRows(JSON.parse(out.slice(start,end+1))?.rows?.[0]);
}
export function validateImageAcceptance(result){
 const proven=x=>x?.installerSha256==='f6366eac647f0f54e7867f06d75c74d166e7b8ed73f376604ed292a3db589083' && x?.imagePolicySha256==='15df47b615b92c00e99bbd65ba3891556ae0602d6798200a70212efbdd5713e8' && x?.textPolicySha256==='9646f627a48c07066989d6086f2904c7ac469c89e8f60826240df61fc4379b4b' && x?.serviceSha256==='b06649f31d2a7905a6f4d8ac92c709002da9d768752966335457441a6d246f4e' && x?.audioPolicySha256==='b9ead47f4d4ad45385fe5cbf428bb0fbefefa5d1f23aa6ce434963a4b5261296';
 if(!Array.isArray(result)||result.length<7||result.slice(0,3).some(x=>x.ok!==true||!proven(x))||result[2].role_check!==true||['txt2img-v3','h3-text-protocol','audio-music','audio-sfx'].some(name=>!result.some(x=>x.case===name&&x.ok===true&&proven(x)&&(name!=='h3-text-protocol'||x.model_calls>=2))))throw Error('Real 9B acceptance evidence is incomplete or does not match the final installer');
}
async function checkImageAcceptance(){
 const path=join(repo,'work/local9b-image-real-check-20261104/result-combined.json');validateImageAcceptance(JSON.parse(await readFile(path,'utf8')));
 const payload=join(repo,'work/compute-286-scope-audit-20261104'),verifier=join(payload,'verify-f636-payload.py'),manifest=join(payload,'installer-payload-f6366eac-sha256.json'),installer=join(payload,'novaflow-web/worker/dist-compute/Foart-2.0.286-Setup.exe');
 if(sha(await readFile(verifier))!=='ccffa69f0e19a372fab79a3191a90c39f21c2430946c1d48beaf67299912f2ff'||sha(await readFile(manifest))!=='2e1a26d773a84d178c9567a48f6d81e267aa25a5f0f48b880b433a2085dd37df')throw Error('Installer verifier changed');
 run('python',['-B',verifier,manifest,installer,join(payload,'installer-payload-harness-proof')],repo);
}
export function validateControlProtocolProof(proof,deployment,now=Date.now()){
 const policy=proof?.policy;
 if(!deployment||proof?.controlDeployment!==deployment||proof?.controlSourceSha256!==next.control||proof?.loginHttpStatus!==200||
    typeof proof?.loginWorkerId!=='string'||!proof.loginWorkerId||proof.loginWorkerId!==proof.heartbeatWorkerId||
    !policy||['enabled','owner_enabled','sharing_enabled','pending_approval'].some(k=>typeof policy[k]!=='boolean')||
    policy.enabled!==true||policy.owner_enabled!==true||policy.pending_approval!==false||
    !['pool','selected'].includes(policy.sharing_scope)||!Array.isArray(policy.allowed_user_ids)||
    proof?.uiOnline!==true||proof?.uiPolicyConfirmed!==true||!Number.isFinite(Date.parse(proof.checkedAt))||
    !Number.isFinite(Date.parse(proof.heartbeatAt))||now-Date.parse(proof.checkedAt)>300000||now-Date.parse(proof.checkedAt)<-30000||
    now-Date.parse(proof.heartbeatAt)>120000||now-Date.parse(proof.heartbeatAt)<-30000)
   throw Error('Current control deployment lacks fresh real-node login, natural heartbeat and UI policy proof');
}
async function checkControlProtocolProof(deployment){
 const path=join(work,'control-live-protocol-proof.json');validateControlProtocolProof(JSON.parse(await readFile(path,'utf8')),deployment);
}
async function liveHealth(name,version){const r=await fetch(base+'/'+slug[name]+'/health',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)});const body=await r.json();if(!r.ok||body?.releaseVersion!==version||body?.ok!==true||body?.service!==({control:'novaflow-web-control',backend:'NovaFlow Backend',companion:'novaflow-companion'})[name])throw Error('Deployment submitted but health not verified; inspect live state before retry');return {version,deployment:r.headers.get('x-foart-deployment')};}
export async function execute286(component,args){
 const {name,phase}=parse286Execute(component,args);
 if(sha(await readFile(CLI))!==cliSha)throw Error('Pinned Supabase CLI changed');
 const initial=await verify286(['--local-qwen-286','--prepare-only'],{expectedLive:phase.versions});
 if(name!=='control')await checkControlProtocolProof(initial.control.deployment);
 await checkMigrations();
 await checkImageAcceptance();
 const names={control:'control-286-disabled.ts',backend:'backend-286.mjs',companion:'companion-286.mjs',enable:'control-286-enabled.ts'};
 const candidate=name==='site'?join(work,'site-packages/foart-site-2.0.286.zip'):join(work,'release-candidate',names[name]);
 if(await fileHash(candidate)!==phase.output)throw Error('Frozen payload mismatch');
 await checkLiveSources(phase.source);
 // Repeat read-only status checks immediately before any production write.
 await verify286(['--local-qwen-286','--prepare-only'],{expectedLive:phase.versions});
 if(await fileHash(candidate)!==phase.output)throw Error('Frozen payload changed before deployment');
 if(name==='site'){
  const assets=join(work,'release-candidate/web-dist');
  // Fixed command, fixed config, and fixed cwd: the normal dirty web-dist is never used.
  run(process.env.ComSpec||'C:/Windows/System32/cmd.exe',['/d','/s','/c','npx --offline wrangler@4.156.0 deploy --config wrangler.toml --assets ../work/local-qwen-aligned-286-20261104/release-candidate/web-dist'],join(repo,'novaflow-web'));
  const [r,home]=await Promise.all([fetch('https://foart.net/release.json',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)}),fetch('https://foart.net/',{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)})]);const b=await r.json(),html=await home.text();
  if(!r.ok||b.version!=='2.0.286'||!home.ok||!html.includes('window.NOVAFLOW_RELEASE_VERSION = "2.0.286"'))throw Error('Site release or public entry not verified; inspect live state before retry');
  return {component:name,version:b.version,productionSubmitted:true,publicEntryVerified:true,protectedEditorVerified:false,requiresRealUserFlows:true};
 }
 const stage=await stageDir('deploy-'+name+'-'),fn=join(stage,'supabase/functions',slug[phase.target]);await mkdir(fn,{recursive:true});
 await writeFile(join(stage,'supabase/config.toml'),`project_id = "${PROJECT}"\n[functions.${slug[phase.target]}]\nverify_jwt = false\n`,{flag:'wx'});
 await writeFile(join(fn,'index.ts'),await readFile(candidate),{flag:'wx'});
 if(sha(await readFile(join(fn,'index.ts')))!==phase.output)throw Error('Staged artifact changed');
 run(CLI,['--workdir',stage,'functions','deploy',slug[phase.target],'--project-ref',PROJECT,'--use-api'],stage);
 const health=await liveHealth(phase.target,'2.0.286');
 const after=await stageDir('postdeploy-'+name+'-'),entry=await downloadStage(phase.target,after);
 if(sha(await readFile(entry))!==phase.output)throw Error('Health passed but deployed source differs; inspect live state before retry');
 return {component:name,...health,sourceSha256:phase.output,productionSubmitted:true,requiresRealPolicyAndBusinessVerification:true};
}
