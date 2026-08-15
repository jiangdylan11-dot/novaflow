import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const bundlePath = path.join(repoRoot, 'particle-editor', 'assets', 'index-BbIa-2NM.js')

let source = fs.readFileSync(bundlePath, 'utf8')

function occurrenceCount(haystack, needle) {
  let count = 0
  let cursor = 0
  while (true) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) return count
    count += 1
    cursor = index + needle.length
  }
}

function replaceOnce(search, replacement, label = search) {
  const count = occurrenceCount(source, search)
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`)
  source = source.replace(search, replacement)
}

function replaceOnceOrAlready(search, replacement, label = search) {
  const searchCount = occurrenceCount(source, search)
  const replacementCount = occurrenceCount(source, replacement)
  if (searchCount === 1 && replacementCount === 0) {
    source = source.replace(search, replacement)
    return
  }
  if (searchCount === 0 && replacementCount === 1) return
  throw new Error(
    `${label}: expected one source match or one already-patched match, found ${searchCount}/${replacementCount}`,
  )
}

function replaceOnceAfter(anchor, search, replacement, label = search) {
  const anchorIndex = source.indexOf(anchor)
  if (anchorIndex < 0) throw new Error(`${label}: anchor not found`)
  const before = source.slice(0, anchorIndex)
  const tail = source.slice(anchorIndex)
  const count = occurrenceCount(tail, search)
  if (count !== 1) throw new Error(`${label}: expected one match after anchor, found ${count}`)
  source = before + tail.replace(search, replacement)
}

function replaceFirstAfter(anchor, search, replacement, label = search) {
  const anchorIndex = source.indexOf(anchor)
  if (anchorIndex < 0) throw new Error(`${label}: anchor not found`)
  const matchIndex = source.indexOf(search, anchorIndex + anchor.length)
  if (matchIndex < 0) throw new Error(`${label}: match not found after anchor`)
  source = source.slice(0, matchIndex) + replacement + source.slice(matchIndex + search.length)
}

function replaceRange(startMarker, endMarker, replacement, label) {
  const startCount = occurrenceCount(source, startMarker)
  if (startCount !== 1) throw new Error(`${label}: start marker count is ${startCount}`)
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (end < 0) throw new Error(`${label}: end marker not found`)
  source = source.slice(0, start) + replacement + source.slice(end)
}

function applyPostAuditFixes() {
  replaceOnce(
    '"--novaflow-ai-reference-column-width":ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`?`calc(100% - 267px)`:Ve===`first_last`?`274px`:`132px`',
    '"--novaflow-ai-reference-column-width":(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 267px)`:Ve===`first_last`?`274px`:`132px`',
    'H3 initial multi-reference width',
  )
  replaceOnce(
    '"--novaflow-ai-reference-offset":ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`?`calc(100% - 257px)`:Ve===`first_last`?`284px`:`142px`',
    '"--novaflow-ai-reference-offset":(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 257px)`:Ve===`first_last`?`284px`:`142px`',
    'H3 initial multi-reference offset',
  )
  replaceOnce(
    '):(i(`local`),[`image_video`,`first_last`].includes(a)||nfSetAiSeqGenType?.(`image_video`),g(`http://127.0.0.1:8188`),x(n.high||``),C(n.low||``))',
    '):(fetch(`http://127.0.0.1:8189/free`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({unload_models:!0,free_memory:!0})}).catch(()=>{}),window.electronAPI?.minimaxH3RuntimeStop?.({timeoutMs:3e4}).catch?.(()=>{}),i(`local`),[`image_video`,`first_last`].includes(a)||nfSetAiSeqGenType?.(`image_video`),g(`http://127.0.0.1:8188`),x(n.high||``),C(n.low||``))',
    'release H3 memory when returning to Wan',
  )
  replaceOnce(
    'if(nfH3Mode&&window.electronAPI?.minimaxH3RuntimeEnsureStarted){',
    'if(nfH3Mode){try{await fetch(`http://127.0.0.1:8188/free`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({unload_models:!0,free_memory:!0})})}catch{}}if(nfH3Mode&&window.electronAPI?.minimaxH3RuntimeEnsureStarted){',
    'release Wan memory before H3 generation',
  )
}

function applyRuntimeIsolationFixes() {
  replaceOnce(
    'function Vs(e){let t=e=>String(e||``).trim().replace(/\\/+$/,``),n=(0,_.useRef)(new Set),r=(0,_.useRef)(!0);',
    'function Vs(e){let t=e=>String(e||``).trim().replace(/\\/+$/,``),n=(0,_.useRef)(new Set),r=(0,_.useRef)(!0),nfAiSeqResolvedBaseRef=(0,_.useRef)(``);',
    'per-run AI sequence Runtime endpoint',
  )
  for (const [anchor, label] of [
    [',f=async(n,r)=>{', 'JSON request endpoint'],
    [',p=async(n,r)=>{', 'binary request endpoint'],
    [',y=async(n,r)=>{', 'upload endpoint'],
    [',E=async n=>{', 'websocket endpoint'],
  ]) {
    replaceFirstAfter(
      anchor,
      'let i=t(e.aiComfyBaseUrl)',
      'let i=t(nfAiSeqResolvedBaseRef.current||(e.aiSeqMode===`minimax_h3_local`?`http://127.0.0.1:8189`:e.aiComfyBaseUrl))',
      label,
    )
  }
  replaceOnce(
    't===`minimax_h3_local`?(i(`minimax_h3_local`),nfSetAiSeqGenType?.(`text_video`),g(`http://127.0.0.1:8189`))',
    't===`minimax_h3_local`?(i(`minimax_h3_local`),nfSetAiSeqGenType?.(`text_video`))',
    'H3 model selection must not overwrite the shared Wan Runtime URL',
  )
  replaceOnceAfter(
    ',O=async n=>{',
    'try{localStorage.setItem(`comfyui_last_connected_url`,t)}catch{}return e.setAiComfyBaseUrl(t),e.setAiComfyStatus',
    'nfAiSeqResolvedBaseRef.current=t;if(!nfH3Runtime){try{localStorage.setItem(`comfyui_last_connected_url`,t)}catch{}e.setAiComfyBaseUrl(t)}return e.setAiComfyStatus',
    'H3 probe must not overwrite the shared Wan Runtime URL',
  )
  replaceOnce(
    'return}if(nfH3Mode){try{await fetch(`http://127.0.0.1:8188/free`',
    'return}if(!nfH3Mode){try{await fetch(`http://127.0.0.1:8189/free`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({unload_models:!0,free_memory:!0})})}catch{}try{await window.electronAPI?.minimaxH3RuntimeStop?.({timeoutMs:3e4})}catch{}}if(nfH3Mode){try{await fetch(`http://127.0.0.1:8188/free`',
    'Wan generation must release a residual H3 Runtime',
  )
}

function applyReferenceMediaContractFixes() {
  replaceOnceAfter(
    'if(nfH3Mode&&a===`multi_reference`){',
    'if(n?.objectUrl){if(t!==e.aiSeqRunTokenRef.current)return;',
    'if(n?.objectUrl){if(window.electronAPI?.aiSeqProbeVideoMeta){let nfH3VideoBlob=await(await fetch(String(n.objectUrl||``))).blob(),nfH3VideoMeta=await v(nfH3VideoBlob,n.fileName||`reference_video.mp4`),nfH3VideoFps=Number(nfH3VideoMeta?.fps||0),nfH3VideoFrames=Number(nfH3VideoMeta?.frames||0);if(!nfH3VideoMeta||!Number.isFinite(nfH3VideoFps)||nfH3VideoFps<=0||Math.abs(nfH3VideoFps-24)>.05){let nfH3VideoFpsLabel=Number.isFinite(nfH3VideoFps)&&nfH3VideoFps>0?`${Math.round(nfH3VideoFps*1e3)/1e3} FPS`:`无法识别`;e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考视频必须为 24 FPS（当前：${nfH3VideoFpsLabel}）`});return}if(!Number.isFinite(nfH3VideoFrames)||nfH3VideoFrames<5){let nfH3VideoFrameLabel=Number.isFinite(nfH3VideoFrames)&&nfH3VideoFrames>0?`${Math.round(nfH3VideoFrames)} 帧`:`无法识别`;e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考视频至少需要 5 帧（当前：${nfH3VideoFrameLabel}）`});return}}if(t!==e.aiSeqRunTokenRef.current)return;',
    'H3 reference video must be 24 FPS and at least five frames',
  )
}

function applyFollowupParameterAndLayoutFixes() {
  replaceOnce(
    '}),Fr=Ja(`ai_seq_prompt`,{recentCap:6})',
    '}),[nfH3DurationInput,nfSetH3DurationInput]=(0,_.useState)(`5`),nfH3WorkflowApi=()=>window.NovaFlowAiSequenceMiniMaxH3Workflow,nfH3Resolution=()=>{try{return nfH3WorkflowApi()?.matchResolution?.({width:yt,height:xt})||{aspectRatio:`9:16`,orientation:`portrait`,megapixels:.4,width:480,height:864,exact:!1}}catch{return{aspectRatio:`9:16`,orientation:`portrait`,megapixels:.4,width:480,height:864,exact:!1}}},nfApplyH3Resolution=(e,t)=>{try{let n=nfH3WorkflowApi()?.calculateResolution?.({aspectRatio:e,megapixels:t});n&&(bt(n.width),St(n.height),Pt(String(n.width)),It(String(n.height)))}catch(e){on({state:`error`,message:String(e?.message||e)})}},nfH3Duration=()=>{try{return nfH3WorkflowApi()?.normalizeDuration?.(nfH3DurationInput)||{requestedDuration:5,frames:124,actualDuration:124/24}}catch{return nfH3WorkflowApi()?.normalizeDuration?.(5)||{requestedDuration:5,frames:124,actualDuration:124/24}}},nfCommitH3Duration=e=>{let t=Number(e),n=Number.isFinite(t)?Math.max(1,Math.min(15,Math.round(t*100)/100)):5,r=nfH3WorkflowApi()?.normalizeDuration?.(n)||{requestedDuration:n,frames:124,actualDuration:124/24};nfSetH3DurationInput(String(r.requestedDuration)),wt(r.frames),Rt(String(r.frames));return r},nfH3ModeSyncEffect=(0,_.useEffect)(()=>{if(ze!==`minimax_h3_local`)return;let e=nfH3Resolution();e.exact||nfApplyH3Resolution(`9:16`,.4),nfCommitH3Duration(nfH3DurationInput)},[ze]),Fr=Ja(`ai_seq_prompt`,{recentCap:6})',
    'H3 UI parameter state and module adapters',
  )

  replaceOnce(
    '"--novaflow-ai-reference-column-width":(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 267px)`:Ve===`first_last`?`274px`:`132px`',
    '"--novaflow-ai-reference-column-width":ze===`minimax_h3_local`&&Ve===`text_video`?`0px`:(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 267px)`:Ve===`first_last`?`274px`:`132px`',
    'H3 text-to-video reference width collapse',
  )
  replaceOnce(
    '"--novaflow-ai-reference-offset":(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 257px)`:Ve===`first_last`?`284px`:`142px`',
    '"--novaflow-ai-reference-offset":ze===`minimax_h3_local`&&Ve===`text_video`?`0px`:(ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`||ze===`minimax_h3_local`&&Ve===`multi_reference`)?`calc(100% - 257px)`:Ve===`first_last`?`284px`:`142px`',
    'H3 text-to-video settings offset collapse',
  )
  replaceOnce(
    'maxWidth:`var(--novaflow-ai-reference-column-width, 132px)`,display:`flex`,flexDirection:`column`,gap:10',
    'maxWidth:`var(--novaflow-ai-reference-column-width, 132px)`,display:ze===`minimax_h3_local`&&Ve===`text_video`?`none`:`flex`,flexDirection:`column`,gap:10',
    'H3 text-to-video empty reference column visibility',
  )

  const settingsStart = 'children:ze===`minimax_h3_local`?(0,X.jsxs)(X.Fragment,{children:['
  const settingsEnd = ']}):ze===`local`?'
  const settingsReplacement = settingsStart +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`画幅`}),' +
    '(0,X.jsxs)(yn,{"data-novaflow-h3-orientation":`1`,value:nfH3Resolution().orientation,onChange:e=>{let t=String(e.target.value||`portrait`),n=t===`landscape`?`16:9`:t===`square`?`1:1`:`9:16`;nfApplyH3Resolution(n,nfH3Resolution().megapixels)},style:{width:76,height:30,padding:`0 8px`},children:[' +
    '(0,X.jsx)(`option`,{value:`portrait`,children:`竖屏`}),(0,X.jsx)(`option`,{value:`landscape`,children:`横屏`}),(0,X.jsx)(`option`,{value:`square`,children:`方形`})]}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`比例`}),' +
    '(0,X.jsx)(yn,{"data-novaflow-h3-aspect":`1`,value:nfH3Resolution().aspectRatio,onChange:e=>nfApplyH3Resolution(String(e.target.value||`9:16`),nfH3Resolution().megapixels),style:{width:72,height:30,padding:`0 8px`},children:(nfH3WorkflowApi()?.ASPECT_RATIOS||[]).filter(e=>e.orientation===nfH3Resolution().orientation).map(e=>(0,X.jsx)(`option`,{value:e.value,children:e.label},e.value))}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`像素`}),' +
    '(0,X.jsx)(yn,{"data-novaflow-h3-megapixels":`1`,value:String(nfH3Resolution().megapixels),onChange:e=>nfApplyH3Resolution(nfH3Resolution().aspectRatio,Number(e.target.value)||.4),style:{width:78,height:30,padding:`0 8px`},children:(nfH3WorkflowApi()?.MEGAPIXEL_OPTIONS||[.2,.3,.4,.5,.6,.7,.8,.9,.98]).map(e=>(0,X.jsx)(`option`,{value:String(e),children:`${e} MP`},String(e)))}),' +
    '(0,X.jsx)(`div`,{"data-novaflow-h3-output-size":`1`,style:{fontSize:11,color:`rgba(255,255,255,0.62)`,whiteSpace:`nowrap`},children:`${nfH3Resolution().width} × ${nfH3Resolution().height}`}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`时长`}),' +
    '(0,X.jsx)(_n,{"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:15,step:.01,value:nfH3DurationInput,onChange:e=>nfSetH3DurationInput(String(e.target.value||``)),onBlur:()=>nfCommitH3Duration(nfH3DurationInput),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),' +
    '(0,X.jsx)(`div`,{"data-novaflow-h3-duration-output":`1`,style:{fontSize:11,color:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`实际 ${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS / 20 步`}),' +
    '(0,X.jsxs)(`div`,{style:{display:`flex`,gap:8,alignItems:`center`},children:[' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.60)`},children:`随机种子`}),' +
    '(0,X.jsxs)(`button`,{"data-novaflow-ai-state-toggle":Gt?`on`:`off`,type:`button`,onClick:()=>Kt(e=>!e),style:{position:`relative`,display:`inline-flex`,alignItems:`center`,width:34,minWidth:34,height:18,padding:0,border:0,borderRadius:999,background:Gt?`#1ea672`:`#222222`,color:`transparent`,cursor:`pointer`,overflow:`hidden`},children:[' +
    '(0,X.jsx)(`span`,{style:{position:`absolute`,top:`50%`,left:Gt?20:4,width:10,height:10,borderRadius:999,background:Gt?`#e8e8e8`:`#8f98a3`,transform:`translateY(-50%)`}}),Gt?`on`:`off`]}),!Gt&&(0,X.jsx)(_n,{inputMode:`numeric`,value:Yt,onChange:e=>Xt(String(e.target.value||``).replace(/[^0-9]/g,``)),style:{width:70,height:26,padding:`4px 8px`,textAlign:`right`}})]})'
  replaceRange(settingsStart, settingsEnd, settingsReplacement, 'H3 resolution and duration controls')

  replaceOnce(
    'width:[`480x864`,`864x480`,`768x1344`,`1344x768`].includes(`${e.aiSeqOutW}x${e.aiSeqOutH}`)?e.aiSeqOutW:480,height:[`480x864`,`864x480`,`768x1344`,`1344x768`].includes(`${e.aiSeqOutW}x${e.aiSeqOutH}`)?e.aiSeqOutH:864,length:[124,192,243,362].includes(Number(e.aiSeqOutFrames))?Number(e.aiSeqOutFrames):124',
    'aspectRatio:nfH3Workflow.matchResolution({width:Number(e.aiSeqOutW),height:Number(e.aiSeqOutH)}).aspectRatio,megapixels:nfH3Workflow.matchResolution({width:Number(e.aiSeqOutW),height:Number(e.aiSeqOutH)}).megapixels,durationSeconds:Math.max(1,Math.min(15,Number(e.aiSeqOutFrames)/24))',
    'H3 workflow dispatch must accept module-normalized parameters',
  )

  const mediaStart = 'if(nfH3Mode&&a===`multi_reference`){let n=e.aiSeqJimengVideoRef;'
  const mediaEnd = '}if(t!==e.aiSeqRunTokenRef.current)return;let c='
  const mediaReplacement = 'if(nfH3Mode&&a===`multi_reference`){let n=e.aiSeqJimengVideoRef,r=e.aiSeqJimengAudioRef;' +
    'if(r?.objectUrl&&!o.length&&!n?.objectUrl){e.setAiSeqJob({state:`error`,message:`MiniMax H3 声音不能作为唯一参考，请同时添加参考图或参考视频`});return}' +
    'if(n?.objectUrl){let nfH3VideoBlob=await(await fetch(String(n.objectUrl||``))).blob(),nfH3VideoMeta=await v(nfH3VideoBlob,n.fileName||`reference_video.mp4`),nfH3VideoFps=Number(nfH3VideoMeta?.fps),nfH3VideoFrames=Number(nfH3VideoMeta?.frames),nfH3VideoDuration=Number(nfH3VideoMeta?.durationSec);' +
    'if(!nfH3VideoMeta||!Number.isFinite(nfH3VideoFps)||nfH3VideoFps<=0||Math.abs(nfH3VideoFps-24)>.05){let nfH3VideoFpsLabel=Number.isFinite(nfH3VideoFps)&&nfH3VideoFps>0?`${Math.round(nfH3VideoFps*1e3)/1e3} FPS`:`无法识别`;e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考视频必须为 24 FPS（当前：${nfH3VideoFpsLabel}）`});return}' +
    'if(!Number.isFinite(nfH3VideoDuration)||nfH3VideoDuration<2||nfH3VideoDuration>15){let nfH3VideoDurationLabel=Number.isFinite(nfH3VideoDuration)&&nfH3VideoDuration>0?`${Math.round(nfH3VideoDuration*100)/100} 秒`:`无法识别`;e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考视频时长必须为 2–15 秒（当前：${nfH3VideoDurationLabel}）`});return}' +
    'if(Number.isFinite(nfH3VideoFrames)&&nfH3VideoFrames>0&&nfH3VideoFrames<5){e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考视频至少需要 5 帧（当前：${Math.round(nfH3VideoFrames)} 帧）`});return}' +
    'if(t!==e.aiSeqRunTokenRef.current)return;e.setAiSeqJob({state:`running`,message:`上传参考视频：${n.fileName}`});let nfH3VideoUpload=await y(n.objectUrl,n.fileName||`reference_video.mp4`);if(!nfH3VideoUpload?.ok){let nfH3VideoRaw=typeof nfH3VideoUpload?.raw==`string`?nfH3VideoUpload.raw:``,nfH3VideoTail=nfH3VideoRaw?` ${nfH3VideoRaw.slice(0,240)}`:``,nfH3VideoHttp=nfH3VideoUpload?.status?`（HTTP ${String(nfH3VideoUpload.status)}）`:``;e.setAiSeqJob({state:`error`,message:`上传参考视频失败：${String(nfH3VideoUpload?.error||nfH3VideoUpload?.status||``)}${nfH3VideoHttp}${nfH3VideoTail}`});return}nfVideos.push(String(nfH3VideoUpload.data?.name||nfH3VideoUpload.data?.filename||``))}' +
    'if(r?.objectUrl){let nfH3AudioBlob=await(await fetch(String(r.objectUrl||``))).blob(),nfH3AudioMeta=await v(nfH3AudioBlob,r.fileName||`reference_audio.wav`),nfH3AudioDuration=Number(nfH3AudioMeta?.durationSec);if(!nfH3AudioMeta||!Number.isFinite(nfH3AudioDuration)||nfH3AudioDuration<2||nfH3AudioDuration>15){let nfH3AudioDurationLabel=Number.isFinite(nfH3AudioDuration)&&nfH3AudioDuration>0?`${Math.round(nfH3AudioDuration*100)/100} 秒`:`无法识别`;e.setAiSeqJob({state:`error`,message:`MiniMax H3 声音参考时长必须为 2–15 秒（当前：${nfH3AudioDurationLabel}）`});return}' +
    'if(t!==e.aiSeqRunTokenRef.current)return;e.setAiSeqJob({state:`running`,message:`上传声音参考：${r.fileName}`});let nfH3AudioUpload=await y(r.objectUrl,r.fileName||`reference_audio.wav`);if(!nfH3AudioUpload?.ok){let nfH3AudioRaw=typeof nfH3AudioUpload?.raw==`string`?nfH3AudioUpload.raw:``,nfH3AudioTail=nfH3AudioRaw?` ${nfH3AudioRaw.slice(0,240)}`:``,nfH3AudioHttp=nfH3AudioUpload?.status?`（HTTP ${String(nfH3AudioUpload.status)}）`:``;e.setAiSeqJob({state:`error`,message:`上传声音参考失败：${String(nfH3AudioUpload?.error||nfH3AudioUpload?.status||``)}${nfH3AudioHttp}${nfH3AudioTail}`});return}nfAudios.push(String(nfH3AudioUpload.data?.name||nfH3AudioUpload.data?.filename||``))}'
  replaceRange(mediaStart, mediaEnd, mediaReplacement, 'H3 reference media duration and audio-only guards')
}

function applyFollowupSyntaxRepair() {
  replaceOnce(
    'nfAudios.push(String(nfH3AudioUpload.data?.name||nfH3AudioUpload.data?.filename||``))}}}if(t!==e.aiSeqRunTokenRef.current)return;',
    'nfAudios.push(String(nfH3AudioUpload.data?.name||nfH3AudioUpload.data?.filename||``))}}if(t!==e.aiSeqRunTokenRef.current)return;',
    'H3 reference media outer block syntax',
  )
}

function applyFollowupSettingsSyntaxRepair() {
  replaceOnce(
    'boxSizing:`border-box`}),(0,X.jsx)(`div`,{"data-novaflow-h3-duration-output":`1`',
    'boxSizing:`border-box`}}),(0,X.jsx)(`div`,{"data-novaflow-h3-duration-output":`1`',
    'H3 duration input props syntax',
  )
}

function applyReferencePolicySubmitFix() {
  const mediaStart = 'let s=[];for(let n of o){'
  const mediaEnd = '}if(t!==e.aiSeqRunTokenRef.current)return;let c='
  const mediaReplacement = 'let nfVideos=[],nfAudios=[],nfH3VideoMeta=null,nfH3AudioMeta=null,nfH3VideoRef=e.aiSeqJimengVideoRef,nfH3AudioRef=e.aiSeqJimengAudioRef;' +
    'if(nfH3Mode&&a===`multi_reference`){' +
    'if(nfH3VideoRef?.objectUrl){let nfH3VideoBlob=await(await fetch(String(nfH3VideoRef.objectUrl||``))).blob();nfH3VideoMeta=await v(nfH3VideoBlob,nfH3VideoRef.fileName||`reference_video.mp4`)}' +
    'if(nfH3AudioRef?.objectUrl){let nfH3AudioBlob=await(await fetch(String(nfH3AudioRef.objectUrl||``))).blob();nfH3AudioMeta=await v(nfH3AudioBlob,nfH3AudioRef.fileName||`reference_audio.wav`)}' +
    'let nfH3Policy=window.NovaFlowAiSequenceMiniMaxH3Resource;if(!nfH3Policy?.validateReferenceMediaPolicy){e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考媒体校验模块未加载`});return}' +
    'try{nfH3Policy.validateReferenceMediaPolicy({images:o,videos:nfH3VideoRef?.objectUrl?[nfH3VideoMeta||{}]:[],audios:nfH3AudioRef?.objectUrl?[nfH3AudioMeta||{}]:[]})}catch(nfH3PolicyError){e.setAiSeqJob({state:`error`,message:`MiniMax H3 参考媒体无效：${String(nfH3PolicyError?.message||nfH3PolicyError)}`});return}}' +
    'let s=[];for(let n of o){if(t!==e.aiSeqRunTokenRef.current)return;e.setAiSeqJob({state:`running`,message:`上传图片：${n.fileName}`});let r=await y(n.dataUrl,n.fileName);if(!r?.ok){let t=typeof r?.raw==`string`?r.raw:``,n=t?` ${t.slice(0,240)}`:``,i=r?.status?`（HTTP ${String(r.status)}）`:``;e.setAiSeqJob({state:`error`,message:`上传失败：${String(r?.error||r?.status||``)}${i}${n}`});return}s.push(String(r.data?.name||r.data?.filename||``))}' +
    'if(nfH3Mode&&a===`multi_reference`){if(nfH3VideoRef?.objectUrl){if(t!==e.aiSeqRunTokenRef.current)return;e.setAiSeqJob({state:`running`,message:`上传参考视频：${nfH3VideoRef.fileName}`});let nfH3VideoUpload=await y(nfH3VideoRef.objectUrl,nfH3VideoRef.fileName||`reference_video.mp4`);if(!nfH3VideoUpload?.ok){let nfH3VideoRaw=typeof nfH3VideoUpload?.raw==`string`?nfH3VideoUpload.raw:``,nfH3VideoTail=nfH3VideoRaw?` ${nfH3VideoRaw.slice(0,240)}`:``,nfH3VideoHttp=nfH3VideoUpload?.status?`（HTTP ${String(nfH3VideoUpload.status)}）`:``;e.setAiSeqJob({state:`error`,message:`上传参考视频失败：${String(nfH3VideoUpload?.error||nfH3VideoUpload?.status||``)}${nfH3VideoHttp}${nfH3VideoTail}`});return}nfVideos.push(String(nfH3VideoUpload.data?.name||nfH3VideoUpload.data?.filename||``))}' +
    'if(nfH3AudioRef?.objectUrl){if(t!==e.aiSeqRunTokenRef.current)return;e.setAiSeqJob({state:`running`,message:`上传声音参考：${nfH3AudioRef.fileName}`});let nfH3AudioUpload=await y(nfH3AudioRef.objectUrl,nfH3AudioRef.fileName||`reference_audio.wav`);if(!nfH3AudioUpload?.ok){let nfH3AudioRaw=typeof nfH3AudioUpload?.raw==`string`?nfH3AudioUpload.raw:``,nfH3AudioTail=nfH3AudioRaw?` ${nfH3AudioRaw.slice(0,240)}`:``,nfH3AudioHttp=nfH3AudioUpload?.status?`（HTTP ${String(nfH3AudioUpload.status)}）`:``;e.setAiSeqJob({state:`error`,message:`上传声音参考失败：${String(nfH3AudioUpload?.error||nfH3AudioUpload?.status||``)}${nfH3AudioHttp}${nfH3AudioTail}`});return}nfAudios.push(String(nfH3AudioUpload.data?.name||nfH3AudioUpload.data?.filename||``))}'
  replaceRange(mediaStart, mediaEnd, mediaReplacement, 'H3 reference policy before all uploads')
}

function applySubmitDurationSnapshotFix() {
  replaceOnce(
    ',j=async()=>{try{let t=e.aiSeqRunTokenRef.current+=1,',
    ',j=async nfH3SubmitOptions=>{try{let t=e.aiSeqRunTokenRef.current+=1,',
    'H3 generator submit-time parameter snapshot',
  )
  replaceOnce(
    'durationSeconds:Math.max(1,Math.min(15,Number(e.aiSeqOutFrames)/24))',
    'durationSeconds:nfH3SubmitOptions?.durationSeconds',
    'H3 workflow duration from the submit-time snapshot',
  )
  replaceOnce(
    'Lr(),Er()',
    'let nfH3SubmitDuration=ze===`minimax_h3_local`?nfCommitH3Duration(nfH3DurationInput):null;Lr(),Er(nfH3SubmitDuration?{durationSeconds:nfH3SubmitDuration.requestedDuration}:void 0)',
    'H3 Generate click normalizes and snapshots the visible duration',
  )
}

function applyIndependentSurfaceStateAndWanRuntimeFixes() {
  replaceRange(
    '}),[nfH3DurationInput,nfSetH3DurationInput]=(0,_.useState)(`5`)',
    ',Fr=Ja(`ai_seq_prompt`',
    '}),[nfH3AspectRatio,nfSetH3AspectRatio]=(0,_.useState)(`9:16`),[nfH3Megapixels,nfSetH3Megapixels]=(0,_.useState)(.4),[nfH3DurationInput,nfSetH3DurationInput]=(0,_.useState)(`5`),[nfH3Steps,nfSetH3Steps]=(0,_.useState)(4),nfH3WorkflowApi=()=>window.NovaFlowAiSequenceMiniMaxH3Workflow,nfH3AspectOptions=()=>nfH3WorkflowApi()?.ASPECT_RATIOS||[{value:`1:1`,label:`1:1（方形）`},{value:`2:3`,label:`2:3（竖屏照片）`},{value:`3:2`,label:`3:2（横屏照片）`},{value:`3:4`,label:`3:4（竖屏标准）`},{value:`4:3`,label:`4:3（横屏标准）`},{value:`9:16`,label:`9:16（竖屏宽银幕）`},{value:`16:9`,label:`16:9（横屏宽银幕）`},{value:`21:9`,label:`21:9（超宽屏）`}],nfH3Resolution=()=>{try{return nfH3WorkflowApi()?.calculateResolution?.({aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels})||{aspectRatio:`9:16`,orientation:`portrait`,megapixels:.4,width:480,height:864}}catch{return{aspectRatio:`9:16`,orientation:`portrait`,megapixels:.4,width:480,height:864}}},nfH3ResolutionOptions=()=>{let e=nfH3WorkflowApi(),t=e?.MEGAPIXEL_OPTIONS||[.2,.3,.4,.5,.6,.7,.8,.9,.98,1,1.2,1.5,1.8,2];return t.map(t=>{try{return e?.calculateResolution?.({aspectRatio:nfH3AspectRatio,megapixels:t})||null}catch{return null}}).filter(e=>e&&Number.isFinite(e.width)&&Number.isFinite(e.height)).filter((e,t,n)=>n.findIndex(t=>`${t.width}x${t.height}`===`${e.width}x${e.height}`)===t)},nfH3Duration=()=>{try{return nfH3WorkflowApi()?.normalizeDuration?.(nfH3DurationInput)||{requestedDuration:5,frames:124,actualDuration:124/24}}catch{return nfH3WorkflowApi()?.normalizeDuration?.(5)||{requestedDuration:5,frames:124,actualDuration:124/24}}},nfCommitH3Duration=e=>{let t=Number(e),n=Number.isFinite(t)?Math.max(1,Math.min(15,Math.round(t*100)/100)):5,r=nfH3WorkflowApi()?.normalizeDuration?.(n)||{requestedDuration:n,frames:124,actualDuration:124/24};nfSetH3DurationInput(String(r.requestedDuration));return r},nfH3SubmitSteps=()=>Ve===`multi_reference`?20:nfH3Steps',
    'independent H3 surface parameter state',
  )

  const settingsStart = 'children:ze===`minimax_h3_local`?(0,X.jsxs)(X.Fragment,{children:['
  const settingsEnd = ']}):ze===`local`?'
  const settingsReplacement = settingsStart +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`画幅比例`}),' +
    '(0,X.jsx)(yn,{"data-novaflow-h3-aspect-ratio":`1`,value:nfH3AspectRatio,onChange:e=>nfSetH3AspectRatio(String(e.target.value||`9:16`)),style:{width:176,height:30,padding:`0 8px`},children:nfH3AspectOptions().map(e=>(0,X.jsx)(`option`,{value:e.value,children:e.label},e.value))}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`分辨率`}),' +
    '(0,X.jsx)(yn,{"data-novaflow-h3-resolution":`1`,value:`${nfH3Resolution().width}x${nfH3Resolution().height}`,onChange:e=>{let t=nfH3ResolutionOptions().find(t=>`${t.width}x${t.height}`===String(e.target.value||``));t&&nfSetH3Megapixels(t.megapixels)},style:{width:156,height:30,padding:`0 8px`},children:nfH3ResolutionOptions().map(e=>(0,X.jsx)(`option`,{value:`${e.width}x${e.height}`,children:`${e.width} × ${e.height}${e.megapixels>.98?`（高负载）`:``}`},`${e.width}x${e.height}`))}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`时长`}),' +
    '(0,X.jsx)(_n,{"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:15,step:.01,value:nfH3DurationInput,onChange:e=>nfSetH3DurationInput(String(e.target.value||``)),onBlur:()=>nfCommitH3Duration(nfH3DurationInput),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),' +
    '(0,X.jsx)(`div`,{"data-novaflow-h3-duration-output":`1`,style:{fontSize:11,color:nfH3Duration().frames<124?`#f0b35a`:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS${nfH3Duration().frames<124?` · 短时长实验模式，低于模型建议训练时长`:``}`}),' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`采样步数`}),' +
    '(0,X.jsxs)(yn,{"data-novaflow-h3-steps":`1`,value:String(nfH3SubmitSteps()),disabled:Ve===`multi_reference`,onChange:e=>nfSetH3Steps(Number(e.target.value)===20?20:4),title:Ve===`multi_reference`?`多参视频固定 20 步`:``,style:{width:64,height:30,padding:`0 8px`},children:[(0,X.jsx)(`option`,{value:`4`,children:`4`}),(0,X.jsx)(`option`,{value:`20`,children:`20`})]}),' +
    '(0,X.jsxs)(`div`,{style:{display:`flex`,gap:8,alignItems:`center`},children:[' +
    '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.60)`},children:`随机种子`}),' +
    '(0,X.jsxs)(`button`,{"data-novaflow-ai-state-toggle":Gt?`on`:`off`,type:`button`,onClick:()=>Kt(e=>!e),style:{position:`relative`,display:`inline-flex`,alignItems:`center`,width:34,minWidth:34,height:18,padding:0,border:0,borderRadius:999,background:Gt?`#1ea672`:`#222222`,color:`transparent`,cursor:`pointer`,overflow:`hidden`},children:[' +
    '(0,X.jsx)(`span`,{style:{position:`absolute`,top:`50%`,left:Gt?20:4,width:10,height:10,borderRadius:999,background:Gt?`#e8e8e8`:`#8f98a3`,transform:`translateY(-50%)`}}),Gt?`on`:`off`]}),!Gt&&(0,X.jsx)(_n,{inputMode:`numeric`,value:Yt,onChange:e=>Xt(String(e.target.value||``).replace(/[^0-9]/g,``)),style:{width:70,height:26,padding:`4px 8px`,textAlign:`right`}})]})'
  replaceRange(settingsStart, settingsEnd, settingsReplacement, 'combined H3 aspect, resolution, duration, and steps controls')

  replaceOnce(
    'aspectRatio:nfH3Workflow.matchResolution({width:Number(e.aiSeqOutW),height:Number(e.aiSeqOutH)}).aspectRatio,megapixels:nfH3Workflow.matchResolution({width:Number(e.aiSeqOutW),height:Number(e.aiSeqOutH)}).megapixels,durationSeconds:nfH3SubmitOptions?.durationSeconds',
    'aspectRatio:nfH3SubmitOptions?.aspectRatio||`9:16`,megapixels:Number(nfH3SubmitOptions?.megapixels)||.4,durationSeconds:nfH3SubmitOptions?.durationSeconds,steps:nfH3ModeName===`r2v`?20:nfH3SubmitOptions?.steps',
    'H3 workflow parameters from the synchronous submit snapshot',
  )
  replaceOnce(
    'let nfH3SubmitDuration=ze===`minimax_h3_local`?nfCommitH3Duration(nfH3DurationInput):null;Lr(),Er(nfH3SubmitDuration?{durationSeconds:nfH3SubmitDuration.requestedDuration}:void 0)',
    'let nfH3SubmitSnapshot=ze===`minimax_h3_local`?(()=>{let e=nfCommitH3Duration(nfH3DurationInput);return{aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels,durationSeconds:e.requestedDuration,steps:Ve===`multi_reference`?20:nfH3Steps}})():null;Lr(),Er(nfH3SubmitSnapshot||void 0)',
    'H3 Generate click snapshots all independent parameters',
  )

  const variableEndpoint = 'nfAiSeqResolvedBaseRef.current||(e.aiSeqMode===`minimax_h3_local`?`http://127.0.0.1:8189`:e.aiComfyBaseUrl)'
  const fixedEndpoint = '(e.aiSeqMode===`minimax_h3_local`?`http://127.0.0.1:8189`:`http://127.0.0.1:8188`)'
  const endpointCount = occurrenceCount(source, variableEndpoint)
  if (endpointCount !== 4) throw new Error(`fixed Wan/H3 request endpoints: expected four matches, found ${endpointCount}`)
  source = source.split(variableEndpoint).join(fixedEndpoint)

  replaceOnce('nfH3Runtime?[8189]:[8e3,8188,8080,7860,3e3]', 'nfH3Runtime?[8189]:[8188]', 'fixed Runtime probe ports')
  replaceOnce(
    '(0,_.useEffect)(()=>{r===`local`&&(b!==aiSeqModelPresets.local_a.high&&x(aiSeqModelPresets.local_a.high),S!==aiSeqModelPresets.local_a.low&&C(aiSeqModelPresets.local_a.low))},[r,b,S])',
    '(0,_.useEffect)(()=>{r===`local`&&(()=>{let e=`http://127.0.0.1:8188`;h!==e&&g(e);try{localStorage.setItem(`comfyui_last_connected_url`,e)}catch{}b!==aiSeqModelPresets.local_a.high&&x(aiSeqModelPresets.local_a.high),S!==aiSeqModelPresets.local_a.low&&C(aiSeqModelPresets.local_a.low)})()},[r,h,b,S])',
    'Wan selection clears stale shared Runtime URLs',
  )
  replaceOnce(
    'let t=await Ne(h,`/object_info`);',
    'let t=await Ne(`http://127.0.0.1:8188`,`/object_info`);',
    'Wan object_info endpoint',
  )
  replaceOnce(
    'a=Array.from(new Set(r)).sort((e,t)=>e.localeCompare(t)),o=Array.from(new Set(i)).sort((e,t)=>e.localeCompare(t));',
    'nfWanVisibleModel=e=>!/(^|[\\/])minimax_h3([\\/]|$)/i.test(String(e||``)),a=Array.from(new Set(r.filter(nfWanVisibleModel))).sort((e,t)=>e.localeCompare(t)),o=Array.from(new Set(i.filter(nfWanVisibleModel))).sort((e,t)=>e.localeCompare(t));',
    'Wan model dropdown excludes the minimax_h3 directory',
  )
  replaceOnce(
    'value:h,onChange:e=>g(e.target.value),placeholder:aiSeqWanModel?`http://127.0.0.1:8188`:`http://127.0.0.1:8189`',
    'value:aiSeqWanModel?`http://127.0.0.1:8188`:`http://127.0.0.1:8189`,onChange:()=>{},readOnly:!0,placeholder:aiSeqWanModel?`http://127.0.0.1:8188`:`http://127.0.0.1:8189`',
    'fixed selected Runtime URL field',
  )
  replaceOnce(
    'onClick:()=>void v(h),disabled:y.state===`checking`',
    'onClick:()=>void v(aiSeqWanModel?`http://127.0.0.1:8188`:`http://127.0.0.1:8189`),disabled:y.state===`checking`',
    'fixed selected Runtime probe action',
  )
  replaceOnce(
    'detail:`固定 24 FPS、20 步；不接入 Wan2.2 High / Low、LoRA 或反向提示词。`',
    'detail:`固定 24 FPS；前三模式默认 4 步并自动使用专用 Turbo LoRA，多参视频固定 20 步；不使用 Wan2.2 High / Low 或反向提示词。`',
    'H3 model detail reflects per-mode steps',
  )
}

function applyWanDirectoryFilterNormalizationFix() {
  replaceOnce(
    'nfWanVisibleModel=e=>!/(^|[\\/])minimax_h3([\\/]|$)/i.test(String(e||``))',
    'nfWanVisibleModel=e=>!String(e||``).toLowerCase().replaceAll(String.fromCharCode(92),`/`).split(`/`).includes(`minimax_h3`)',
    'Wan model path separator normalization',
  )
}

function applyFixedProbeInputNormalizationFix() {
  replaceOnce(
    'let nfH3Runtime=e.aiSeqMode===`minimax_h3_local`;nfH3Runtime&&(n=`http://127.0.0.1:8189`);if(!t(n))',
    'let nfH3Runtime=e.aiSeqMode===`minimax_h3_local`;n=nfH3Runtime?`http://127.0.0.1:8189`:`http://127.0.0.1:8188`;if(!t(n))',
    'fixed Runtime probe input URL',
  )
}

function applyFinalH3ControlsAndEndpointFixes() {
  replaceOnce(
    '[{value:`1:1`,label:`1:1 (Square)`},{value:`2:3`,label:`2:3 (Portrait Photo)`},{value:`3:2`,label:`3:2 (Photo)`},{value:`3:4`,label:`3:4 (Portrait Standard)`},{value:`4:3`,label:`4:3 (Standard)`},{value:`9:16`,label:`9:16 (Portrait Widescreen)`},{value:`16:9`,label:`16:9 (Widescreen)`},{value:`21:9`,label:`21:9 (Ultrawide)`}]',
    '[{value:`1:1`,label:`1:1（方形）`},{value:`2:3`,label:`2:3（竖屏照片）`},{value:`3:2`,label:`3:2（横屏照片）`},{value:`3:4`,label:`3:4（竖屏标准）`},{value:`4:3`,label:`4:3（横屏标准）`},{value:`9:16`,label:`9:16（竖屏宽银幕）`},{value:`16:9`,label:`16:9（横屏宽银幕）`},{value:`21:9`,label:`21:9（超宽屏）`}]',
    'Chinese H3 aspect-ratio fallback labels',
  )
  replaceOnce(
    'style:{width:128,height:30,padding:`0 8px`},children:nfH3ResolutionOptions().map(e=>(0,X.jsx)(`option`,{value:`${e.width}x${e.height}`,children:`${e.width} × ${e.height}`},`${e.width}x${e.height}`))',
    'style:{width:156,height:30,padding:`0 8px`},children:nfH3ResolutionOptions().map(e=>(0,X.jsx)(`option`,{value:`${e.width}x${e.height}`,children:`${e.width} × ${e.height}${e.megapixels>.98?`（高负载）`:``}`},`${e.width}x${e.height}`))',
    'direct H3 resolution labels with high-load notice',
  )
  replaceOnce(
    'children:`步数`}),(0,X.jsxs)(yn,{"data-novaflow-h3-steps"',
    'children:`采样步数`}),(0,X.jsxs)(yn,{"data-novaflow-h3-steps"',
    'H3 sampling-step label',
  )

  const staleResolvedEndpoint = 'nfAiSeqResolvedBaseRef.current||(e.aiSeqMode===`minimax_h3_local`?`http://127.0.0.1:8189`:`http://127.0.0.1:8188`)'
  const directFixedEndpoint = '(e.aiSeqMode===`minimax_h3_local`?`http://127.0.0.1:8189`:`http://127.0.0.1:8188`)'
  const staleEndpointCount = occurrenceCount(source, staleResolvedEndpoint)
  if (staleEndpointCount !== 4) {
    throw new Error(`direct Wan/H3 helper endpoints: expected four matches, found ${staleEndpointCount}`)
  }
  source = source.split(staleResolvedEndpoint).join(directFixedEndpoint)

  replaceOnce(
    'detail:`固定 24 FPS；前三模式默认 4 步，多参视频固定 20 步；不接入 Wan2.2 High / Low、LoRA 或反向提示词。`',
    'detail:`固定 24 FPS；前三模式默认 4 步并自动使用专用 Turbo LoRA，多参视频固定 20 步；不使用 Wan2.2 High / Low 或反向提示词。`',
    'accurate H3 Turbo profile detail',
  )
}

function applyFreeFormH3StepsFixes() {
  replaceOnceOrAlready(
    'nfH3SubmitSteps=()=>Ve===`multi_reference`?20:nfH3Steps',
    'nfCommitH3Steps=e=>{let t=Number(e),n=Number.isInteger(t)&&t>=1&&t<=1e4?t:4;nfSetH3Steps(n);return n},nfH3SubmitSteps=()=>{let e=Number(nfH3Steps);return Number.isInteger(e)&&e>=1&&e<=1e4?e:4},nfH3StepHint=()=>{let e=nfH3SubmitSteps();return e===4?`4 步：自动启用 Turbo LoRA`:e===20?`20 步：推荐质量基线`:`${e} 步：自定义采样`}',
    'free-form H3 steps state and profile hint',
  )
  replaceOnceOrAlready(
    '(0,X.jsxs)(yn,{"data-novaflow-h3-steps":`1`,value:String(nfH3SubmitSteps()),disabled:Ve===`multi_reference`,onChange:e=>nfSetH3Steps(Number(e.target.value)===20?20:4),title:Ve===`multi_reference`?`多参视频固定 20 步`:``,style:{width:64,height:30,padding:`0 8px`},children:[(0,X.jsx)(`option`,{value:`4`,children:`4`}),(0,X.jsx)(`option`,{value:`20`,children:`20`})]}),',
    '(0,X.jsx)(_n,{"data-novaflow-h3-steps":`1`,type:`number`,inputMode:`numeric`,min:1,max:1e4,step:1,value:String(nfH3Steps),onChange:e=>{let t=String(e.target.value||``);if(t===``){nfSetH3Steps(``);return}let n=Number(t);Number.isInteger(n)&&nfSetH3Steps(n)},onBlur:()=>nfCommitH3Steps(nfH3Steps),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),(0,X.jsx)(`div`,{"data-novaflow-h3-steps-hint":`1`,style:{fontSize:11,color:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:nfH3StepHint()}),',
    'free-form H3 steps number input',
  )
  replaceOnceOrAlready(
    'steps:nfH3ModeName===`r2v`?20:nfH3SubmitOptions?.steps',
    'steps:nfH3SubmitOptions?.steps',
    'H3 workflow receives the submitted steps in every mode',
  )
  replaceOnceOrAlready(
    'steps:Ve===`multi_reference`?20:nfH3Steps',
    'steps:nfCommitH3Steps(nfH3Steps)',
    'H3 Generate click snapshots the entered integer steps',
  )
  replaceOnceOrAlready(
    'detail:`固定 24 FPS；前三模式默认 4 步并自动使用专用 Turbo LoRA，多参视频固定 20 步；不使用 Wan2.2 High / Low 或反向提示词。`',
    'detail:`固定 24 FPS；采样步数可输入 1–10000，4 步自动使用专用 Turbo LoRA，20 步为推荐质量基线。`',
    'H3 model detail reflects free-form steps',
  )
}

function applyH3LoraModeBodyWidthOwnership() {
  replaceOnceOrAlready(
    'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`,style:',
    'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`,"data-novaflow-ai-mode-body-item":`1`,style:',
    'H3 LoRA top-level mode body width ownership',
  )
}

function applyH3PromptModeSemantics() {
  replaceOnceOrAlready(
    'return(0,X.jsx)(`button`,{type:`button`,onClick:()=>p(e.value),"aria-pressed":t,style:',
    'return(0,X.jsx)(`button`,{type:`button`,"data-novaflow-ai-generation-mode":e.value,onClick:()=>p(e.value),"aria-pressed":t,style:',
    'semantic generation mode on AI sequence top tabs',
  )
}

function applyH3ShortDurationUiFixes() {
  replaceOnceOrAlready(
    'nfCommitH3Duration=e=>{let t=Number(e),n=Number.isFinite(t)?Math.max(4,Math.min(15,Math.round(t*100)/100)):5',
    'nfCommitH3Duration=e=>{let t=Number(e),n=Number.isFinite(t)?Math.max(1,Math.min(15,Math.round(t*100)/100)):5',
    'H3 duration commit clamp starts at one second',
  )
  replaceOnceOrAlready(
    '"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:4,max:15,step:.01',
    '"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:15,step:.01',
    'H3 duration input starts at one second',
  )
  const durationTooltipMarker = 'title:`模型对齐输出 ${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS'
  if (occurrenceCount(source, durationTooltipMarker) === 0) {
    replaceOnceOrAlready(
      'color:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS`',
      'color:nfH3Duration().frames<124?`#f0b35a`:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS${nfH3Duration().frames<124?` · 短时长实验模式，低于模型建议训练时长`:``}`',
      'H3 short-duration experimental warning',
    )
  } else if (occurrenceCount(source, durationTooltipMarker) !== 1) {
    throw new Error('H3 short-duration tooltip marker must be unique')
  }
}

function applyH3ParameterTooltipFixes() {
  replaceOnceOrAlready(
    '(0,X.jsx)(_n,{"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:15,step:.01,value:nfH3DurationInput,onChange:e=>nfSetH3DurationInput(String(e.target.value||``)),onBlur:()=>nfCommitH3Duration(nfH3DurationInput),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),(0,X.jsx)(`div`,{"data-novaflow-h3-duration-output":`1`,style:{fontSize:11,color:nfH3Duration().frames<124?`#f0b35a`:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS${nfH3Duration().frames<124?` · 短时长实验模式，低于模型建议训练时长`:``}`}),',
    '(0,X.jsx)(_n,{"data-novaflow-h3-duration":`1`,type:`number`,inputMode:`decimal`,min:1,max:15,step:.01,value:nfH3DurationInput,title:`模型对齐输出 ${nfH3Duration().actualDuration.toFixed(2)} 秒 / ${nfH3Duration().frames} 帧 · 24 FPS${nfH3Duration().frames<124?`；短时长实验模式`:``}`,"aria-label":`时长（秒）`,onChange:e=>nfSetH3DurationInput(String(e.target.value||``)),onBlur:()=>nfCommitH3Duration(nfH3DurationInput),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),',
    'H3 duration technical details move to the input tooltip',
  )
  replaceOnceOrAlready(
    '(0,X.jsx)(_n,{"data-novaflow-h3-steps":`1`,type:`number`,inputMode:`numeric`,min:1,max:1e4,step:1,value:String(nfH3Steps),onChange:e=>{let t=String(e.target.value||``);if(t===``){nfSetH3Steps(``);return}let n=Number(t);Number.isInteger(n)&&nfSetH3Steps(n)},onBlur:()=>nfCommitH3Steps(nfH3Steps),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),(0,X.jsx)(`div`,{"data-novaflow-h3-steps-hint":`1`,style:{fontSize:11,color:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:nfH3StepHint()}),',
    '(0,X.jsx)(_n,{"data-novaflow-h3-steps":`1`,type:`number`,inputMode:`numeric`,min:1,max:1e4,step:1,value:String(nfH3Steps),title:nfH3SubmitSteps()===4?`4 步会自动启用内置 Turbo LoRA（0.75）`:nfH3SubmitSteps()===20?`20 步质量基线`:`自定义采样步数 ${nfH3SubmitSteps()}`,"aria-label":`采样步数`,onChange:e=>{let t=String(e.target.value||``);if(t===``){nfSetH3Steps(``);return}let n=Number(t);Number.isInteger(n)&&nfSetH3Steps(n)},onBlur:()=>nfCommitH3Steps(nfH3Steps),onKeyDown:e=>{e.key===`Enter`&&e.currentTarget.blur()},style:{width:72,height:30,padding:`4px 8px`,textAlign:`right`,boxSizing:`border-box`}}),',
    'H3 sampling profile details move to the input tooltip',
  )
}

function applyH3OutputWarehouseFixes() {
  const h3OutputRestoreMarker = 'let nfH3OutputApi=window.NovaFlowAiSequenceMiniMaxH3OutputResource,nfH3OutputCancelled=!1'
  if (occurrenceCount(source, h3OutputRestoreMarker) === 0) {
    replaceOnce(
      '[Qe,$e]=(0,_.useState)([]),et=(0,_.useRef)(Qe);(0,_.useEffect)(()=>{et.current=Qe},[Qe]);',
      '[Qe,$e]=(0,_.useState)([]),et=(0,_.useRef)(Qe);(0,_.useEffect)(()=>{et.current=Qe},[Qe]);(0,_.useEffect)(()=>{let nfH3OutputApi=window.NovaFlowAiSequenceMiniMaxH3OutputResource,nfH3OutputCancelled=!1;if(!nfH3OutputApi?.list)return;Promise.resolve(nfH3OutputApi.list()).then(nfH3Items=>{if(nfH3OutputCancelled||!Array.isArray(nfH3Items)||!nfH3Items.length)return;$e(nfCurrent=>{let nfById=new Map((Array.isArray(nfCurrent)?nfCurrent:[]).map(nfItem=>[String(nfItem?.id||``),nfItem]));let nfMerged=nfH3Items.map(nfItem=>{let nfExisting=nfById.get(String(nfItem?.id||``));return nfExisting?.objectUrl&&!nfItem?.objectUrl?{...nfItem,objectUrl:nfExisting.objectUrl}:nfItem});let nfRest=nfCurrent.filter(nfItem=>!nfMerged.some(nfNew=>String(nfNew?.id||``)===String(nfItem?.id||``)));return[...nfMerged,...nfRest].slice(0,30)})}).catch(()=>{});return()=>{nfH3OutputCancelled=!0}},[]);',
      'restore published H3 outputs into the current AI sequence resource list',
    )
  } else if (occurrenceCount(source, h3OutputRestoreMarker) !== 1) {
    throw new Error(`restore published H3 outputs: expected one patched marker`)
  }
  replaceOnceOrAlready(
    'h=async(e,t)=>{try{let n=window.electronAPI;if(!n?.aiSeqCacheTempFile)return null;',
    'h=async(nfCacheBlob,nfCacheName)=>{try{if(e.aiSeqMode===`minimax_h3_local`)return null;let n=window.electronAPI;if(!n?.aiSeqCacheTempFile)return null;',
    'H3 outputs bypass the legacy duplicate cache copy',
  )
  replaceOnceOrAlready(
    'let r=new Uint8Array(await e.arrayBuffer()),i=await n.aiSeqCacheTempFile({bytes:r,fileName:String(t||`output.mp4`)})',
    'let r=new Uint8Array(await nfCacheBlob.arrayBuffer()),i=await n.aiSeqCacheTempFile({bytes:r,fileName:String(nfCacheName||`output.mp4`)})',
    'renamed cache helper arguments after the H3 bypass',
  )
  replaceOnceOrAlready(
    'let M=!1,N=``,P=0,F=!1,I=!1,nfOutputEmptySince=0,nfHistoryRetryCount=0;',
    'let M=!1,N=``,P=0,F=!1,I=!1,nfOutputEmptySince=0,nfHistoryRetryCount=0,nfH3MediaDurationSec=NaN;',
    'retain the probed H3 media duration through history polling',
  )
  replaceOnceOrAlready(
    'let n=await m(r.blob,d.filename),o=await h(n,d.filename),s=await v(n,d.filename),c=Number(s?.fps||0);Number.isFinite(c)&&c>.1&&e.setAiSeqTimelineFps',
    'let n=await m(r.blob,d.filename),o=await h(n,d.filename),s=await v(n,d.filename),c=Number(s?.fps||0),nfH3ProbedDurationSec=Number(s?.durationSec);Number.isFinite(nfH3ProbedDurationSec)&&nfH3ProbedDurationSec>0&&(nfH3MediaDurationSec=nfH3ProbedDurationSec);Number.isFinite(c)&&c>.1&&e.setAiSeqTimelineFps',
    'capture the H3 media probe duration',
  )
  replaceOnceOrAlready(
    'sourceFrames:t.sourceFrames??(s?.frames||void 0),trimmedTailFrame:',
    'sourceFrames:t.sourceFrames??(s?.frames||void 0),mediaDurationSec:t.mediaDurationSec??(Number.isFinite(nfH3MediaDurationSec)&&nfH3MediaDurationSec>0?nfH3MediaDurationSec:void 0),trimmedTailFrame:',
    'keep the probed H3 media duration on the live resource item',
  )
  if (occurrenceCount(source, 'generationElapsedSec:nfH3NormalizedGenerationElapsedSec') === 0) {
    replaceOnceOrAlready(
      'if(P>=2){try{for(let n of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;await C({id:`${A}:${n.type||``}:${n.subfolder||``}:${n.filename}`,promptId:A,filename:n.filename,subfolder:n.subfolder||``,type:n.type||`output`})}}catch{}e.setAiSeqJob({state:`done`,message:`已生成（共 ${u.length} 个输出）`,promptId:A||void 0}),I=!0;break}',
      'if(P>=2){if(nfH3Mode){let nfH3OutputApi=window.NovaFlowAiSequenceMiniMaxH3OutputResource;if(!nfH3OutputApi?.publish){e.setAiSeqJob({state:`error`,message:`视频已生成，但临时仓库模块未加载`,promptId:A||void 0}),I=!0;break}try{for(let nfOutput of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;let nfPublished=await nfH3OutputApi.publish({promptId:A,filename:nfOutput.filename,subfolder:nfOutput.subfolder||``,type:nfOutput.type||`output`});e.setAiSeqGenerated(nfCurrent=>{let nfExisting=nfCurrent.find(nfItem=>String(nfItem?.id||``)===String(nfPublished?.id||``));let nfItem=nfExisting?.objectUrl&&!nfPublished?.objectUrl?{...nfPublished,objectUrl:nfExisting.objectUrl}:nfPublished;return[nfItem,...nfCurrent.filter(nfOld=>String(nfOld?.id||``)!==String(nfItem?.id||``))].slice(0,30)})}}catch(nfWarehouseError){e.setAiSeqJob({state:`error`,message:`视频已生成，但加入临时仓库失败：${String(nfWarehouseError?.message||nfWarehouseError)}`,promptId:A||void 0}),I=!0;break}}else try{for(let n of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;await C({id:`${A}:${n.type||``}:${n.subfolder||``}:${n.filename}`,promptId:A,filename:n.filename,subfolder:n.subfolder||``,type:n.type||`output`})}}catch{}e.setAiSeqJob({state:`done`,message:`已生成并加入临时仓库（共 ${u.length} 个输出）`,promptId:A||void 0}),I=!0;break}',
      'publish stable H3 outputs before reporting completion',
    )
  }
  replaceOnceOrAlready(
    'if(P>=2){if(nfH3Mode){let nfH3OutputApi=window.NovaFlowAiSequenceMiniMaxH3OutputResource;if(!nfH3OutputApi?.publish){e.setAiSeqJob({state:`error`,message:`视频已生成，但临时仓库模块未加载`,promptId:A||void 0}),I=!0;break}try{for(let nfOutput of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;let nfPublished=await nfH3OutputApi.publish({promptId:A,filename:nfOutput.filename,subfolder:nfOutput.subfolder||``,type:nfOutput.type||`output`});e.setAiSeqGenerated(nfCurrent=>{let nfExisting=nfCurrent.find(nfItem=>String(nfItem?.id||``)===String(nfPublished?.id||``));let nfItem=nfExisting?.objectUrl&&!nfPublished?.objectUrl?{...nfPublished,objectUrl:nfExisting.objectUrl}:nfPublished;return[nfItem,...nfCurrent.filter(nfOld=>String(nfOld?.id||``)!==String(nfItem?.id||``))].slice(0,30)})}}catch(nfWarehouseError){e.setAiSeqJob({state:`error`,message:`视频已生成，但加入临时仓库失败：${String(nfWarehouseError?.message||nfWarehouseError)}`,promptId:A||void 0}),I=!0;break}}else try{for(let n of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;await C({id:`${A}:${n.type||``}:${n.subfolder||``}:${n.filename}`,promptId:A,filename:n.filename,subfolder:n.subfolder||``,type:n.type||`output`})}}catch{}e.setAiSeqJob({state:`done`,message:`已生成并加入临时仓库（共 ${u.length} 个输出）`,promptId:A||void 0}),I=!0;break}',
    'if(P>=2){if(nfH3Mode){let nfH3OutputApi=window.NovaFlowAiSequenceMiniMaxH3OutputResource;if(!nfH3OutputApi?.publish){e.setAiSeqJob({state:`error`,message:`视频已生成，但临时仓库模块未加载`,promptId:A||void 0}),I=!0;break}let nfH3HistoryTiming=nfH3OutputApi.extractHistoryTiming?.(o)||{},nfH3GenerationElapsedSec=Number(nfH3HistoryTiming?.generationElapsedSec),nfH3NormalizedMediaDurationSec=Number.isFinite(nfH3MediaDurationSec)&&nfH3MediaDurationSec>0?nfH3MediaDurationSec:void 0,nfH3NormalizedGenerationElapsedSec=Number.isFinite(nfH3GenerationElapsedSec)&&nfH3GenerationElapsedSec>0?nfH3GenerationElapsedSec:void 0;try{for(let nfOutput of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;let nfPublished=await nfH3OutputApi.publish({promptId:A,filename:nfOutput.filename,subfolder:nfOutput.subfolder||``,type:nfOutput.type||`output`,mediaDurationSec:nfH3NormalizedMediaDurationSec,generationElapsedSec:nfH3NormalizedGenerationElapsedSec}),nfPublishedItem={...nfPublished,mediaDurationSec:nfPublished?.mediaDurationSec??nfH3NormalizedMediaDurationSec,generationElapsedSec:nfPublished?.generationElapsedSec??nfH3NormalizedGenerationElapsedSec};e.setAiSeqGenerated(nfCurrent=>{let nfExisting=nfCurrent.find(nfItem=>String(nfItem?.id||``)===String(nfPublishedItem?.id||``));let nfItem=nfExisting?.objectUrl&&!nfPublishedItem?.objectUrl?{...nfPublishedItem,objectUrl:nfExisting.objectUrl}:nfPublishedItem;return[nfItem,...nfCurrent.filter(nfOld=>String(nfOld?.id||``)!==String(nfItem?.id||``))].slice(0,30)})}}catch(nfWarehouseError){e.setAiSeqJob({state:`error`,message:`视频已生成，但加入临时仓库失败：${String(nfWarehouseError?.message||nfWarehouseError)}`,promptId:A||void 0}),I=!0;break}}else try{for(let n of u.slice(0,6)){if(t!==e.aiSeqRunTokenRef.current)return;await C({id:`${A}:${n.type||``}:${n.subfolder||``}:${n.filename}`,promptId:A,filename:n.filename,subfolder:n.subfolder||``,type:n.type||`output`})}}catch{}e.setAiSeqJob({state:`done`,message:`已生成并加入临时仓库（共 ${u.length} 个输出）`,promptId:A||void 0}),I=!0;break}',
    'publish H3 media and generation timing without another history request',
  )
  replaceOnceOrAlready(
    '(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.55)`,marginTop:4},children:new Date(e.createdAt).toLocaleString()})',
    '(0,X.jsx)(`div`,{"data-novaflow-ai-media-duration-sec":Number.isFinite(Number(e?.mediaDurationSec))&&Number(e?.mediaDurationSec)>0?String(Number(e.mediaDurationSec)):void 0,"data-novaflow-ai-generation-elapsed-sec":Number.isFinite(Number(e?.generationElapsedSec))&&Number(e?.generationElapsedSec)>0?String(Number(e.generationElapsedSec)):void 0,style:{fontSize:11,color:`rgba(255,255,255,0.55)`,marginTop:4},children:new Date(e.createdAt).toLocaleString()})',
    'expose H3 timing metadata on the collapsed resource card timestamp',
  )
  replaceOnceOrAlready(
    '(0,X.jsx)(`div`,{style:{fontSize:10,lineHeight:1.2,color:`rgba(255,255,255,0.55)`,marginTop:4},children:new Date(e.createdAt).toLocaleString()})',
    '(0,X.jsx)(`div`,{"data-novaflow-ai-media-duration-sec":Number.isFinite(Number(e?.mediaDurationSec))&&Number(e?.mediaDurationSec)>0?String(Number(e.mediaDurationSec)):void 0,"data-novaflow-ai-generation-elapsed-sec":Number.isFinite(Number(e?.generationElapsedSec))&&Number(e?.generationElapsedSec)>0?String(Number(e.generationElapsedSec)):void 0,style:{fontSize:10,lineHeight:1.2,color:`rgba(255,255,255,0.55)`,marginTop:4},children:new Date(e.createdAt).toLocaleString()})',
    'expose H3 timing metadata on resource list card timestamps',
  )
}

function applyH3CompatibleLoraSurfaceFixes() {
  replaceOnceOrAlready(
    '[be,xe]=(0,_.useState)({state:`idle`,message:``}),Se=(0,_.useRef)(0),Ce=',
    '[be,xe]=(0,_.useState)({state:`idle`,message:``}),[nfPanelH3LoraSnapshot,nfSetPanelH3LoraSnapshot]=(0,_.useState)(()=>window.NovaFlowAiSequenceMiniMaxH3LoraResource?.getSnapshot?.()||{mode:`t2v`,steps:4,items:[],selected:[],loading:!1,error:``}),nfPanelH3LoraApi=()=>window.NovaFlowAiSequenceMiniMaxH3LoraResource,nfPanelH3LoraAvailable=()=>{let e=new Set((Array.isArray(nfPanelH3LoraSnapshot?.selected)?nfPanelH3LoraSnapshot.selected:[]).map(e=>String(e?.name||``).toLowerCase()));return(Array.isArray(nfPanelH3LoraSnapshot?.items)?nfPanelH3LoraSnapshot.items:[]).filter(t=>!e.has(String(t?.name||``).toLowerCase()))},nfPanelH3LoraSubscribeEffect=(0,_.useEffect)(()=>{let e=nfPanelH3LoraApi();if(!e?.getSnapshot||!e?.subscribe)return;let t=e=>nfSetPanelH3LoraSnapshot(e);t(e.getSnapshot());return e.subscribe(t)},[]),Se=(0,_.useRef)(0),Ce=',
    'model-panel H3 LoRA snapshot subscription',
  )
  replaceOnceOrAlready(
    'nfH3StepHint=()=>{let e=nfH3SubmitSteps();return e===4?`4 步：自动启用 Turbo LoRA`:e===20?`20 步：推荐质量基线`:`${e} 步：自定义采样`},Fr=Ja(`ai_seq_prompt`',
    'nfH3StepHint=()=>{let e=nfH3SubmitSteps();return e===4?`4 步：自动启用 Turbo LoRA`:e===20?`20 步：推荐质量基线`:`${e} 步：自定义采样`},[nfH3LoraSnapshot,nfSetH3LoraSnapshot]=(0,_.useState)(()=>window.NovaFlowAiSequenceMiniMaxH3LoraResource?.getSnapshot?.()||{mode:`t2v`,steps:4,items:[],selected:[],loading:!1,error:``}),nfH3LoraApi=()=>window.NovaFlowAiSequenceMiniMaxH3LoraResource,nfH3LoraMode=()=>({text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[Ve]||`t2v`),nfH3LoraAvailable=()=>{let e=new Set((Array.isArray(nfH3LoraSnapshot?.selected)?nfH3LoraSnapshot.selected:[]).map(e=>String(e?.name||``).toLowerCase()));return(Array.isArray(nfH3LoraSnapshot?.items)?nfH3LoraSnapshot.items:[]).filter(t=>!e.has(String(t?.name||``).toLowerCase()))},nfH3LoraSubscribeEffect=(0,_.useEffect)(()=>{let e=nfH3LoraApi();if(!e?.getSnapshot||!e?.subscribe)return;let t=e=>nfSetH3LoraSnapshot(e);t(e.getSnapshot());return e.subscribe(t)},[]),nfH3LoraRefreshEffect=(0,_.useEffect)(()=>{if(ze!==`minimax_h3_local`)return;let e=nfH3LoraApi(),t=nfH3LoraMode(),n=nfH3SubmitSteps();if(!e?.refreshCatalog){nfSetH3LoraSnapshot({mode:t,steps:n,items:[],selected:[],loading:!1,error:`MiniMax H3 LoRA 兼容目录模块未加载`});return}try{e.setContext?.({mode:t,steps:n})}catch{}Promise.resolve(e.refreshCatalog({mode:t,steps:n})).catch(()=>{})},[ze,Ve,nfH3Steps]),Fr=Ja(`ai_seq_prompt`',
    'independent H3 LoRA snapshot, subscription, and context refresh',
  )

  const h3LoraSection =
    'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`,"data-novaflow-ai-mode-body-item":`1`,style:{width:`100%`,minWidth:0,maxWidth:`100%`,marginTop:8,marginBottom:0,paddingTop:0,border:0,position:`relative`,zIndex:21,pointerEvents:`auto`},children:[' +
    '(0,X.jsx)(`div`,{"data-novaflow-ai-lora-head":`1`,style:{display:`block`,marginBottom:7},children:(0,X.jsx)(`div`,{"data-novaflow-ai-lora-title":`1`,children:`MiniMax H3 LoRA`})}),' +
    'Number(nfPanelH3LoraSnapshot?.steps)===4&&(0,X.jsxs)(`div`,{"data-novaflow-h3-internal-turbo":`1`,style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:8,padding:`8px 10px`,marginBottom:8,borderRadius:8,background:`rgba(30,166,114,0.10)`,border:`1px solid rgba(30,166,114,0.26)`,fontSize:11},children:[(0,X.jsx)(`span`,{style:{color:`rgba(238,248,244,0.94)`},children:`内置 Turbo LoRA`}),(0,X.jsx)(`span`,{style:{color:`#62d6aa`,whiteSpace:`nowrap`},children:`0.75 · 已启用`})]}),' +
    '(0,X.jsxs)(`div`,{style:{display:`grid`,gap:6},children:[(0,X.jsx)(Qt,{children:`添加兼容 LoRA`}),(0,X.jsxs)(tn,{"data-novaflow-h3-lora-add":`1`,value:``,disabled:!!nfPanelH3LoraSnapshot?.loading||nfPanelH3LoraAvailable().length===0,onChange:e=>{let t=String(e.target.value||``);if(!t)return;try{let e=nfPanelH3LoraApi(),n=Array.isArray(nfPanelH3LoraSnapshot?.selected)?nfPanelH3LoraSnapshot.selected:[];e?.setSelection?.([...n,{name:t}])}catch(e){o({state:`error`,message:`MiniMax H3 LoRA 添加失败：${String(e?.message||e)}`})}},children:[(0,X.jsx)(`option`,{value:``,children:nfPanelH3LoraSnapshot?.loading?`正在读取兼容 LoRA…`:nfPanelH3LoraAvailable().length?`请选择兼容 LoRA`:Array.isArray(nfPanelH3LoraSnapshot?.items)&&nfPanelH3LoraSnapshot.items.length?`所有兼容 LoRA 已添加`:`暂无兼容 LoRA`}),...nfPanelH3LoraAvailable().map(e=>(0,X.jsx)(`option`,{value:e.name,children:e.name},e.name))]})]}),' +
    'Array.isArray(nfPanelH3LoraSnapshot?.selected)&&nfPanelH3LoraSnapshot.selected.length?(0,X.jsx)(`div`,{style:{display:`grid`,gap:8,marginTop:8},children:nfPanelH3LoraSnapshot.selected.map(e=>{let t=e?.strengthRange||{min:0,max:2,step:.05},n=Number(e?.strength),r=Number.isFinite(n)?n:Number(t.default)||1;return(0,X.jsx)(`div`,{"data-novaflow-ai-lora-card":`1`,"data-novaflow-h3-lora-card":`1`,style:{padding:10,borderRadius:10,border:`1px solid rgba(255,255,255,0.10)`,background:`rgba(255,255,255,0.03)`},children:(0,X.jsxs)(`div`,{style:{display:`grid`,gap:8},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(244,247,251,0.92)`,wordBreak:`break-all`},children:e.name}),(0,X.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,gap:10},children:[(0,X.jsxs)(`div`,{style:{flex:1},children:[(0,X.jsxs)(Qt,{children:[`强度：`,r.toFixed(2)]}),(0,X.jsx)(`input`,{type:`range`,min:Number(t.min)||0,max:Number(t.max)||2,step:Number(t.step)||.05,value:r,onChange:t=>{try{nfPanelH3LoraApi()?.updateStrength?.(e.name,Number(t.target.value))}catch(t){o({state:`error`,message:`MiniMax H3 LoRA 强度更新失败：${String(t?.message||t)}`})}},style:{width:`100%`}})]}),(0,X.jsx)(`button`,{"data-novaflow-h3-lora-remove":`1`,type:`button`,onClick:()=>nfPanelH3LoraApi()?.remove?.(e.name),style:{width:28,height:28,borderRadius:8,background:`rgba(239,68,68,0.12)`,border:`1px solid rgba(239,68,68,0.35)`,color:`#fca5a5`,cursor:`pointer`,fontWeight:900,fontSize:14,lineHeight:`26px`},children:`×`})]})]})},e.name)})}):null,' +
    'nfPanelH3LoraSnapshot?.error?(0,X.jsx)(`div`,{"data-novaflow-ai-lora-empty":`1`,style:{marginTop:7,fontSize:11,color:`#fca5a5`,lineHeight:1.5},children:`兼容 LoRA 列表不可用：${String(nfPanelH3LoraSnapshot.error)}`}):!nfPanelH3LoraSnapshot?.loading&&(!Array.isArray(nfPanelH3LoraSnapshot?.items)||nfPanelH3LoraSnapshot.items.length===0)?(0,X.jsx)(`div`,{"data-novaflow-ai-lora-empty":`1`,style:{marginTop:7,fontSize:11,color:`#9a9a9a`,lineHeight:1.5},children:`当前模式与步数暂无兼容 LoRA`}):null]})'

  const h3LoraSurfaceMarker = '"data-novaflow-h3-lora-section":`1`'
  const h3LoraSurfaceCount = occurrenceCount(source, h3LoraSurfaceMarker)
  if (h3LoraSurfaceCount === 0) {
    replaceOnce(
      ']})]}),(0,X.jsxs)(`div`,{"data-novaflow-ai-post-section":`1`',
      `]})]}),${h3LoraSection},(0,X.jsxs)(\`div\`,{"data-novaflow-ai-post-section":\`1\``,
      'H3 LoRA controls before the post-processing section',
    )
  } else if (h3LoraSurfaceCount !== 1) {
    throw new Error(`H3 LoRA controls: expected one already-patched surface, found ${h3LoraSurfaceCount}`)
  }
  const legacyH3LoraSurfaceStart = 'ze===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`'
  const panelH3LoraSurfaceStart = 'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`'
  const legacyH3LoraSurfaceCount = occurrenceCount(source, legacyH3LoraSurfaceStart)
  const panelH3LoraSurfaceCount = occurrenceCount(source, panelH3LoraSurfaceStart)
  if (legacyH3LoraSurfaceCount === 1 && panelH3LoraSurfaceCount === 0) {
    const legacyStart = source.indexOf(legacyH3LoraSurfaceStart)
    const postSectionStart = source.indexOf(',(0,X.jsxs)(`div`,{"data-novaflow-ai-post-section":`1`', legacyStart)
    if (postSectionStart < 0) throw new Error('model-panel H3 LoRA migration: post section not found')
    source = source.slice(0, legacyStart) + h3LoraSection + source.slice(postSectionStart)
  } else if (legacyH3LoraSurfaceCount !== 0 || panelH3LoraSurfaceCount !== 1) {
    throw new Error(
      `model-panel H3 LoRA migration: expected legacy/panel counts 0/1 or 1/0, found ${legacyH3LoraSurfaceCount}/${panelH3LoraSurfaceCount}`,
    )
  }
  applyH3LoraModeBodyWidthOwnership()
  replaceOnceOrAlready(
    'children:[(0,X.jsx)(`span`,{style:{color:`rgba(238,248,244,0.94)`},children:`内置 Turbo LoRA`}),(0,X.jsx)(`span`,{style:{color:`#62d6aa`,whiteSpace:`nowrap`},children:`0.75 · 已启用`})]',
    'children:(0,X.jsx)(`span`,{style:{color:`#62d6aa`,whiteSpace:`nowrap`},children:`内置 Turbo LoRA · 0.75 · 已启用`})',
    'exact read-only H3 internal Turbo profile label',
  )
  replaceOnceOrAlready(
    'else if(a!==`text_video`){e.setAiSeqJob({state:`error`,message:`MiniMax H3 模式无效`});return}let nfVideos=[]',
    'else if(a!==`text_video`){e.setAiSeqJob({state:`error`,message:`MiniMax H3 模式无效`});return}let nfH3ValidatedLoras=[];if(nfH3Mode){let nfH3LoraResource=window.NovaFlowAiSequenceMiniMaxH3LoraResource;if(!nfH3LoraResource?.validateSelection){e.setAiSeqJob({state:`error`,message:`MiniMax H3 LoRA 兼容性模块未加载`});return}try{nfH3ValidatedLoras=Array.from(await nfH3LoraResource.validateSelection({mode:a,steps:nfH3SubmitOptions?.steps}))}catch(nfH3LoraError){e.setAiSeqJob({state:`error`,message:`MiniMax H3 LoRA 校验失败：${String(nfH3LoraError?.message||nfH3LoraError)}`});return}if(t!==e.aiSeqRunTokenRef.current)return}let nfVideos=[]',
    'H3 LoRA submit validation before media uploads',
  )
  replaceOnceOrAlready(
    'if(t!==e.aiSeqRunTokenRef.current)return;let c=e=>{let t=String(e||``).trim().replace(/^\\uFEFF/,``);',
    'if(t!==e.aiSeqRunTokenRef.current)return;if(nfH3Mode){let nfH3FinalLoraResource=window.NovaFlowAiSequenceMiniMaxH3LoraResource;if(!nfH3FinalLoraResource?.validateSelection){e.setAiSeqJob({state:`error`,message:`MiniMax H3 LoRA 最终校验模块不可用`});return}try{nfH3ValidatedLoras=Array.from(await nfH3FinalLoraResource.validateSelection({mode:a,steps:nfH3SubmitOptions?.steps}))}catch(nfH3FinalLoraError){e.setAiSeqJob({state:`error`,message:`MiniMax H3 LoRA 最终校验失败：${String(nfH3FinalLoraError?.message||nfH3FinalLoraError)}`});return}if(t!==e.aiSeqRunTokenRef.current)return}let c=e=>{let t=String(e||``).trim().replace(/^\\uFEFF/,``);',
    'final H3 LoRA validation after all uploads and before workflow construction',
  )
  replaceOnceOrAlready(
    'steps:nfH3SubmitOptions?.steps,seed:d',
    'steps:nfH3SubmitOptions?.steps,loras:nfH3ValidatedLoras,seed:d',
    'validated H3 LoRAs passed to the workflow module',
  )
  replaceOnceOrAlready(
    'let _=nfH3Mode?0:(Array.isArray(e.aiSeqComfyLoras)',
    'let _=nfH3Mode?nfH3ValidatedLoras.length:(Array.isArray(e.aiSeqComfyLoras)',
    'H3 generation status counts only validated H3 LoRAs',
  )
}

function applyWan22CompatibleLoraSurfaceFixes() {
  replaceOnceOrAlready(
    'aiSeqComfyLoras:w,setAiSeqComfyLoras:T,aiSeqVideoRef:E',
    'aiSeqComfyLoras:w,setAiSeqComfyLoras:T,aiSeqSampleSteps:nfWanPanelSteps,aiSeqVideoRef:E',
    'Wan panel receives the actual sampling steps',
  )
  replaceOnceOrAlready(
    'aiSeqComfyLoras:et,setAiSeqComfyLoras:rt,AiSeqBgRemoveDock:zt',
    'aiSeqComfyLoras:et,setAiSeqComfyLoras:rt,aiSeqSampleSteps:Tt,AiSeqBgRemoveDock:zt',
    'Wan panel actual steps prop wiring',
  )
  const wanPanelState = '[nfPanelWanLoraSnapshot,nfSetPanelWanLoraSnapshot]=(0,_.useState)(()=>window.NovaFlowAiSequenceWan22LoraResource?.getSnapshot?.()||{highName:``,lowName:``,steps:Number(nfWanPanelSteps)||4,items:[],selected:[],loading:!1,error:``}),nfPanelWanLoraApi=()=>window.NovaFlowAiSequenceWan22LoraResource,nfPanelWanLoraAvailable=e=>{let t=String(e||``).toLowerCase(),n=new Set((Array.isArray(nfPanelWanLoraSnapshot?.selected)?nfPanelWanLoraSnapshot.selected:[]).map(e=>String(e?.name||``).toLowerCase()));return(Array.isArray(nfPanelWanLoraSnapshot?.items)?nfPanelWanLoraSnapshot.items:[]).filter(e=>!n.has(String(e?.name||``).toLowerCase())&&(e?.role===t||e?.role===`shared`))},nfPanelWanLoraSubscribeEffect=(0,_.useEffect)(()=>{let e=nfPanelWanLoraApi();if(!e?.getSnapshot||!e?.subscribe)return;let t=e=>{nfSetPanelWanLoraSnapshot(e),T(Array.from(Array.isArray(e?.selected)?e.selected:[]))};t(e.getSnapshot());return e.subscribe(t)},[]),nfPanelWanLoraRefreshEffect=(0,_.useEffect)(()=>{if(r!==`local`)return;let e=nfPanelWanLoraApi(),t={highName:String(b||``).trim(),lowName:String(S||``).trim(),steps:Number(nfWanPanelSteps)};if(!e?.refreshCatalog){nfSetPanelWanLoraSnapshot({...t,items:[],selected:[],loading:!1,error:`Wan2.2 LoRA 兼容目录模块未加载`}),T([]);return}try{e.setContext?.(t)}catch(n){nfSetPanelWanLoraSnapshot({...t,items:[],selected:[],loading:!1,error:String(n?.message||n)}),T([]);return}Promise.resolve(e.refreshCatalog(t)).catch(()=>{})},[r,b,S,nfWanPanelSteps])'
  const wanPanelStateMarker = 'nfPanelWanLoraAvailable=e=>'
  if (occurrenceCount(source, wanPanelStateMarker) === 0) {
    const existingWanPanelStateMarker = '[nfPanelWanLoraSnapshot,nfSetPanelWanLoraSnapshot]='
    if (occurrenceCount(source, existingWanPanelStateMarker) === 1) {
      replaceRange(
        existingWanPanelStateMarker,
        ',Se=(0,_.useRef)(0)',
        wanPanelState,
        'migrate Wan LoRA panel state to role-aware catalog filtering',
      )
    } else {
      replaceOnce(
        'nfPanelH3LoraSubscribeEffect=(0,_.useEffect)(()=>{let e=nfPanelH3LoraApi();if(!e?.getSnapshot||!e?.subscribe)return;let t=e=>nfSetPanelH3LoraSnapshot(e);t(e.getSnapshot());return e.subscribe(t)},[]),Se=',
        `nfPanelH3LoraSubscribeEffect=(0,_.useEffect)(()=>{let e=nfPanelH3LoraApi();if(!e?.getSnapshot||!e?.subscribe)return;let t=e=>nfSetPanelH3LoraSnapshot(e);t(e.getSnapshot());return e.subscribe(t)},[]),${wanPanelState},Se=`,
        'independent Wan LoRA snapshot, subscription, and secure context refresh',
      )
    }
  } else if (occurrenceCount(source, wanPanelStateMarker) !== 1) {
    throw new Error(`Wan role-aware panel state: expected one marker, found ${occurrenceCount(source, wanPanelStateMarker)}`)
  }
  const duplicateWanRequestTokenRef = ',Se=(0,_.useRef)(0),Se=(0,_.useRef)(0),Ce='
  const duplicateWanRequestTokenRefCount = occurrenceCount(source, duplicateWanRequestTokenRef)
  if (duplicateWanRequestTokenRefCount === 1) {
    source = source.replace(duplicateWanRequestTokenRef, ',Se=(0,_.useRef)(0),Ce=')
  } else if (duplicateWanRequestTokenRefCount !== 0) {
    throw new Error(`Wan role-aware panel state: duplicate Runtime request token refs found ${duplicateWanRequestTokenRefCount} times`)
  }
  replaceOnceOrAlready(
    '{unets:r,loras:i}=Me(n)',
    '{unets:r}=Me(n)',
    'renderer object_info no longer consumes raw Wan LoRA names',
  )
  replaceOnceOrAlready(
    ',o=Array.from(new Set(i.filter(nfWanVisibleModel))).sort((e,t)=>e.localeCompare(t));_e(a),ye(o)',
    ';_e(a),ye([])',
    'renderer raw Wan LoRA list is discarded',
  )

  const wanLoraSection =
    'aiSeqWanModel&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-wan22-lora-section":`1`,style:{width:`100%`,minWidth:0,maxWidth:`100%`,marginTop:8,marginBottom:0,paddingTop:0,border:0,position:`relative`,zIndex:21,pointerEvents:`auto`},children:[' +
    '(0,X.jsx)(`div`,{"data-novaflow-ai-lora-head":`1`,style:{display:`block`,marginBottom:7},children:(0,X.jsx)(`div`,{"data-novaflow-ai-lora-title":`1`,children:`Wan2.2 LoRA`})}),' +
    '...[`high`,`low`].map(nfWanRole=>{let nfWanRoleLabel=nfWanRole===`high`?`High LoRA`:`Low LoRA`,nfWanAvailable=nfPanelWanLoraAvailable(nfWanRole),nfWanSelected=(Array.isArray(nfPanelWanLoraSnapshot?.selected)?nfPanelWanLoraSnapshot.selected:[]).filter(e=>e?.role===nfWanRole||e?.role===`shared`);return(0,X.jsxs)(`div`,{"data-novaflow-wan22-lora-role-group":nfWanRole,style:{display:`grid`,gap:6,marginTop:nfWanRole===`low`?10:0,paddingTop:nfWanRole===`low`?10:0,borderTop:nfWanRole===`low`?`1px solid rgba(255,255,255,0.08)`:`0`},children:[(0,X.jsx)(Qt,{children:nfWanRoleLabel}),(0,X.jsxs)(tn,{"data-novaflow-wan22-lora-add":nfWanRole,value:``,disabled:!!nfPanelWanLoraSnapshot?.loading||nfWanAvailable.length===0,onChange:e=>{let t=String(e.target.value||``);if(!t)return;try{let e=nfPanelWanLoraApi(),n=Array.isArray(nfPanelWanLoraSnapshot?.selected)?nfPanelWanLoraSnapshot.selected:[];e?.setSelection?.([...n,{name:t}])}catch{}},children:[(0,X.jsx)(`option`,{value:``,children:nfPanelWanLoraSnapshot?.loading?`正在读取兼容 LoRA…`:nfWanAvailable.length?`添加 ${nfWanRoleLabel}`:`暂无可添加 ${nfWanRoleLabel}`}),...nfWanAvailable.map(e=>(0,X.jsx)(`option`,{value:e.name,children:`${e.name}${e.role===`shared`?`（共享 High + Low）`:nfWanRole===`high`?`（High）`:`（Low）`}`},e.name))]}),nfWanSelected.length?(0,X.jsx)(`div`,{style:{display:`grid`,gap:8},children:nfWanSelected.map(e=>{let t=e?.strengthRange||{min:0,max:2,step:.05,default:1},n=Number(e?.strength),r=Number.isFinite(n)?n:Number(t.default)||1;return(0,X.jsx)(`div`,{"data-novaflow-ai-lora-card":`1`,"data-novaflow-wan22-lora-card":`1`,"data-novaflow-wan22-lora-role":e.role,style:{padding:10,borderRadius:10,border:`1px solid rgba(255,255,255,0.10)`,background:`rgba(255,255,255,0.03)`},children:(0,X.jsxs)(`div`,{style:{display:`grid`,gap:8},children:[(0,X.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:8,fontSize:11,color:`rgba(244,247,251,0.92)`},children:[(0,X.jsx)(`span`,{style:{wordBreak:`break-all`},children:e.name}),(0,X.jsx)(`span`,{style:{color:e.role===`shared`?`#62d6aa`:`#9a9a9a`,whiteSpace:`nowrap`},children:e.role===`shared`?`共享 High + Low`:nfWanRoleLabel})]}),(0,X.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,gap:10},children:[(0,X.jsxs)(`div`,{style:{flex:1},children:[(0,X.jsxs)(Qt,{children:[`强度：`,r.toFixed(2)]}),(0,X.jsx)(`input`,{type:`range`,min:Number(t.min)||0,max:Number(t.max)||2,step:Number(t.step)||.05,value:r,onChange:t=>{try{nfPanelWanLoraApi()?.updateStrength?.(e.name,Number(t.target.value))}catch{}},style:{width:`100%`}})]}),(0,X.jsx)(`button`,{"data-novaflow-wan22-lora-remove":e.role,type:`button`,onClick:()=>nfPanelWanLoraApi()?.remove?.(e.name),style:{width:28,height:28,borderRadius:8,background:`rgba(239,68,68,0.12)`,border:`1px solid rgba(239,68,68,0.35)`,color:`#fca5a5`,cursor:`pointer`,fontWeight:900,fontSize:14,lineHeight:`26px`},children:`×`})]})]})},`${nfWanRole}:${e.name}`)})}):(0,X.jsx)(`div`,{style:{fontSize:11,color:`#777`,lineHeight:1.5},children:`未选择 ${nfWanRoleLabel}`})]},nfWanRole)}),' +
    'nfPanelWanLoraSnapshot?.error?(0,X.jsx)(`div`,{"data-novaflow-ai-lora-empty":`1`,style:{marginTop:7,fontSize:11,color:`#fca5a5`,lineHeight:1.5},children:`兼容 LoRA 列表不可用：${String(nfPanelWanLoraSnapshot.error)}`}):!nfPanelWanLoraSnapshot?.loading&&(!Array.isArray(nfPanelWanLoraSnapshot?.items)||nfPanelWanLoraSnapshot.items.length===0)?(0,X.jsx)(`div`,{"data-novaflow-ai-lora-empty":`1`,style:{marginTop:7,fontSize:11,color:`#9a9a9a`,lineHeight:1.5},children:`当前 High / Low 模型与步数暂无兼容 LoRA`}):null]})'

  const wanSurfaceMarker = '"data-novaflow-wan22-lora-section":`1`'
  const wanSurfaceCount = occurrenceCount(source, wanSurfaceMarker)
  const wanRoleSurfaceMarker = '"data-novaflow-wan22-lora-role-group":nfWanRole'
  const wanRoleSurfaceCount = occurrenceCount(source, wanRoleSurfaceMarker)
  if (wanRoleSurfaceCount === 0) {
    replaceRange(
      'aiSeqWanModel&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`',
      'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`',
      `${wanLoraSection}]}),`,
      'Wan High and Low LoRA controls use only role-aware compatibility catalog items',
    )
  } else if (wanSurfaceCount !== 1 || wanRoleSurfaceCount !== 1) {
    throw new Error(`Wan LoRA controls: expected one surface and role marker, found ${wanSurfaceCount}/${wanRoleSurfaceCount}`)
  }

  const wanFailFastMarker = 'let nfWanSubmitContext={highName:String(e.aiSeqComfyUnetHighName||``).trim()'
  const wanFailFastCount = occurrenceCount(source, wanFailFastMarker)
  if (wanFailFastCount === 0) {
    replaceOnce(
      'if(t!==e.aiSeqRunTokenRef.current)return}let nfVideos=[]',
      'if(t!==e.aiSeqRunTokenRef.current)return}let nfWanSubmitContext={highName:String(e.aiSeqComfyUnetHighName||``).trim(),lowName:String(e.aiSeqComfyUnetLowName||``).trim(),steps:Number(e.aiSeqSampleSteps)},nfWanValidatedLoras=[];if(!nfH3Mode){let nfWanLoraResource=window.NovaFlowAiSequenceWan22LoraResource;if(!nfWanLoraResource?.validateSelection){e.setAiSeqJob({state:`error`,message:`Wan2.2 LoRA 兼容性模块未加载`});return}try{nfWanValidatedLoras=Array.from(await nfWanLoraResource.validateSelection(nfWanSubmitContext))}catch(nfWanLoraError){e.setAiSeqJob({state:`error`,message:`Wan2.2 LoRA 校验失败：${String(nfWanLoraError?.message||nfWanLoraError)}`});return}if(t!==e.aiSeqRunTokenRef.current)return}let nfVideos=[]',
      'Wan LoRA fail-fast validation before the first media upload',
    )
  } else if (wanFailFastCount !== 1) {
    throw new Error(`Wan LoRA fail-fast validation: expected one marker, found ${wanFailFastCount}`)
  }
  const wanFinalValidationMarker = 'let nfWanFinalLoraResource=window.NovaFlowAiSequenceWan22LoraResource'
  const wanFinalValidationCount = occurrenceCount(source, wanFinalValidationMarker)
  if (wanFinalValidationCount === 0) {
    replaceOnce(
      'if(t!==e.aiSeqRunTokenRef.current)return}let c=e=>{let t=String(e||``).trim().replace(/^\\uFEFF/,``);',
      'if(t!==e.aiSeqRunTokenRef.current)return}if(!nfH3Mode){let nfWanFinalLoraResource=window.NovaFlowAiSequenceWan22LoraResource;if(!nfWanFinalLoraResource?.validateSelection){e.setAiSeqJob({state:`error`,message:`Wan2.2 LoRA 最终校验模块不可用`});return}try{nfWanValidatedLoras=Array.from(await nfWanFinalLoraResource.validateSelection(nfWanSubmitContext))}catch(nfWanFinalLoraError){e.setAiSeqJob({state:`error`,message:`Wan2.2 LoRA 最终校验失败：${String(nfWanFinalLoraError?.message||nfWanFinalLoraError)}`});return}if(t!==e.aiSeqRunTokenRef.current)return}let c=e=>{let t=String(e||``).trim().replace(/^\\uFEFF/,``);',
      'Wan LoRA final validation after uploads and before workflow construction',
    )
  } else if (wanFinalValidationCount !== 1) {
    throw new Error(`Wan LoRA final validation: expected one marker, found ${wanFinalValidationCount}`)
  }
  const wanRawLoraBuild = 'loras:Array.isArray(e.aiSeqComfyLoras)?e.aiSeqComfyLoras:void 0'
  const wanValidatedLoraBuild = 'loras:nfWanValidatedLoras'
  const wanRoleAwareBuildMarker = 'nfWanRoleWorkflow.buildRoleAwareWorkflow(u,nfWanValidatedLoras).workflow'
  if (occurrenceCount(source, wanRoleAwareBuildMarker) === 0) {
    const rawBuildCount = occurrenceCount(source, wanRawLoraBuild)
    const validatedBuildCount = occurrenceCount(source, wanValidatedLoraBuild)
    if (rawBuildCount === 1 && validatedBuildCount === 0) {
      source = source.replace(wanRawLoraBuild, wanValidatedLoraBuild)
    } else if (rawBuildCount !== 0 || validatedBuildCount !== 1) {
      throw new Error(`Wan validated LoRA workflow input: expected one raw or validated build, found ${rawBuildCount}/${validatedBuildCount}`)
    }
    replaceOnce(
      'loras:nfWanValidatedLoras})}}catch(t){',
      'loras:[]});let nfWanRoleWorkflow=window.NovaFlowAiSequenceWan22LoraWorkflow;if(!nfWanRoleWorkflow?.buildRoleAwareWorkflow)throw Error(`Wan2.2 角色 LoRA 工作流模块未加载`);u=nfWanRoleWorkflow.buildRoleAwareWorkflow(u,nfWanValidatedLoras).workflow}}catch(t){',
      'Wan Cn stays LoRA-free before the role-aware workflow module injects validated descriptors',
    )
  } else if (occurrenceCount(source, wanRoleAwareBuildMarker) !== 1) {
    throw new Error(`Wan role-aware workflow build: expected one marker, found ${occurrenceCount(source, wanRoleAwareBuildMarker)}`)
  }
  replaceOnceOrAlready(
    'let _=nfH3Mode?nfH3ValidatedLoras.length:(Array.isArray(e.aiSeqComfyLoras)?e.aiSeqComfyLoras:[]).filter(e=>e?.enabled!==!1&&String(e?.name||``).trim()&&Number.isFinite(Number(e?.weight))).length',
    'let _=nfH3Mode?nfH3ValidatedLoras.length:nfWanValidatedLoras.length',
    'Wan generation status counts only freshly validated LoRAs',
  )
}

if (process.argv.includes('--post-audit-only')) {
  applyPostAuditFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} post-audit fixes`)
  process.exit(0)
}

if (process.argv.includes('--runtime-isolation-only')) {
  applyRuntimeIsolationFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} Runtime isolation fixes`)
  process.exit(0)
}

if (process.argv.includes('--reference-media-only')) {
  applyReferenceMediaContractFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} reference media contract`)
  process.exit(0)
}

if (process.argv.includes('--followup-parameters-only')) {
  applyFollowupParameterAndLayoutFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 follow-up parameters and layout`)
  process.exit(0)
}

if (process.argv.includes('--followup-syntax-repair-only')) {
  applyFollowupSyntaxRepair()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`repaired ${path.relative(repoRoot, bundlePath)} H3 follow-up syntax`)
  process.exit(0)
}

if (process.argv.includes('--followup-settings-syntax-repair-only')) {
  applyFollowupSettingsSyntaxRepair()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`repaired ${path.relative(repoRoot, bundlePath)} H3 settings syntax`)
  process.exit(0)
}

if (process.argv.includes('--reference-policy-submit-only')) {
  applyReferencePolicySubmitFix()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 reference policy submit`)
  process.exit(0)
}

if (process.argv.includes('--submit-duration-snapshot-only')) {
  applySubmitDurationSnapshotFix()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 submit duration snapshot`)
  process.exit(0)
}

if (process.argv.includes('--independent-surface-runtime-only')) {
  applyIndependentSurfaceStateAndWanRuntimeFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} independent H3 surface state and Runtime routing`)
  process.exit(0)
}

if (process.argv.includes('--wan-filter-normalization-only')) {
  applyWanDirectoryFilterNormalizationFix()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} Wan model directory filter normalization`)
  process.exit(0)
}

if (process.argv.includes('--fixed-probe-input-only')) {
  applyFixedProbeInputNormalizationFix()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} fixed Runtime probe input URL`)
  process.exit(0)
}

if (process.argv.includes('--final-controls-endpoints-only')) {
  applyFinalH3ControlsAndEndpointFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} final H3 controls and fixed helper endpoints`)
  process.exit(0)
}

if (process.argv.includes('--freeform-steps-only')) {
  applyFreeFormH3StepsFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} free-form H3 steps`)
  process.exit(0)
}

if (process.argv.includes('--h3-lora-width-only')) {
  applyH3LoraModeBodyWidthOwnership()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 LoRA width ownership`)
  process.exit(0)
}

if (process.argv.includes('--h3-prompt-semantics-only')) {
  applyH3PromptModeSemantics()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 prompt mode semantics`)
  process.exit(0)
}

if (process.argv.includes('--h3-short-duration-only')) {
  applyH3ShortDurationUiFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 short-duration controls`)
  process.exit(0)
}

if (process.argv.includes('--h3-parameter-tooltips-only')) {
  applyH3ParameterTooltipFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 parameter tooltips`)
  process.exit(0)
}

if (process.argv.includes('--h3-output-warehouse-only')) {
  applyH3OutputWarehouseFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 output warehouse`)
  process.exit(0)
}

if (process.argv.includes('--h3-lora-surface-only')) {
  applyH3CompatibleLoraSurfaceFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} H3 compatible LoRA surface`)
  process.exit(0)
}

if (process.argv.includes('--wan22-lora-surface-only')) {
  applyWan22CompatibleLoraSurfaceFixes()
  fs.writeFileSync(bundlePath, source, 'utf8')
  console.log(`patched ${path.relative(repoRoot, bundlePath)} Wan2.2 compatible LoRA surface`)
  process.exit(0)
}

replaceOnce(
  'aiSeqTopModeCenterLeft:d,aiSeqGenType:f,setAiSeqGenType:p',
  'aiSeqTopModeCenterLeft:d,aiSeqMode:nfAiSeqMode,aiSeqGenType:f,setAiSeqGenType:p',
  'top mode component model prop',
)

replaceOnce(
  'children:[...[{value:`image_video`,label:`图生视频`},{value:`first_last`,label:`首尾帧视频`}].map',
  'children:[...(nfAiSeqMode===`minimax_h3_local`?[{value:`text_video`,label:`文生视频`},{value:`image_video`,label:`图生视频`},{value:`first_last`,label:`首尾帧视频`},{value:`multi_reference`,label:`多参视频`}]:[{value:`image_video`,label:`图生视频`},{value:`first_last`,label:`首尾帧视频`}]).map',
  'top mode options',
)

replaceOnce(
  'aiSeqMode:r,setAiSeqMode:i,aiSeqGenType:a,getAiSeqWorkflowJson:o',
  'aiSeqMode:r,setAiSeqMode:i,aiSeqGenType:a,setAiSeqGenType:nfSetAiSeqGenType,getAiSeqWorkflowJson:o',
  'left model panel generation setter',
)

replaceRange(
  'aiSeqModelPresets={',
  '(0,_.useEffect)(()=>{r===`local`',
  'aiSeqModelPresets={local_a:{mode:`local`,label:`Wan2_2`,high:`smoothMixWan22I2V14B_i2vHigh.safetensors`,low:`smoothMixWan22I2V14B_i2vLow.safetensors`,summary:`Wan2_2：沿用双 UNET High / Low 工作流。`,detail:`High: smoothMixWan22I2V14B_i2vHigh.safetensors / Low: smoothMixWan22I2V14B_i2vLow.safetensors`},minimax_h3_local:{mode:`minimax_h3_local`,label:`MiniMax_h3`,summary:`MiniMax H3：按模式使用单个 FL2VA 或 Ref2VA 模型，不使用 High / Low。`,detail:`固定 24 FPS、20 步；不接入 Wan2.2 High / Low、LoRA 或反向提示词。`}},aiSeqModelValue=r===`minimax_h3_local`?`minimax_h3_local`:`local_a`,aiSeqWanModel=aiSeqModelValue===`local_a`,aiSeqCloudModel=!1,applyAiSeqModelValue=e=>{let t=String(e||`local_a`),n=aiSeqModelPresets[t]||aiSeqModelPresets.local_a;t===`minimax_h3_local`?(i(`minimax_h3_local`),nfSetAiSeqGenType?.(`text_video`),g(`http://127.0.0.1:8189`)):(i(`local`),[`image_video`,`first_last`].includes(a)||nfSetAiSeqGenType?.(`image_video`),g(`http://127.0.0.1:8188`),x(n.high||``),C(n.low||``))};',
  'AI sequence model presets',
)

replaceRange(
  '(0,X.jsxs)(tn,{value:aiSeqModelValue,onChange:e=>applyAiSeqModelValue(e.target.value),children:[',
  ']})]}),(0,X.jsx)(`div`,{style:{marginTop:8',
  '(0,X.jsxs)(tn,{value:aiSeqModelValue,onChange:e=>applyAiSeqModelValue(e.target.value),children:[(0,X.jsx)(`option`,{value:`local_a`,children:`Wan2_2`}),(0,X.jsx)(`option`,{value:`minimax_h3_local`,children:`MiniMax_h3`})',
  'AI sequence model dropdown',
)

replaceOnce('!aiSeqCloudModel&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`', 'aiSeqWanModel&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`', 'Wan-only LoRA section')

replaceRange(
  ',aiSeqCloudModel&&(0,X.jsx)(`div`,{"data-novaflow-ai-lora-disabled":`1`',
  ',(0,X.jsxs)(`div`,{"data-novaflow-ai-post-section":`1`',
  '',
  'retired cloud LoRA notice',
)

replaceFirstAfter(
  'aiSeqModelPresets={',
  'placeholder:`http://127.0.0.1:8188`',
  'placeholder:aiSeqWanModel?`http://127.0.0.1:8188`:`http://127.0.0.1:8189`',
  'selected runtime placeholder',
)

replaceOnce(
  'D=()=>f===`image_video`?Vt:Ht',
  'D=()=>u===`minimax_h3_local`?window.NovaFlowAiSequenceMiniMaxH3Workflow?.getWorkflowJson?.({text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[f]):f===`image_video`?Vt:Ht',
  'state workflow selector',
)

replaceOnce(
  'aiSeqTopModeCenterLeft:Bn,aiSeqGenType:Ve,setAiSeqGenType:He',
  'aiSeqTopModeCenterLeft:Bn,aiSeqMode:ze,aiSeqGenType:Ve,setAiSeqGenType:He',
  'top mode component invocation',
)

replaceOnce(
  'aiSeqMode:ze,setAiSeqMode:Be,aiSeqGenType:Ve,getAiSeqWorkflowJson:Ue',
  'aiSeqMode:ze,setAiSeqMode:Be,aiSeqGenType:Ve,setAiSeqGenType:He,getAiSeqWorkflowJson:Ue',
  'left model panel invocation',
)

replaceOnce(
  ';let t=ze===`cloud`&&ot===`jimeng`,nfStrictAiSeqFirstFrame=ze===`cloud`&&Ve===`image_video`&&!!vt(`strictFirstFrame`)',
  ';let t=ze===`minimax_h3_local`&&Ve===`multi_reference`,nfStrictAiSeqFirstFrame=!1',
  'reference layout mode gate',
)

replaceOnce(
  'if(Ve===`image_video`){\nif(t&&!nfStrictAiSeqFirstFrame){let nfSeedanceR2VFourRef=!0;',
  'if(Ve===`text_video`)return null;\nif(Ve===`multi_reference`){\nif(t){',
  'multi-reference layout entry',
)

replaceOnce(
  ']})\n};return(0,X.jsx)(e,{title:nfStrictAiSeqFirstFrame?',
  ']})\n};return null}\nif(Ve===`image_video`){return(0,X.jsx)(e,{title:nfStrictAiSeqFirstFrame?',
  'single-image layout entry',
)

const h3Settings = 'children:ze===`minimax_h3_local`?(0,X.jsxs)(X.Fragment,{children:[' +
  '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`分辨率`}),' +
  '(0,X.jsxs)(yn,{value:[`480x864`,`864x480`,`768x1344`,`1344x768`].includes(`${yt}x${xt}`)?`${yt}x${xt}`:`480x864`,onChange:e=>{let[t,n]=String(e.target.value||``).split(`x`).map(Number);Number.isFinite(t)&&Number.isFinite(n)&&(bt(t),St(n),Pt(String(t)),It(String(n)))},style:{width:124,height:30,padding:`0 8px`},children:[' +
  '(0,X.jsx)(`option`,{value:`480x864`,children:`480 × 864`}),(0,X.jsx)(`option`,{value:`864x480`,children:`864 × 480`}),(0,X.jsx)(`option`,{value:`768x1344`,children:`768 × 1344`}),(0,X.jsx)(`option`,{value:`1344x768`,children:`1344 × 768`})]}),' +
  '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`时长`}),' +
  '(0,X.jsxs)(yn,{value:String([124,192,243,362].includes(Number(Ct))?Ct:124),onChange:e=>{let t=Te(Number(e.target.value)||124,5,362);wt(t),Rt(String(t))},style:{width:92,height:30,padding:`0 8px`},children:[' +
  '(0,X.jsx)(`option`,{value:`124`,children:`约 5 秒`}),(0,X.jsx)(`option`,{value:`192`,children:`约 8 秒`}),(0,X.jsx)(`option`,{value:`243`,children:`约 10 秒`}),(0,X.jsx)(`option`,{value:`362`,children:`约 15 秒`})]}),' +
  '(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.55)`,whiteSpace:`nowrap`},children:`固定 24 FPS / 20 步`}),' +
  '(0,X.jsxs)(`div`,{style:{display:`flex`,gap:8,alignItems:`center`},children:[' +
  '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.60)`},children:`随机种子`}),' +
  '(0,X.jsxs)(`button`,{"data-novaflow-ai-state-toggle":Gt?`on`:`off`,type:`button`,onClick:()=>Kt(e=>!e),style:{position:`relative`,display:`inline-flex`,alignItems:`center`,width:34,minWidth:34,height:18,padding:0,border:0,borderRadius:999,background:Gt?`#1ea672`:`#222222`,color:`transparent`,cursor:`pointer`,overflow:`hidden`},children:[' +
  '(0,X.jsx)(`span`,{style:{position:`absolute`,top:`50%`,left:Gt?20:4,width:10,height:10,borderRadius:999,background:Gt?`#e8e8e8`:`#8f98a3`,transform:`translateY(-50%)`}}),Gt?`on`:`off`]}),!Gt&&(0,X.jsx)(_n,{inputMode:`numeric`,value:Yt,onChange:e=>Xt(String(e.target.value||``).replace(/[^0-9]/g,``)),style:{width:70,height:26,padding:`4px 8px`,textAlign:`right`}})]})]}):ze===`local`?'

replaceOnce('children:ze===`local`?', h3Settings, 'H3-specific generation settings')

replaceOnce('ze!==`cloud`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-prompt-column":`1`', 'ze===`local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-prompt-column":`1`', 'Wan-only negative prompt')

replaceOnce(
  'if(n!==`spine`||r!==`ai_animation`||u!==`local`)return;',
  'if(n!==`spine`||r!==`ai_animation`||u!==`local`&&u!==`minimax_h3_local`)return;',
  'local runtime connectivity effect',
)

replaceOnceAfter('function Vs(e){', 'if(a?.comfyRequestJson)return await a.comfyRequestJson', 'if(e.aiSeqMode!==`minimax_h3_local`&&a?.comfyRequestJson)return await a.comfyRequestJson', 'H3 direct JSON requests')
replaceOnceAfter('function Vs(e){', 'if(a?.comfyRequestBinary){', 'if(e.aiSeqMode!==`minimax_h3_local`&&a?.comfyRequestBinary){', 'H3 direct binary requests')
replaceOnceAfter('function Vs(e){', 'if(a?.comfyUploadImage){', 'if(e.aiSeqMode!==`minimax_h3_local`&&a?.comfyUploadImage){', 'H3 direct uploads')
replaceOnceAfter('function Vs(e){', 'fallbackFps:e.aiSeqFps', 'fallbackFps:e.aiSeqMode===`minimax_h3_local`?24:e.aiSeqFps', 'H3 trim FPS')

replaceRange(
  ',D=()=>{',
  ',O=async n=>{',
  ',D=()=>e.aiSeqMode===`minimax_h3_local`?window.NovaFlowAiSequenceMiniMaxH3Workflow?.getWorkflowJson?.({text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[e.aiSeqGenType]):e.aiSeqGenType===`image_video`?Vt:Ht\n',
  'generator workflow selector',
)

replaceRange(
  ',O=async n=>{',
  ',k=async t=>{',
  ',O=async n=>{let nfH3Runtime=e.aiSeqMode===`minimax_h3_local`;nfH3Runtime&&(n=`http://127.0.0.1:8189`);if(!t(n))return e.setAiComfyStatus({state:`error`,message:`NovaFlow AI Runtime 地址为空`}),{ok:!1,message:`NovaFlow AI Runtime 地址为空`};e.setAiComfyStatus({state:`checking`,message:`扫描中…`});let r=nfH3Runtime?[8189]:[8e3,8188,8080,7860,3e3],i=async e=>{let t=`http://127.0.0.1:${e}`,n=window.electronAPI;if(!nfH3Runtime&&n?.comfyGetSystemStats){let e=new Promise((e,t)=>window.setTimeout(()=>t(Error(`timeout`)),2e3)),r=Promise.resolve(n.comfyGetSystemStats({baseUrl:t})).then(e=>{if(!e?.ok)throw Error(String(e?.error||`not ok`));return t});return await Promise.race([r,e])}let r=`${t}/system_stats`,i=new AbortController,a=window.setTimeout(()=>i.abort(),4e3);try{if(!(await fetch(r,{method:`GET`,signal:i.signal,headers:void 0})).ok)throw Error(`not ok`);return t}finally{window.clearTimeout(a)}};try{let t=await Promise.any(r.map(e=>i(e)));try{localStorage.setItem(`comfyui_last_connected_url`,t)}catch{}return e.setAiComfyBaseUrl(t),e.setAiComfyStatus({state:`ok`,message:`已连接 ${t}`}),{ok:!0,message:`已连接 ${t}`}}catch{let t=nfH3Runtime?`未找到 MiniMax H3 Runtime（8189），请确认已安装并启动`:`未找到NovaFlow AI Runtime，请确认已启动`;return e.setAiComfyStatus({state:`error`,message:t}),{ok:!1,message:t}}}',
  'runtime probe isolation',
)

replaceRange(
  ',j=async()=>{try{let t=e.aiSeqRunTokenRef.current+=1,',
  ';if(e.aiSeqMode!==`local`&&!nfCloudMode){',
  ',j=async()=>{try{let t=e.aiSeqRunTokenRef.current+=1,nfH3Mode=e.aiSeqMode===`minimax_h3_local`,nfCloudMode=!1,nfCloudSubmitSnapshot=null,nfCloudProvider=``,nfCloudGenType=e.aiSeqGenType,nfCloudParams={},nfCloudRoute=null,nfStrictCloud=!1',
  'generation mode gate',
)

replaceOnce(';if(e.aiSeqMode!==`local`&&!nfCloudMode){', ';if(e.aiSeqMode!==`local`&&!nfH3Mode){', 'generation H3 allow-list')

replaceOnce(
  '}let n=await O(e.aiComfyBaseUrl);',
  '}if(nfH3Mode&&window.electronAPI?.minimaxH3RuntimeEnsureStarted){e.setAiSeqJob({state:`running`,message:`启动 MiniMax H3 Runtime…`});let nfH3Start=await window.electronAPI.minimaxH3RuntimeEnsureStarted({timeoutMs:18e4});if(!nfH3Start?.running){e.setAiSeqJob({state:`error`,message:`MiniMax H3 Runtime 启动失败：${String(nfH3Start?.error||nfH3Start?.status||`unknown`)}`});return}}let n=await O(nfH3Mode?`http://127.0.0.1:8189`:e.aiComfyBaseUrl);',
  'H3 lifecycle startup',
)

replaceRange(
  'let a=nfCloudGenType,o=[];',
  'let s=[];',
  'let a=e.aiSeqGenType,o=[];if(a===`image_video`){if(!e.aiSeqRefImage){e.setAiSeqJob({state:`error`,message:`请先上传参考图`});return}o.push(e.aiSeqRefImage)}else if(a===`first_last`){if(!e.aiSeqFirstFrame||!e.aiSeqLastFrame){e.setAiSeqJob({state:`error`,message:`请先上传首帧与尾帧`});return}o.push(e.aiSeqFirstFrame,e.aiSeqLastFrame)}else if(a===`multi_reference`){[e.aiSeqRefImage,e.aiSeqJimengImage2Ref,e.aiSeqJimengImage3Ref,e.aiSeqJimengImage4Ref].forEach(e=>e&&o.push(e))}else if(a!==`text_video`){e.setAiSeqJob({state:`error`,message:`MiniMax H3 模式无效`});return}',
  'generation reference selection',
)

replaceOnce(
  'if(!nfStrictCloud&&nfCloudMode&&String(nfCloudProvider||``).trim()===`jimeng`&&a===`image_video`){',
  'if(nfH3Mode&&a===`multi_reference`){',
  'H3 video and audio references',
)

replaceRange(
  'let nfLiveKlingStoryboardPrompts=',
  'let g=await x();',
  '',
  'retired cloud storyboard submit preparation',
)

replaceOnce('let g=await x();', 'let g=nfH3Mode?null:await x();', 'H3 checkpoint isolation')

const h3BuildBranch = 'try{if(nfH3Mode){' +
  'let nfH3Workflow=window.NovaFlowAiSequenceMiniMaxH3Workflow,nfH3Resource=window.NovaFlowAiSequenceMiniMaxH3Resource,nfH3ModeName={text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[a],nfH3Prompt=String(e.aiSeqPrompt||``).trim();' +
  'if(!nfH3Workflow?.buildWorkflow||!nfH3Resource?.compileMentions)throw Error(`MiniMax H3 工作流模块未加载`);' +
  'if(a===`multi_reference`){let nfH3Resources=[' +
  '{key:`multi_ref_image_1`,occupied:!!e.aiSeqRefImage,sourceId:`multi_ref_image_1`,fileName:e.aiSeqRefImage?.fileName||``,type:e.aiSeqRefImage?.type||``},' +
  '{key:`multi_ref_image_2`,occupied:!!e.aiSeqJimengImage2Ref,sourceId:`multi_ref_image_2`,fileName:e.aiSeqJimengImage2Ref?.fileName||``,type:e.aiSeqJimengImage2Ref?.type||``},' +
  '{key:`multi_ref_image_3`,occupied:!!e.aiSeqJimengImage3Ref,sourceId:`multi_ref_image_3`,fileName:e.aiSeqJimengImage3Ref?.fileName||``,type:e.aiSeqJimengImage3Ref?.type||``},' +
  '{key:`multi_ref_image_4`,occupied:!!e.aiSeqJimengImage4Ref,sourceId:`multi_ref_image_4`,fileName:e.aiSeqJimengImage4Ref?.fileName||``,type:e.aiSeqJimengImage4Ref?.type||``},' +
  '{key:`multi_ref_video_1`,occupied:!!e.aiSeqJimengVideoRef,sourceId:`multi_ref_video_1`,fileName:e.aiSeqJimengVideoRef?.fileName||``,type:e.aiSeqJimengVideoRef?.type||``},' +
  '{key:`multi_ref_audio_1`,occupied:!!e.aiSeqJimengAudioRef,sourceId:`multi_ref_audio_1`,fileName:e.aiSeqJimengAudioRef?.fileName||``,type:e.aiSeqJimengAudioRef?.type||``}];' +
  'let nfH3Compiled=nfH3Resource.compileMentions(nfH3Prompt,nfH3Resources);if(nfH3Compiled.invalidTokens.length)throw Error(`未绑定参考资源：${nfH3Compiled.invalidTokens.join(`、`)}`);let nfH3Tokens=nfH3Compiled.snapshot.filter(e=>e.occupied).map(e=>e.modelToken).filter(e=>!nfH3Compiled.text.includes(e));nfH3Prompt=`${nfH3Tokens.join(` `)} ${nfH3Compiled.text}`.trim()}' +
  'u=nfH3Workflow.buildWorkflow({mode:nfH3ModeName,prompt:nfH3Prompt,width:[`480x864`,`864x480`,`768x1344`,`1344x768`].includes(`${e.aiSeqOutW}x${e.aiSeqOutH}`)?e.aiSeqOutW:480,height:[`480x864`,`864x480`,`768x1344`,`1344x768`].includes(`${e.aiSeqOutW}x${e.aiSeqOutH}`)?e.aiSeqOutH:864,length:[124,192,243,362].includes(Number(e.aiSeqOutFrames))?Number(e.aiSeqOutFrames):124,seed:d,outputPrefix:`video/MiniMax_H3_${nfH3ModeName}`,...a===`image_video`||a===`first_last`?{images:s}:{},...a===`multi_reference`?{referenceImages:s,referenceVideo:nfVideos[0]||void 0,referenceAudio:nfAudios[0]||void 0}:{}})' +
  '}else{u=Cn(u,{prompt:e.aiSeqPrompt,negative:e.aiSeqNegativePrompt,width:e.aiSeqOutW,height:e.aiSeqOutH,frames:e.aiSeqOutFrames,fps:e.aiSeqFps,steps:e.aiSeqSampleSteps,seed:d,images:s,unetHighName:String(e.aiSeqComfyUnetHighName||``).trim()||void 0,unetLowName:String(e.aiSeqComfyUnetLowName||``).trim()||void 0,loras:Array.isArray(e.aiSeqComfyLoras)?e.aiSeqComfyLoras:void 0})}}'

replaceRange('try{u=Cn(u,{', 'catch(t){e.setAiSeqJob({state:`error`', h3BuildBranch, 'H3 and Wan workflow dispatch')

replaceOnce('let _=nfCloudMode?0:', 'let _=nfH3Mode?0:', 'H3 LoRA isolation')

applyPostAuditFixes()
applyRuntimeIsolationFixes()
applyReferenceMediaContractFixes()
applyFollowupParameterAndLayoutFixes()
applyReferencePolicySubmitFix()
applySubmitDurationSnapshotFix()
applyIndependentSurfaceStateAndWanRuntimeFixes()
applyWanDirectoryFilterNormalizationFix()
applyFixedProbeInputNormalizationFix()
applyFreeFormH3StepsFixes()
applyH3CompatibleLoraSurfaceFixes()
applyWan22CompatibleLoraSurfaceFixes()
applyH3PromptModeSemantics()
applyH3ShortDurationUiFixes()
applyH3ParameterTooltipFixes()

fs.writeFileSync(bundlePath, source, 'utf8')
console.log(`patched ${path.relative(repoRoot, bundlePath)}`)
