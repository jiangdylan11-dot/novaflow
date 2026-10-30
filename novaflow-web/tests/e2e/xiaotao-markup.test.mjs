import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { creditsFromUsd, estimateXiaotaoOnlineCredits, settleTokenImageCredits, settleXiaotaoOnlineCredits, xiaotaoOnlinePolicy } from '../../packages/shared/src/feature-credits.mjs';
import { createCompanionChat } from '../../packages/shared/src/companion-chat.mjs';
import { createOnlineAiCharge } from '../../packages/shared/src/online-ai-charge.mjs';

const model = 'xai/grok-4.7';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function prices() {
  const scope = {}; scope.window = scope;
  runInContext(readFileSync(new URL('../../renderer/feature-credit-prices.js', import.meta.url), 'utf8'), createContext(scope));
  return scope.NovaFlowFeatureCreditPrices;
}

test('小桃 uses 1.5 for both example costs independently of image markup', () => {
  for (const [usd, expected] of [['0.0148427', 5], ['0.0161415', 6]]) {
    const normal = settleXiaotaoOnlineCredits({model, usage:{consumeMoney:usd}, reservedCredits:20});
    const globalOverride = settleXiaotaoOnlineCredits({model, usage:{consumeMoney:usd}, reservedCredits:20, config:{token_billing:{markup:9}}});
    assert.equal(normal.credits, expected);
    assert.equal(normal.markup, 1.5);
    assert.equal(globalOverride.credits, expected);
    assert.equal(globalOverride.markup, 1.5);
  }
  assert.equal(creditsFromUsd(0.02), 9);
  assert.equal(settleTokenImageCredits({usage:{thirdPartyConsumeMoney:'0.02'},reservedCredits:40}).credits, 9);
});

test('web forecast and reservation use the 小桃 policy including explicit overrides', () => {
  const p = prices();
  const input = {text:'a'.repeat(10000),system:'',model};
  for (const config of [undefined, {token_billing:{markup:8}}, {xiaotao_online:{markup:1.2}}, {xiaotao_online:{markup:true}}]) {
    const spec = {...input,config};
    const server = estimateXiaotaoOnlineCredits(spec);
    const browser = p.estimateXiaotaoOnline(spec);
    assert.equal(browser.credits, server.credits);
    assert.equal(p.predictXiaotaoOnline(spec).reservedCredits, server.credits);
  }
  assert.equal(xiaotaoOnlinePolicy().markup, 1.5);
  assert.equal(xiaotaoOnlinePolicy({xiaotao_online:{markup:1.2}}).markup, 1.2);
  assert.equal(xiaotaoOnlinePolicy({xiaotao_online:{markup:true}}).markup, 1.5);
  assert.equal(p.estimateXiaotaoOnline({...input,config:{token_billing:{markup:8}}}).credits, p.estimateXiaotaoOnline(input).credits);
});

test('old 2x price observations do not determine the new 小桃 forecast', () => {
  const p = prices();
  const input = {text:'a'.repeat(10000),system:'',model};
  const newQuote = p.predictXiaotaoOnline(input);
  const oldGroup = JSON.stringify(JSON.parse(newQuote.group).map((part,i) => {
    if (i !== 1) return part;
    const policy = JSON.parse(part); policy[0] = 2; policy[3] = 2;
    return JSON.stringify(policy);
  }));
  const oldSamples = [{group:oldGroup,baseTokens:newQuote.baseTokens,usdCost:1,totalTokens:10000}];
  const result = p.predictXiaotaoOnline({...input,samples:oldSamples,config:{token_billing:{markup:2}}});
  assert.equal(result.sampleCount, 0);
  assert.equal(result.credits, newQuote.credits);
});

test('real companion charge seam settles both text and image with the 小桃 rate and reports it to the web', async () => {
  let cost = '0.0148427'; const settlements = [];
  const charge = createOnlineAiCharge({
    reserve: async ({estimatedCredits}) => ({status:'reserved',amount:1,credits:estimatedCredits}),
    settle: async (input) => { settlements.push(input); return {settled_credits:input.settledCredits}; },
    release: async () => assert.fail('completed request must settle')
  });
  const companion = createCompanionChat({provider:{baseUrl:'https://provider.test/v1',model,apiKey:'fixture',creditConfig:{token_billing:{markup:9}}},charge,
    fetchImpl:async()=>Response.json({model,choices:[{finish_reason:'stop',message:{content:'好'}}],usage:{prompt_tokens:5000,completion_tokens:1000,total_tokens:6000,consumeMoney:cost}})});
  const payload={mode:'chat',promptLanguage:'en',message:'帮我看',history:[]};
  const text = await companion.reply({user:{id:'user'},payload:{...payload,requestId:'markup-text-123'}});
  cost = '0.0161415';
  const vision = await companion.reply({user:{id:'user'},payload:{...payload,requestId:'markup-image-123',images:[{role:'attachment',dataUrl:PNG}]}});
  assert.deepEqual(settlements.map(x=>[x.feature,x.settledCredits]),[['xiaotao-text',5],['xiaotao-vision',6]]);
  assert.equal(text.billingSample.markup,1.5);
  assert.equal(vision.billingSample.markup,1.5);
  assert.equal(text.billingSample.policy.markup,1.5);
  assert.equal(vision.billingSample.policy.markup,1.5);
});
