import test from 'node:test';
import assert from 'node:assert/strict';
import {foartUnsupportedMediaAnalysis,FOART_TOOL_SCHEMA} from '../../packages/shared/src/foart-tool-plan.mjs';
import {createCompanionChat} from '../../packages/shared/src/companion-chat.mjs';
test('native imports, reference binding and negated media generation remain executable',()=>{
  for(const message of [
    '导入JSON、ATLAS和PNG，用原生自动蒙皮，不用查看器，不生成图片或视频。',
    '把视频裁成前两秒，音量改到50%，保留画面内容。',
    '用本次图片、视频和音频作为多参引用生成一个2秒循环动画。',
    '分析这张参考图，用它制作一个视频。',
    '图片抠图，背景透明。不生成视频。'
  ])assert.equal(foartUnsupportedMediaAnalysis(message,[{kind:'video'}]),false,message);
  for(const message of ['帮我听一下这段音频讲了什么','分析上传视频的内容','看一下这段视频有什么问题','给视频生成字幕'])assert.equal(foartUnsupportedMediaAnalysis(message,[{kind:'video'}]),true,message);
});
test('online Foart tool metadata reaches planning but unsupported content analysis fails before billing',async()=>{
  let charges=0,calls=0;
  const service=createCompanionChat({provider:{model:'xai/grok-4.7',baseUrl:'https://provider.test/v1',apiKey:'fixture'},charge:async({run})=>{charges++;return run()},fetchImpl:async()=>{calls++;return Response.json({model:'xai/grok-4.7',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({schema:FOART_TOOL_SCHEMA,status:'reply',reply:'将调用原生工具，尚未执行。',operations:[]})}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}})}});
  const payload={requestId:'native-media-material-123',mode:'foart',promptLanguage:'en',history:[],message:'把这段视频裁成前两秒，保持其他参数',uploads:[{kind:'video',name:'source.mp4'}],foartContext:{schema:FOART_TOOL_SCHEMA,controls:[]}};
  const result=await service.reply({user:{id:'u'},payload});assert.equal(result.toolPlan.status,'reply');assert.equal(charges,1);assert.equal(calls,1);
  await assert.rejects(service.reply({user:{id:'u'},payload:{...payload,message:'分析这段视频的内容'}}),/暂不支持分析/);assert.equal(charges,1);assert.equal(calls,1);
});
