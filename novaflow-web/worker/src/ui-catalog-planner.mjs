// The verified PE model and CPU compiler behind the normal local UI assistant.
// No cloud provider, credential, model download or automatic retry lives here.
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

export const UI_CATALOG_SCHEMA = 'nf.ui.structure-catalog.v1';
export const UI_CATALOG_MODEL = 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const FLASH_REGION_LABELS = Object.freeze({ top_information:'顶部信息区', grid:'网格区', characters:'角色展示区', information:'信息栏', readouts:'金额调节栏', controls:'底部控件区' });
const FLASH_SOURCE_FIELDS = Object.freeze({
  'source-natural':['区域关系','网格','角色关联','业务文字','玩法文字'],
  'source-controls':['区域关系','网格','角色关联','操作组件','显示文字','玩法文字']
});

function flashSourceSystem(stage) {
  const fields=FLASH_SOURCE_FIELDS[stage];
  if(!fields)return null;
  const common='只观察当前界面的结构和真实业务职责，不重新设计，不描述旧人物物件的物种、衣服、颜色、材质或故事。灰色留白不属于界面。同一原图的全图与局部视图不能重复计数。看不清写“未知”，不猜补。\n'
    +'只返回固定字段文本，不把观察或界面字面包成JSON字符串，不用Markdown或解释。每个字段先单独一行写[FIELD 字段名]，下一行开始直接写该字段原文。标头顺序固定为'+['region_order',...fields].map(key=>'[FIELD '+key+']').join('、')+'，最后单独一行[END]。每个标头只出现一次，不省略字段；引号、货币、按钮字面在字段正文原样保留，无须转义。\n'
    +'region_order字段正文独立一行，用 > 连接从上到下实际存在的业务区域语义键：top_information=位于网格上方的独立业务显示，grid=玩法网格，characters=格外角色展示，information=购买/中奖/计数信息栏，readouts=金额读数与加减调节，controls=主操作与辅助按钮。不要加引号或括号。不存在的区不列，不能照抄此键列表作为顺序；同一大操作区中的信息栏、金额调节条和按钮行若各占一行，须分开依实际上下顺序列出。不能确认先后时正文写unknown并在区域关系说明未知。\n'
    +'区域关系：用实际位置证据解释region_order，不能只列区域名单。玩法文字：只抄可见特殊玩法标签及行列，不把物件印字当玩法。\n';
  if(stage==='source-natural')return common
    +'本阶段看完整原图，负责总区域和可见字面。网格：只写全图可确认的实际行数、列数和总格数，看不清则写未知，精确格表由局部网格任务核验。角色关联：仅记录可确认的格外主体数量和位置；格内头像在小图中看不清时写未知，不能据未看清断言不存在，头像格位由后续网格和局部核验负责。业务文字：逐字保留功能标签、数值、按钮字面、调节符号和自然位置；同值出现在不同载体时分别记录。独立字母数字可附格位，不列普通物件名单。';
  return common
    +'两张图分别是同一界面全图与底部放大。网格：只记录玩法区相对位置，不重新估算行列与逐格内容；精确格表由独立网格任务负责。角色关联：先写“N位格外展示”（N为实际数量），再写可确认的对应头像格位；头像与格外全身若是同一角色的两种展示不能算两人，不能确认关联时明确说明未知，不能凭全图没看清断言没有头像。\n'
    +'操作组件：按实际从上到下的行、每行从左到右列全购买按钮、非交互信息显示、金额、加减符号、主旋转和辅助按钮，说明同条连续关系；真实字面和符号用中文引号，各载体只抄一次，信息显示不能写成按钮。显示文字：只列操作组件未覆盖的固定业务显示/数值，无则写无。不逐格复述普通物件，不推断按钮点击结果。';
}

// CPU graph descriptions are retained as application contracts, not submitted
// to Comfy when the caller supplies the already-owned Flash session.
export function uiGraphInferenceInput(graph, resolveImage, stage) {
  const generators = Object.values(graph || {}).filter(node => node.class_type === 'TextGenerate');
  if (generators.length !== 1) throw new Error('UI 原生分析需要唯一的文本契约');
  const input = generators[0].inputs;
  const match = /^<\|im_start\|>system\n([\s\S]*?)<\|im_end\|>\n<\|im_start\|>user\n([\s\S]*?)<\|im_end\|>\n<\|im_start\|>assistant\n([\s\S]*)$/u.exec(input.prompt || '');
  if (!match || input.system_prompt || /<\|im_(?:start|end)\|>/u.test(match[1] + match[2] + match[3])) throw new Error('UI 原生分析模板不受支持');
  let [, system, user, suffix] = match;
  const nativeArt=stage==='native-art'||stage==='native-art-catalog-retry';
  // PE output prefills are format constraints, never a user ChatML message or
  // an already-written answer. Native inference must return the whole object.
  suffix = suffix.replace(/^<think>\s*<\/think>\s*/u, '').trim();
  if (suffix === '<think>') suffix = '';
  if (suffix === '{' || /^\{"[^"\n]+":"$/u.test(suffix)) {if(!nativeArt)system += '\n只返回完整顶层 JSON 对象，不省略开头的花括号或字段名，不输出思考或 Markdown。';}
  else if (suffix && !/[<>]/u.test(suffix) && suffix.length <= 100) system += '\n最终记录从“' + suffix + '”开始，返回完整记录，不省略该行首。';
  else if (suffix) throw new Error('UI 原生分析不接受旧思考续写');
  system=flashSourceSystem(stage)||system;
  if(FLASH_SOURCE_FIELDS[stage])user=user.replace('仅返回上述五行结构记录。','只返回指定的FIELD字段记录。').replace('返回六行最终识别记录一次。','只返回指定的FIELD字段记录。');
  if (stage === 'source-grid' || stage === 'source-grid-focus') {
    // This legacy PE sentence describes a tuple although its CPU consumer
    // requires a cell object. Replace the conflicting format instruction for
    // Flash rather than giving the model both incompatible representations.
    system = system.replace('每格只放三个值[type,text,group]。', '每格为一个JSON对象，固定包含type、text、group三个键。');
    system += '\n输出格式澄清：最外层必须是一个JSON对象，不能包在数组中。rows必须是二维数组，每格必须是含type、text、group三个键的JSON对象；[type,text,group]仅表示字段顺序，不是三元数组。逐格按实际观察填值，不推测或补齐格子、字面与分组。';
  }
  const ordered = [], visiting = new Set();
  const read = link => {
    if (!Array.isArray(link) || link.length !== 2 || link[1] !== 0) throw new Error('UI 原生参考连接无效');
    const id = String(link[0]), node = graph[id];
    if (!node || visiting.has(id)) throw new Error('UI 原生参考连接缺失或循环');
    visiting.add(id);
    if (node.class_type === 'ImageBatch') { read(node.inputs.image1); read(node.inputs.image2); }
    else if (node.class_type === 'LoadImage') {
      const name = String(node.inputs.image), value = resolveImage(name);
      const dataUrl = typeof value === 'string' ? value : value?.dataUrl;
      const parsed = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(dataUrl || '');
      if (!parsed || !Buffer.from(parsed[1], 'base64').length || Buffer.from(parsed[1], 'base64').length > 16 * 1024 * 1024) throw new Error('UI 原生参考字节未绑定或大小无效');
      ordered.push({ dataUrl, name: typeof value === 'object' && value.name ? value.name : name });
    } else throw new Error('UI 原生参考包含未绑定的图像处理节点');
    visiting.delete(id);
  };
  if (input.image) read(input.image);
  const marker = '<|vision_start|><|image_pad|><|vision_end|>';
  let index = 0;
  user = user.replaceAll(marker, () => '[图片 ' + (++index) + ']');
  if (index !== ordered.length || /<\|(?:vision|image)_/u.test(user)) throw new Error('UI 原生参考数量与正文职责不一致');
  let artOutputKeys;
  if(nativeArt){
    let context;try{context=JSON.parse(user.slice(user.indexOf('{'))).context;}catch{throw new Error('Flash UI 美术字段契约无法读取');}
    artOutputKeys=context?.output_keys;
    if(!Array.isArray(artOutputKeys)||!artOutputKeys.length||new Set(artOutputKeys).size!==artOutputKeys.length
      ||artOutputKeys.some(key=>typeof key!=='string'||!/^[A-Z][A-Z0-9_]*$/u.test(key)))throw new Error('Flash UI 美术output_keys无效；未猜补字段');
    system=system.replace('三种新主题应有自己的','当前主题应有自己的')
      .replace('只输出紧凑扁平JSON，键恰好等于output_keys，每个值为非空中文字符串。不嵌套、不加字段、不附解释。字段写法如下：','只输出output_keys指定的美术字段，不新增字段或业务。字段写法如下：')
      .replace('仅输出以下output_keys，每个值是非空中文字符串，字段顺序一致。','仅输出以下output_keys指定的美术字段，字段顺序一致。')
      .replace('仅输出一个完整JSON对象一次。最后一个字段结束并闭合根对象后立即结束回答。','仅输出一次完整FIELD目录，最后一个字段结束后以[END]结束回答。');
    system+='\n本轮实际输出协议：不用JSON包裹长文字。依output_keys顺序，每个字段先独立一行写[FIELD 字段名]，下一行直接写完整中文美术原文，结束后下一个字段标头另起一行；最后独立一行[END]。标头依次为'+artOutputKeys.map(key=>'[FIELD '+key+']').join('、')+'。各字段非空、只输出一次，不加其他字段。字面引号原样写，不需要JSON转义；名称/造型、名称/头像/全身仍在同一字段内按既定格式写成完整段落。\n美术仅负责本体外观，不决定任何实例数量、占格、行列、空间比例或位置；这些由源结构和CPU绑定。不要用几格、几行、几列、像素或尺寸倍数指定物件占地，每个普通符号必须在自己的指定单格内完整独立呈现。不要为了主题添加新人物、数值、按钮或额外显示。';
  }
  const requestedMaxTokens = Number(input.max_length), temperature = Number(input['sampling_mode.temperature']);
  if (!Number.isInteger(requestedMaxTokens) || requestedMaxTokens < 1 || requestedMaxTokens > 32768) throw new Error('UI 原生输出预算无效');
  // Flash low reasoning shares max_tokens with final content. Preserve the PE
  // final-output allowance while reserving the outer session's 1024-token thought budget.
  const maxTokens = Math.min(8192, requestedMaxTokens + 1024);
  return { system, user, images: ordered, maxTokens, ...(Number.isFinite(temperature) ? { temperature } : {}), stage,...(artOutputKeys?{artOutputKeys:[...artOutputKeys]}:{}),
    budget:{requestedMaxTokens,effectiveMaxTokens:maxTokens,reasoningBudgetTokens:1024,policy:'ui-flash-output-plus-reasoning-v1'} };
}

function fixedUiFields(raw,keys,{allowMissing=false}={}){
  const headers=[...raw.matchAll(/^\[FIELD ([^\]\r\n]+)\]\r?$/gmu)],end=[...raw.matchAll(/^\[END\]\r?$/gmu)];
  const indices=headers.map(match=>keys.indexOf(match[1]));
  if(!headers.length||(!allowMissing&&headers.length!==keys.length)||indices.some((at,index)=>at<0||(index>0&&at<=indices[index-1]))
    ||end.length!==1||end[0].index<=headers.at(-1).index||raw.slice(0,headers[0].index).trim()||raw.slice(end[0].index+end[0][0].length).trim())throw new Error('Flash UI 固定字段边界缺失、重复或顺序无效；未补写内容');
  const value={},fieldEvidence={};
  headers.forEach((match,index)=>{
    const start=match.index+match[0].length+(raw[match.index+match[0].length]==='\n'?1:0);
    let finish=(headers[index+1]||end[0]).index;
    if(raw[finish-1]==='\n')finish--;if(raw[finish-1]==='\r')finish--;
    const text=raw.slice(start,finish);
    if(!text.trim())throw new Error('Flash UI 固定字段为空：'+match[1]+'；未补写内容');
    value[match[1]]=text;fieldEvidence[match[1]]={raw:text,span:[start,finish],sha256:createHash('sha256').update(text).digest('hex')};
  });
  return {value,fieldEvidence};
}

export function projectFlashUiGrid(raw, stage) {
  if (stage !== 'source-grid' && stage !== 'source-grid-focus') return { text:raw };
  let value;
  try { value = JSON.parse(raw); } catch { return { text:raw }; }
  const unwrappedRoot = Array.isArray(value);
  if (unwrappedRoot) {
    if (value.length !== 1 || !value[0] || typeof value[0] !== 'object' || Array.isArray(value[0]) || !Array.isArray(value[0].rows)) throw new Error('Flash UI 网格顶层数组必须仅含一个完整网格对象；未选择或补造记录');
    value = value[0];
  }
  if (!value || typeof value !== 'object' || !Array.isArray(value.rows)) return { text:raw };
  const hasTuples = value.rows.some(row => Array.isArray(row) && row.some(Array.isArray));
  if (!unwrappedRoot && !hasTuples) return { text:raw };
  const shape=value.shape;
  if (!Array.isArray(shape) || shape.length!==2 || !shape.every(x=>Number.isSafeInteger(x)&&x>0)
      || value.rows.length!==shape[0] || value.rows.some(row=>!Array.isArray(row)||row.length!==shape[1])) throw new Error('Flash UI 网格三元记录与声明行列不完整；未补齐格子');
  let convertedCells=0;
  const rows=value.rows.map(row=>row.map(cell=>{
    if (!Array.isArray(cell)) return cell;
    const [type,text,group]=cell;
    if (cell.length!==3 || !['o','p','g','s','u'].includes(type)
        || !(typeof text==='string'||(type==='u'&&text===null))
        || !(Number.isSafeInteger(group)&&group>0||(type==='u'&&group===null))) throw new Error('Flash UI 网格三元记录格式或类型无效；未改写识别值');
    convertedCells++;
    return {type,text,group};
  }));
  const projectedRaw=JSON.stringify({...value,rows}),hash=text=>createHash('sha256').update(text).digest('hex');
  return {text:projectedRaw,syntaxProjection:{schema:'nf.ui.flash.grid-syntax-projection.v1',kind:unwrappedRoot?(hasTuples?'singleton-root-and-tuple-cell-to-object':'singleton-root-object'):'tuple-cell-to-object',
    nativeRaw:raw,nativeRawSHA256:hash(raw),projectedRaw,projectedRawSHA256:hash(projectedRaw),convertedCells,
    ...(unwrappedRoot?{unwrappedRootObjects:1}:{}),
    shape:[...shape],semanticEdits:0,providerCalls:0,cellOrderPreserved:true,groupValuesPreserved:true}};
}

export function projectFlashUiSource(raw,stage) {
  const fields=FLASH_SOURCE_FIELDS[stage];
  if(!fields)return {text:raw};
  let value,fieldEvidence;
  if(raw.trimStart().startsWith('[FIELD ')){
    ({value,fieldEvidence}=fixedUiFields(raw,['region_order',...fields]));
    value.region_order=value.region_order.split('>').map(key=>key.trim());
  }else{try{value=JSON.parse(raw);}catch{return {text:raw};}}
  // Archived prose/legacy named-field records retain their original strict
  // CPU checks. Only this explicit native contract receives a projection.
  if(!value||typeof value!=='object'||!Object.hasOwn(value,'region_order'))return {text:raw};
  if(Array.isArray(value)||Object.keys(value).some(key=>!['region_order',...fields].includes(key))
      ||fields.some(key=>typeof value[key]!=='string'||!value[key].trim()||(!fieldEvidence&&/[\r\n]/u.test(value[key]))))throw new Error('Flash UI 源观察字段不完整或类型无效；未补写观察');
  const order=value.region_order;
  if(!Array.isArray(order)||!order.length||new Set(order).size!==order.length||order.some(key=>!Object.hasOwn(FLASH_REGION_LABELS,key)))throw new Error('Flash UI 源区域顺序未知或无效；未推断区域职责');
  const lines=['区域关系：自上而下为'+order.map(key=>FLASH_REGION_LABELS[key]).join('、')+'。','结构化区域顺序JSON：'+JSON.stringify(order),'区域位置依据：'+value['区域关系'],...fields.filter(key=>key!=='区域关系').map(key=>key+'：'+value[key])];
  const projectedRaw=lines.join('\n'),hash=text=>createHash('sha256').update(text).digest('hex');
  return {text:projectedRaw,syntaxProjection:{schema:fieldEvidence?'nf.ui.flash.source-syntax-projection.v2':'nf.ui.flash.source-syntax-projection.v1',kind:fieldEvidence?'native-field-record-to-observation-record':'native-json-fields-to-observation-record',
    nativeRaw:raw,nativeRawSHA256:hash(raw),projectedRaw,projectedRawSHA256:hash(projectedRaw),regionOrder:[...order],
    regionLabels:Object.fromEntries(order.map(key=>[key,FLASH_REGION_LABELS[key]])),originalRegionEvidence:value['区域关系'],
    observedFields:Object.fromEntries(fields.map(key=>[key,value[key]])),...(fieldEvidence?{fieldEvidence,nativeFormat:'fixed-field-text-v1'}:{}),semanticEdits:0,providerCalls:0,fieldValuesPreserved:true}};
}

function knownFlatArtFields(raw,keys){
  const headers=[...raw.matchAll(/(?:\{|,)\s*"([^"\r\n\\]+)"\s*:\s*/gu)],end=raw.lastIndexOf('}');
  const indices=headers.map(match=>keys.indexOf(match[1]));
  if(!headers.length||headers[0].index!==raw.indexOf('{')||raw.slice(0,headers[0].index).trim()||raw.slice(end+1).trim()
    ||indices.some((at,index)=>at<0||(index>0&&at<=indices[index-1])))return null;
  const value={},fieldEvidence={};
  for(let index=0;index<headers.length;index++){
    const match=headers[index],opening=match.index+match[0].length,bound=(headers[index+1]?.index??end);
    if(raw[opening]!=='"')return null;
    let finish=bound;while(/\s/u.test(raw[finish-1]))finish--;
    if(raw[finish-1]!=='"')return null;
    const start=opening+1,text=raw.slice(start,finish-1);
    // This narrow compatibility path only re-serializes complete known string
    // fields. Existing escape sequences are ambiguous after malformed JSON;
    // they remain with the legacy strict parser rather than being decoded twice.
    if(!text.trim()||text.includes('\\'))return null;
    value[match[1]]=text;fieldEvidence[match[1]]={raw:text,span:[start,finish-1],sha256:createHash('sha256').update(text).digest('hex')};
  }
  return {value,fieldEvidence};
}

export function projectFlashUiArt(raw,stage,keys){
  if(stage!=='native-art'&&stage!=='native-art-catalog-retry')return {text:raw};
  if(!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length)throw new Error('Flash UI 美术输出缺少实际字段契约');
  let parsed,kind;
  if(raw.trimStart().startsWith('[FIELD ')){parsed=fixedUiFields(raw,keys,{allowMissing:true});kind='native-field-art-to-flat-json';}
  else{
    try{JSON.parse(raw);return {text:raw};}catch{}
    parsed=knownFlatArtFields(raw,keys);if(!parsed)return {text:raw};kind='known-flat-art-literal-quote-serialization';
  }
  const projectedRaw=JSON.stringify(parsed.value),hash=text=>createHash('sha256').update(text).digest('hex');
  return {text:projectedRaw,syntaxProjection:{schema:'nf.ui.flash.art-syntax-projection.v1',kind,
    nativeRaw:raw,nativeRawSHA256:hash(raw),projectedRaw,projectedRawSHA256:hash(projectedRaw),
    expectedKeys:[...keys],observedKeys:Object.keys(parsed.value),fieldEvidence:parsed.fieldEvidence,
    artWordEdits:0,semanticEdits:0,providerCalls:0,fieldValuesPreserved:true}};
}

export async function inferUiGraph(infer, graph, { resolveImage, stage, signal, isCancelled = () => false }) {
  const active = () => { if (signal?.aborted || isCancelled()) throw new Error('任务已中止；未提交后续分析或生图'); };
  active();
  const { budget, artOutputKeys, ...input } = uiGraphInferenceInput(graph, resolveImage, stage), started = Date.now();
  const result = await infer(input);
  active();
  if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('Flash UI 分析没有返回有效内容；未切换分析来源');
  if (!result.requestId || typeof result.model !== 'string' || !result.model.trim()) throw new Error('Flash UI 分析缺少实际模型或请求凭据');
  const projection=stage==='source-grid'||stage==='source-grid-focus'?projectFlashUiGrid(result.text,stage)
    :stage==='native-art'||stage==='native-art-catalog-retry'?projectFlashUiArt(result.text,stage,artOutputKeys):projectFlashUiSource(result.text,stage);
  return { ...result, ...projection, budget, wallMs: Date.now() - started };
}

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

export async function planUiCatalog({ baseUrl, payload, cpu, infer, fetchImpl = fetch, pollMs = 1000, timeoutMs = 600000, isCancelled = () => false }) {
  if (infer !== undefined && typeof infer !== 'function') throw new Error('UI 原生推理接口无效');
  if (infer && (payload.uiCatalogResume || payload.uiDraftResume)) throw new Error('Flash UI 分析不接受旧 PE 任务恢复');
  const active = () => { if (payload.signal?.aborted || isCancelled()) throw new Error('任务已中止；未提交后续分析或生图'); };
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
  active();
  if (!infer) {
    await idle();
    const info = await json('/object_info/CLIPLoader');
    if (!info.CLIPLoader?.input?.required?.clip_name?.[0]?.includes(UI_CATALOG_MODEL)) throw new Error('缺少已验证的 UI PE 分析模型；不会自动下载或更换模型');
  }
  const names = [], sources = [], nativeImages = new Map(), timings = [];
  let analysisModel = infer ? '' : UI_CATALOG_MODEL;
  for (const [index, item] of images.entries()) {
    const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(item.dataUrl || ''));
    if (!match) throw new Error('参考图数据无效');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('参考图大小无效');
    if (infer) { const name = 'native-ui-' + randomUUID(); nativeImages.set(name, item.dataUrl); names.push(name); }
    else {
      const form = new FormData(), ext = match[1].includes('jpeg') ? 'jpg' : match[1].split('/')[1];
      form.append('image', new Blob([bytes], { type: match[1] }), 'NF_UI_CATALOG_' + randomUUID() + '.' + ext); form.append('overwrite', 'false');
      const uploaded = await json('/upload/image', { method: 'POST', body: form });
      if (!uploaded.name) throw new Error('布局图上传未返回文件名');
      names.push((uploaded.subfolder ? uploaded.subfolder + '/' : '') + uploaded.name);
    }
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
    active();
    if(promptIds.length>=7)throw new Error('UI分析已达到本次有界调用上限，本次未提交生图');
    if(infer){
      const result=await inferUiGraph(infer,graph,{resolveImage:name=>nativeImages.get(name),stage,signal:payload.signal,isCancelled});
      if(analysisModel&&analysisModel!==result.model)throw new Error('UI 分析会话的实际模型发生变化；未提交生图');
      analysisModel=result.model;promptIds.push(result.requestId);
      timings.push({stage,promptId:result.requestId,requestId:result.requestId,model:result.model,wallMs:result.wallMs,budget:result.budget,...(result.syntaxProjection?{syntaxProjection:result.syntaxProjection}:{}),...(result.usage?{usage:result.usage}:{}),...(result.timing?{timing:result.timing}:{})});
      return {status:{completed:true,status_str:'success'},outputs:{4:{text:[result.text]}}};
    }
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
    active();stage='compile';const compiled=await cpu({action:'compile',case:job.case,catalog});
    return {prompt:compiled.prompt,negativePrompt:'',uiCatalog:{schema:UI_CATALOG_SCHEMA,model:analysisModel,...(infer?{analysisBackend:'strata',timings}:{}),recognitionMethod:'staged-observation-v1',promptIds,providerCallCount:promptIds.length,anchorRepaired,artExtraction,sources,inventory:compiled.proof.inventory,warnings:compiled.proof.business_guard.warnings,promptSha256:createHash('sha256').update(compiled.prompt).digest('hex')},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference:layoutIndex+1,visualMode:'theme-redesign',references:images.map((x,i)=>({index:i+1,role:x.role==='layout'?'layout':['style','color','material'].includes(x.role)?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  }catch(error){error.uiCatalogDiagnostics={stage,model:analysisModel,...(infer?{analysisBackend:'strata',timings}:{}),promptIds:[...promptIds],dispatchClientId,samplingSubmitted:false};throw error;}
}
