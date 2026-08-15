#!/usr/bin/env node
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const tool = read("particle-editor/ai-sequence-video-merge.tool.js");
const stateMachine = read("particle-editor/ai-sequence-state-machine-runtime.js");
const runtime = read("particle-editor/novaflow-brand-runtime.js");
const resourceBridge = read("particle-editor/ai-sequence-video-merge.resource-bridge.js");
const exportWorkflow = read("particle-editor/ai-sequence-video-merge-export.workflow.js");
const workspace = read("particle-editor/ai-sequence-video-merge.workspace.js");
const videoMergePreview = read("particle-editor/ai-sequence-video-merge.preview.js");
const rendererBundle = read("particle-editor/assets/index-BbIa-2NM.js");
const rendererIndex = read("particle-editor/index.html");
const desktopMain = read("particle-editor-desktop/main.js");
const desktopPreload = read("particle-editor-desktop/preload.js");
const syncRuntime = read("scripts/sync-runtime.mjs");
const checkRuntime = read("scripts/check-runtime-sync.mjs");
const buildRenderer = read("particle-editor-desktop/scripts/build-renderer.mjs");

function assert(condition, message) {
  if (condition) return;
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} must exist`);
  if (start < 0) return "";
  const signatureEnd = source.indexOf(") {", start);
  const bodyStart = signatureEnd >= 0 ? signatureEnd + 2 : source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  assert(false, `${name} body must close`);
  return "";
}

const runtimeFiles = [
  "ai-sequence-state-machine-runtime.js",
  "ai-sequence-video-merge.resource.js",
  "ai-sequence-video-merge.resource-bridge.js",
  "ai-sequence-video-merge.mask.tool.js",
  "ai-sequence-video-merge.preview.js",
  "ai-sequence-video-merge-export.workflow.js",
  "ai-sequence-video-merge.workspace.js",
  "ai-sequence-video-merge.tool.js"
];

assert(
  tool.includes("root.NovaFlowAiSequenceVideoMergeTool = Object.freeze({") &&
    tool.includes("mountEntry,") &&
    tool.includes("activate,") &&
    tool.includes("syncLifecycle,") &&
    tool.includes("deactivate,") &&
    tool.includes("saveAndClose,") &&
    tool.includes("exportToFile"),
  "Thin tool must expose the frozen lifecycle, resource save and file export APIs"
);
assert(tool.includes('data-novaflow-ai-video-merge-entry'), "Video merge entry must have its dedicated semantic marker");
assert(tool.includes('data-novaflow-ai-sequence-tool", TOOL_ID'), "Video merge entry must declare its state-machine tool id");
assert(tool.includes('insertAdjacentElement("afterend", entry)'), "Video merge entry must mount immediately after the processing action row");
assert(tool.includes('width: "100%"') && tool.includes('gridColumn: "1 / -1"'), "Video merge entry must be full width");
assert(tool.includes("workspace.open(options)"), "activate must delegate to workspace.open(options)");
assert(tool.includes("workspace.close(options)"), "deactivate must delegate to workspace.close(options)");
assert(tool.includes("workspace.saveAndClose()"), "saveAndClose must delegate to the active workspace");
assert(tool.includes("workspace.exportToFile()"), "exportToFile must delegate to the active workspace");
assert(!tool.includes("MutationObserver") && !tool.includes("setInterval("), "Thin tool must not add polling or a mutation observer");

let previousIndex = rendererIndex.indexOf("ai-sequence-state-machine-runtime.js");
assert(previousIndex >= 0, "State machine must load from index.html");
for (const file of runtimeFiles.slice(1)) {
  const currentIndex = rendererIndex.indexOf(file);
  assert(currentIndex > previousIndex, `${file} must load after the previous video merge dependency`);
  previousIndex = currentIndex;
}
assert(
  rendererIndex.indexOf("novaflow-brand-runtime.js") > previousIndex,
  "All video merge modules must load before Brand Runtime"
);
assert(
  rendererIndex.includes("ai-sequence-video-merge.preview.js?v=20260807-video-merge-mask-cursor-1"),
  "Video merge viewport controls must publish the current Preview cache revision"
);
assert(
    rendererIndex.includes("assets/index-BbIa-2NM.js?v=20260806-video-merge-save-close-1") &&
    rendererIndex.includes("ai-sequence-video-merge.resource-bridge.js?v=20260806-video-merge-save-close-1") &&
    rendererIndex.includes("ai-sequence-video-merge-export.workflow.js?v=20260807-video-merge-save-semantics-1") &&
    rendererIndex.includes("ai-sequence-video-merge.workspace.js?v=20260807-video-merge-left-feedback-1") &&
    rendererIndex.includes("ai-sequence-video-merge.tool.js?v=20260807-video-merge-save-semantics-1") &&
    rendererIndex.includes("novaflow-brand-runtime.js?v=20260807-video-merge-event-ownership-1"),
  "Video merge save semantics must publish the current cache revision"
);

for (const file of runtimeFiles) {
  assert(syncRuntime.includes(file), `${file} must participate in sync:runtime`);
  assert(checkRuntime.includes(file), `${file} must participate in check:runtime`);
  assert(buildRenderer.split(file).length - 1 >= 2, `${file} must be copied and required by the renderer build`);
}

assert(stateMachine.includes('"video-merge"'), "State machine must register video-merge");
assert(stateMachine.includes("videoMergeCache: createToolCache"), "State machine sessions must own a videoMergeCache");
assert(stateMachine.includes('if (tool === "video-merge") return session.videoMergeCache'), "cacheForTool must route video-merge");
assert(stateMachine.includes("resetToolCache(session.videoMergeCache"), "Source replacement/tool begin must reset videoMergeCache");
assert(stateMachine.includes("videoMergeCache: cloneValue(session.videoMergeCache)"), "State snapshots must include videoMergeCache");
assert(
  functionBody(stateMachine, "cancelEditing").includes('if (options.preserveMedia !== true) session.processedMedia = null'),
  "cancelEditing must preserve its default behavior while supporting preserveMedia"
);

const toolFromNode = functionBody(runtime, "aiSequenceToolFromNode");
const statefulTool = functionBody(runtime, "isAiSequenceStatefulEditTool");
const videoMergeEntryRequest = functionBody(runtime, "handleAiSequenceVideoMergeEntryRequest");
const videoMergeClose = functionBody(runtime, "closeAiSequenceVideoMergeEditing");
const cancelEditing = functionBody(runtime, "cancelAiSequenceCutoutEditingSession");
const forceResourceMode = functionBody(runtime, "forceAiSequenceCutoutSaveResourceMode");
const canvasMedia = functionBody(runtime, "hasAiAnimationCanvasMedia");
const canvasSignature = functionBody(runtime, "getAiSequenceCanvasMediaSignature");
const previewCandidate = functionBody(runtime, "isAiSequencePreviewMediaCandidate");
const previewPrimaryVisibility = functionBody(runtime, "syncAiSequencePreviewPrimaryMediaVisibility");
const stateDomGuards = functionBody(runtime, "ensureAiSequenceStateDomGuards");
const videoMergeEditingSession = functionBody(runtime, "isAiSequenceVideoMergeEditingSession");
const videoMergeResourceTarget = functionBody(runtime, "isAiSequenceVideoMergeSharedResourceTarget");
const videoMergeWorkspaceEventTarget = functionBody(runtime, "isAiSequenceVideoMergeWorkspaceEventTarget");
const userCanvasPanIntent = functionBody(runtime, "markAiAnimationUserCanvasPanIntent");
const previewViewportForEvent = functionBody(runtime, "getAiSequencePreviewViewportForEvent");
const bottomWorkspaceState = functionBody(runtime, "applyAiSequenceBottomWorkspaceState");
const primePostLayout = functionBody(runtime, "primeAiAnimationPostLayoutMarkers");
const markPostLayout = functionBody(runtime, "markAiAnimationPostLayout");
const collapseHeading = functionBody(runtime, "ensureAiAnimationCollapseHeading");
const entryPresentation = functionBody(tool, "applyEntryPresentation");
const deactivateVideoMerge = functionBody(tool, "deactivate");
const postToolStates = functionBody(runtime, "styleAiAnimationPostToolStates");
const videoMergePostToolStart = postToolStates.indexOf('if (sequenceTool === "video-merge")');
const videoMergePostToolEnd = postToolStates.indexOf("const text = normalizeText", videoMergePostToolStart);
const videoMergePostToolBranch = videoMergePostToolStart >= 0 && videoMergePostToolEnd > videoMergePostToolStart
  ? postToolStates.slice(videoMergePostToolStart, videoMergePostToolEnd)
  : "";

assert(toolFromNode.includes('sequenceTool === "video-merge"'), "Runtime must recognize video merge only from its semantic tool attribute");
assert(statefulTool.includes('tool === "video-merge"'), "Video merge must participate in the editing lock");
assert(
  videoMergeEntryRequest.includes("controller.expandTools(true)") && videoMergeEntryRequest.includes('controller.beginTool("video-merge")'),
  "Video merge must enter through forced processing expansion followed by beginTool"
);
assert(videoMergeClose.includes("cancelAiSequenceCutoutEditingSession(controller)"), "Video merge close must use the shared state cleanup path");
assert(
  cancelEditing.includes("clearCache: true, preserveMedia: preserveVideoMergeMedia"),
  "Video merge close must clear its cache while preserving current media"
);
assert(
  cancelEditing.includes("{ preserveMedia: preserveVideoMergeMedia }") && forceResourceMode.includes("options.preserveMedia !== true"),
  "The complete Runtime settle path must preserve existing media for video merge"
);
assert(!videoMergeClose.includes("commitAndClose") && !videoMergeClose.includes("replaceSource"), "Video merge export/close must not replace current source media");
assert(collapseHeading.includes("controller.expandTools(true)"), "Processing tools must expand without current media for video merge");
assert(
  runtime.includes('tool !== "video-merge" && !hasAiSequenceBoardResource(document)') &&
    /isPostReference\s*\?\s*\(hasMedia &&/.test(runtime),
  "Native cutout tools must remain blocked when the empty board is expanded for video merge"
);
for (const body of [canvasMedia, canvasSignature, previewCandidate, previewPrimaryVisibility]) {
  assert(body.includes('data-novaflow-runtime-ignore'), "Legacy media scans must ignore the isolated video merge workspace");
}
assert(tool.includes("state.previewHost === options.previewHost") && tool.includes("onActivationError"), "Tool lifecycle must recover from host replacement and activation failure");
assert(
  entryPresentation.includes("ACTIVE_LABEL") &&
    entryPresentation.includes("IDLE_LABEL") &&
    entryPresentation.includes('active ? "#6f1f2a" : "rgba(255, 255, 255, 0.08)"'),
  "Video merge entry must own its active red and idle neutral presentation"
);
assert(
  deactivateVideoMerge.includes("applyEntryPresentation(getMountedEntry(), false)"),
  "Closing video merge must restore the idle entry presentation immediately"
);
assert(
  postToolStates.includes('sequenceTool === "video-merge"') &&
    postToolStates.includes('node.removeAttribute("data-novaflow-ai-cutout-mode")'),
  "Legacy cutout styling must not classify the video merge entry as an AI cutout action"
);
assert(
  !videoMergePostToolBranch.includes("styleActionButtonBase(node)") &&
    videoMergePostToolBranch.includes('removeAttributeIfPresent(parent, "data-novaflow-ai-post-action-row")') &&
    videoMergePostToolBranch.includes('removeStylePropertiesIfPresent(parent, ["column-gap", "row-gap"])'),
  "Video merge styling must not mark the processing-tools section as an action row"
);
assert(!primePostLayout.includes("video-merge") && !markPostLayout.includes("video-merge"), "Video merge must not expand the legacy post-layout token scanners");
assert(runtime.includes(':not([data-novaflow-ai-video-merge-canvas="1"])'), "Legacy cutout canvas CSS must exclude the isolated video merge canvas");
assert(runtime.includes("mountAiSequenceVideoMergeEntry(postSection)"), "Section layout must mount the thin entry");
assert(runtime.includes("syncAiSequenceVideoMergeLifecycle(activePostSection, session)"), "State sync must drive the workspace lifecycle");
assert(videoMergeEditingSession.includes('tool === "video-merge"'), "Shared resources may unlock only for an active video-merge editing session");
assert(videoMergeResourceTarget.includes('data-novaflow-ai-resource-sidebar-host'), "Video merge resource exception must stay scoped to the shared sidebar");
assert(
  videoMergeWorkspaceEventTarget.includes('data-novaflow-ai-video-merge-workspace') &&
    userCanvasPanIntent.includes("isAiSequenceVideoMergeWorkspaceEventTarget") &&
    previewViewportForEvent.includes("isAiSequenceVideoMergeWorkspaceEventTarget"),
  "Video merge preview gestures must stay owned by its isolated canvas instead of legacy global pan handlers"
);
assert(stateDomGuards.includes("isAiSequenceVideoMergeSharedResourceTarget"), "Editing guards must allow shared-sidebar drag and upload for video merge");
assert(
  bottomWorkspaceState.includes('session.mode === "editing"') &&
    bottomWorkspaceState.includes('activeTool === "video-merge"') &&
    bottomWorkspaceState.includes("setAiSequenceHidden(bottomWorkspace, true)") &&
    bottomWorkspaceState.indexOf("setAiSequenceHidden(bottomWorkspace, true)") < bottomWorkspaceState.indexOf("setAiSequenceHidden(bottomWorkspace, false)"),
  "Video merge must hide the unrelated native timeline before the shared bottom-workspace layout runs"
);
assert(
  rendererBundle.includes('"data-novaflow-ai-resource-id":e.id') &&
    stateDomGuards.includes('card.getAttribute("data-novaflow-ai-resource-id")') &&
    stateDomGuards.includes('window.dispatchEvent(new CustomEvent("novaflow:ai-sequence-video-merge-import-resource"') &&
    stateDomGuards.includes("detail: { resourceId }"),
  "Shared resource clicks must bridge a stable resource id into the video merge workspace"
);
assert(resourceBridge.includes("resolveDrop") && resourceBridge.includes("extractDroppedFiles"), "Video merge resource bridge must own resource-card and Explorer drop decoding");
assert(resourceBridge.includes("resolveVideoResource") && resourceBridge.includes("addLocalVideoFiles"), "Video merge resource bridge must delegate to the authoritative shared asset bridge");
assert(resourceBridge.includes("publishExportedVideo") && rendererBundle.includes("publishVideoResource:async"), "Video merge output must publish through the authoritative shared asset bridge");
assert(rendererBundle.includes("videoResourceMediaRegister") && rendererBundle.includes("videoResourceMediaRelease"), "Path-backed output resources must register and release opaque media URLs");
assert(resourceBridge.includes("extractDroppedVideos") && resourceBridge.includes("rejectedCount"), "Explorer folders must filter supported videos before applying the shared-list cap");
assert(rendererBundle.includes("videoMergeCachedPath") && rendererBundle.includes("aiSeqCacheCopyFromPath") && rendererBundle.includes("aiSeqCacheTempFile"), "Shared video resources must materialize an independently owned stable cache path");
assert(rendererBundle.includes("nfVideoMergeUploadOnly") && rendererBundle.includes("nfVideoMergeUploadOnly||await ie?.(C)"), "Shared upload must not replace the native canvas while video merge is open");
assert(workspace.includes("NovaFlowAiSequenceVideoMergeResourceBridge"), "Workspace must consume the dedicated shared-resource adapter");
assert(
  videoMergePreview.includes("fitToViewport") &&
    videoMergePreview.includes("handleWheel") &&
    videoMergePreview.includes("event.button === 2") &&
    videoMergePreview.includes("handleContextMenu") &&
    videoMergePreview.includes("anchorProjectX") &&
    videoMergePreview.includes("handleCapturedPanStart") &&
    videoMergePreview.includes("windowRef?.addEventListener?.('pointerdown'") &&
    videoMergePreview.includes("(Number(event?.buttons) & 2) !== 2") &&
    videoMergePreview.includes("brushOverlayIsVisible") &&
    videoMergePreview.includes("visible ? 'none' : 'crosshair'"),
  "Video merge preview must own auto-fit, wheel zoom and right-button viewport pan"
);
assert(!workspace.includes("nf-vm-empty") && !workspace.includes("短视频结束后自动透明"), "Video merge layer panel must not render the redundant drag annotation");
assert(
  !workspace.includes("输出设置") &&
    !workspace.includes("输出格式") &&
    !workspace.includes("输出帧率") &&
    !workspace.includes("音频来源") &&
    !workspace.includes("导出合并视频") &&
    !workspace.includes("store.setFormat") &&
    !workspace.includes("store.setFps") &&
    !workspace.includes("store.setAudioSource"),
  "Fixed video merge output defaults must not expose redundant settings or a duplicate export action"
);
assert(
  workspace.includes("exportFeedbackVisible") && workspace.includes("取消导出"),
  "Video merge must retain transient export feedback and cancellation without an idle settings panel"
);
assert(
  workspace.includes("fragment.appendChild(outputPanel)") &&
    workspace.includes("center.append(stageHost, timeline)") &&
    !workspace.includes("center.append(stageHost, timeline, outputPanel)"),
  "Video merge feedback must render below the left layer cards instead of below the timeline"
);
assert(
  workspace.includes("if (result?.canceled)") && workspace.includes("exportFeedbackVisible = false"),
  "Canceled video merge exports must remove their completed feedback panel"
);
assert(!workspace.includes("headerExport") && !workspace.includes("data-novaflow-ai-video-merge-export"), "Workspace header must not duplicate the save-and-close action or listener");
assert(!workspace.includes("nf-vm-header") && !workspace.includes("nf-vm-title") && !workspace.includes("nf-vm-subtitle"), "Video merge workspace must not render a private title bar");
assert(
  workspace.includes("externalControlsHost.appendChild(leftPanel)") &&
    workspace.includes("data-novaflow-ai-video-merge-controls-external") &&
    workspace.includes("leftPanel.remove()"),
  "Video merge controls must mount in and cleanly leave the shared left editing section"
);
assert(
  workspace.includes("编辑图层蒙版") &&
    workspace.includes("data-novaflow-ai-video-merge-edit-mask") &&
    !workspace.includes("编辑当前图层蒙版") &&
    !workspace.includes("退出视频合并") &&
    !workspace.includes("nf-vm-exit"),
  "Video merge must place the renamed mask action first and rely on the processing-section lifecycle for exit"
);
assert(
  workspace.includes("nf-vm-layer-toolbar") &&
    workspace.includes("data-novaflow-ai-video-merge-move") &&
    workspace.includes("nf-vm-layer-thumbnail") &&
    workspace.includes("context.drawImage(video") &&
    workspace.includes("min-height:64px") &&
    workspace.includes("background:#222") &&
    !workspace.includes("nf-vm-layer-index") &&
    !workspace.includes("nf-vm-layer-actions"),
  "Video merge layers must use taller thumbnail cards with one shared ordering toolbar"
);
assert(
  workspace.includes("data-novaflow-ai-video-merge-auto-fit") &&
    workspace.includes("preview?.fitToViewport?.()") &&
    workspace.includes("data-novaflow-ai-video-merge-host-active") &&
    workspace.includes("data-novaflow-ai-board-controls-top-left") &&
    workspace.includes("documentRef.body") &&
    workspace.includes("nativeBoardControls") &&
    runtime.includes("isVideoMergeOwnedAutoFitControl") &&
    workspace.includes("height:34px;min-height:34px"),
  "Video merge must align its mask button, expose functional auto-fit and hide only the native board switcher"
);
assert(
  workspace.includes("background:rgba(24,24,24,.96)") && workspace.includes("border-radius:8px"),
  "Video merge timeline must use the shared floating-panel visual treatment"
);
assert(
  videoMergePreview.includes("backgroundColor: '#0b0b0b', backgroundImage: 'none'") && !videoMergePreview.includes("backgroundSize: '24px 24px'"),
  "Video merge preview must use the sequence black background without a checker pattern"
);
assert(workspace.includes("publishExportedVideo") && workspace.includes("config.onExportComplete"), "Save-and-close must publish before requesting shared state cleanup");
assert(
  workspace.includes("destination: publishToResources ? 'resource' : 'file'") &&
    exportWorkflow.includes("configExport.destination === 'resource'") &&
    exportWorkflow.includes("aiSeqCacheReserveOutput"),
  "Save-and-close must target NovaFlow internal cache while file export retains the save picker"
);
assert(
  desktopMain.includes('handleNovaFlowTempIpc("ai-seq-cache-reserve-output"') &&
    desktopMain.includes('handleNovaFlowTempIpc("ai-seq-cache-release-output"') &&
    desktopPreload.includes("aiSeqCacheReserveOutput") &&
    desktopPreload.includes("aiSeqCacheReleaseOutput"),
  "Desktop cache bridge must reserve and release resource-owned video outputs"
);
assert(runtime.includes('tool === "video-merge" || tool === "chroma-key"') || runtime.includes('tool === "ai-cutout" || tool === "chroma-key" || tool === "video-merge"'), "Video merge save must remain asynchronous until export and publication finish");
assert(runtime.includes("saveAndCloseAiSequenceVideoMergeWorkspace") && !stateDomGuards.includes('session.activeTool === "video-merge") return'), "Global save-and-close must dispatch into the video merge workspace");
assert(
  runtime.includes("exportAiSequenceVideoMergeWorkspace") &&
    runtime.includes("if (exportAiSequenceVideoMergeWorkspace()) return true"),
  "The shared Export entry must dispatch to video merge file export while its workspace is active"
);
assert(
  exportWorkflow.includes("inspectCapability") && exportWorkflow.includes("canRegisterSource") && exportWorkflow.includes("canExport"),
  "Export workflow must expose explicit compositor capabilities"
);
assert(
  workspace.includes("workflow.getCapability") && workspace.includes("storeOptions.registerSource = workflow.registerSource") && workspace.includes("source.exportReady === true"),
  "Workspace must choose compositor registration and export readiness from explicit capabilities"
);
assert(
  exportWorkflow.includes("当前环境暂不支持视频合并导出") && !exportWorkflow.includes("video_merge_open_session_api_missing"),
  "Missing compositor APIs must surface a human-readable availability notice"
);
assert(
  runtime.includes('body.novaflow-ai-animation-section-layers[data-novaflow-ai-sequence-mode="editing"][data-novaflow-ai-sequence-active-tool="video-merge"] [data-novaflow-ai-main-stage="1"] > [data-novaflow-ai-zoom-controls="1"]') &&
    runtime.includes("isAiSequenceVideoMergeAutoFitHidden") &&
    runtime.includes("data-novaflow-video-merge-autofit-hidden") &&
    !workspace.includes("图层变换") &&
    !workspace.includes("居中适配画板") &&
    !workspace.includes("拖右下角控制点等比缩放"),
  "Video merge must hide the native auto-fit control without rendering a duplicate transform section"
);

if (!process.exitCode) console.log("AI_SEQUENCE_VIDEO_MERGE_ENTRY_CONTRACT_OK");
