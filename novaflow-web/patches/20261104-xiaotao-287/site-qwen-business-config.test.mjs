import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {readConfig,writeConfig} from '../../tools/set-web-config.mjs';

// Import the real build transforms without allowing their generated-input
// checks to write into the shared renderer or replace the browser bundle.
process.env.FOART_ISOLATED_BUILD_TAG='qwen-business-config-test';
process.env.FOART_ISOLATED_UI_ONLY='1';
process.argv.push('--check');
const {rewriteHomeHtml,rewriteIndexHtml}=await import('../../tools/build-web-renderer.mjs');

const destinations={controlUrl:'https://control.example/functions/v1/novaflow-web',authUrl:'https://auth.example/functions/v1/novaflow-backend'};
const evaluateConfig=html=>{
  const block=html.match(/window\.NOVAFLOW_WEB_CONFIG = window\.NOVAFLOW_WEB_CONFIG \|\| \{[\s\S]*?\};/);
  assert.ok(block,'packaged page must contain a configuration block');
  const context={window:{}};runInNewContext(block[0],context);return context.window.NOVAFLOW_WEB_CONFIG;
};

test('real home and editor build transforms retain enabled local Qwen through package repoint',async()=>{
  const [home,editor]=await Promise.all(['home-shell.html','index.html'].map(name=>readFile(new URL('../../renderer/'+name,import.meta.url),'utf8')));
  const built=[rewriteHomeHtml(home),rewriteIndexHtml(editor)];
  for(const html of built){
    assert.equal(evaluateConfig(html).xiaotaoQwenBusinessEnabled,true);
    const packaged=writeConfig(html,destinations),config=evaluateConfig(packaged);
    assert.equal(config.xiaotaoQwenBusinessEnabled,true);
    assert.equal(config.controlUrl,destinations.controlUrl);assert.equal(config.authUrl,destinations.authUrl);
    assert.equal(readConfig(packaged).xiaotaoQwenBusinessEnabled,true);
  }
});

test('repoint preserves explicit false and can set a deliberate value for older entries',()=>{
  const original='window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || { controlUrl: "http://localhost", authUrl: "https://auth.example", xiaotaoQwenBusinessEnabled: false };';
  assert.equal(evaluateConfig(writeConfig(original,destinations)).xiaotaoQwenBusinessEnabled,false);
  const old=original.replace(', xiaotaoQwenBusinessEnabled: false','');
  assert.equal(readConfig(writeConfig(old,destinations)).xiaotaoQwenBusinessEnabled,undefined);
  assert.equal(evaluateConfig(writeConfig(old,{...destinations,xiaotaoQwenBusinessEnabled:true})).xiaotaoQwenBusinessEnabled,true);
});
