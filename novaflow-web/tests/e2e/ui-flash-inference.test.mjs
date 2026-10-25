import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildUiCatalogGraph, cpuCatalog, uiGraphInferenceInput, inferUiGraph, projectFlashUiGrid, projectFlashUiSource, projectFlashUiArt, planUiCatalog } from '../../worker/src/ui-catalog-planner.mjs';
import { planNativeUiDraft } from '../../worker/src/native-ui-draft.mjs';
import { planNaturalUiDraft as planQuick, buildNaturalDraftGraph } from '../../worker/src/natural-ui-draft.mjs';
import { planNaturalUiDraft as planComplete } from '../../worker/src/complete-ui-draft.mjs';

// Offline transport/contract verification only: recorded PE texts are fixtures,
// not claimed as fresh Flash quality or timing measurements.
const model = 'Swift1.5-Qwen3.8-Flash-Next-local-test';
const image = { role:'layout', dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAABACAIAAAD07OL5AAAAUklEQVR4nO3RsQ3AIBAEQUwhxI7df3GUsCQElmYKuJf2n/V+46Z5dX04cMAPkkRJoiRRkihJlCRKEiWJkkRJoiRRkihJlCRKEiWJkkRJovT/RBuGOwD4Dwr4YgAAAABJRU5ErkJggg==' };
const fixture = name => JSON.parse(readFileSync(new URL('../fixtures/ui-native-'+name+'.json',import.meta.url),'utf8'));
const cpu = value => cpuCatalog({ python:process.env.NOVAFLOW_TEST_PYTHON || 'python', serviceScript:fileURLToPath(new URL('../../../particle-editor-desktop/prompt-assistant-service.py',import.meta.url)) }, value);
const noComfy = async () => { throw new Error('Flash path touched Comfy'); };
const response = (text, number=1) => ({ text, requestId:'flash-'+number, model, usage:{completion_tokens:40}, timing:{requestMs:12} });
const actualFlash=JSON.parse(readFileSync(new URL('../fixtures/ui-flash-native-twenty-actual.json',import.meta.url),'utf8'));
const actualFlashV3=JSON.parse(readFileSync(new URL('../fixtures/ui-flash-native-twenty-format-v3-actual.json',import.meta.url),'utf8'));
const actualFlashV4=JSON.parse(readFileSync(new URL('../fixtures/ui-flash-native-twenty-region-v4-actual.json',import.meta.url),'utf8'));
const actualFlashV5=JSON.parse(readFileSync(new URL('../fixtures/ui-flash-native-twenty-source-json-v5-actual.json',import.meta.url),'utf8'));
const actualFlashArt=JSON.parse(readFileSync(new URL('../fixtures/ui-flash-native-art-actual-v1.json',import.meta.url),'utf8'));
const digest=text=>createHash('sha256').update(text).digest('hex');
function wireFor(record) {
  const calls=[];
  return { calls, infer:async input => {
    calls.push(input);
    let raw;
    if(input.stage==='native-art') raw=record.artRaw;
    else if(input.stage==='native-art-catalog-retry') raw=record.artRetryRaw;
    else raw=record.raws[input.stage.replace(/^source-/,'').replace('-focus','_focus')];
    assert.equal(typeof raw,'string','unexpected stage '+input.stage);
    if(input.stage.startsWith('native-art') && !raw.trim().startsWith('{')) raw='{'+raw;
    return response(raw,calls.length);
  } };
}

test('native message adapter preserves actual ImageBatch order, roles and bytes without ChatML',()=>{
  const graph=buildUiCatalogGraph({ system:'Keep identity and roles.', context:{references:[{index:1,role:'style'},{index:2,role:'identity'},{index:3,role:'material'}]}, images:['style','identity','material'], maxLength:4096 });
  // The connection, not numeric node order, defines the vision sequence.
  graph['15'].inputs.image1=['14',0]; graph['15'].inputs.image2=['13',0];
  const bytes={style:'data:image/png;base64,YQ==',identity:'data:image/jpeg;base64,Yg==',material:'data:image/webp;base64,Yw=='};
  const input=uiGraphInferenceInput(graph,name=>bytes[name],'design');
  assert.deepEqual(input.images.map(x=>x.dataUrl),[bytes.material,bytes.style,bytes.identity]);
  assert.equal(input.maxTokens,5120);assert.equal(input.budget.requestedMaxTokens,4096);assert.equal(input.temperature,1);assert.equal(input.stage,'design');
  assert.match(input.system,/完整顶层 JSON/);assert.match(input.user,/"role":"identity"/);
  assert.doesNotMatch(input.system+input.user,/<\|im_|<think>|<\|vision_|<\|image_/);
  assert.match(input.user,/图1：\[图片 1\]/);
  assert.equal(graph['3'].inputs.prompt.includes('<|im_start|>'),true,'CPU contract remains intact');
});

test('unsupported image chains, missing views, slot mismatches and stale thought continuations fail before infer',()=>{
  const graph=buildUiCatalogGraph({system:'s',context:'u',images:['current']});
  assert.throws(()=>uiGraphInferenceInput(graph,()=>undefined),/未绑定/);
  const mismatch=structuredClone(graph);mismatch['3'].inputs.prompt=mismatch['3'].inputs.prompt.replace('<|vision_start|><|image_pad|><|vision_end|>','');
  assert.throws(()=>uiGraphInferenceInput(mismatch,()=>image.dataUrl),/数量/);
  const processed=structuredClone(graph);processed['10'].class_type='ImageScale';
  assert.throws(()=>uiGraphInferenceInput(processed,()=>image.dataUrl),/处理节点/);
  const old=buildUiCatalogGraph({system:'s',context:'u',observation:true,continuation:'an old model thought'});
  assert.throws(()=>uiGraphInferenceInput(old,()=>image.dataUrl),/旧思考/);
  const cycle=structuredClone(graph);cycle['10']={class_type:'ImageBatch',inputs:{image1:['10',0],image2:['10',0]}};
  assert.throws(()=>uiGraphInferenceInput(cycle,()=>image.dataUrl),/循环/);
});

test('native JSON prefills and controls labels become output constraints, not answer continuations',()=>{
  const json=buildNaturalDraftGraph({system:'s',user:'u',design:true});
  assert.match(uiGraphInferenceInput(json,()=>undefined).system,/完整顶层 JSON/);
  const record=buildNaturalDraftGraph({system:'s',user:'u'});record['3'].inputs.prompt+='操作组件：';
  assert.match(uiGraphInferenceInput(record,()=>undefined).system,/操作组件：/);
});

test('Flash shares final-output and reasoning tokens, so UI reserves 1024 without shrinking the old output allowance',async()=>{
  for(const [requested,effective] of [[768,1792],[1024,2048],[4096,5120],[6144,7168],[8192,8192]]) {
    const graph=buildUiCatalogGraph({system:'s',context:'u',maxLength:requested});
    const input=uiGraphInferenceInput(graph,()=>undefined);
    assert.equal(input.maxTokens,effective);
    assert.deepEqual(input.budget,{requestedMaxTokens:requested,effectiveMaxTokens:effective,reasoningBudgetTokens:1024,policy:'ui-flash-output-plus-reasoning-v1'});
    const result=await inferUiGraph(async wire=>{assert.equal(wire.maxTokens,effective);assert.equal(wire.budget,undefined,'diagnostics not sent as a provider option');return response('{"x":"actual"}');},graph,{resolveImage:()=>undefined,stage:'test'});
    assert.equal(result.budget.requestedMaxTokens,requested);assert.equal(result.budget.effectiveMaxTokens,effective);
  }
});

test('actual native Flash grid tuple record is projected without changing any observed cell value/order/group',()=>{
  const record=actualFlash.records.find(x=>x.stage==='source-grid');assert.equal(digest(record.text),record.textSHA256);
  const before=JSON.parse(record.text),projected=projectFlashUiGrid(record.text,record.stage),after=JSON.parse(projected.text);
  assert.deepEqual(after.rows.map(row=>row.map(({type,text,group})=>[type,text,group])),before.rows);
  assert.deepEqual(after.shape,before.shape);assert.deepEqual(after.uncertain,before.uncertain);
  assert.equal(projected.syntaxProjection.convertedCells,20);assert.equal(projected.syntaxProjection.semanticEdits,0);assert.equal(projected.syntaxProjection.providerCalls,0);
  assert.equal(projected.syntaxProjection.nativeRaw,record.text);assert.equal(projected.syntaxProjection.nativeRawSHA256,record.textSHA256);
  assert.equal(projected.syntaxProjection.projectedRawSHA256,digest(projected.text));
  assert.deepEqual(projectFlashUiGrid(projected.text,record.stage),{text:projected.text},'dictionary output stays byte-identical');
  assert.deepEqual(projectFlashUiGrid(record.text,'native-art'),{text:record.text},'no projection in art or legacy PE');
});

test('tuple syntax projection refuses invalid field types/length/dimensions, leaves semantic unknowns for CPU rejection',async()=>{
  for(const cell of [['o',''],['o','',1,'extra'],['bad','',1],['o',{},1],['o','',0],['o','',1.5],['o','',true],['g','J','1']]) {
    assert.throws(()=>projectFlashUiGrid(JSON.stringify({shape:[1,1],rows:[[cell]],uncertain:[]}),'source-grid'),/格式或类型无效/);
  }
  assert.throws(()=>projectFlashUiGrid(JSON.stringify({shape:[2,2],rows:[[['o','',1],['o','',2]]],uncertain:[]}),'source-grid'),/行列不完整/);
  assert.throws(()=>projectFlashUiGrid(JSON.stringify({shape:[1,2],rows:[[['o','',1]]],uncertain:[]}),'source-grid'),/行列不完整/);
  const records=Object.fromEntries(actualFlash.records.map(x=>[x.stage.replace(/^source-/,'').replace('-focus','_focus'),x.text]));
  await assert.rejects(()=>cpu({action:'native-ui-project',raws:{...records,grid:projectFlashUiGrid('{"shape":[1,1],"rows":[[["u",null,null]]],"uncertain":["unreadable"]}','source-grid').text},ids:{natural:'n',grid:'g',controls:'c'},focusUsed:true,image}),/类别未知/);
});

test('actual region-v4 singleton grid object is unwrapped losslessly and never chooses among multiple records',()=>{
  const record=actualFlashV4.records.find(x=>x.stage==='source-grid'),original=JSON.parse(record.text),projection=projectFlashUiGrid(record.text,record.stage);
  assert.equal(digest(record.text),record.textSHA256);assert.equal(original.length,1);
  assert.deepEqual(JSON.parse(projection.text),original[0]);assert.equal(projection.syntaxProjection.convertedCells,0);
  assert.equal(projection.syntaxProjection.unwrappedRootObjects,1);assert.equal(projection.syntaxProjection.semanticEdits,0);
  assert.equal(projection.syntaxProjection.nativeRawSHA256,record.textSHA256);assert.equal(projection.syntaxProjection.projectedRawSHA256,digest(projection.text));
  for(const value of [[],[original[0],original[0]],[null],[[original[0]]],[{notGrid:true}]])assert.throws(()=>projectFlashUiGrid(JSON.stringify(value),record.stage),/顶层数组必须仅含一个完整网格对象/);
  assert.throws(()=>projectFlashUiGrid(JSON.stringify([{...original[0],rows:original[0].rows.slice(1)}]),record.stage),/行列不完整/);
  assert.deepEqual(projectFlashUiGrid("[{'shape':[1,1]}]",record.stage),{text:"[{'shape':[1,1]}]"},'never eval Python-looking output');
});

test('actual region-v4 grid syntax repair does not fabricate missing complete region evidence or rewrite the mistaken natural avatar claim',async()=>{
  const records=Object.fromEntries(actualFlashV4.records.map(x=>[x.stage,x]));
  assert.match(records['source-natural'].text,/无头像区/);
  await assert.rejects(()=>planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>{
    const record=records[input.stage];assert.ok(record,'no extra model call');return {text:record.text,requestId:record.requestId,model:record.model};
  }}),/区域先后缺少源依据/);
});

test('Flash source contracts separate literal text fields from regional keys; only numeric grid requires JSON',async()=>{
  const prepared=await cpu({action:'native-ui-prepare',image});
  for(const [kind,graph] of Object.entries(prepared.graphs)) {
    const input=uiGraphInferenceInput(graph,name=>prepared.views[name.match(/^__native_(.+)__$/)?.[1]],'source-'+kind);
    assert.doesNotMatch(input.system,/每格只放三个值|只输出以下五行|仅输出下面六行/);
    assert.doesNotMatch(input.user,/返回上述五行|返回六行/);
    if(kind==='grid')assert.match(input.system,/最外层必须是一个JSON对象，不能包在数组中/);
    else {assert.match(input.system,/固定字段文本/);assert.match(input.system,/\[FIELD region_order\]/);assert.match(input.system,/\[END\]/);assert.match(input.system,/不存在的区不列/);assert.doesNotMatch(input.system,/完整合法JSON对象|4行|5列|三只羊|3位格外展示/);}
  }
});

test('fixed native source fields preserve arbitrary UI quotes/newlines with per-field exact raw/span/hash evidence',async()=>{
  const order=['grid','characters','information','readouts','controls'],records=Object.fromEntries(actualFlashV5.records.map(x=>[x.stage,x])),texts={};
  for(const stage of ['source-natural','source-controls']){
    const old=JSON.parse(records[stage].text),fields=Object.keys(old).filter(key=>key!=='region_order');
    if(stage==='source-controls')old['操作组件']=old['操作组件'].replaceAll("'",'"');
    const raw='[FIELD region_order]\n'+order.join(' > ')+'\n'+fields.map(key=>'[FIELD '+key+']\n'+old[key]).join('\n')+'\n[END]';
    texts[stage]=raw;const projected=projectFlashUiSource(raw,stage),proof=projected.syntaxProjection;
    assert.equal(proof.nativeFormat,'fixed-field-text-v1');assert.equal(proof.semanticEdits,0);assert.equal(proof.providerCalls,0);
    for(const [key,evidence] of Object.entries(proof.fieldEvidence)){
      assert.equal(raw.slice(...evidence.span),evidence.raw);assert.equal(digest(evidence.raw),evidence.sha256);
      if(key!=='region_order')assert.equal(evidence.raw,old[key]);
    }
    assert.equal(proof.nativeRawSHA256,digest(raw));assert.equal(proof.projectedRawSHA256,digest(projected.text));
  }
  const output=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>({text:texts[input.stage]||records[input.stage].text,requestId:'cpu-text-'+input.stage,model})});
  assert.deepEqual(output.bundle.source.shape,[4,5]);assert.equal(output.bundle.source.mains.length,3);assert.equal(output.uiCatalog.sourceFocusCalls,0);
  assert.deepEqual(output.bundle.source.readouts.map(x=>x[0]),['amount','minus','amount','plus','amount']);assert.deepEqual(output.bundle.source.aux.map(x=>x[1]),['菜单','极速','自动','声音']);
  const multiline=texts['source-natural'].replace('[FIELD 业务文字]\n','[FIELD 业务文字]\n第一行原始文字"¥1000"\n');
  const proof=projectFlashUiSource(multiline,'source-natural').syntaxProjection;
  assert.match(proof.fieldEvidence['业务文字'].raw,/第一行原始文字"¥1000"\n/);assert.equal(multiline.slice(...proof.fieldEvidence['业务文字'].span),proof.fieldEvidence['业务文字'].raw);
  for(const raw of [texts['source-natural'].replace('[END]',''),texts['source-natural'].replace('[FIELD 网格]','[FIELD invented]'),texts['source-natural']+'\n[END]',texts['source-natural'].replace('[FIELD 网格]','[FIELD 区域关系]'),texts['source-natural'].replace('[FIELD 网格]\n4行5列，共20格','[FIELD 网格]\n')])assert.throws(()=>projectFlashUiSource(raw,'source-natural'),/字段/);
});

test('structured Flash observation projection preserves every field value and CPU business rules without a provider call',async()=>{
  // A protocol-shaped CPU fixture around archived observations, NOT a new
  // native-model result or a claimed successful fresh UI workflow.
  const records=Object.fromEntries(actualFlashV3.records.map(x=>[x.stage,x])),order=['grid','characters','information','readouts','controls'];
  const structured={};
  for(const stage of ['source-natural','source-controls']) {
    const fields=Object.fromEntries(records[stage].text.split('\n').filter(Boolean).map(line=>{const i=line.indexOf('：');return [line.slice(0,i),line.slice(i+1)];}));
    structured[stage]=JSON.stringify({region_order:order,...fields});
    const projected=projectFlashUiSource(structured[stage],stage),proof=projected.syntaxProjection;
    assert.equal(proof.semanticEdits,0);assert.equal(proof.providerCalls,0);assert.equal(proof.nativeRawSHA256,digest(structured[stage]));assert.equal(proof.projectedRawSHA256,digest(projected.text));
    assert.deepEqual(proof.observedFields,fields);assert.deepEqual(proof.regionOrder,order);
    for(const [key,value] of Object.entries(fields))assert.ok(projected.text.includes((key==='区域关系'?'区域位置依据':key)+'：'+value));
  }
  const calls=[],output=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>{
    calls.push(input.stage);return {text:structured[input.stage]||records[input.stage].text,requestId:'cpu-protocol-'+calls.length,model};
  }});
  assert.deepEqual(calls,['source-natural','source-grid','source-controls']);assert.equal(output.uiCatalog.sourceFocusCalls,0);
  assert.deepEqual(output.bundle.source.shape,[4,5]);assert.equal(output.bundle.source.rows.flat().length,20);assert.equal(output.bundle.source.mains.length,3);
  assert.deepEqual(output.bundle.source.readouts.map(x=>x[0]),['amount','minus','amount','plus','amount']);assert.deepEqual(output.bundle.source.aux.map(x=>x[1]),['菜单','极速','自动','声音']);
  assert.deepEqual(output.uiCatalog.sourceProof.nativeRegionOrderEvidence.map(x=>x.order),[order,order]);
  const invalid=JSON.parse(structured['source-controls']);
  for(const change of [{region_order:[]},{region_order:['grid','grid']},{region_order:['invented']},{'操作组件':null},{unexpected:'value'},{'操作组件':'a\nb'}])assert.throws(()=>projectFlashUiSource(JSON.stringify({...invalid,...change}),'source-controls'),/无效|不完整|未知/);
  const raws=Object.fromEntries(Object.entries(records).map(([stage,value])=>[stage.replace('source-',''),structured[stage]?projectFlashUiSource(structured[stage],stage).text:value.text]));
  // Real positional phrases are still present: they must not bypass the new
  // native array's agreement with independently projected CPU responsibilities.
  const wrongOrder=['characters','grid','information','readouts','controls'];
  raws.controls=projectFlashUiSource(JSON.stringify({...invalid,region_order:wrongOrder}),'source-controls').text;
  await assert.rejects(()=>cpu({action:'native-ui-project',raws,ids:{natural:'n',grid:'g',controls:'c'},focusUsed:false,image}),/结构化区域顺序与实际业务区域不一致/);
});

test('actual Flash source replay reaches CPU source projection with 20 cells/3 identities and no extra model focus',async()=>{
  const records=Object.fromEntries(actualFlash.records.map(x=>[x.stage,x])),calls=[];
  const result=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>{
    calls.push(input);const record=records[input.stage];assert.ok(record,'unexpected extra call '+input.stage);
    assert.equal(digest(record.text),record.textSHA256);
    if(input.stage==='source-grid')assert.match(input.system,/每格必须是含type、text、group三个键的JSON对象/);
    return {text:record.text,requestId:record.requestId,model:record.model};
  }});
  assert.deepEqual(calls.map(x=>x.stage),['source-natural','source-grid','source-controls']);
  assert.equal(result.uiCatalog.sourceFocusCalls,0);assert.deepEqual(result.bundle.source.shape,[4,5]);assert.equal(result.bundle.source.rows.flat().length,20);
  assert.equal(result.bundle.source.mains.length,3);assert.equal(Object.keys(result.bundle.source.portraits).length,3);
  assert.deepEqual(result.bundle.source.regions,['grid','characters','information','readouts','controls']);
  assert.deepEqual(result.bundle.source.aux.map(x=>x[1]),['菜单','极速','自动','声音']);assert.ok(result.bundle.source.rotation);
  assert.equal(result.bundle.source.shared.purchase,'BUY FREE GAMES');assert.equal(result.bundle.source.shared.display,'WIN 20.00');
  assert.deepEqual(result.bundle.source.readouts.filter(x=>x[0]==='amount').map(x=>x[1]),['¥1000','¥1000','¥1000']);
  assert.deepEqual(result.bundle.source.readouts.map(x=>x[0]),['amount','minus','amount','plus','amount']);
  const projection=result.uiCatalog.timings.find(x=>x.stage==='source-grid').syntaxProjection;
  assert.equal(projection.nativeRawSHA256,records['source-grid'].textSHA256);assert.equal(projection.convertedCells,20);
});

test('observed controls accepts original fullwidth/ASCII/mathematical minus without altering its literal or evidence span',()=>{
  const actual=actualFlash.records.find(x=>x.stage==='source-controls').text;
  const source=String.raw`import json,sys
from prompt_assistant.ui_native.controls import observed_controls
sys.stdout.reconfigure(encoding='utf-8')
sys.stdin.reconfigure(encoding='utf-8')
values=json.load(sys.stdin)
print(json.dumps([observed_controls(value,'actual-flash-controls') for value in values],ensure_ascii=False))`;
  const signs=['－','-','−'],raws=signs.map(sign=>actual.replaceAll('－',sign));
  const run=spawnSync(process.env.NOVAFLOW_TEST_PYTHON||'python',['-B','-c',source],{cwd:fileURLToPath(new URL('../../../particle-editor-desktop',import.meta.url)),input:JSON.stringify(raws),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const results=JSON.parse(run.stdout);
  results.forEach((value,index)=>{
    assert.deepEqual(value.readout_order.map(x=>x[0]),['amount','minus','amount','plus','amount']);
    assert.deepEqual(value.signs,[signs[index],'＋']);
    const evidence=value.sign_evidence.find(x=>x.kind==='minus');
    assert.equal(evidence.literal,signs[index]);assert.equal(evidence.evidence.quote,signs[index]);
    const [start,end]=evidence.evidence.span;
    assert.equal(raws[index].slice(start,end),signs[index]);assert.equal(evidence.evidence.raw_sha256,digest(raws[index]));
    assert.equal(value.amounts.length,3);
  });
});

test('paired business literal quotes preserve original spans and reject missing/mismatched delimiters without eval',()=>{
  const actual=actualFlashV5.records.find(x=>x.stage==='source-controls'),native=JSON.parse(actual.text),body=native['操作组件'];
  const raws=["'",'"','“','「'].map(open=>'操作组件：'+body.replace(/'([^']*)'/gu,(_,text)=>open+text+({"'":"'",'"':'"','“':'”','「':'」'}[open])));
  const invalid=['操作组件：金额¥1000、－、¥1000、＋、¥1000；主旋转按钮','操作组件：金额“¥1000\'；主旋转按钮',"操作组件：金额'¥1000；主旋转按钮"];
  const script=String.raw`import json,sys
from prompt_assistant.ui_native.controls import observed_controls,quoted_literals
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
value=json.load(sys.stdin)
print(json.dumps({'controls':[observed_controls(raw,'native-v5') for raw in value['raws']], 'invalid':[observed_controls(raw,'invalid') for raw in value['invalid']], 'apostrophes':quoted_literals("here's a label and '¥1000' and \"player's label\"")},ensure_ascii=False))`;
  const run=spawnSync(process.env.NOVAFLOW_TEST_PYTHON||'python',['-B','-c',script],{cwd:fileURLToPath(new URL('../../../particle-editor-desktop',import.meta.url)),input:JSON.stringify({raws,invalid}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  result.controls.forEach((value,index)=>{
    assert.deepEqual(value.readout_order.map(x=>x[0]),['amount','minus','amount','plus','amount']);assert.equal(value.amounts.length,3);assert.equal(value.purchase_observed,true);assert.equal(value.information_observed,true);
    assert.deepEqual(value.auxiliary_labels,['菜单','极速','自动','声音']);assert.equal(value.literalSyntax.rawTextUnchanged,true);assert.equal(value.literalSyntax.semanticEdits,0);
    for(const evidence of [...value.amounts.map(x=>x.evidence),...value.sign_evidence.map(x=>x.evidence),...value.auxiliary_evidence]){assert.equal(raws[index].slice(...evidence.span),evidence.quote);assert.equal(evidence.raw_sha256,digest(raws[index]));}
  });
  for(const value of result.invalid)assert.equal(value.amounts.length,0,'must not invent unquoted or unpaired values');
  assert.deepEqual(result.apostrophes.map(x=>x.literal),['¥1000',"player's label"]);
});

test('actual source-json-v5 observations pass full source projection after literal syntax parsing, without re-inference or focus',async()=>{
  const records=Object.fromEntries(actualFlashV5.records.map(x=>[x.stage,x])),calls=[];
  const output=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>{
    const record=records[input.stage];assert.ok(record,'no new focus or art inference');assert.equal(digest(record.text),record.textSHA256);calls.push(input.stage);
    return {text:record.text,requestId:record.requestId,model:record.model};
  }});
  assert.deepEqual(calls,['source-natural','source-grid','source-controls']);assert.equal(output.uiCatalog.sourceFocusCalls,0);
  const source=output.bundle.source;assert.deepEqual(source.shape,[4,5]);assert.equal(source.rows.flat().length,20);assert.equal(source.mains.length,3);assert.equal(Object.keys(source.portraits).length,3);
  assert.deepEqual(source.regions,['grid','characters','information','readouts','controls']);assert.equal(source.shared.purchase,'BUY FREE GAMES');assert.equal(source.shared.display,'WIN 20.00');
  assert.deepEqual(source.readouts.map(x=>x[0]),['amount','minus','amount','plus','amount']);assert.deepEqual(source.readouts.filter(x=>x[0]==='amount').map(x=>x[1]),['¥1000','¥1000','¥1000']);assert.deepEqual(source.aux.map(x=>x[1]),['菜单','极速','自动','声音']);assert.ok(source.rotation);
  const timing=output.uiCatalog.timings.find(x=>x.stage==='source-controls'),proof=output.uiCatalog.sourceProof.controlsFormatProjection.literalSyntax;
  assert.equal(timing.syntaxProjection.nativeRawSHA256,records['source-controls'].textSHA256);assert.equal(proof.singleQuotedLiterals.length,11);assert.equal(proof.semanticEdits,0);
  for(const value of proof.singleQuotedLiterals){assert.equal(timing.syntaxProjection.projectedRaw.slice(...value.evidence.span),value.literal);assert.equal(value.evidence.raw_sha256,timing.syntaxProjection.projectedRawSHA256);}
});

test('actual complete Flash art recovers only quoted literal syntax from actual expected keys, preserving native business conflicts',async()=>{
  assert.equal(digest(actualFlashArt.text),actualFlashArt.textSHA256);assert.equal(actualFlashArt.finishReason,'stop');
  assert.throws(()=>JSON.parse(actualFlashArt.text));
  const projected=projectFlashUiArt(actualFlashArt.text,'native-art',actualFlashArt.expectedOutputKeys),catalog=JSON.parse(projected.text),proof=projected.syntaxProjection;
  assert.deepEqual(Object.keys(catalog),actualFlashArt.expectedOutputKeys);assert.equal(proof.artWordEdits,0);assert.equal(proof.semanticEdits,0);assert.equal(proof.providerCalls,0);
  assert.equal(proof.nativeRawSHA256,actualFlashArt.textSHA256);assert.equal(proof.projectedRawSHA256,digest(projected.text));
  for(const [key,evidence]of Object.entries(proof.fieldEvidence)){assert.equal(actualFlashArt.text.slice(...evidence.span),catalog[key]);assert.equal(digest(catalog[key]),evidence.sha256);}
  assert.match(catalog.AUXILIARY_ART,/中文"菜单"/);assert.match(catalog.OBJECT1,/高约两格/);assert.match(catalog.OBJECT3,/直径两格/);
  const inspected=await cpu({action:'native-ui-inspect-art',raw:projected.text,keys:actualFlashArt.expectedOutputKeys});assert.deepEqual(inspected.missing,[]);
  for(const raw of ['{"ENVIRONMENT_ART":"not \\safely escaped","OBJECT1":"x"}', '{"ENVIRONMENT_ART":"x","invented":"y"}'])assert.equal(projectFlashUiArt(raw,'native-art',actualFlashArt.expectedOutputKeys).text,raw,'ambiguous/unknown legacy syntax stays with the strict CPU parser');
});

test('Flash art protocol derives dynamic FIELD keys from current context and serializes arbitrary quotes without provider schema promises',async()=>{
  const keys=['ENVIRONMENT_ART','OBJECT7','MAIN_CHARACTER2'],graph=buildUiCatalogGraph({system:'只输出紧凑扁平JSON，键恰好等于output_keys，每个值为非空中文字符串。不嵌套、不加字段、不附解释。字段写法如下：\n三种新主题应有自己的语言。',context:{context:{output_keys:keys}}});
  const input=uiGraphInferenceInput(graph,()=>undefined,'native-art');
  assert.deepEqual(input.artOutputKeys,keys);assert.match(input.system,/\[FIELD OBJECT7\]/);assert.doesNotMatch(input.system,/\[FIELD OBJECT1\]|三种新主题|紧凑扁平JSON/);
  assert.match(input.system,/不决定任何实例数量、占格、行列/);assert.equal(input.responseFormat,undefined);
  const values={ENVIRONMENT_ART:'完整原文"标题"，不替换字面。',OBJECT7:'名称：原名；造型：包含"引号"和\n原段落。',MAIN_CHARACTER2:'名称：角色；主体：角色原文。'};
  const raw=keys.map(key=>'[FIELD '+key+']\n'+values[key]).join('\n')+'\n[END]';
  const result=await inferUiGraph(async wire=>{assert.equal(wire.artOutputKeys,undefined);assert.equal(wire.responseFormat,undefined);return response(raw);},graph,{resolveImage:()=>undefined,stage:'native-art'});
  assert.deepEqual(JSON.parse(result.text),values);assert.equal(result.syntaxProjection.artWordEdits,0);
  for(const [key,evidence]of Object.entries(result.syntaxProjection.fieldEvidence))assert.equal(raw.slice(...evidence.span),values[key]);
  const partial=raw.replace('[FIELD OBJECT7]\n'+values.OBJECT7+'\n','');
  assert.deepEqual(Object.keys(JSON.parse(projectFlashUiArt(partial,'native-art',keys).text)),['ENVIRONMENT_ART','MAIN_CHARACTER2']);
  for(const text of [raw.replace('[END]',''),raw.replace('[FIELD OBJECT7]','[FIELD EXTRA]'),raw.replace('[FIELD OBJECT7]','[FIELD ENVIRONMENT_ART]'),raw+'\n[END]'])assert.throws(()=>projectFlashUiArt(text,'native-art',keys),/字段/);
  await assert.rejects(()=>inferUiGraph(async()=>{throw Error('must not call provider');},buildUiCatalogGraph({system:'x',context:{context:{}}}),{resolveImage:()=>undefined,stage:'native-art'}),/output_keys/);
});

test('actual reused source plus one archived Flash art compiles with original native values and visible two-cell conflicts, not a fresh inference',async()=>{
  const source=Object.fromEntries(actualFlashV5.records.map(x=>[x.stage,x])),calls=[];
  const result=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request},cpu,fetchImpl:noComfy,infer:async input=>{
    calls.push(input.stage);const record=input.stage==='native-art'?actualFlashArt:source[input.stage];assert.ok(record,'no hidden retry/focus');return {text:record.text,requestId:record.requestId,model:record.model};
  }});
  assert.deepEqual(calls,['source-natural','source-grid','source-controls','native-art']);assert.equal(result.uiCatalog.artRetryCalls,0);assert.equal(result.uiCatalog.sourceFocusCalls,0);
  assert.equal(Object.keys(result.uiCatalog.catalog).length,actualFlashArt.expectedOutputKeys.length);assert.equal(result.uiCatalog.extraction.artWordEdits,0);
  assert.deepEqual(result.uiCatalog.compileProof.functionalStyleProjection,[]);assert.deepEqual(result.uiCatalog.compileProof.sourceLiteralProjection,[]);
  assert.match(result.prompt,/每格恰好一个完整独立符号/);assert.match(result.prompt,/高约两格/);assert.match(result.prompt,/直径两格/);
  assert.equal(result.uiCatalog.timings.find(x=>x.stage==='native-art').syntaxProjection.nativeRawSHA256,actualFlashArt.textSHA256);
});

test('FIELD art omission uses existing single whole-catalog retry while retaining all first-complete native values',async()=>{
  const source=Object.fromEntries(actualFlashV5.records.map(x=>[x.stage,x])),catalog=JSON.parse(projectFlashUiArt(actualFlashArt.text,'native-art',actualFlashArt.expectedOutputKeys).text),keys=actualFlashArt.expectedOutputKeys;
  const fields=(selected)=>selected.map(key=>'[FIELD '+key+']\n'+catalog[key]).join('\n')+'\n[END]',calls=[];
  const result=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request},cpu,fetchImpl:noComfy,infer:async input=>{
    calls.push(input.stage);if(source[input.stage])return {text:source[input.stage].text,requestId:source[input.stage].requestId,model:actualFlashArt.model};
    return {text:fields(input.stage==='native-art'?keys.slice(0,-1):keys),requestId:'cpu-field-art-'+calls.length,model:actualFlashArt.model};
  }});
  assert.deepEqual(calls.slice(-2),['native-art','native-art-catalog-retry']);assert.equal(result.uiCatalog.artRetryCalls,1);
  assert.equal(result.uiCatalog.artRetryProof.firstCatalogValuesPreserved,true);assert.deepEqual(result.uiCatalog.catalog,catalog);
});

test('fresh format-v3 Flash records explicitly ground full region order without legacy phrase wording or an extra model call',async()=>{
  const records=Object.fromEntries(actualFlashV3.records.map(x=>[x.stage,x])),calls=[];
  const output=await planNativeUiDraft({payload:{images:[image],currentPrompt:fixture('twenty').request,uiAnalysisStage:'source-only'},cpu,fetchImpl:noComfy,infer:async input=>{
    calls.push(input.stage);const record=records[input.stage];assert.ok(record,'unexpected extra call '+input.stage);
    assert.equal(digest(record.text),record.textSHA256);return {text:record.text,requestId:record.requestId,model:record.model};
  }});
  assert.deepEqual(calls,['source-natural','source-grid','source-controls']);assert.equal(output.uiCatalog.sourceFocusCalls,0);
  assert.deepEqual(output.bundle.source.shape,[4,5]);assert.equal(output.bundle.source.mains.length,3);
  assert.deepEqual(output.bundle.source.readouts.map(x=>x[0]),['amount','minus','amount','plus','amount']);
  assert.deepEqual(output.bundle.source.aux.map(x=>x[1]),['菜单','极速','自动','声音']);
  const proof=output.uiCatalog.sourceProof.regionOrderStructuredEvidence,raw=records['source-controls'].text;
  assert.deepEqual(proof.order,['grid','characters','information','readouts','controls']);assert.equal(proof.rawSha256,digest(raw));assert.equal(proof.semanticEdits,0);
  assert.equal(raw.slice(...proof.span),proof.text);
  for(const item of proof.labels)assert.equal(raw.slice(...item.span),item.label);
  assert.equal(output.uiCatalog.timings.some(x=>x.syntaxProjection),false,'new model obeyed object schema; do not claim conversion happened');
});

test('new region-list route still rejects unordered, incomplete, unknown, repeated or contradictory source duties',async()=>{
  const expected=['grid','characters','information','readouts','controls'];
  const valid='区域关系：自上而下为网格区（4行5列）、角色装饰区（3位）、中奖条区、下注条区、按钮区。';
  const invalid=[valid.replace('自上而下为','包含'),valid.replace('自上而下为','从下到上为'),valid.replace('、按钮区',''),valid.replace('中奖条区','未知区域'),valid.replace('、下注条区','、中奖条区'),valid.replace('网格区（4行5列）、角色装饰区（3位）','角色装饰区（3位）、网格区（4行5列）'),valid.replace('4行5列）','4行5列')];
  const script=String.raw`import json,sys
from prompt_assistant.ui_native.evidence_source import explicit_region_order
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
value=json.load(sys.stdin)
print(json.dumps([explicit_region_order(raw,value['expected']) for raw in value['raws']],ensure_ascii=False))`;
  const process=spawnSync(globalThis.process.env.NOVAFLOW_TEST_PYTHON||'python',['-B','-c',script],{cwd:fileURLToPath(new URL('../../../particle-editor-desktop',import.meta.url)),input:JSON.stringify({expected,raws:[valid,...invalid]}),encoding:'utf8'});
  assert.equal(process.status,0,process.stderr);const values=JSON.parse(process.stdout);
  assert.deepEqual(values[0].order,expected);assert.ok(values.slice(1).every(x=>x===null));
  // A body lacking direction cannot bypass the integration gate just because
  // it contains all five familiar region labels.
  const raws=Object.fromEntries(actualFlashV3.records.map(x=>[x.stage.replace('source-',''),x.text]));
  raws.controls=raws.controls.replace(/^区域关系：[^\n]+/u,'区域关系：'+invalid[0].slice('区域关系：'.length));
  await assert.rejects(()=>cpu({action:'native-ui-project',raws,ids:{natural:'actual-v3-n',grid:'actual-v3-g',controls:'actual-v3-c'},focusUsed:false,image}),/区域先后缺少源依据/);
});

for(const name of ['twenty','nine','zodiac-actual']) test('Flash native '+name+' uses real CPU contracts, bounded focus/art retry and unchanged compiler',async()=>{
  const record=fixture(name),wire=wireFor(record);
  const output=await planNativeUiDraft({payload:{images:[image],currentPrompt:record.request},cpu,infer:wire.infer,fetchImpl:noComfy});
  assert.equal(output.uiCatalog.model,model);assert.equal(output.uiDraft.model,model);
  assert.equal(output.uiCatalog.analysisBackend,'strata');
  if(record.promptSha256)assert.equal(output.uiCatalog.promptSha256,record.promptSha256);
  else {assert.match(output.prompt,/严格5行6列共30格/);assert.match(output.prompt,/SUPER SCATTER/);}
  assert.equal(output.uiCatalog.providerCallCount,wire.calls.length);
  assert.deepEqual(wire.calls.slice(0,3).map(x=>x.images.length),[1,2,2]);
  const artCall=wire.calls.find(x=>x.stage==='native-art');assert.equal(artCall.images.length,0,'layout excluded from art');
  const expectedKeys=JSON.parse(artCall.user.slice(artCall.user.indexOf('{'))).context.output_keys;
  assert.deepEqual([...artCall.system.matchAll(/\[FIELD ([A-Z][A-Z0-9_]*)\]/gu)].map(x=>x[1]),expectedKeys,'FIELD output follows this actual20/9/zodiac contract, never a fixed14-key list');
  assert.deepEqual(Object.keys(output.uiCatalog.catalog),expectedKeys);assert.equal(artCall.artOutputKeys,undefined,'transport metadata not sent as provider arguments');
  assert.match(artCall.system,/不决定任何实例数量、占格、行列、空间比例或位置/);assert.match(artCall.system,/指定单格内完整独立呈现/);
  assert.equal(output.uiCatalog.sourceFocusCalls,name==='nine'?1:0);
  assert.equal(output.uiCatalog.artRetryCalls,name==='zodiac-actual'?1:0);
  assert.ok(output.uiCatalog.timings.every(x=>x.requestId.startsWith('flash-')&&x.timing.requestMs===12));
  assert.equal(output.uiCatalog.timings[0].budget.requestedMaxTokens,768);assert.equal(output.uiCatalog.timings[0].budget.effectiveMaxTokens,1792);
  for(const call of wire.calls)assert.doesNotMatch(call.system+call.user,/<\|im_|<think>|<\|vision_|<\|image_/);
});

test('Flash art receives only explicit ordered references with original reference roles; source-only cloud stays CPU-ready',async()=>{
  const record=fixture('twenty'),calls=[],style={role:'style',dataUrl:'data:image/png;base64,c3R5bGU='},identity={role:'identity',dataUrl:'data:image/jpeg;base64,aWRlbnRpdHk='};
  const wire=wireFor(record);
  const result=await planNativeUiDraft({payload:{images:[style,image,identity],currentPrompt:record.request},cpu,infer:async input=>{calls.push(input);return wire.infer(input);},fetchImpl:noComfy});
  const art=calls.find(x=>x.stage==='native-art'),context=JSON.parse(art.user.slice(art.user.indexOf('{'))).context;
  assert.deepEqual(art.images.map(x=>x.dataUrl),[style.dataUrl,identity.dataUrl]);
  assert.deepEqual(context.art_reference_roles,[{art_image_index:1,original_reference_index:1,role:'style'},{art_image_index:2,original_reference_index:3,role:'identity'}]);
  assert.equal(result.uiPlan.layoutReference,2);
  const sourceWire=wireFor(record),source=await planNativeUiDraft({payload:{images:[image],currentPrompt:record.request,uiAnalysisStage:'source-only'},cpu,infer:sourceWire.infer,fetchImpl:noComfy});
  assert.equal(sourceWire.calls.length,3);assert.equal(source.uiCatalog.designPending,true);assert.equal(source.uiCatalog.analysisProvider,'grok');assert.equal(source.uiCatalog.model,model);
  const cloud=await cpu({action:'native-ui-cloud',bundle:source.bundle,images:[image]});
  assert.equal(cloud.systemInstruction,source.bundle.job.systemInstruction);assert.equal(cloud.allowRetry,false);
});

test('Flash cancellation/error/model drift stop later stages without HTTP fallback or session lifecycle',async()=>{
  const record=fixture('twenty');let calls=0,cancelled=false;
  await assert.rejects(()=>planNativeUiDraft({payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:noComfy,isCancelled:()=>cancelled,infer:async()=>{calls++;cancelled=true;return response(record.raws.natural);}}),/中止/);
  assert.equal(calls,1);calls=0;
  await assert.rejects(()=>planNativeUiDraft({payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:noComfy,infer:async()=>{calls++;throw Error('Flash failed');}}),/Flash failed/);
  assert.equal(calls,1);
  const wire=wireFor(record);
  await assert.rejects(()=>planNativeUiDraft({payload:{images:[image],currentPrompt:record.request},cpu,fetchImpl:noComfy,infer:async input=>{const result=await wire.infer(input);return {...result,model:wire.calls.length>1?'other':model};}}),/实际模型发生变化/);
  assert.equal(wire.calls.length,2);
  await assert.rejects(()=>inferUiGraph(async()=>({text:'ok'}),buildUiCatalogGraph({system:'s',context:'u'}),{resolveImage:()=>undefined}),/凭据/);
});

test('staged catalog uses one injected session for grid/business/art and keeps CPU business compiler',async()=>{
  const answers=[{rows:1,columns:2,matrix:[['o|stone','g|B']]},{regions:['grid']},{ENVIRONMENT_ART:'清晨森林柔光。',OBJECT1:'名称：松果；造型：松果棕色鳞片层叠。',GLYPH_FAMILY:'木质字形清楚。'}],calls=[];
  const result=await planUiCatalog({payload:{images:[image],currentPrompt:'森林主题，保留布局'},cpu,fetchImpl:noComfy,infer:async input=>{calls.push(input);return response(JSON.stringify(answers[calls.length-1]),calls.length);}});
  assert.match(result.prompt,/1行2列共2格/);assert.equal(result.uiCatalog.model,model);assert.equal(result.uiCatalog.analysisBackend,'strata');assert.equal(result.uiCatalog.inventory.cells,2);
  assert.deepEqual(calls.map(x=>x.stage),['grid-recognition','business-recognition','theme-analysis']);
  assert.deepEqual(calls.map(x=>x.images.length),[1,1,1]);
  await assert.rejects(()=>planUiCatalog({payload:{images:[image],currentPrompt:'x',uiCatalogResume:{}},cpu,fetchImpl:noComfy,infer:async()=>{throw Error('must not infer');}}),/旧 PE/);
});

const natural='区域关系：上方人物，中部玩法网格，下方控制栏有主旋转环形箭头。\n网格：一行两列。\n角色关联：无头像，一名主角在网格上方。\n业务文字：无。\n玩法文字：无。';
test('quick draft keeps two calls and passes only neutral structure into text-only design',async()=>{
  const calls=[];
  const result=await planQuick({payload:{images:[image],currentPrompt:'森林主题，水彩风格'},cpu,fetchImpl:noComfy,infer:async input=>{calls.push(input);return response(calls.length===1?natural:JSON.stringify({rewritten_prompt:'模型原生完整设计稿。'}),calls.length);}});
  assert.equal(result.prompt,'模型原生完整设计稿。');assert.equal(result.uiDraft.model,model);
  assert.deepEqual(calls.map(x=>x.images.length),[1,0]);assert.match(calls[1].user,/一行两列/);assert.match(calls[1].system,/水彩风格/);
});

test('complete draft preserves explicit art roles and one bounded field repair through native JSON',async()=>{
  const calls=[],actions=[],art={role:'material',dataUrl:'data:image/png;base64,bWF0ZXJpYWw='};
  const mockCpu=async value=>{
    actions.push(value);
    if(value.action==='natural-draft-image')return {dataUrl:value.image.dataUrl,proof:{originalSha256:'original'}};
    if(value.action==='natural-draft-project')return {design_layout_zh:value.raw,warnings:[]};
    if(value.action==='complete-natural-job')return {systemInstruction:'完整成品任务',context:{carrier_bindings:{CARRIER1:{role:'information_display'}}},output_keys:['ENVIRONMENT_ART','CARRIER1'],case:{}};
    if(value.action==='inspect-complete-natural')return value.catalog.CARRIER1==='invalid'?{ok:false,invalid_fields:['CARRIER1'],errors:[{field:'CARRIER1',detail:'button is not information'}]}:{ok:true};
    if(value.action==='compile-complete-natural')return {prompt:value.catalog.ENVIRONMENT_ART+value.catalog.CARRIER1,proof:{artWordEdits:0}};
    throw Error('Unexpected CPU '+value.action);
  };
  const result=await planComplete({payload:{images:[image,art],currentPrompt:'全新主题'},cpu:mockCpu,fetchImpl:noComfy,infer:async input=>{calls.push(input);return response(calls.length===1?natural:JSON.stringify(calls.length===2?{ENVIRONMENT_ART:'原生环境设计',CARRIER1:'invalid'}:{CARRIER1:'原生修复显示面'}),calls.length);}});
  assert.equal(result.prompt,'原生环境设计原生修复显示面');assert.equal(result.uiDraft.model,model);assert.equal(result.uiCatalog.analysisBackend,'strata');
  assert.deepEqual(calls.map(x=>x.images.map(y=>y.dataUrl)),[[image.dataUrl],[art.dataUrl],[art.dataUrl]]);
  assert.equal(result.uiCatalog.fieldRepair.attempts,1);assert.equal(result.uiCatalog.fieldRepair.extraction.artWordEdits,0);
  const job=actions.find(x=>x.action==='inspect-complete-natural');assert.equal(job.catalog.ENVIRONMENT_ART,'原生环境设计');
  assert.match(calls[2].system,/完整顶层 JSON/);assert.doesNotMatch(calls[2].user,/invalid/);
});
