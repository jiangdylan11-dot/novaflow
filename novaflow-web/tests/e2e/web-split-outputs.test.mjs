// 一键拆图 on the Web: the compute node copies the See-through files back by name, the page reads
// them from the newest task, and the layers stay out of the 仓库.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { collectSeeThroughOutputs } from '../../worker/src/worker-core.mjs';

let checks = 0;
const check = (a, b, msg) => { assert.deepEqual(a, b, msg); checks += 1; };

// ---- the worker side: files by their See-through names, a per-task log, the optional head layer
const prefix = 'novaflow_spine_1_ab';
const store = new Map([
  ['seethrough_psd_info.log', prefix + '_2_cd_layers.json'],
  [prefix + '_2_cd_layers.json', JSON.stringify({ width: 10, height: 10, layers: [
    { name: 'hair', filename: prefix + '_2_cd_hair.png' },
    { name: 'back hair', filename: prefix + '_2_cd_back hair.png' },
    { name: 'skirt', filename: 'other_prefix.png' }
  ] })],
  [prefix + '_2_cd_back hair.png', 'BACK-HAIR'],
  [prefix + '_2_cd_hair.png', 'HAIR'],
  ['other_prefix.png', 'NOT-OURS'],
  [prefix + '_head.json', JSON.stringify({ ok: true, layer: { name: 'head', filename: prefix + '_head.png' } })],
  [prefix + '_head.png', 'HEAD']
]);
const comfy = { async viewFile({ filename }) {
  if (!store.has(filename)) throw new Error('ComfyUI view failed: 404');
  return Buffer.from(store.get(filename));
} };
const files = await collectSeeThroughOutputs(comfy, prefix);
check(files.map((f) => f.name), ['seethrough_psd_info.log', prefix + '_2_cd_layers.json', prefix + '_2_cd_hair.png', prefix + '_2_cd_back_hair.png', prefix + '_head.json', prefix + '_head.png']);
check(files.map((f) => f.kind), ['file', 'file', 'image', 'image', 'file', 'image']);
check(String(files[3].bytes), 'BACK-HAIR');
// The json the page reads names the served copy, not See-through's spaced original.
check(JSON.parse(String(files[1].bytes)).layers.map((l) => l.filename), [prefix + '_2_cd_hair.png', prefix + '_2_cd_back_hair.png', 'other_prefix.png']);
check(String(files[0].bytes), prefix + '_2_cd_layers.json');
check(String(files[2].bytes), 'HAIR');
store.delete(prefix + '_head.json');
check((await collectSeeThroughOutputs(comfy, prefix)).map((f) => f.name).includes(prefix + '_head.png'), false);
store.set('seethrough_psd_info.log', 'someone_else_layers.json');
await assert.rejects(collectSeeThroughOutputs(comfy, prefix), /不是本次任务输出/); checks += 1;
store.delete('seethrough_psd_info.log');
await assert.rejects(collectSeeThroughOutputs(comfy, prefix), /未写入图层信息/); checks += 1;
await assert.rejects(collectSeeThroughOutputs(comfy, 'bad prefix'), /前缀/); checks += 1;

// ---- the page side: the newest task answers a shared file name, and split layers skip the 仓库
const warehouse = [];
const tasks = [];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const sandbox = createDomSandbox({
  Response, Request, Blob, FormData,
  NovaFlowWebWarehouse: { save: async (item) => { warehouse.push(item.name); } },
  NOVAFLOW_WEB_CONFIG: { controlUrl: 'https://control.test' },
  fetch: async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith('/api/web/tasks') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const task = { id: 'task-' + (tasks.length + 1), status: 'completed', workflow: body.workflow,
        output_manifest: { files: [{ name: 'seethrough_psd_info.log', kind: 'file' }, { name: 'result.png', kind: 'image' }] } };
      tasks.push(task);
      return response({ task });
    }
    const byId = /\/api\/web\/tasks\/(task-\d+)$/.exec(url);
    if (byId) return response({ task: tasks.find((t) => t.id === byId[1]) });
    if (url.endsWith('/grant')) return response({ grant: { endpoint: 'https://worker.test', token: 't', expiresAt: new Date(Date.now() + 600000).toISOString() } });
    const gw = /worker\.test\/gw\/tasks\/(task-\d+)\/output\/([^?]+)/.exec(url);
    if (gw) return new Response(gw[1] + ':' + decodeURIComponent(gw[2]), { headers: { 'content-type': 'text/plain' } });
    throw new Error('unexpected request ' + url);
  }
});
runInContext(await readFile(new URL('../../web-dist/novaflow-web-runtime.js', import.meta.url), 'utf8'), createContext(sandbox));
const api = sandbox.electronAPI;
const submit = async (method) => {
  const marker = sandbox.NovaFlowWebRuntime.serverOnly('spine-split-runtime', method, ['', 'x.png', {}]);
  return api.runtimeRequestJson({ path: '/prompt', init: { method: 'POST', body: JSON.stringify({ prompt: JSON.parse(String(marker)) }) } });
};
check((await submit('buildSeeThroughSplitWorkflow')).data.prompt_id, 'task-1');
check((await submit('buildSeeThroughSplitWorkflow')).data.prompt_id, 'task-2');
const log = await api.runtimeRequestBinary({ path: '/view?filename=seethrough_psd_info.log&type=output' });
check(log.ok, true);
check(Buffer.from(log.dataBase64, 'base64').toString(), 'task-2:seethrough_psd_info.log');
check(warehouse, []);
check((await submit('defaultRmbgWorkflow')).data.prompt_id, 'task-3');
check((await api.runtimeRequestBinary({ path: '/view?filename=result.png&type=output' })).ok, true);
check(warehouse, ['result.png']);
console.log(checks + ' passed, 0 failed: See-through split files by name, newest task first, no 仓库 entry for layers');
