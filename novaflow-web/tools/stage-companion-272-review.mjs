// LOCAL STAGING ONLY. This module cannot deploy or accept a drain attestation.
// Both candidates remain blocked until independently verified production state,
// a non-disruptive drain, and a separately authorized safe deployment channel.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const REPO=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const WEB=join(REPO,'novaflow-web');
const sha=x=>createHash('sha256').update(x).digest('hex');
const modules=Object.freeze({
 verifier:['verify-companion-272.mjs','460af3d16697c3750fac58ac38295b0d9b709ad569af8dbbd8d81dcf98a8d854'],
 staging:['frozen-edge-deploy.mjs','74f9c270faf0415fe5203f9129f7476237f872aa92ab65364ae0eb29c2a67fc5']
});
const candidates=Object.freeze({
 '272':Object.freeze({id:'companion-272-review',service:'companion',version:'2.0.272',path:'work/qa-policy-revision-compat-20261103/pin265-version272.mjs',sha:'b0b9e174167f83aaea6986aaa491e17d5d92d5df1581eeec849843c95dfc5c09'}),
 '273':Object.freeze({id:'companion-273-rollback-review',service:'companion',version:'2.0.273',path:'work/qa-policy-rollback-273-20261103/companion-2.0.273-rollback-REVIEW-NOT-DEPLOY.mjs',sha:'93e3acc353f6a1b87f9f1efc29bc9ba73709109b301755b20035827ab911c445'})
});

async function pinnedImport([name,expected]) {
 const path=join(WEB,'tools',name);
 if(sha(await readFile(path))!==expected)throw Error('Pinned staging dependency mismatch: '+name);
 return import(pathToFileURL(path).href);
}
export async function stageCompanionReview(version) {
 const candidate=candidates[version];if(!candidate)throw Error('Unsupported review candidate');
 const verifier=await pinnedImport(modules.verifier),stager=await pinnedImport(modules.staging);
 const proof=version==='272'?await verifier.verifyCompanion272Offline():await verifier.verifyCompanion273Offline();
 if(proof.mode!=='offline-verify-only'||proof.project!=='cjakoblszlmbmotchzva'||proof.service!=='novaflow-companion'||
    proof.candidateSha256!==candidate.sha||proof.productionConnected!==false||proof.productionDeployed!==false||proof.deploymentAllowed!==false)
   throw Error('Candidate verification did not remain fail-closed');
 const staged=await stager.stageFrozen({root:REPO,id:candidate.id,selected:candidate});
 const expected='project_id = "cjakoblszlmbmotchzva"\n[functions.novaflow-companion]\nverify_jwt = false\n';
 if(staged.name!=='novaflow-companion'||staged.sha256!==candidate.sha||staged.config!==expected||
    sha(await readFile(staged.dest))!==candidate.sha)throw Error('Staged companion differs from verified candidate');
 await writeFile(join(staged.stage,'LOCAL-REVIEW-NOT-DEPLOY.txt'),
  'LOCAL REVIEW ONLY — NO PRODUCTION DEPLOYMENT AUTHORIZATION OR DRAIN PROOF.\n'+
  'This staging directory is not evidence that active requests are drained.\n'+
  'Use only after the project-specific production guard and authorized deployment channel exist.\n', {flag:'wx'});
 return {mode:'offline-stage-only',project:'cjakoblszlmbmotchzva',service:staged.name,version:candidate.version,
   candidateSha256:candidate.sha,stage:staged.stage,entry:staged.dest,productionConnected:false,
   productionDeployed:false,deploymentAllowed:false,blockers:proof.blockers};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const a=process.argv.slice(2);
 if(a.length!==2||!a.includes('--stage-only')||a.filter(x=>x==='--frozen-272'||x==='--frozen-273').length!==1||
   a.some(x=>!['--frozen-272','--frozen-273','--stage-only'].includes(x)))throw Error('Only a fixed local staging action is permitted');
 console.log(JSON.stringify(await stageCompanionReview(a.includes('--frozen-272')?'272':'273')));
}
