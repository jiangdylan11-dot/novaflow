// Build, point at a control plane, verify, and package - in one command.
//
// These four steps have an order, and getting it wrong produces a site that
// looks fine and is broken: the build always writes the LOCAL control plane
// into index.html, so anything that rebuilds after the repoint silently undoes
// it. Running the test suite rebuilds. I did exactly that, zipped the result,
// and shipped a public site that tried to reach http://127.0.0.1:4890 - which
// fails as "暂无可用算力" with a perfectly healthy pool one HTTP call away.
//
// So the order is not something to remember. It is this file. And the last
// step refuses to produce a zip whose index.html still points at localhost,
// because that zip has no legitimate use on a public host.
//
//   node tools/package-site.mjs --control-url=https://<ref>.supabase.co/functions/v1/novaflow-web
//   node tools/package-site.mjs --control-url=... --out=C:/path/site.zip

import { readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readConfig, writeConfig } from './set-web-config.mjs';
import { prepareDeploymentArtReview } from './art-knowledge-deploy-review.mjs';
import {linkFullAssets,assertFullDestinations} from './isolated-full-site-policy.mjs';
import { RELEASE_VERSION } from '../packages/shared/src/release.mjs';

// 290 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-290'))){
  const args=process.argv.slice(2),expected=['--local-qwen-290','--package-only','--control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web','--auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 290 release arguments');
  const helper=new URL('../../work/xiaotao-local-290-20261104/release-290.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='8db2323c6a29f8fcb6eee827dcb0797c995183e53c4c2e6a138c082862819239';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('290 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).package290(args)));process.exit(0);
}

// 289 frozen release: no shared-output build or default deployment fallback.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-289'))){
  const args=process.argv.slice(2),expected=['--local-qwen-289','--package-only','--control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web','--auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 289 release arguments');
  const helper=new URL('../../work/xiaotao-local-289-20261104/release-289.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='69efd7af3b432495feae7441ffc0190d0155bb9980356b9b5cc0517bcf1816dd';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('289 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).package289(args)));process.exit(0);
}

// 288 frozen release: never fall through to shared build or default deploy.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-288'))){
  const args=process.argv.slice(2),expected=['--local-qwen-288','--package-only','--control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web','--auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 288 release arguments');
  const helper=new URL('../../work/xiaotao-local-288-20261104/release-288.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='45ae8bd4212c682fc70f89bf88e3ca8c3b3cb06e98fd4082895dd5c75e0245e8';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('288 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).package288(args)));process.exit(0);
}

// 287 frozen release: never fall through to the ordinary shared-output build.
if(process.argv.slice(2).some(arg=>arg.startsWith('--local-qwen-287'))){
  const args=process.argv.slice(2),expected=['--local-qwen-287','--package-only','--control-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web','--auth-url=https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend'];
  if(args.length!==expected.length||new Set(args).size!==args.length||expected.some(arg=>!args.includes(arg)))throw Error('Invalid 287 package arguments');
  const helper=new URL('../../work/xiaotao-local-287-20261104/release-287.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  const expectedSha='9d7e6b0b51e512a20c2e2ad75dc733dea682a30f8365d4b999eae999716d9f81';
  if(!/^[a-f0-9]{64}$/.test(expectedSha)||createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!==expectedSha)throw Error('287 release helper not pinned or changed');
  console.log(JSON.stringify(await (await import(helper)).package287(args)));process.exit(0);
}

// 286 frozen candidate: strictly read-only prepare-only verification.
if(process.argv.slice(2).includes('--local-qwen-286')){
  const helper=new URL('../../work/local-qwen-aligned-286-20261104/release-preflight-286.mjs',import.meta.url);
  const {readFile:readFrozen}=await import('node:fs/promises'),{createHash:createFrozenHash}=await import('node:crypto');
  if(createFrozenHash('sha256').update(await readFrozen(helper)).digest('hex')!=='5ef2a1e2eceafdb14c497ce4abb2a58512926df637dbb425dac73a8d1086a6a6')throw Error('286 preflight helper changed');
  const frozen=await import(helper);
  console.log(JSON.stringify(await (process.argv.includes('--package-only')?frozen.package286(process.argv.slice(2)):frozen.verify286(process.argv.slice(2),{site:true}))));
  process.exit(0);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
if(process.argv.includes('--qwen21-edit-285')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--qwen21-edit-285'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/qwen21-edit-285-20261104/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--qwen21-edit-284')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--qwen21-edit-284'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/qwen21-edit-284-20261104/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--qwen21-edit-283')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--qwen21-edit-283'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/qwen21-edit-283-20261104/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--qwen21-native-282')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--qwen21-native-282'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/qwen21-native-282-20261104/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--art-recovery-281')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--art-recovery-281'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-art-diagnostics-281-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--art-english-280')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--art-english-280'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-English package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-art-english-280-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--art-language-279')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--art-language-279'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid art-language package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-art-contract-279-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--billing-note-278')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--billing-note-278'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid billing-note package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-billing-note-278-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--direct-prompt-277')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--direct-prompt-277'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid direct-prompt package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-direct-prompt-277-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--chat-recovery-276')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--chat-recovery-276'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid 276 hotfix package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-chat-recovery-276-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
if(process.argv.includes('--chat-recovery-275')){
  const args=process.argv.slice(2);
  if(args.length!==4||!args.includes('--check')||args.some(x=>x!=='--check'&&x!=='--chat-recovery-275'&&!x.startsWith('--control-url=')&&!x.startsWith('--auth-url=')))throw Error('Invalid 275 hotfix package arguments');
  const {packageHotfixSite}=await import('../../work/xiaotao-video-budget-20261103/release.mjs');
  await packageHotfixSite({controlUrl:args.find(x=>x.startsWith('--control-url='))?.slice(14),authUrl:args.find(x=>x.startsWith('--auth-url='))?.slice(11)});process.exit(0);
}
const frozenArgs=process.argv.filter(v=>v.startsWith('--frozen-264-cross-slot='));
if(frozenArgs.length>1) throw Error('Duplicate frozen package option');
const FROZEN_TAG=frozenArgs.length?frozenArgs[0].slice('--frozen-264-cross-slot='.length):null;
if(FROZEN_TAG!==null && (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(FROZEN_TAG)||!process.argv.includes('--check')||process.argv.some(v=>v.startsWith('--isolated-full-stage=')||v.startsWith('--isolated-version='))||process.env.FOART_ISOLATED_BUILD_TAG||process.env.FOART_ISOLATED_UI_ONLY))throw Error('Invalid frozen 264 package options');
// A misspelled or value-less isolation flag must never fall through to the
// ordinary builder, which cleans the shared generated output directories.
const sessionOptions=process.argv.filter(v=>v.startsWith('--frozen-265-session'));
if(sessionOptions.some(v=>!v.startsWith('--frozen-265-session=')))throw Error('Invalid frozen session package option');
const sessionArgs=sessionOptions;
if(sessionArgs.length>1)throw Error('Duplicate session package option');
const SESSION_TAG=sessionArgs.length?sessionArgs[0].slice('--frozen-265-session='.length):null;
if(SESSION_TAG!==null&&(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(SESSION_TAG)||!process.argv.includes('--check')||FROZEN_TAG!==null||process.argv.some(v=>v.startsWith('--isolated-full-stage=')||v.startsWith('--isolated-version='))||process.env.FOART_ISOLATED_BUILD_TAG||process.env.FOART_ISOLATED_UI_ONLY))throw Error('Invalid frozen session package options');
// The 269 review path is explicitly isolated and can never fall through to a
// regular build, which cleans shared output directories.
const h3Options=process.argv.filter(v=>v.startsWith('--frozen-269-h3'));
if(h3Options.some(v=>!v.startsWith('--frozen-269-h3='))||h3Options.length>1)throw Error('Invalid frozen 269 package option');
const H3_TAG=h3Options.length?h3Options[0].slice('--frozen-269-h3='.length):null;
if(H3_TAG!==null&&(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(H3_TAG)||!process.argv.includes('--check')||FROZEN_TAG!==null||SESSION_TAG!==null||process.argv.some(v=>v.startsWith('--isolated-full-stage=')||v.startsWith('--isolated-version='))||process.env.FOART_ISOLATED_BUILD_TAG||process.env.FOART_ISOLATED_UI_ONLY))throw Error('Invalid frozen 269 package options');
if(H3_TAG!==null){
  const args=process.argv.slice(2),once=key=>args.filter(v=>v.startsWith(key)).length===1;
  if(args.length!==4||args.filter(v=>v==='--check').length!==1||!once('--frozen-269-h3=')||!once('--control-url=')||!once('--auth-url=')||
    args.some(v=>v!=='--check'&&!v.startsWith('--frozen-269-h3=')&&!v.startsWith('--control-url=')&&!v.startsWith('--auth-url=')))throw Error('Frozen 269 accepts only tag, check, control and auth options');
}
// Review-only 271 always uses the hash-locked 267 baseline; invalid variants
// must never fall through to the regular shared-output builder.
const releaseOptions=process.argv.filter(v=>v.startsWith('--frozen-271-release'));
if(releaseOptions.some(v=>v!=='--frozen-271-release')||releaseOptions.length>1)throw Error('Invalid frozen 271 release option');
const RELEASE_271=releaseOptions.length===1;
if(RELEASE_271){
 const args=process.argv.slice(2),once=key=>args.filter(v=>v.startsWith(key)).length===1;
 if(FROZEN_TAG!==null||SESSION_TAG!==null||H3_TAG!==null||process.env.FOART_ISOLATED_BUILD_TAG||process.env.FOART_ISOLATED_UI_ONLY||args.length!==4||args.filter(v=>v==='--check').length!==1||!once('--control-url=')||!once('--auth-url=')||args.some(v=>v!=='--check'&&v!=='--frozen-271-release'&&!v.startsWith('--control-url=')&&!v.startsWith('--auth-url=')))throw Error('Invalid frozen 271 release package options');
}
const pilotOptions=process.argv.filter(v=>v.startsWith('--frozen-271')&&!v.startsWith('--frozen-271-release'));
if(pilotOptions.some(v=>!v.startsWith('--frozen-271-pilot='))||pilotOptions.length>1)throw Error('Invalid frozen 271 pilot option');
const PILOT_TAG=pilotOptions.length?pilotOptions[0].slice('--frozen-271-pilot='.length):null;
if(PILOT_TAG!==null){
  const args=process.argv.slice(2),once=key=>args.filter(v=>v.startsWith(key)).length===1;
  if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(PILOT_TAG)||FROZEN_TAG!==null||SESSION_TAG!==null||H3_TAG!==null||
    process.env.FOART_ISOLATED_BUILD_TAG||process.env.FOART_ISOLATED_UI_ONLY||args.length!==4||
    args.filter(v=>v==='--check').length!==1||!once('--frozen-271-pilot=')||!once('--control-url=')||!once('--auth-url=')||
    args.some(v=>v!=='--check'&&!v.startsWith('--frozen-271-pilot=')&&!v.startsWith('--control-url=')&&!v.startsWith('--auth-url=')))throw Error('Invalid frozen 271 pilot package options');
}
const runtime=FROZEN_TAG===null&&SESSION_TAG===null&&H3_TAG===null&&PILOT_TAG===null&&!RELEASE_271?await import('./build-web-renderer.mjs'):null;
const {buildWebRenderer,PATHS,HOST_FILE_LIMIT}=runtime||{};
const INDEX = PATHS?join(PATHS.WEB_OUT, 'index.html'):null;
const EDITOR = PATHS?join(PATHS.WEB_OUT, 'editor.html'):null;

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
}

const LOCAL = /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/i;

export async function packageSite({ controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled, out, allowLocal = false, logger } = {}) {
  if(RELEASE_271){
    assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
    // Pin this hash after review, QA receipt creation and installing the exact helper.
    const helperSha='b68f3bc696727b0dad46ed3e62e178f0ac03f902fb872fccbcd74aabb039fa49';
    if(!/^[0-9a-f]{64}$/.test(helperSha||''))throw Error('Frozen 271 release helper hash not pinned');
    const {createHash}=await import('node:crypto');const path=join(ROOT,'tools','package-frozen-271-release.mjs');
    if(createHash('sha256').update(await readFile(path)).digest('hex')!==helperSha)throw Error('Release helper changed');
    const {packageFrozen271Release}=await import('./package-frozen-271-release.mjs');
    return packageFrozen271Release({root:ROOT,tag:'qa-site-release-271-final-20261103',controlUrl,authUrl,logger});
  }
  if(PILOT_TAG!==null){
    assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
    const {packageFrozen271Pilot}=await import('./package-frozen-271-pilot.mjs');
    return packageFrozen271Pilot({root:ROOT,tag:PILOT_TAG,controlUrl,authUrl,logger});
  }
  if(H3_TAG!==null){
    assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
    const {packageFrozen269H3}=await import('./package-frozen-269-h3.mjs');
    return packageFrozen269H3({root:ROOT,tag:H3_TAG,controlUrl,authUrl,logger});
  }
  if(SESSION_TAG!==null){
    assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
    const {packageFrozen265Session}=await import('./package-frozen-265-session.mjs');
    return packageFrozen265Session({root:ROOT,tag:SESSION_TAG,controlUrl,authUrl,logger});
  }
  if(FROZEN_TAG!==null){
    assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
    const {packageFrozenCrossSlot}=await import('./package-frozen-264-cross-slot.mjs');
    return packageFrozenCrossSlot({root:ROOT,tag:FROZEN_TAG,controlUrl,authUrl,logger});
  }
  if (PATHS.ISOLATED_UI_ONLY) throw Error('UI-only validation cannot be packaged or deployed');
  if (PATHS.FULL_PLAN) assertFullDestinations({controlUrl,authUrl,artKnowledgeUrl,artKnowledgeEnabled,out,allowLocal});
  const log = logger || (() => {});
  // Software deployment prepares the review automatically but never grants
  // approval or publishes pending methods on the owner's behalf.
  const artReview=artKnowledgeEnabled===true?await prepareDeploymentArtReview({outputPath:join(ROOT,'.artifacts',`art-knowledge-review-${RELEASE_VERSION}.json`)}):null;
  if(artReview)log('art review prepared',artReview);

  // 1. build - this writes the local default into index.html. The published
  // site is minified: comments stripped, names mangled (anti-copy).
  const report = await buildWebRenderer({ clean: true, minify: true });
  if(PATHS.FULL_PLAN) await linkFullAssets(PATHS.FULL_PLAN,ROOT,PATHS.WEB_OUT);
  log('built', { modules: report.redactedModules, copied: report.copied, minified: report.minify ? report.minify.minified : 0 });

  // 2. repoint
  if (controlUrl || authUrl || artKnowledgeUrl || artKnowledgeEnabled!==undefined) {
    const entries = await Promise.all([INDEX, EDITOR].map(async path => ({path, html:await readFile(path, 'utf8')})));
    const rewritten = entries.map(entry => ({...entry, html:writeConfig(entry.html, { controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled })}));
    for (const entry of rewritten) await writeFile(entry.path, entry.html, 'utf8');
  }

  // 3. verify what actually landed, by reading the file back
  const config = readConfig(await readFile(INDEX, 'utf8'));
  if (!config) throw new Error('no config block in the built index.html');
  const editorConfig = readConfig(await readFile(EDITOR, 'utf8'));
  if (!editorConfig || JSON.stringify(editorConfig) !== JSON.stringify(config)) throw new Error('home and editor configuration do not match');
  if (!allowLocal && LOCAL.test(config.controlUrl)) {
    throw new Error(
      'refusing to package: the site still points at ' + config.controlUrl +
      '\n  A public host cannot reach a local control plane. Pass --control-url=<your deployed function>' +
      '\n  (or --allow-local if you really are packaging for a local test).'
    );
  }
  if (controlUrl && config.controlUrl !== controlUrl) {
    throw new Error('the repoint did not take: asked for ' + controlUrl + ', file holds ' + config.controlUrl);
  }
  log('pointed at', config);

  // 4. zip - with tar, because PowerShell's Compress-Archive writes backslash
  //    separators, which the ZIP spec forbids. Cloudflare's unzipper obeys the
  //    spec, so every file in a subdirectory 404s and the site is a blank page
  //    with the main bundle missing. That cost a deploy to find.
  const zip = resolve(out || (PATHS.FULL_PLAN ? join(PATHS.FULL_PLAN.stage,`foart-site-${PATHS.FULL_PLAN.version}.zip`) : join(ROOT, '.artifacts/novaflow-web-site.zip')));
  // Cloudflare's uploader refuses any file of 25 MiB or more, one file at a
  // time, after everything else has gone up. Refuse here instead.
  const oversized = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (entry.isFile() && (await stat(full)).size >= HOST_FILE_LIMIT) oversized.push(relative(PATHS.WEB_OUT, full));
    }
  };
  await walk(PATHS.WEB_OUT);
  if (oversized.length) throw new Error('refusing to package: over the host\'s 25 MiB file limit: ' + oversized.join(', '));
  await mkdir(dirname(zip), { recursive: true });
  if(!PATHS.FULL_PLAN) await rm(zip, { force: true });
  // Windows' own tar.exe, by full path. A `tar` from Git Bash reads C:\... as
  // a remote host ("Cannot connect to C: resolve failed").
  const tar = process.platform === 'win32'
    ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe')
    : 'tar';
  execFileSync(tar, ['-a', '-c', '-f', zip, '.'], { cwd: PATHS.WEB_OUT, stdio: 'pipe' });

  const bytes = (await import('node:fs')).statSync(zip).size;
  return { zip, bytes, config, files: report, ...(artReview?{artReview}:{}) };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('package-site.mjs');
if (invokedDirectly) {
  try {
    const res = await packageSite({
      controlUrl: arg('control-url'),
      authUrl: arg('auth-url'),
      artKnowledgeUrl: arg('art-knowledge-url')||undefined,artKnowledgeEnabled:process.argv.includes('--enable-art-knowledge')?true:undefined,
      out: arg('out'),
      allowLocal: process.argv.includes('--allow-local'),
      logger: (m, x) => console.log('  ' + m + ' ' + (x ? JSON.stringify(x) : ''))
    });
    console.log('');
    console.log('  controlUrl : ' + res.config.controlUrl);
    console.log('  authUrl    : ' + res.config.authUrl);
    console.log('  zip        : ' + res.zip);
    console.log('  size       : ' + (res.bytes / 1024 / 1024).toFixed(1) + ' MB');
  } catch (error) {
    console.error('\n' + String(error.message || error) + '\n');
    process.exit(1);
  }
}
