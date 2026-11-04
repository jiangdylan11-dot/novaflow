// REVIEW DRAFT. Apply only after approval and an independent security review.
// Explicit frozen artifacts prevent an implicit rebuild from changing pricing.
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const PROJECT='cjakoblszlmbmotchzva';
const CLI_SHA='f51f287379f72f8d3cdf8469836fd1474141e57f9935a6fb8edd0f60bdb4995e';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const catalog=Object.freeze({
 'backend-maint-263': {service:'backend',version:'2.0.263',maintenance:'263',path:'work/maintenance-263-20261102/backend-263-maintenance-250-frozen-review.mjs',sha:'a877169be20299c5e4ecca55ee5c47d4de67c30ce4656f99b30159fd0fc3122b'},
 'backend-final-263': {service:'backend',version:'2.0.263',maintenance:null,path:'work/maintenance-263-20261102/backend-263-formal-250-frozen-review.mjs',sha:'784c9bb859d3aaac688a1108ba211fd08092b191e6b17b3e70a8964df50e9ea6'},
 'backend-rollback-preactivation-250': {service:'backend',version:'2.0.250',maintenance:null,preactivationOnly:true,path:'work/qwen-business-242-web-minimal/novaflow-web/.artifacts/backend-2.0.250/supabase/functions/novaflow-backend/index.ts',sha:'904a85b80c60ee536f2929dd50d1e4e019a1be9eaafeb2e4edf096183083f8a5'},
 'companion-maint-from253-263': {service:'companion',version:'2.0.263',maintenance:'263',path:'work/maintenance-263-20261102/companion-253-as263-cutover-diagnostics-review.mjs',sha:'169acbdcd9878c12483a0c49ad9bdbddb0a9e900aa5190f3a24b7a00985f59b7'},
 'companion-maint-263': {service:'companion',version:'2.0.263',maintenance:'263',path:'work/maintenance-263-20261102/companion-263-credit-cutover-review.mjs',sha:'498e27e5a775347feca7e6181ad6a03f89ef7883db0ec9a01abf89880af3a35d'},
 'companion-rollback-preactivation-253': {service:'companion',version:'2.0.253',maintenance:null,preactivationOnly:true,path:'work/maintenance-263-20261102/baseline-253.mjs',sha:'0a3dba59785c7d4b5bec2451c5697183ccefb19eb120c1eacf8711ac49308d1e'},
 'companion-final-263': {service:'companion',version:'2.0.263',maintenance:null,path:'work/qwen-release-263-20261102/edge-bundles/companion-2.0.263.mjs',sha:'074fcb94e6e9e573a360d199ff1eefba9cc4a1f79b18abff4fc69d427ecb9bcc'},
 'companion-maint-267': {service:'companion',version:'2.0.267-maint.1',maintenance:'267-maint.1',path:'work/qa-267-maintenance-20261102/companion-2.0.267-maint.1.mjs',sha:'c8284630134b6dd3bd26bef0ffd992092bb6a73db1ab070f58ba18fffd31d31f'},
 'companion-final-267': {service:'companion',version:'2.0.267',maintenance:null,path:'work/qa-companion-267-isolated-v2-20261102/novaflow-web/companion-2.0.267-review.mjs',sha:'6e22911a410dd42dcc98df686b95a1957f974e8c5825e3f90796e2e228f6dbd8'},
 'companion-final-267-audio-disabled': {service:'companion',version:'2.0.267',maintenance:null,path:'work/qa-companion-267-audio-disabled-20261103/companion-2.0.267-audio-disabled-FINAL-REVIEW.mjs',sha:'e6be0e20bde5b7d70ea1c088a97f2f51dcd3c782a395853a90053045ac805545'},
 'companion-final-265-art-vision-diagnostic': {service:'companion',version:'2.0.265',maintenance:null,path:'work/xiaotao-265-final-companion-review-20261102/companion-2.0.265-art-vision-diagnostic.mjs',sha:'16713b779ba18d52bbb14c52a4d2aa4aa410c286ec3be4cf30f66db976b48a8f'}
});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(base,target)=>{const r=relative(base,target);return !!r&&r!=='..'&&!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(r)};
function uniqueArg(args,key){const x=args.filter(v=>v.startsWith('--'+key+'='));if(x.length!==1)throw Error('Exactly one --'+key+' is required');return x[0].slice(key.length+3)}
export function parseFrozenArgs(service,args){
 const id=uniqueArg(args,'frozen'), expected=uniqueArg(args,'sha256').toLowerCase(), cli=uniqueArg(args,'cli'), cliSha=uniqueArg(args,'cli-sha256').toLowerCase();
 const selected=catalog[id];
 if(!selected||selected.service!==service||expected!==selected.sha)throw Error('Frozen artifact is not allowlisted for service and SHA');
 if(selected.preactivationOnly){
  if(args.length!==5||uniqueArg(args,'preactivation-rollback')!=='verified')throw Error('Rollback requires explicit preactivation verification');
 }else if(args.length!==4)throw Error('Frozen mode requires --frozen, --sha256, --cli and --cli-sha256 only');
 if(!isAbsolute(cli)||cliSha!==CLI_SHA)throw Error('CLI path or approved CLI SHA mismatch');
 return {id,selected,cli,cliSha};
}
export async function stageFrozen({root=ROOT,id,selected}){
 const repo=await realpath(root),work=await realpath(join(repo,'work'));
 if(!inside(repo,work))throw Error('Work directory escaped workspace');
 const candidate=resolve(repo,selected.path),entry=await lstat(candidate),artifact=await realpath(candidate);
 if(!entry.isFile()||entry.isSymbolicLink()||!inside(work,artifact))throw Error('Artifact must be a regular file inside work');
 const bytes=await readFile(artifact);
 if(sha(bytes)!==selected.sha)throw Error('Frozen artifact SHA mismatch');
 const name=selected.service==='backend'?'novaflow-backend':'novaflow-companion';
 const stagingParent=join(work,'frozen-edge-deploy-stages');await mkdir(stagingParent,{recursive:true});
 const st=await lstat(stagingParent),actualParent=await realpath(stagingParent);
 if(st.isSymbolicLink()||!st.isDirectory()||!inside(work,actualParent))throw Error('Unsafe staging parent');
 const stage=await mkdtemp(join(actualParent,id+'-'));
 const fnDir=join(stage,'supabase','functions',name);await mkdir(fnDir,{recursive:true});
 const dest=join(fnDir,'index.ts');await writeFile(dest,bytes,{flag:'wx'});
 const config=`project_id = "${PROJECT}"\n[functions.${name}]\nverify_jwt = false\n`;
 await writeFile(join(stage,'supabase','config.toml'),config,{flag:'wx'});
 if(sha(await readFile(dest))!==selected.sha||await readFile(join(stage,'supabase','config.toml'),'utf8')!==config)throw Error('Staged bytes mismatch');
 return {stage,dest,name,config,sha256:selected.sha};
}
export function verifyHealth(selected,status,body,deployment){
 const service=selected.service==='backend'?'NovaFlow Backend':'novaflow-companion';
 if(status!==200||body?.ok!==true||body.service!==service||body.releaseVersion!==selected.version)throw Error('Live service or version mismatch');
 if(selected.maintenance!==null&&body.creditCutoverMaintenance!==selected.maintenance)throw Error('Maintenance marker missing or incorrect');
 if(selected.maintenance===null&&body.creditCutoverMaintenance!=null)throw Error('Maintenance still active');
 return {status,service,version:selected.version,maintenance:selected.maintenance,deployment:deployment||null,businessCheckRequired:true};
}
export async function deployFrozen(service,args){
 const choice=parseFrozenArgs(service,args),cliPath=await realpath(choice.cli),cliBytes=await readFile(cliPath);
 if(sha(cliBytes)!==choice.cliSha)throw Error('CLI binary SHA mismatch');
 const staged=await stageFrozen(choice);
 // Recheck immediately before invocation. Fixed arguments and cwd avoid shell injection.
 if(sha(await readFile(staged.dest))!==choice.selected.sha||await readFile(join(staged.stage,'supabase','config.toml'),'utf8')!==staged.config)throw Error('Staged artifact or config changed before deployment');
 // Never echo CLI output: errors can contain sensitive configuration. The
 // caller must inspect actual remote state after an uncertain outcome.
 const result=spawnSync(cliPath,['--workdir','.','functions','deploy',staged.name,'--project-ref',PROJECT,'--use-api'],{cwd:staged.stage,stdio:'ignore',windowsHide:true,timeout:45000});
 if(result.error||result.status!==0)throw Error('Deployment outcome is uncertain; inspect actual state before any retry');
 let response;try{response=await fetch(`https://${PROJECT}.supabase.co/functions/v1/${staged.name}/health`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});}catch{throw Error('Deployment was submitted but live state is unknown; inspect before any retry')}
 const body=await response.json();const proof=verifyHealth(choice.selected,response.status,body,response.headers.get('x-foart-deployment'));
 await writeFile(join(staged.stage,'live-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(proof));
}
