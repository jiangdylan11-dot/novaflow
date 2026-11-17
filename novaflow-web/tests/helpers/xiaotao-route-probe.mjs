// Where one sentence to 小桃 ends up, with nothing real behind it: no account, model or network.
// route(): 'planner' (tools decide and act), 'chat' (answer only), 'video-prompt' / 'drawing-prompt' /
// 'audio-prompt' (only the prompt box is rewritten), 'reply' (a canned line), 'error' (refused).
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeCreditConfig} from '../../packages/shared/src/feature-credits.mjs';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';

const read=name=>readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8');
export const MODEL='xai/grok-4.7';
const ROUTES={foartOperationStart:'planner',artAgentChat:'chat',promptAssistantVideoDraft:'video-prompt',onlineTextArtAvailableSync:'drawing-prompt',
  onlineVisionArtAvailableSync:'drawing-prompt',promptAssistantRewriteAudioPrompt:'audio-prompt'};

// page: 'drawing' | 'video' | 'audio' | 'other'; prompt: what the page's prompt box holds;
// task: what 小桃 finished earlier in this conversation; plan: what the planner answers.
// frame: the first picture in the video page's slot ({width,height}); controls: native fields the planner may set.
export async function probe({page='drawing',prompt='',task=null,genType='text_video',plans=[],pending=null,frame=null,controls=[],draftFailures=0,reading=null}={}) {
  const root={console:{...console,warn(){},debug(){}},crypto:webcrypto,AbortController,setTimeout,clearTimeout,btoa:value=>Buffer.from(value,'binary').toString('base64')};
  root.window=root;createContext(root);
  // reading: what the brain answers when it reads the turn (an object, or a function of the question); without it the rules decide.
  for(const file of ['xiaotao-prompt-source.js','xiaotao-upload.js',...(reading?['xiaotao-intent-reader.js']:[]),'xiaotao-art-agent.js'])runInContext(read(file),root);
  const rtState={active:page==='drawing',prompt:page==='drawing'?prompt:'',mode:'txt2img',count:1};
  root.__NovaFlowArtGenerate={state:rtState,capturePrompt(){},references:()=>[],capturePromptSourceGuard:()=>({isCurrent:()=>true}),
    captureContext:()=>({generationSurface:page==='drawing'?'drawing':'other',state:rtState,routeRevision:1,references:[]})};
  const media=page==='video'||page==='audio';
  root.NovaFlowAudioStudio={isOpen:()=>media,sub:()=>page,agentSettings:()=>({mode:'music',music:{text:page==='audio'?prompt:'',seconds:30},sfx:{text:'',seconds:2}}),
    captureTextReview:()=>({isCurrent:()=>true})};
  const video={mode:'minimax_h3_local',genType,prompt:page==='video'?prompt:'',h3References:[],h3:{custom:false,width:'480',height:'864'},
    referenceSlots:frame?[{key:'first_frame',label:'首帧',kind:'image',occupied:true,sourceId:'f1',name:'frame.png',...frame}]:[]};
  root.NovaFlowAiSequenceGeneration={capture:()=>video,resources:()=>[],setRequest(op){if(op.size)video.h3={custom:true,width:String(op.size.width),height:String(op.size.height)};}};
  root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow={hasDraft:()=>true,rememberDraft(){}};
  // The prompt-only path: the draft is written back into the page's box.
  root.NovaFlowMediaAgent={captureH3PromptSourceGuard:()=>({isCurrent:()=>true}),captureH3TextDraft:async()=>({request:{h3Mode:genType,durationSeconds:5},isCurrent:()=>true,
    applyDraft:async text=>{video.prompt=text;return {phase:'applied'};}})};
  root.NovaFlowFoartToolContract={FOART_TOOL_SCHEMA,validateFoartPlan,foartAnimationExportAllowed:()=>true,foartUnsupportedMediaAnalysis:()=>false};
  const executed=[];
  root.NovaFlowFoartTools={setUploads(){},capture:()=>({schema:FOART_TOOL_SCHEMA,controls,media:media?{active:true,sub:page,generation:{...video}}:undefined}),settlePending:async()=>null,images:async()=>[],
    execute:async op=>{executed.push(op);const action=op.operation?.action;
      return op.action==='media'?{action:'media',phase:'completed',results:[{action,target:op.operation.target,mode:genType,resources:action?.startsWith('generate_')?[{id:'r1',name:'out.mp4',seconds:1}]:[]}]}
        :{action:op.action,phase:'applied',message:'ok'};}};
  const config=normalizeCreditConfig({});
  Object.assign(config.xiaotao_online,{billing_scope:'operation',minimum_positive_credits:1,operation_text_chat_v3:true,operation_vision_chat_v3:true,operation_foart_open_v3:true,
    operation_foart_general_v3:true,operation_video_rewrite_v3:true,operation_audio_rewrite_v3:true,operation_art_v3:true,operation_ui_draft_v3:true});
  const policy={version:'sha256:'+'a'.repeat(64),expiresAt:Date.now()+60000,defaultModel:MODEL,config,models:[{id:MODEL,available:true}]};
  const touched=[],starts=[],questions=[];
  const base={captureFoartBillingOwner:()=>({owner:'test-user',current:()=>true}),captureFoartSessionGuard:()=>()=>true,onlineBusinessAvailableSync:()=>true,
    artAgentStop:async()=>({ok:true}),artAgentStatus:async()=>({ok:true}),companionPricing:async()=>({ok:true,policy}),foartOperationCancel:async()=>({ok:true}),
    artAgentChat:async payload=>reading&&/^你是 Foart 里的助手小桃/.test(payload.message)?(questions.push(payload.message),{ok:true,data:{reply:JSON.stringify(typeof reading==='function'?reading(payload.message):reading)}}):({ok:true,data:{reply:'好的。',history:[...payload.history,{role:'user',content:payload.message},{role:'assistant',content:'好的。'}]}}),
    foartOperationStart:async payload=>{starts.push(payload);const next=plans.shift();
      if(next?.busy)return {ok:false,providerSubmitted:false,errorCode:'operation-busy',error:'请求已发送或另一操作正在运行。'};
      return {ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:next?'act':'done',reply:next?'开始':'好的。',operations:next?[next]:[]},...(next?{foartOperationSession:{opaque:starts.length}}:{})}};},
    foartOperationResume:async()=>{const next=plans.shift();
      return {ok:true,data:{toolPlan:{schema:FOART_TOOL_SCHEMA,status:next?'act':'done',reply:next?'继续':'好的。',operations:next?[next]:[]},...(next?{foartOperationSession:{opaque:1}}:{})}};},
    promptAssistantVideoDraft:async()=>{if(draftFailures-->0)throw Error('upload failed');return {ok:true,quota:{settled_credits:1},draft:{status:'preview-only',applyAvailable:false,textOnly:true,displayPrompt:'【写好的视频稿】',modelPrompt:'draft',h3Mode:genType,durationSeconds:5}};},promptAssistantRewriteAudioPrompt:async()=>({ok:false,error:'stub'}),
    onlineTextArtAvailableSync:()=>false,onlineVisionArtAvailableSync:()=>false};
  const api=()=>new Proxy(base,{get(target,key){if(ROUTES[key])touched.push(key);return target[key];}});
  const bridge={clearPrepared(){},hasResult:()=>!!task,async captureChat(){return {artContext:{surface:page},images:[]};}};
  const c=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  c.setModel(MODEL);await c.refreshPricingPolicy();
  if(task)c.state.activeTask={executor:'foart',status:'completed',revisions:[],outputs:[],...task};
  touched.length=0;
  return {c,root,starts,executed,video,questions,
    async say(message){
      touched.length=0;const before=c.state.messages.length;
      const ok=await c.send(message);
      const first=touched[0],reply=c.state.messages.slice(before).filter(m=>m.role==='assistant').map(m=>m.content).join(' | ');
      return {ok,route:first?ROUTES[first]:c.state.error?'error':reply?'reply':'none',error:c.state.error,reply,status:c.state.status,
        prompts:executed.map(op=>op.operation?.prompt||op.prompt||''),ops:executed.splice(0).map(op=>op.operation?.action||op.action),sent:starts.at(-1)?.message||''};
    }};
}
export async function route(message,context){return (await probe(context)).say(message);}
