// The verified PE model and CPU compiler behind the normal local UI assistant.
// No cloud provider, credential, model download or automatic retry lives here.
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const UI_CATALOG_SCHEMA = 'nf.ui.structure-catalog.v1';
export const UI_CATALOG_MODEL = 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function parseCatalogObject(raw) {
  const source = String(raw || '').split(/^\s*<\/think>\s*$/mu).at(-1).replace(/^```(?:json)?\s*/u, '').trim();
  // PE custom templates can return the continuation after the opening brace.
  for (const candidate of (source.startsWith('\"') ? ['{' + source, source] : [source, '{' + source])) {
    const first = candidate.indexOf('{');
    let depth = 0, quoted = false, escaped = false;
    for (let i = first; i >= 0 && i < candidate.length; i++) {
      const c = candidate[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(candidate.slice(first, i + 1)); } catch { break; } }
    }
  }
  throw new Error('UI 分析没有返回完整 JSON，本次未提交生图');
}

// Same first-complete-field policy as the validated research extractor.
// A repeated/truncated suffix never overwrites the retained art values.
export function parseCatalogFields(raw, expectedKeys) {
  const original = String(raw || '').replace(/^```(?:json)?\s*/u, '').trim();
  const addedOpeningBrace = !original.startsWith('{'), source = addedOpeningBrace ? '{' + original : original;
  let position = 1; const value = {}, spans = {}, ignoredFields = [], observedOrder = [], expected = new Set(expectedKeys);
  const skip = () => { while (/\s/u.test(source[position] || '') && position < source.length) position++; };
  const string = () => {
    const start = position; if (source[position] !== '"') throw new Error('主题美术字段格式不完整');
    let escaped = false; position++;
    while (position < source.length) {
      const c = source[position++];
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') return { value:JSON.parse(source.slice(start, position)), span:[start, position] };
    }
    throw new Error('主题美术字段被截断，本次未提交生图');
  };
  while (Object.keys(value).length < expectedKeys.length) {
    skip(); const actual = string(), key = actual.value;
    skip(); if (source[position++] !== ':') throw new Error('主题美术字段缺少分隔符'); skip();
    const field = string();
    if (expected.has(key)) {
      if (Object.hasOwn(value,key)) throw new Error('主题美术字段在完整集合前重复：'+key);
      if (!field.value.trim()) throw new Error('主题美术字段为空：'+key);
      value[key]=field.value;spans[key]=field.span;observedOrder.push(key);
    } else {
      if (!/^(?:OBJECT|CHARACTER|MAIN_CHARACTER|SPECIAL|CARRIER)\d+$/.test(key)) throw new Error('主题美术返回了未支持字段：'+key);
      ignoredFields.push(key);
    }
    if (Object.keys(value).length < expectedKeys.length) { skip(); if (source[position++] !== ',') throw new Error('主题美术字段缺失'); }
  }
  return { value, proof:{ completeFields:expectedKeys.length, reconstructedValueSpans:spans, ignoredFields, observedOrder, addedOpeningBrace,
    sourceSha256:createHash('sha256').update(original).digest('hex'), suffixQuarantinedChars:source.length-position, artWordEdits:0 } };
}

export function buildUiCatalogGraph({ system, context, images = [], observation = false, maxLength = 6144, continuation = '' }) {
  const graph = { '1': { class_type: 'CLIPLoader', inputs: { clip_name: UI_CATALOG_MODEL, type: 'qwen_image', device: 'default' } } };
  let image;
  images.forEach((name, i) => {
    const id = String(10 + i * 2);
    graph[id] = { class_type: 'LoadImage', inputs: { image: name } };
    if (!image) image = [id, 0];
    else { const batch = String(11 + i * 2); graph[batch] = { class_type: 'ImageBatch', inputs: { image1: image, image2: [id, 0] } }; image = [batch, 0]; }
  });
  const vision = images.map((_,i) => (observation ? '' : '图'+(i+1)+'：')+'<|vision_start|><|image_pad|><|vision_end|>'+(observation ? '' : '\n')).join('');
  const user = typeof context === 'string' ? context : JSON.stringify(context);
  const tail = observation ? '<think>\n'+(continuation ? continuation+'\n</think>\n\n{' : '') : '<think>\n\n</think>\n\n{';
  graph['3'] = { class_type:'TextGenerate',inputs:{
    clip:['1',0],prompt:'<|im_start|>system\n'+system+'<|im_end|>\n<|im_start|>user\n'+vision+user+'<|im_end|>\n<|im_start|>assistant\n'+tail,
    system_prompt:'',max_length:maxLength,sampling_mode:'on',thinking:observation&&!continuation,use_default_template:false,mtp:'off',
    'sampling_mode.temperature':1,'sampling_mode.top_k':20,'sampling_mode.top_p':.95,'sampling_mode.min_p':0,
    'sampling_mode.repetition_penalty':1,'sampling_mode.seed':0,'sampling_mode.presence_penalty':observation?1.5:0,
    ...(image?{image}:{})
  }};
  graph['4']={class_type:'PreviewAny',inputs:{source:['3',0]}};
  graph['5']={class_type:'PreviewAny',inputs:{source:['3',1]}};
  return graph;
}

export function cpuCatalog({ python, serviceScript }, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', '-m', 'prompt_assistant.ui_catalog_cli'], { cwd: dirname(serviceScript), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('UI 编译器超时，本次未提交生图')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', s => { output += s; }); child.stderr.on('data', s => { errors = (errors + s).slice(-2000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); try { const result = JSON.parse(output.trim()); if (!result.ok) throw new Error(result.error); resolve(result.data); } catch (error) { reject(new Error(error.message || errors || 'UI 编译失败')); } });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function planUiCatalog({ baseUrl, payload, cpu, fetchImpl = fetch, pollMs = 1000, timeoutMs = 600000 }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const images = payload.images || [];
  if (!Array.isArray(images) || !images.length) throw new Error('结构编译需要布局参考图');
  const layoutIndex = images.findIndex(x => x.role === 'layout');
  if (layoutIndex < 0) throw new Error('请指定一张布局参考图');
  const request = String(payload.currentPrompt || payload.prompt || '').trim();
  if (!request || request.length > 18000) throw new Error('请填写有效的主题与设计要求');
  const json = async (path, init) => {
    const response = await fetchImpl(base + path, { ...init, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('UI 分析运行时请求失败：HTTP ' + response.status);
    return response.json();
  };
  async function idle() {
    const queue = await json('/queue');
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('无法确认 GPU 队列，本次未提交');
    if (queue.queue_running.length || queue.queue_pending.length) throw new Error('其他任务正在使用 GPU，请等待完成后重试；本次未重复排队');
  }
  await idle();
  const info = await json('/object_info/CLIPLoader');
  if (!info.CLIPLoader?.input?.required?.clip_name?.[0]?.includes(UI_CATALOG_MODEL)) throw new Error('缺少已验证的 UI PE 分析模型；不会自动下载或更换模型');
  const names = [], sources = [];
  for (const [index, item] of images.entries()) {
    const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(item.dataUrl || ''));
    if (!match) throw new Error('参考图数据无效');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('参考图大小无效');
    const form = new FormData(), ext = match[1].includes('jpeg') ? 'jpg' : match[1].split('/')[1];
    form.append('image', new Blob([bytes], { type: match[1] }), 'NF_UI_CATALOG_' + randomUUID() + '.' + ext); form.append('overwrite', 'false');
    const uploaded = await json('/upload/image', { method: 'POST', body: form });
    if (!uploaded.name) throw new Error('布局图上传未返回文件名');
    names.push((uploaded.subfolder ? uploaded.subfolder + '/' : '') + uploaded.name);
    sources.push({ index: index + 1, role: item.role, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const promptIds = [];
  let artExtraction = null;
  const decode = (raw, expectedKeys) => { if (!expectedKeys) return parseCatalogObject(raw); const extracted = parseCatalogFields(raw, expectedKeys); artExtraction = extracted.proof; return extracted.value; };
  let dispatchClientId = '';
  const canonical = value => JSON.stringify(value,function(key,item){return item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item;});
  async function verifyResume(id,history,expected,refs) {
    const prior=history.prompt?.[2];
    const normalize=graph=>Object.fromEntries(Object.entries(graph||{}).map(([key,node])=>[key,{...node,inputs:{...node.inputs,...(node.class_type==='LoadImage'?{image:'same-verified-source'}:{})}}]));
    if(canonical(normalize(prior))!==canonical(normalize(expected)))throw new Error('UI分析恢复的模型、模板或要求已变化，未复用旧任务');
    const loaded=Object.entries(prior).filter(([,n])=>n.class_type==='LoadImage').sort((a,b)=>Number(a[0])-Number(b[0]));
    if(loaded.length!==refs.length)throw new Error('UI分析恢复的参考图数量不符');
    for(let i=0;i<loaded.length;i++){
      const name=String(loaded[i][1].inputs.image),slash=name.lastIndexOf('/');
      const response=await fetchImpl(base+'/view?'+new URLSearchParams({filename:name.slice(slash+1),subfolder:slash>=0?name.slice(0,slash):'',type:'input'}),{signal:AbortSignal.timeout(30000)});
      if(!response.ok||createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')!==sources[names.indexOf(refs[i])].sha256)throw new Error('UI分析恢复的原图字节不一致');
    }
  }
  async function execute(graph,refs,resumeId='') {
    if(promptIds.length>=7)throw new Error('UI分析已达到本次有界调用上限，本次未提交生图');
    if(resumeId){
      if(!/^[0-9a-f-]{36}$/i.test(resumeId))throw new Error('UI分析恢复任务ID无效');
      const history=(await json('/history/'+resumeId))[resumeId];
      if(!history?.status?.completed||history.status.status_str!=='success')throw new Error('UI分析恢复任务尚未成功完成');
      await verifyResume(resumeId,history,graph,refs);promptIds.push(resumeId);return history;
    }
    await idle();dispatchClientId='novaflow-ui-catalog-'+randomUUID();
    const sent=await json('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:dispatchClientId,prompt:graph})});
    if(!sent.prompt_id)throw new Error('UI分析提交状态未确认；请先核对运行时，本次不重复提交');
    promptIds.push(sent.prompt_id);const start=Date.now();
    while(Date.now()-start<timeoutMs){
      const history=(await json('/history/'+sent.prompt_id))[sent.prompt_id];
      if(history?.status?.status_str==='error')throw new Error('UI分析任务失败，任务ID：'+sent.prompt_id);
      if(history?.status?.completed)return history;
      await sleep(pollMs);
    }
    throw new Error('UI分析等待超时；请先核对任务 '+sent.prompt_id+' 的状态，勿重复提交');
  }
  const output=(history,id)=>{const text=history.outputs?.[id]?.text;return Array.isArray(text)?text.join(''):String(text||'');};
  async function analyze(system,context,refs,{resumeId='',finalId='',expectedKeys=null,observation=false,maxLength=6144}={}){
    const history=await execute(buildUiCatalogGraph({system,context,images:refs,observation,maxLength}),refs,resumeId);
    try{return decode(output(history,'4'),expectedKeys);}catch(error){
      const thinking=output(history,'5');
      if(!observation||!thinking||thinking.length>80000)throw error;
      // Only the actual model reasoning is retained. The suffix adds syntax,
      // never a grid cell, identity, function, layout relation or art phrase.
      const final=await execute(buildUiCatalogGraph({system,context,images:refs,observation,maxLength:1024,continuation:thinking}),refs,finalId);
      return decode(output(final,'4'),expectedKeys);
    }
  }
  let stage='grid-recognition',anchorRepaired=false;
  try {
    const resume=payload.uiCatalogResume||{},rules=await cpu({action:'recognition-rules'});
    if(resume.sourcePromptId)throw new Error('旧单段结构恢复记录不兼容分阶段识别；本次未提交生图');
    const refs=[names[layoutIndex]];
    const grid=await analyze(rules.gridRules,rules.gridTask,refs,{observation:true,maxLength:4096,resumeId:resume.gridPromptId,finalId:resume.gridFinalPromptId});
    stage='grid-validation';await cpu({action:'observed-grid-check',source:grid});
    stage='business-recognition';
    const business=await analyze(rules.businessRules,rules.businessTask,refs,{observation:true,maxLength:4096,resumeId:resume.businessPromptId,finalId:resume.businessFinalPromptId});
    stage='structure-validation';const inspection=await cpu({action:'inspect-observations',grid,business});
    let anchors;
    if(inspection.needsAnchorRepair){
      stage='structure-field-repair';
      anchors=await analyze(rules.anchorRules,rules.anchorTask,refs,{observation:true,maxLength:1024,resumeId:resume.anchorPromptId,finalId:resume.anchorFinalPromptId});
      anchorRepaired=true;
    }
    stage='structure-validation';
    const job=await cpu({action:'merge-observed-job',grid,business,request,...(anchors?{anchors}:{})});
    stage='theme-analysis';
    const catalog=await analyze(job.systemInstruction,{...job.context,references:sources.map(({index,role})=>({index,role}))},names,{resumeId:resume.artPromptId,expectedKeys:job.output_keys});
    stage='compile';const compiled=await cpu({action:'compile',case:job.case,catalog});
    return {prompt:compiled.prompt,negativePrompt:'',uiCatalog:{schema:UI_CATALOG_SCHEMA,model:UI_CATALOG_MODEL,recognitionMethod:'staged-observation-v1',promptIds,providerCallCount:promptIds.length,anchorRepaired,artExtraction,sources,inventory:compiled.proof.inventory,warnings:compiled.proof.business_guard.warnings,promptSha256:createHash('sha256').update(compiled.prompt).digest('hex')},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference:layoutIndex+1,visualMode:'theme-redesign',references:images.map((x,i)=>({index:i+1,role:x.role==='layout'?'layout':['style','color','material'].includes(x.role)?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  }catch(error){error.uiCatalogDiagnostics={stage,model:UI_CATALOG_MODEL,promptIds:[...promptIds],dispatchClientId,samplingSubmitted:false};throw error;}
}
