"""Apply narrowly scoped, idempotent H3 profile wiring to the shipped static bundle."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'particle-editor/assets/index-BbIa-2NM.js'
source = path.read_text(encoding='utf-8')


def replace(old, new):
    global source
    if new in source:
        return
    if source.count(old) != 1:
        raise RuntimeError(f'Expected one UI anchor ({source.count(old)}): {old[:120]}')
    source = source.replace(old, new, 1)


old = '[nfH3AspectRatio,nfSetH3AspectRatio]=(0,_.useState)(`9:16`),[nfH3Megapixels,nfSetH3Megapixels]=(0,_.useState)(.4),[nfH3DurationInput,nfSetH3DurationInput]=(0,_.useState)(`5`),[nfH3Fps,nfSetH3Fps]=(0,_.useState)(24),[nfH3Steps,nfSetH3Steps]=(0,_.useState)(4),nfH3WorkflowApi=()=>window.NovaFlowAiSequenceMiniMaxH3Workflow'
new = '''[nfH3Profile,nfSetH3Profile]=(0,_.useState)(()=>window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.()||`classic`),nfH3Saved=()=>window.NovaFlowAiSequenceMiniMaxH3Workflow?.getProfileSettings?.(nfH3Profile)||{aspectRatio:`9:16`,megapixels:.4,durationSeconds:5,fps:24,steps:4},[nfH3AspectRatio,nfSetH3AspectRatio]=(0,_.useState)(()=>nfH3Saved().aspectRatio),[nfH3Megapixels,nfSetH3Megapixels]=(0,_.useState)(()=>nfH3Saved().megapixels),[nfH3DurationInput,nfSetH3DurationInput]=(0,_.useState)(()=>String(nfH3Saved().durationSeconds)),[nfH3Fps,nfSetH3Fps]=(0,_.useState)(()=>nfH3Saved().fps),[nfH3Steps,nfSetH3Steps]=(0,_.useState)(()=>nfH3Saved().steps),nfH3WorkflowApi=()=>window.NovaFlowAiSequenceMiniMaxH3Workflow,nfH3ProfileEffect=(0,_.useEffect)(()=>{nfH3WorkflowApi()?.saveProfileSettings?.(nfH3Profile,{aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels,durationSeconds:Number(nfH3DurationInput),fps:nfH3Fps,steps:Number(nfH3Steps)})},[nfH3Profile,nfH3AspectRatio,nfH3Megapixels,nfH3DurationInput,nfH3Fps,nfH3Steps]),nfChangeH3Profile=e=>{let t=nfH3WorkflowApi(),n=t.setSelectedProfile(e),r=t.getProfileSettings(n);nfSetH3Profile(n);nfSetH3AspectRatio(r.aspectRatio);nfSetH3Megapixels(r.megapixels);nfSetH3DurationInput(String(r.durationSeconds));nfSetH3Fps(r.fps);nfSetH3Steps(r.steps);if(n!==`classic`&&Ve===`multi_reference`)He(`image_video`)}'''
replace(old, new)
replace('return{aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels,durationSeconds:e.requestedDuration,fps:nfH3Fps,steps:nfCommitH3Steps(nfH3Steps)}', 'return{profile:nfH3Profile,aspectRatio:nfH3AspectRatio,megapixels:nfH3Megapixels,durationSeconds:e.requestedDuration,fps:nfH3Fps,steps:nfCommitH3Steps(nfH3Steps)}')
replace('nfH3Workflow.buildWorkflow({mode:nfH3ModeName,prompt:', 'nfH3Workflow.buildWorkflow({profile:nfH3SubmitOptions?.profile||`classic`,mode:nfH3ModeName,prompt:')
for token in ['e.aiSeqGenType', 'f']:
    old = 'getWorkflowJson?.({text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[' + token + '])'
    new = 'getWorkflowJson?.({mode:{text_video:`t2v`,image_video:`i2v`,first_last:`fl2v`,multi_reference:`r2v`}[' + token + '],profile:window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.(),steps:window.NovaFlowAiSequenceMiniMaxH3Workflow?.getProfileSettings?.()?.steps})'
    replace(old, new)
anchor = '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`画幅比例`}),(0,X.jsx)(yn,{"data-novaflow-h3-aspect-ratio"'
prefix = '(0,X.jsx)(`div`,{style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`},children:`H3 版本`}),(0,X.jsx)(yn,{"data-novaflow-h3-profile":`1`,"aria-label":`H3 版本`,value:nfH3Profile,onChange:e=>nfChangeH3Profile(e.target.value),style:{width:190,height:30,padding:`0 8px`},children:(nfH3WorkflowApi()?.PROFILES||[]).map(e=>(0,X.jsx)(`option`,{value:e.id,children:e.label},e.id))}),'
replace(anchor, prefix + anchor)
replace('[ze,Ve,nfH3Steps]),Fr=Ja', '[ze,Ve,nfH3Steps,nfH3Profile]),Fr=Ja')
replace('Number(nfPanelH3LoraSnapshot?.steps)===4&&(0,X.jsxs)(`div`,{"data-novaflow-h3-internal-turbo"', '(Number(nfPanelH3LoraSnapshot?.steps)===4&&window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.()===`classic`)&&(0,X.jsxs)(`div`,{"data-novaflow-h3-internal-turbo"')
replace('title:nfH3SubmitSteps()===4?', 'title:nfH3Profile!==`classic`?`beta5 独立模型；不自动叠加 Turbo LoRA`:nfH3SubmitSteps()===4?')
replace('"data-novaflow-ai-generation-mode":e.value,onClick:()=>p(e.value)', '"data-novaflow-ai-generation-mode":e.value,disabled:nfAiSeqMode===`minimax_h3_local`&&!window.NovaFlowAiSequenceMiniMaxH3Workflow?.supportsMode?.(window.NovaFlowAiSequenceMiniMaxH3Workflow?.getSelectedProfile?.(),e.value),title:e.value===`multi_reference`?`多参考需要 H3 原版 Ref2VA 模型`:void 0,onClick:()=>p(e.value)')
path.write_text(source, encoding='utf-8', newline='')
print('Patched H3 beta5 profile selector and submission snapshots')
