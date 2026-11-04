// OFFLINE REVIEW ONLY. This verifier never starts a CLI, deploys, calls a
// network endpoint, or modifies project files. A production cutover remains
// blocked until an authorized channel can independently verify source identity,
// in-flight operations, settlement and deployment-time request handling.
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {dirname,join,relative,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const PROJECT='cjakoblszlmbmotchzva';
const FROZEN={
  saved265:['work/xiaotao-265-final-companion-review-20261102/novaflow-web/companion-2.0.265-no-idle.mjs','96ed83965dba1c9b306c4b701e7044bf13490fba7961ff01dd3e87c74bdd66b4'],
  fenced265:['work/qa-policy-revision-compat-20261103/baseline.mjs','9bb7234089745022c51ce9fd480a6006f8d075c7c985e06f1c17dd07b60f33a1'],
  candidate272:['work/qa-policy-revision-compat-20261103/pin265-version272.mjs','b0b9e174167f83aaea6986aaa491e17d5d92d5df1581eeec849843c95dfc5c09'],
  pgResult:['work/qa-policy-pg-vertical-20261103/RESULT-20261103.json','4b126d492950d29d808f31eb36ae06544e37b0dce71f8b0886413a68d6e22267'],
  pgScript:['work/qa-policy-pg-vertical-20261103/vertical.mjs','46119666201dbbb29be08115bf5080a85b182892ae4413aeb00b82a4fffda70d'],
  originalPgResult:['work/qa-policy-pg-vertical-20261103/RESULT-original-265-v272-20261103.json','3727dae96b3410cc3c494c5d8635bc7958d1ba5f5d696b27346a640c98f28e09'],
  originalPgScript:['work/qa-policy-pg-vertical-20261103/vertical-original-265-v272.mjs','d7e14cf9e45d1774e8a58ddac42d9866c1b147f55a47fdce7b54d1199a19e90b'],
  rollback273:['work/qa-policy-rollback-273-20261103/companion-2.0.273-rollback-REVIEW-NOT-DEPLOY.mjs','93e3acc353f6a1b87f9f1efc29bc9ba73709109b301755b20035827ab911c445'],
  rollbackManifest:['work/qa-policy-rollback-273-20261103/rollback-manifest.json','6d1ec45a5a8b43b597d8a241592113a22904d4c6cdc2f90ba494cf707352a6df'],
  rollbackPgResult:['work/qa-policy-pg-vertical-20261103/RESULT-272-to-rollback-273-20261103.json','86d0ff02f866fc8db7dee803d808f2baf85367771df96e8be0d3352fed593a29'],
  rollbackPgScript:['work/qa-policy-pg-vertical-20261103/vertical-272-to-rollback-273.mjs','f28efd31bf298e3ec4e4fcb8be42b8ad2358cefb9e615ae75e652a3b0e6e229f']
};
const sha=b=>createHash('sha256').update(b).digest('hex');
function inside(base,target){const p=relative(base,target);return p!==''&&p!=='..'&&!p.startsWith('../')&&!p.startsWith('..\\')&&!isAbsolute(p);}
async function frozenFile(root,work,[rel,expected]){
  const path=resolve(root,rel),info=await lstat(path),actual=await realpath(path);
  if(!info.isFile()||info.isSymbolicLink()||actual!==path||!inside(work,actual))throw Error('Unsafe frozen input: '+rel);
  const bytes=await readFile(actual);if(sha(bytes)!==expected)throw Error('Frozen input hash mismatch: '+rel);
  return bytes;
}
function once(s,before,after){if(s.split(before).length!==2)throw Error('Expected unique compatibility token');return s.replace(before,after);}
export function verifyFenced265(saved,fenced){
  let expected=once(saved,'    let pair;\n    try {\n      pair = JSON.parse(text3);',
    '    const fence = text3.trim().match(/^```(?:json)?[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```$/i);\n    const content = fence ? fence[1] : text3;\n    let pair;\n    try {\n      pair = JSON.parse(content);');
  expected=once(expected,'return workflow.validateAndRestore({ text: text3, context: trusted.validation.context, current: trusted.validation.current });',
    'return workflow.validateAndRestore({ text: content, context: trusted.validation.context, current: trusted.validation.current });');
  if(fenced!==expected)throw Error('265 candidate differs beyond fenced JSON handling');
}
export function verifyCandidatePair(base,candidate){
  let expected=once(base,'var RELEASE_VERSION = "2.0.265";','var RELEASE_VERSION = "2.0.272";');
  expected=once(expected,'async function companionPricingPolicy(provider = {}, { revision = RELEASE_VERSION } = {}) {','async function companionPricingPolicy(provider = {}, { revision = "2.0.265" } = {}) {');
  if(candidate!==expected)throw Error('Candidate differs beyond release and frozen pricing revision');
  if(/(?:from\s*|import\s*\()\s*['"]\.\.?\//.test(candidate))throw Error('Candidate contains a relative import');
}
export function verifyRollbackPair(saved,candidate){
  let expected=once(saved,'var RELEASE_VERSION = "2.0.265";','var RELEASE_VERSION = "2.0.273";');
  expected=once(expected,'async function companionPricingPolicy(provider = {}, { revision = RELEASE_VERSION } = {}) {','async function companionPricingPolicy(provider = {}, { revision = "2.0.265" } = {}) {');
  if(candidate!==expected)throw Error('273 rollback differs beyond release and frozen pricing revision');
  if(/(?:from\s*|import\s*\()\s*['"]\.\.?\//.test(candidate))throw Error('Rollback candidate contains a relative import');
}
export function verifyPgEvidence(result){
  if(result?.production!==false||result?.databaseStopped!==true||result?.localPortClosed!==11026||result?.checksPassed!==2||
     result?.providerCalls!==2||result?.settledLedgerRows!==2||result?.initialBalance!==100||result?.endingBalance!==99.999996||
     result?.bundle265Sha256!==FROZEN.fenced265[1]||result?.bundle272Sha256!==FROZEN.candidate272[1]||result?.scriptSha256!==FROZEN.pgScript[1]||
     !Array.isArray(result?.limits)||!result.limits.includes('formal production source and configuration identity were not verified'))
    throw Error('Compatibility evidence is absent or does not match the locked candidate');
}
export function verifyOriginalPgEvidence(result){
  if(result?.kind!=='captured-isolated-test-result'||result?.production!==false||result?.syntheticProvider!==true||result?.syntheticAuthentication!==true||
    result?.exitCode!==0||result?.postgresStopped!==true||result?.portClosed!==10976||result?.checks?.length!==3||result?.syntheticProviderCalls!==3||
    result?.settledLedgerRows!==3||result?.startingBalance!==100||result?.endingBalance!==99.999994||result?.baseline265Sha256!==FROZEN.saved265[1]||
    result?.candidate272Sha256!==FROZEN.candidate272[1]||result?.testScriptSha256!==FROZEN.originalPgScript[1])
    throw Error('Original 265 compatibility evidence does not match the locked candidate');
}
export function verifyRollbackPgEvidence(result){
  if(result?.kind!=='captured-isolated-test-result'||result?.production!==false||result?.syntheticProvider!==true||result?.syntheticAuthentication!==true||
    result?.exitCode!==0||result?.postgresStopped!==true||result?.portClosed!==2602||result?.checks?.length!==1||result?.syntheticProviderCalls!==1||
    result?.settledLedgerRows!==1||result?.startingBalance!==100||result?.endingBalance!==99.999998||result?.candidate272Sha256!==FROZEN.candidate272[1]||
    result?.rollback273Sha256!==FROZEN.rollback273[1]||result?.testScriptSha256!==FROZEN.rollbackPgScript[1])
    throw Error('273 rollback compatibility evidence does not match the locked candidate');
}
async function loadInputs(root){
  root=await realpath(resolve(root));const workPath=join(root,'work'),st=await lstat(workPath),work=await realpath(workPath);
  if(!st.isDirectory()||st.isSymbolicLink()||work!==workPath||!inside(root,work))throw Error('Unsafe work directory');
  const inputs={};for(const [name,ref] of Object.entries(FROZEN))inputs[name]=await frozenFile(root,work,ref);
  return {root,inputs};
}
async function versionState(root){
  const web=join(root,'novaflow-web'); const moduleNames=['packages/shared/src/release.mjs','supabase/functions/novaflow-web/release.mjs','supabase/functions/_art-shared/release.mjs'];
  const packageNames=['package.json','package-lock.json','web/package.json','worker/package.json','worker/package-lock.json'];
  const state={};for(const name of moduleNames){const text=await readFile(join(web,name),'utf8');const m=text.match(/export const RELEASE_VERSION = "(\d+\.\d+\.\d+)";/g)||[];state[name]=m.length===1?m[0].match(/"([^"]+)"/)[1]:null;}
  for(const name of packageNames){const obj=JSON.parse(await readFile(join(web,name),'utf8'));state[name]=obj.version??null;
    if(name.endsWith('package-lock.json')){const keys=name==='package-lock.json'?['','web','worker']:[''];for(const key of keys)state[name+'#'+key]=obj.packages?.[key]?.version??null;}}
  return state;
}
export async function verifyCompanion272Offline(root=ROOT){
  const loaded=await loadInputs(root);root=loaded.root;const inputs=loaded.inputs;
  verifyFenced265(inputs.saved265.toString('utf8'),inputs.fenced265.toString('utf8'));
  verifyCandidatePair(inputs.fenced265.toString('utf8'),inputs.candidate272.toString('utf8'));
  const pg=JSON.parse(inputs.pgResult.toString('utf8'));verifyPgEvidence(pg);
  const originalPg=JSON.parse(inputs.originalPgResult.toString('utf8'));verifyOriginalPgEvidence(originalPg);
  const versions=await versionState(root);const versions272=Object.values(versions).every(v=>v==='2.0.272');
  return {mode:'offline-verify-only',project:PROJECT,service:'novaflow-companion',healthVersion:'2.0.272',pricingRevision:'2.0.265',
    candidateSha256:FROZEN.candidate272[1],baselineSaved265Sha256:FROZEN.saved265[1],isolatedFenced265PgChecks:pg.checksPassed,isolatedOriginal265PgChecks:originalPg.checks.length,
    versions,versions272,productionConnected:false,productionDeployed:false,deploymentAllowed:false,
    blockers:[...(!versions272?['Repository release versions must all be 2.0.272']:[]),'Production 265 source and configuration identity not independently verified','No authorized read-only production channel has verified in-flight operations and settlement','Deployment-time handling of old in-flight requests is unverified','The existing Supabase CLI has unresolved temporary-role side effects']};
}
export async function verifyCompanion273Offline(root=ROOT){
  const loaded=await loadInputs(root);root=loaded.root;const inputs=loaded.inputs;
  verifyFenced265(inputs.saved265.toString('utf8'),inputs.fenced265.toString('utf8'));
  verifyCandidatePair(inputs.fenced265.toString('utf8'),inputs.candidate272.toString('utf8'));
  verifyRollbackPair(inputs.saved265.toString('utf8'),inputs.rollback273.toString('utf8'));
  const manifest=JSON.parse(inputs.rollbackManifest.toString('utf8'));
  if(manifest?.reviewOnly!==true||manifest?.notDeployable!==true||manifest?.productionChanged!==false||manifest?.version!=='2.0.273'||
    manifest?.baseSha256!==FROZEN.saved265[1]||manifest?.candidateSha256!==FROZEN.rollback273[1]||manifest?.pricingRevision!=='2.0.265')throw Error('Rollback manifest mismatch');
  const pg=JSON.parse(inputs.rollbackPgResult.toString('utf8'));verifyRollbackPgEvidence(pg);
  const versions=await versionState(root);const versions273=Object.values(versions).every(v=>v==='2.0.273');
  return {mode:'offline-verify-only',project:PROJECT,service:'novaflow-companion',rollbackVersion:'2.0.273',pricingRevision:'2.0.265',
    candidateSha256:FROZEN.rollback273[1],source265Sha256:FROZEN.saved265[1],isolated272To273PgChecks:pg.checks.length,
    versions,versions273,productionConnected:false,productionDeployed:false,deploymentAllowed:false,
    blockers:[...(!versions273?['Repository release versions must all be 2.0.273 before any rollback release']:[]),'Production 272 state and prior 265 source identity must be independently verified','No authorized read-only production channel has verified in-flight operations and settlement','Deployment-time handling of old in-flight requests is unverified','The existing Supabase CLI has unresolved temporary-role side effects'],
    limits:['Rollback restores original 265 strict video parser and may reject fenced JSON again','Isolated PostgreSQL tests use synthetic provider and authentication; they do not prove production safety']};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--verify-only')console.log(JSON.stringify(await verifyCompanion272Offline()));
  else if(args.length===2&&args.includes('--frozen-273')&&args.includes('--verify-only'))console.log(JSON.stringify(await verifyCompanion273Offline()));
  else throw Error('Offline verify-only; production deployment is blocked');
}
