import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {XIAOTAO_FOART_ROLE_SYSTEM} from '../packages/shared/src/xiaotao-role-policy.mjs';
const root=new URL('../',import.meta.url);
const source=await readFile(new URL('packages/shared/src/foart-tool-plan.mjs',root),'utf8');
const body=source.replace(/^import[^\n]+\n/gm,'').replace(/\bexport /g,'');
const output='// GENERATED from packages/shared/src/foart-tool-plan.mjs; run tools/sync-foart-tool-contract.mjs\n(function(root){\nconst withXiaotaoFoartRole=system=>'+JSON.stringify(XIAOTAO_FOART_ROLE_SYSTEM+'\n\n本次请求的具体能力与协议：\n')+'+system;\n'+body+'\nroot.NovaFlowFoartToolContract=Object.freeze({FOART_TOOL_SCHEMA,FOART_ACTIONS,FOART_ART_ACTIONS,FOART_TOOL_SYSTEM,validateFoartContext,validateFoartPlan,validateFoartMediaOperation,readFoartPlan});\n})(typeof window!=="undefined"?window:globalThis);\n';
const destination=new URL('renderer/foart-tool-contract.js',root);
if(process.argv.includes('--check')){if(await readFile(destination,'utf8')!==output)throw Error('Foart browser tool contract is out of sync');}
else await writeFile(destination,output);
console.log('Foart tool contract '+(process.argv.includes('--check')?'verified':'synced')+': '+fileURLToPath(destination));
