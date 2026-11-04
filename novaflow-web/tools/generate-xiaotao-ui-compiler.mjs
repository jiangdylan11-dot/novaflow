// Build a server-side, module-local view of the original UI professional rules.
// The renderer sources remain the sole implementation. Only pure helpers are
// exported; the renderer cache/session and its global object are not exposed.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const names=['ui-design-prompt.pipeline.js','ui-design-assistant.workflow.js'];
const destination=join(root,'packages/shared/src/xiaotao-ui-professional.generated.mjs');
export async function generateXiaotaoUiCompiler({check=false}={}) {
  const sources=await Promise.all(names.map(name=>readFile(join(root,'renderer',name),'utf8')));
  const hashes=Object.fromEntries(sources.map((s,i)=>[names[i],createHash('sha256').update(s).digest('hex')]));
  const output='// GENERATED: server-local wrappers around unchanged renderer UI rules.\n'
    +'// Sources: '+JSON.stringify(hashes)+'\n'
    +'const isolated=(()=>{const globalThis=Object.create(null);const module=undefined;\n'
    +sources.join('\n;\n')+'\n'
    +'const pipeline=globalThis.NovaFlowUiDesignPromptPipeline,assistant=globalThis.NovaFlowUiDesignAssistantWorkflow;\n'
    +"if(!pipeline||!assistant)throw Error('ui-compiler-unavailable');\n"
    +'return Object.freeze({pipeline:Object.freeze({requireLayoutReferences:pipeline.requireLayoutReferences,normalizeQwenPlan:pipeline.normalizeQwenPlan}),assistant:Object.freeze({structureSnapshot:assistant.structureSnapshot,buildRequirements:assistant.buildRequirements,buildTextOnlyRequirements:assistant.buildTextOnlyRequirements,restoreText:assistant.restoreText})});})();\n'
    +'export const pipeline=isolated.pipeline;export const assistant=isolated.assistant;\n'
    +'export const sourceHashes=Object.freeze('+JSON.stringify(hashes)+');\n';
  if(check) {
    let actual;try {actual=await readFile(destination,'utf8');} catch {throw Error('UI professional compiler missing');}
    if(actual!==output)throw Error('UI professional compiler drift');
  } else await writeFile(destination,output,'utf8');
  return {destination,hashes,bytes:Buffer.byteLength(output)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await generateXiaotaoUiCompiler({check:process.argv.includes('--check')})));
