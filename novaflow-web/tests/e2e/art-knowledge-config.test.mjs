import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfig,writeConfig} from '../../tools/set-web-config.mjs';
test('deployment preserves independent knowledge endpoint and rollout flag across later repointing',()=>{
  const html='<script>window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || {controlUrl: "https://control.test",authUrl: "https://auth.test"};</script>';
  const ready=writeConfig(html,{artKnowledgeUrl:'https://knowledge.test',artKnowledgeEnabled:true});
  const repointed=writeConfig(ready,{controlUrl:'https://next.test'}),config=readConfig(repointed);
  assert.equal(config.artKnowledgeUrl,'https://knowledge.test');assert.equal(config.artKnowledgeEnabled,true);
  assert.equal(config.controlUrl,'https://next.test');assert.equal(config.authUrl,'https://auth.test');
  assert.equal(readConfig(writeConfig(repointed,{artKnowledgeEnabled:false})).artKnowledgeEnabled,false);
});
