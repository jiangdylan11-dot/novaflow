import test from 'node:test';
import assert from 'node:assert/strict';
import {ART_EDIT_MODEL,ART_EDIT_SYSTEM,buildArtEditGraph} from '../../worker/src/art-edit-planner.mjs';

const context={userRequest:'图5用图2画风',references:[{source:2,roles:['style']},{source:5,roles:['subject']}],width:1280,height:960};
const build=extra=>buildArtEditGraph(['whole-style.png','whole-subject.png'],{...context,...extra});
const user=graph=>graph['3'].inputs.prompt.split('<|im_start|>user\n')[1].split('<|im_end|>')[0];

test('unclassified references use actual medium and material evidence without an assumed anime branch',()=>{
  const baseline=build({peStyleClass:'painterly'});
  for(const extra of [{},{peStyleClass:null},{peStyleClass:'other'},{peStyleClass:'animated-3d'},{peStyleClass:'unknown-cg'}]){
    const graph=build(extra),instruction=user(graph);
    assert.match(instruction,/实际媒介、表面材质/);
    assert.match(instruction,/体积与反射仅在参考实际可见时描述，不预先指定渲染类别/);
    assert.match(instruction,/不强加细线描边、赛璐璐或固定动漫脸/);
    assert.match(instruction,/五官塑造、实际媒介.*完整重构<image2>/);
    assert.match(instruction,/用户原始需求：<image2>用<image1>画风/);
    assert.deepEqual(graph,baseline,'unknown styles share the neutral material contract, not a guessed class');
  }
});

test('only explicit anime selects its approved drawing wording and preserves the PE execution protocol',()=>{
  const anime=build({peStyleClass:'anime'}),neutral=build({});
  assert.match(user(anime),/五官塑造、线条、上色、肤色色层、整体配色、光感与质感完整重构/);
  assert.match(user(anime),/只迁移绘画表现/);
  assert.doesNotMatch(user(anime),/不预先指定渲染类别|实际媒介、表面材质/);
  for(const graph of [anime,neutral]){
    assert.equal(graph['1'].inputs.clip_name,ART_EDIT_MODEL);
    assert.deepEqual(graph['10'].inputs,{image:'whole-style.png'});
    assert.deepEqual(graph['11'].inputs,{image:'whole-subject.png'});
    assert.deepEqual(graph['12'].inputs,{image1:['10',0],image2:['11',0]});
    const input=graph['3'].inputs;
    assert.equal(input.system_prompt,'');assert.equal(input.thinking,true);assert.equal(input.use_default_template,false);
    assert.equal(input.max_length,8192);assert.equal(input.mtp,'off');
    assert.equal(input['sampling_mode.temperature'],1);assert.equal(input['sampling_mode.top_p'],.95);
    assert.equal(input['sampling_mode.top_k'],20);assert.equal(input['sampling_mode.min_p'],0);assert.equal(input['sampling_mode.seed'],42);
    assert.ok(input.prompt.includes(ART_EDIT_SYSTEM));
    assert.match(input.prompt,/"rewritten_prompt".*"wh_ratio".*"ratio_follow"/);
    assert.match(user(graph),/wh_ratio必须为"1280:960"，ratio_follow为空字符串/);
    assert.ok(Object.values(graph).every(node=>!['ImageCrop','ImageScale'].includes(node.class_type)));
  }
  const withoutPrompt=graph=>({...graph,'3':{...graph['3'],inputs:{...graph['3'].inputs,prompt:''}}});
  assert.deepEqual(withoutPrompt(anime),withoutPrompt(neutral),'only instruction selection changes');
});
