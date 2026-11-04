// Writes the one shared 小桃 online model list into each browser script that
// needs it (between the BEGIN/END markers), so the menu and checks can never
// drift from the server allowlists. Source: packages/shared/src/xiaotao-online-models.mjs
import {readFile,writeFile} from 'node:fs/promises';
import {XIAOTAO_ONLINE_MODELS} from '../packages/shared/src/xiaotao-online-models.mjs';
const root=new URL('../',import.meta.url);
const TARGETS=['renderer/xiaotao-art-agent.js','renderer/novaflow-web-runtime.js','renderer/feature-credit-prices.js','renderer/novaflow-smart-ai.js'];
const BEGIN='// BEGIN GENERATED xiaotao-online-models (run tools/sync-xiaotao-online-models.mjs)';
const END='// END GENERATED xiaotao-online-models';
const models=XIAOTAO_ONLINE_MODELS.map(({id,label,flatRate,vision,thinkingHeadroom})=>({id,label,flatRate,vision,...(thinkingHeadroom?{thinkingHeadroom}:{})}));
const block=indent=>[BEGIN,
  'const XIAOTAO_ONLINE_MODELS = Object.freeze('+JSON.stringify(models)+'.map(model => Object.freeze(model)));',
  'const XIAOTAO_ONLINE_MODEL_IDS = Object.freeze(XIAOTAO_ONLINE_MODELS.map(model => model.id));',
  'const isXiaotaoOnlineModel = id => XIAOTAO_ONLINE_MODEL_IDS.includes(id);',
  'const isXiaotaoFlatRateModel = id => XIAOTAO_ONLINE_MODELS.some(model => model.id === id && model.flatRate);',
  END].map(line=>indent+line).join('\n');
const check=process.argv.includes('--check');
for(const target of TARGETS){
  const url=new URL(target,root),source=await readFile(url,'utf8');
  const match=source.match(/^([ \t]*)\/\/ BEGIN GENERATED xiaotao-online-models[^\n]*\n[\s\S]*?\/\/ END GENERATED xiaotao-online-models/m);
  if(!match)throw Error(target+' has no generated xiaotao-online-models block');
  const output=source.replace(match[0],block(match[1]));
  if(check){if(output!==source)throw Error(target+': 小桃 online model list is out of sync; run tools/sync-xiaotao-online-models.mjs');}
  else if(output!==source)await writeFile(url,output);
}
console.log('小桃 online models '+(check?'verified':'synced')+': '+TARGETS.join(', '));
