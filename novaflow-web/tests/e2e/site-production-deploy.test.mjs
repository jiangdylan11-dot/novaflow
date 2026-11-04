import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProductionSite, verifySiteEntries, parseFrozen265Args} from '../../tools/deploy-site.mjs';
const controlUrl='https://control.example/functions/v1/novaflow-web',authUrl='https://auth.example/functions/v1/novaflow-backend',version='2.0.216';
const html=(control=controlUrl,auth=authUrl)=>`window.NOVAFLOW_RELEASE_VERSION = "${version}";window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || {controlUrl: "${control}", authUrl: "${auth}"};`;
test('production deployment rejects rebuilt local defaults, changed endpoints and mismatched ZIP versions',()=>{
  const expected={controlUrl,authUrl,version};
  assert.deepEqual(verifyProductionSite(html(),{version},expected),{controlUrl,authUrl});
  assert.throws(()=>verifyProductionSite(html('http://127.0.0.1:4890'),{version},expected),/endpoints/);
  assert.throws(()=>verifyProductionSite(html(),{version:'old'},expected),/release/);
  assert.throws(()=>verifyProductionSite(html(controlUrl,'https://wrong.example'),{version},expected),/endpoints/);
  for(const local of ['http://127.0.0.1:4890','https://localhost','https://[::1]'])assert.throws(()=>verifyProductionSite(html(local),{version},{...expected,controlUrl:local}),/local/);
});

test('deployment validates both home and editor configuration and release',()=>{
 const expected={controlUrl,authUrl,version};assert.deepEqual(verifySiteEntries(html(),html(),{version},expected),{controlUrl,authUrl});
 assert.throws(()=>verifySiteEntries(html(),'',{version},expected),/endpoints/);
 assert.throws(()=>verifySiteEntries(html(),html(controlUrl,'https://wrong.example'),{version},expected),/endpoints/);
 assert.throws(()=>verifySiteEntries(html(),html().replace(version,'old'),{version},expected),/release/);
});

test('265 frozen mode only accepts its fixed artifact and target',()=>{
 assert.deepEqual(parseFrozen265Args(['--frozen-265']),{verifyOnly:false});
 assert.deepEqual(parseFrozen265Args(['--frozen-265','--verify-only']),{verifyOnly:true});
 for(const args of [[],['--verify-only'],['--frozen-265','--frozen-265'],['--frozen-265','--site-zip=other.zip'],['--frozen-265','--auth-url=https://wrong.example'],['--frozen-265','--control-url=https://wrong.example']]){
  assert.throws(()=>parseFrozen265Args(args),/Frozen 265/);
 }
});
