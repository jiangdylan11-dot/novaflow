"""Add the independent PDMD 2/4-step selector to the maintained Web bundle."""
from pathlib import Path

bundle = Path(__file__).resolve().parents[1] / 'novaflow-web/renderer/assets/index-BbIa-2NM.js'
source = bundle.read_text(encoding='utf-8')


def replace(old, new):
    global source
    if new in source:
        return
    if source.count(old) != 1:
        raise RuntimeError(f'Expected one PDMD UI anchor ({source.count(old)}): {old[:100]}')
    source = source.replace(old, new, 1)


replace('nfH3Profile=`beta5_int8`,nfH3Saved=', '[nfH3Profile,nfSetH3Profile]=(0,_.useState)(()=>window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.()||`beta5_int8`),nfH3Saved=')
replace('nfH3AspectOptions=()=>', 'nfChangeH3Profile=id=>{let api=nfH3WorkflowApi(),profile=api.setSelectedProfile(id),saved=api.getProfileSettings(profile);nfSetH3Profile(profile);nfSetH3AspectRatio(saved.aspectRatio);nfSetH3Megapixels(saved.megapixels);nfSetH3Custom(saved.resolutionMode===`custom`);nfSetH3Width(String(saved.width||480));nfSetH3Height(String(saved.height||864));nfSetH3DurationInput(String(saved.durationSeconds));nfSetH3Fps(saved.fps);nfSetH3Steps(saved.steps);if(!api.supportsMode(profile,Ve))He(`image_video`)},nfH3AspectOptions=()=>')
anchor = '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`画幅比例`}),(0,X.jsx)(yn,{"data-novaflow-h3-aspect-ratio"'
prefix = '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`H3 版本`}),(0,X.jsx)(yn,{"data-novaflow-h3-profile":`1`,"aria-label":`H3 版本`,value:nfH3Profile,onChange:e=>nfChangeH3Profile(e.target.value),style:{width:200,height:30,padding:`0 8px`},children:(nfH3WorkflowApi()?.PROFILES||[]).map(e=>(0,X.jsx)(`option`,{value:e.id,children:e.label},e.id))}),'
replace(anchor, prefix + anchor)
replace('value:String(nfH3Steps),title:`beta5 TURBO 已内置加速权重；不额外叠加 Turbo LoRA`', 'value:String(nfH3Steps),disabled:nfH3Profile.startsWith(`pdmd_`),title:nfH3Profile.startsWith(`pdmd_`)?`PDMD 自动加载对应 LoRA，固定采样步数`:`beta5 TURBO 已内置加速权重；不额外叠加 Turbo LoRA`')
replace('nfH3ValidatedLoras=[];if(nfH3Mode){', 'nfH3ValidatedLoras=[];if(nfH3Mode&&!String(nfH3SubmitOptions?.profile||``).startsWith(`pdmd_`)){')
replace('e.setContext?.({mode:t,steps:n})}catch{}Promise.resolve(e.refreshCatalog', 'e.setContext?.({mode:t,steps:n})}catch{}if(nfH3Profile.startsWith(`pdmd_`))return;Promise.resolve(e.refreshCatalog')
anchor = 'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`'
prefix = 'r===`minimax_h3_local`&&String(window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.()||``).startsWith(`pdmd_`)&&(0,X.jsx)(`div`,{"data-novaflow-h3-pdmd-adapter":`1`,style:{marginTop:8,fontSize:12,color:`#b9b9b9`,lineHeight:1.6},children:`PDMD ${window.NovaFlowAiSequenceMiniMaxH3Workflow.getProfileSettings().steps} 步测试：加速 LoRA 已自动加载，强度 1。支持文生、图生和首尾帧视频。`}),'
replace(anchor, prefix + anchor.replace('r===`minimax_h3_local`&&', 'r===`minimax_h3_local`&&window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.()===`beta5_int8`&&', 1))
bundle.write_text(source, encoding='utf-8', newline='')
print('Patched PDMD profile selector, fixed steps, and isolated adapters')
