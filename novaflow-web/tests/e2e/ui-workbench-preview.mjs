// Local-only visual fixture. Production components, isolated state, no model/auth requests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const renderer = new URL('../../renderer/', import.meta.url);
const modules = ['left-panel-accordion.helper.js', 'ui-design.structure.tool.js', 'ui-design.project.resource.js', 'ui-design-layout-guide.helper.js', 'ui-design.inspector.tool.js', 'ui-design.preview.js', 'ui-design-mode.tool.js', 'resource-mention.tool.js', 'ui-design-generate.tool.js', 'ui-design-assistant.workflow.js', 'ui-design-assistant.dialog.js', 'ui-design-prompt.pipeline.js', 'ui-design.workbench.js'];
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>UI 工作台 · 组件验收</title>
<link rel="stylesheet" href="/modules/resource-mention.tool.css"><style>html,body{margin:0;height:100%;background:#171717;color:#ddd;font:12px system-ui}header{height:48px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid #333;gap:16px}body>main{display:grid;grid-template-columns:230px 1fr;height:calc(100% - 49px)}#left{padding:10px;overflow:auto}#canvas{position:relative;min-width:0;height:100%}button,select,input,textarea{font:inherit}button{cursor:pointer}</style>
<body class="novaflow-primary-target-art"><header><b>NOVAFLOW</b> 美工 / UI <span style="color:#888">组件验收环境 · 模型调用使用测试替身</span><button id="test">执行链路检查</button><output id="tests"></output></header><main><aside data-novaflow-left-column="1"><div id="left" data-novaflow-art-ui-host="1"></div></aside><section id="canvas"></section></main>
${modules.map(name => `<script src="/modules/${name}"></script>`).join('')}
<script>
const calls = [], pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
window.addEventListener('error', event => { document.querySelector('#tests').textContent = 'ERROR: ' + event.message });
window.electronAPI = { runtimeFeaturesSync: () => ({qwenImage21:true}), runtimeFeatures: async () => ({qwenImage21:true}), promptAssistantOptimizePrompt: async input => { calls.push('optimize'); return {ok:true,prompt:input.prompt || 'UI 页面，清晰层级和统一组件风格'} }, promptAssistantReverseImagePrompt: async input => { calls.push('optimize'); return {ok:true,prompt:input.prompt || '根据参考图设计 UI'} } };
window.NovaFlowSpineSplitBridge = { registerSourceDataUrlResource: async (name, dataUrl, options) => ({id:'shared-'+Date.now(),dataUrl}) };
window.NovaFlowUiDesignGenerateWorkflow = { run: async options => { calls.push('generate'); return {dataUrl:pixel,name:'链路测试图片',width:1024,height:1024} }, providerCapability: () => ({provider:'local',externalReferenceLimit:10,reservedLayoutReferences:0,engine:'qwen-2.1'}) };
</script><script src="/modules/ui-design.bridge.js"></script><script>
const bridge = NovaFlowUiDesignBridge;
bridge.stop();
const store = bridge.ensureStore();
store.patchSettings({provider:'local',assistantEngine:'local'});
bridge.activate({active:true,leftHost:document.querySelector('#left'),workspaceHost:document.querySelector('#canvas')});
document.querySelector('#test').onclick = async () => {
 try {
  const id = store.getState().project.graph.nodes.find(n=>n.type==='generator').id;
  const node = store.getState().project.graph.nodes.find(n=>n.id===id);
  store.patchGraphNode(id,{data:{generationSettings:{...node.data.generationSettings,prompt:'一个简洁的背包界面',assistantEngine:'local'}}});
  await bridge.runGeneration({generatorNodeId:id});
  if(calls.join(',')!=='optimize,generate') throw Error('调用次序不正确: '+calls);
  await bridge.runGeneration({generatorNodeId:id});
  if(calls.join(',')!=='optimize,generate,generate') throw Error('未复用优化: '+calls);
  document.querySelector('#tests').textContent='PASS · 无布局生成、优化复用、结果入库';
 } catch(error) { document.querySelector('#tests').textContent='FAIL: '+error.message }
};
</script></html>`;
createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page); return; }
    const name = pathname.replace('/modules/', '');
    if (!pathname.startsWith('/modules/') || ![...modules, 'ui-design.bridge.js', 'resource-mention.tool.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.end(await readFile(fileURLToPath(new URL(name, renderer))));
  } catch(error) { res.writeHead(500).end(String(error.message)); }
}).listen(4894, '127.0.0.1', () => console.log('UI component preview http://127.0.0.1:4894'));
