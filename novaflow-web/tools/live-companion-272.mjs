// SINGLE-SERVICE RELEASE PROPOSAL. No local drain assertion is accepted.
// Verify-only reads current metadata/source through the approved CLI; execute
// repeats those checks immediately before one narrowly scoped deploy.
import {createHash} from 'node:crypto';
import {lstat,mkdir,mkdtemp,readdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const WEB=join(ROOT,'novaflow-web'),WORK=join(ROOT,'work');
const PROJECT='cjakoblszlmbmotchzva',SLUG='novaflow-companion';
const CLI='C:\\Users\\jiang\\AppData\\Local\\npm-cache\\_npx\\91eb58246759989d\\node_modules\\@supabase\\cli-windows-x64\\bin\\supabase.exe';
const CLI_HASH='f51f287379f72f8d3cdf8469836fd1474141e57f9935a6fb8edd0f60bdb4995e';
const OLD_HASH='16713b779ba18d52bbb14c52a4d2aa4aa410c286ec3be4cf30f66db976b48a8f';
const NEW_HASH='c4cf6e33c22257ca20e449135f2942c80f5594b5c589a37ff89f69c6c3f7e35b';
const ROLLBACK_HASH='3612fe82202c5098f47263c81fae610e4e42bae3c224444c9ae97b1f71f4a9e6';
const PG_RESULT_HASH='a693b9ca0805621911544d8c259b3457e896a8261af4ccfc91f4b340bf7a6dbb';
const PG_TEST_HASH='1b6f1423c1437e46e76b446b2e399995c78ac03c2829819b71f26d2079302447';
const BUNDLE_TEST_HASH='d59c5d21364fe211fc30aa3aff086b98d26f92ea95026e353bfd8aca30b28c9d';
const STAGES=join(WORK,'frozen-edge-deploy-stages');
const STAGE=join(STAGES,'companion-live-272-formal-20261103');
const CANDIDATE=join(WORK,'qa-live265-video-272-20261103','candidate-NOT-DEPLOY.mjs');
const ROLLBACK=join(WORK,'qa-live265-video-272-20261103','companion-273-rollback-NOT-DEPLOY.mjs');
const CONFIG=`project_id = "${PROJECT}"\n[functions.${SLUG}]\nverify_jwt = false\n`;
const MANIFEST=JSON.stringify({project:PROJECT,service:SLUG,version:'2.0.272',source265Sha256:OLD_HASH,candidateSha256:NEW_HASH,rollbackSha256:ROLLBACK_HASH,rollbackPgResultSha256:PG_RESULT_HASH,bundleTestSha256:BUNDLE_TEST_HASH,verifyJwt:false,inFlightStatus:'unknown'},null,2)+'\n';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const contained=(base,p)=>{const r=relative(base,p);return !!r&&r!=='..'&&!r.startsWith('../')&&!r.startsWith('..\\')&&!isAbsolute(r)};
async function fixedFile(path,expected) {
  const st=await lstat(path),actual=await realpath(path);
  if(!st.isFile()||st.isSymbolicLink()||actual!==path)throw Error('Unsafe fixed file');
  const bytes=await readFile(path);if(hash(bytes)!==expected)throw Error('Fixed file hash changed');return bytes;
}
async function fixedStage(path,expected) {
  const st=await lstat(path),actual=await realpath(path);
  if(!st.isDirectory()||st.isSymbolicLink()||actual!==path||!contained(WORK,actual))throw Error('Unsafe fixed staging path');
  const entry=join(path,'supabase','functions',SLUG,'index.ts');
  const bytes=await fixedFile(entry,expected);
  if(/(?:from\s*|import\s*\()\s*['"]\.\.?\//.test(bytes.toString('utf8')))throw Error('Non-self-contained function');
  await fixedFile(join(path,'supabase','config.toml'),hash(Buffer.from(CONFIG)));
  await fixedFile(join(path,'release-manifest.json'),hash(Buffer.from(MANIFEST)));
  const names=(await readdir(path)).sort();
  if(JSON.stringify(names)!==JSON.stringify(['release-manifest.json','supabase']))throw Error('Unexpected formal staging content');
  if(JSON.stringify((await readdir(join(path,'supabase'))).sort())!==JSON.stringify(['config.toml','functions']))throw Error('Unexpected Supabase staging content');
  if(JSON.stringify(await readdir(join(path,'supabase','functions')))!==JSON.stringify([SLUG]))throw Error('Unexpected staged function');
  if(JSON.stringify(await readdir(join(path,'supabase','functions',SLUG)))!==JSON.stringify(['index.ts']))throw Error('Unexpected staged function content');
  return entry;
}
async function formalStage(candidate) {
  const st=await lstat(STAGES),actual=await realpath(STAGES);
  if(!st.isDirectory()||st.isSymbolicLink()||actual!==STAGES||!contained(WORK,actual))throw Error('Unsafe staging parent');
  let created=false;try{await mkdir(STAGE);created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  if(created){
    await mkdir(join(STAGE,'supabase'));await mkdir(join(STAGE,'supabase','functions'));await mkdir(join(STAGE,'supabase','functions',SLUG));
    await writeFile(join(STAGE,'supabase','functions',SLUG,'index.ts'),candidate,{flag:'wx'});
    await writeFile(join(STAGE,'supabase','config.toml'),CONFIG,{flag:'wx'});
    await writeFile(join(STAGE,'release-manifest.json'),MANIFEST,{flag:'wx'});
  }
  return fixedStage(STAGE,NEW_HASH);
}
async function require272Versions() {
  for(const n of ['packages/shared/src/release.mjs','supabase/functions/novaflow-web/release.mjs','supabase/functions/_art-shared/release.mjs']){
    const s=await readFile(join(WEB,...n.split('/')),'utf8');
    if((s.match(/export const RELEASE_VERSION = "2\.0\.272";/g)||[]).length!==1)throw Error('Unified release version is not 272: '+n);
  }
  for(const n of ['package.json','package-lock.json','web/package.json','worker/package.json','worker/package-lock.json']){
    const o=JSON.parse(await readFile(join(WEB,...n.split('/')),'utf8'));if(o.version!=='2.0.272')throw Error('Package version is not 272: '+n);
    if(n.endsWith('package-lock.json'))for(const k of n==='package-lock.json'?['','web','worker']:[''])if(o.packages?.[k]?.version!=='2.0.272')throw Error('Lock version is not 272: '+n);
  }
}
function runCli(args,cwd) {
  const result=spawnSync(CLI,args,{cwd,encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'1'}});
  if(result.error||result.status!==0)throw Error('Read-only Management API check failed; inspect permissions or connectivity without retrying a deploy');
  return result.stdout;
}
function listCurrent(cwd) {
  let data;try { data=JSON.parse(runCli(['--workdir',cwd,'functions','list','--project-ref',PROJECT,'--output','json'],cwd)); }
  catch { throw Error('Read-only function metadata could not be verified'); }
  const rows=Array.isArray(data)?data:Array.isArray(data?.functions)?data.functions:[];
  const found=rows.filter(x=>x?.slug===SLUG);
  if(found.length!==1||found[0].status!=='ACTIVE'||found[0].version!==101||found[0].verify_jwt!==false)throw Error('Live function version or JWT config changed; do not deploy');
}
async function health(version,expectedDeployment) {
  const response=await fetch(`https://${PROJECT}.supabase.co/functions/v1/${SLUG}/health`,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
  const body=await response.json();const deployment=response.headers.get('x-foart-deployment');
  if(response.status!==200||body?.ok!==true||body?.service!==SLUG||body?.releaseVersion!==version||body?.creditCutoverMaintenance!=null||
     (expectedDeployment&&deployment!==expectedDeployment))throw Error('Live health or deployment identity changed');
  return {status:response.status,version:body.releaseVersion,deployment};
}
export async function preflight(){
  const repo=await realpath(ROOT),work=await realpath(WORK);if(repo!==ROOT||work!==WORK||!contained(repo,work))throw Error('Unsafe workspace');
  await fixedFile(CLI,CLI_HASH);await require272Versions();const candidate=await fixedFile(CANDIDATE,NEW_HASH);await fixedFile(ROLLBACK,ROLLBACK_HASH);
  const pg=JSON.parse((await fixedFile(join(WORK,'qa-policy-pg-vertical-20261103','RESULT-live272-to-live273-20261103.json'),PG_RESULT_HASH)).toString('utf8'));
  await fixedFile(join(WORK,'qa-policy-pg-vertical-20261103','vertical-live-272-to-rollback-273.mjs'),PG_TEST_HASH);
  await fixedFile(join(WORK,'qa-live265-video-272-20261103','bundle-video-handler.test.mjs'),BUNDLE_TEST_HASH);
  await fixedFile(join(WORK,'qa-live265-video-272-20261103','bundle-test-loader.mjs'),'0504b41d976eefbf67642e94d66b10b5d436a19eaf62c5dc60719d4bf5bf3324');
  await fixedFile(join(WORK,'qa-live265-video-272-20261103','bundle-test-supabase.mjs'),'4cccb434569f2bb66c4eda84a24a3f07b1682604c1bb594562b49c0bfd021704');
  if(pg.production!==false||pg.syntheticProvider!==true||pg.syntheticAuthentication!==true||pg.exitCode!==0||pg.postgresStopped!==true||
     pg.candidate272Sha256!==NEW_HASH||pg.rollback273Sha256!==ROLLBACK_HASH||pg.testScriptSha256!==PG_TEST_HASH||
     pg.syntheticProviderCalls!==1||pg.settledLedgerRows!==1||pg.checks?.length!==1)throw Error('Rollback isolation evidence mismatch');
  if(/(?:from\s*|import\s*\()\s*['"]\.\.?\//.test(candidate.toString('utf8')))throw Error('Non-self-contained candidate');
  const before=await health('2.0.265','cjakoblszlmbmotchzva_4b2edea7-d2ca-404f-9aa0-7394b3536550_101');
  const dir=await mkdtemp(join(WORK,'companion-272-live-readonly-'));await mkdir(join(dir,'supabase'));await writeFile(join(dir,'supabase','config.toml'),CONFIG,{flag:'wx'});
  listCurrent(dir);
  runCli(['--workdir',dir,'functions','download',SLUG,'--project-ref',PROJECT,'--use-api'],dir);
  const observed=join(dir,'supabase','functions',SLUG,'index.ts');await fixedFile(observed,OLD_HASH);
  listCurrent(dir);await health('2.0.265',before.deployment);
  await formalStage(candidate);await fixedFile(ROLLBACK,ROLLBACK_HASH);
  return {project:PROJECT,service:SLUG,liveVersion:'2.0.265',liveFunctionVersion:101,liveSourceSha256:OLD_HASH,candidateSha256:NEW_HASH,rollbackSha256:ROLLBACK_HASH,rollbackPgResultSha256:PG_RESULT_HASH,bundleTestSha256:BUNDLE_TEST_HASH,verifyJwt:false,readonlyDir:dir,productionModified:false,inFlightStatus:'unknown'};
}
export async function runLive272(mode) {
  if(mode!=='--verify-only'&&mode!=='--execute')throw Error('Use exactly --verify-only or --execute');
  const proof=await preflight();console.log(JSON.stringify({...proof,mode}));
  if(mode==='--verify-only')return;
  // No local marker is accepted as a drain proof. This action can affect
  // in-flight requests; the caller must obtain action-time authorization.
  const r=spawnSync(CLI,['--workdir',STAGE,'functions','deploy',SLUG,'--project-ref',PROJECT,'--use-api'],{cwd:STAGE,stdio:'ignore',windowsHide:true,timeout:90000,env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'1'}});
  if(r.error||r.status!==0)throw Error('Deployment result unknown; inspect live state before any retry');
  const live=await health('2.0.272',null);console.log(JSON.stringify({productionDeployed:true,health:live,businessCheckRequired:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))throw Error('Invoke only through the audited project deploy entry');
