import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createFlashArtAgent,computeArtAgentFingerprint,FLASH_ART_AGENT_SYSTEM_SHA256,FLASH_ART_AGENT_PARENT_SYSTEM_SHA256,FLASH_CREATION_AGENT_TOOLS} from '../../worker/src/flash-art-agent.mjs';
import {readArtSkill} from '../../worker/src/art-skill-service.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('the drawing default is exactly the candidate used in the eight-style real generation evaluation',async()=>{
  const tested=JSON.parse(await readFile(new URL('../../docs/experiments/style-transfer-1.0.13.json',import.meta.url),'utf8'));
  assert.deepEqual(await readArtSkill(),tested);
  assert.equal(FLASH_ART_AGENT_PARENT_SYSTEM_SHA256,'c74b48b7ec8b15d26e2a4eaf0148c153ffa8a743b84ea1fb4df00146750ff21e');
  assert.equal(FLASH_ART_AGENT_SYSTEM_SHA256,'4d646e8f69e8a82086ec759883497ec7fc51c70021a505dec2dc7b94a11ec44c');
});

test('ordinary chat and independent creation retain their prior actual model-facing systems, tool menus and reasoning settings',async()=>{
  const expected={chat:{system:'ccea2d19d45b5defcf050adb3b419f2efd411c0cff3fe9cea9a42cd6525ae024',tools:'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'},creation:{system:'9cbf60adf4de03a3528e478c302fae2b25ef61062caedb93bfea63d9299d229d',tools:'98f6663156a62a9409be4426366a6c1c55616490750efbf3ede94e58cf8bdaa6'}};
  for(const mode of ['chat','creation']){
    const request={requestId:'scope-test-'+mode,mode,message:'解释一下当前创作方式',history:[],images:[],...(mode==='creation'?{artContext:{task:'creation',provider:'local',engine:'qwen-2.1',mode:'txt2img',nsfw:false,prompt:'A porcelain tea set',negativePrompt:'literal negative',cfg:3,steps:8}}:{})};
    if(mode==='creation')request.contextFingerprint=computeArtAgentFingerprint(request);
    let calls=0;
    const response=await createFlashArtAgent().run({payload:request,flash:{identity:{id:'scope-fixture'},inferConversation:async input=>{
      calls++;assert.equal(sha(input.messages[0].content),expected[mode].system);
      assert.equal(sha(JSON.stringify(input.tools||[])),expected[mode].tools);
      assert.equal(input.reasoningEffort,'none');assert.equal(input.reasoningBudgetTokens,0);
      return {model:'scope-fixture',requestId:'scope-result-'+mode,finishReason:'stop',message:{role:'assistant',content:'这是创作方式的说明。'}};
    }}});
    assert.equal(calls,1);assert.equal(response.proposal,undefined);
  }
  assert.equal(sha(JSON.stringify(FLASH_CREATION_AGENT_TOOLS)),expected.creation.tools);
});
