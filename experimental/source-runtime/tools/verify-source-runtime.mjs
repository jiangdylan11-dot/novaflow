import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
const legacyFrameSource = fs.readFileSync(path.join(root, "src", "components", "LegacyRuntimeFrame.tsx"), "utf8");
const colorReferenceSource = fs.readFileSync(path.join(root, "src", "components", "ColorReferencePicker.tsx"), "utf8");
const referenceImageSource = fs.readFileSync(path.join(root, "src", "components", "ReferenceImagePicker.tsx"), "utf8");
const imageSequenceSource = fs.readFileSync(path.join(root, "src", "components", "ImageSequencePicker.tsx"), "utf8");
const videoPreviewPickerSource = fs.readFileSync(path.join(root, "src", "components", "VideoPreviewPicker.tsx"), "utf8");
const processingToolsSource = fs.readFileSync(path.join(root, "src", "components", "ProcessingToolsPanel.tsx"), "utf8");
const boardSwitcherSource = fs.readFileSync(path.join(root, "src", "components", "BoardSwitcher.tsx"), "utf8");
const aiSequencePreviewSource = fs.readFileSync(path.join(root, "src", "components", "AISequencePreviewArea.tsx"), "utf8");
const aiSequenceBoardSource = fs.readFileSync(path.join(root, "src", "components", "AISequenceBoard.tsx"), "utf8");
const aiSequenceFramePreviewSource = fs.readFileSync(path.join(root, "src", "components", "AISequenceFramePreview.tsx"), "utf8");
const aiSequenceVideoPreviewSource = fs.readFileSync(path.join(root, "src", "components", "AISequenceVideoPreview.tsx"), "utf8");
const addBoardSource = fs.readFileSync(path.join(root, "src", "components", "AddBoardButton.tsx"), "utf8");
const generationParametersPanelSource = fs.readFileSync(path.join(root, "src", "components", "GenerationParametersPanel.tsx"), "utf8");
const timelinePanelSource = fs.readFileSync(path.join(root, "src", "components", "TimelinePanel.tsx"), "utf8");
const timelineTransportSource = fs.readFileSync(path.join(root, "src", "components", "TimelineTransport.tsx"), "utf8");
const timelineTrackSource = fs.readFileSync(path.join(root, "src", "components", "TimelineTrack.tsx"), "utf8");
const timelinePlayheadSource = fs.readFileSync(path.join(root, "src", "components", "TimelinePlayhead.tsx"), "utf8");
const sourceShellSource = fs.readFileSync(path.join(root, "src", "components", "SourceShell.tsx"), "utf8");
const aiSequenceSourceStateHookSource = fs.readFileSync(path.join(root, "src", "hooks", "useAISequenceSourceState.ts"), "utf8");
const colorReferenceTypesSource = fs.readFileSync(path.join(root, "src", "types", "colorReference.ts"), "utf8");
const imageSequenceTypesSource = fs.readFileSync(path.join(root, "src", "types", "imageSequence.ts"), "utf8");
const videoPreviewTypesSource = fs.readFileSync(path.join(root, "src", "types", "videoPreview.ts"), "utf8");
const aiSequenceBoardTypesSource = fs.readFileSync(path.join(root, "src", "types", "aiSequenceBoard.ts"), "utf8");
const aiSequenceBoardSessionTypesSource = fs.readFileSync(path.join(root, "src", "types", "aiSequenceBoardSession.ts"), "utf8");
const generationParametersTypesSource = fs.readFileSync(path.join(root, "src", "types", "generationParameters.ts"), "utf8");
const timelineTypesSource = fs.readFileSync(path.join(root, "src", "types", "timeline.ts"), "utf8");
const sourcePartialReplacementFlagsSource = fs.readFileSync(
  path.join(root, "src", "featureFlags", "sourcePartialReplacementFlags.ts"),
  "utf8"
);
const sourceIslandManagerSource = fs.readFileSync(
  path.join(root, "src", "partialReplacement", "sourceIslandManager.ts"),
  "utf8"
);
const sourceUploadSurfacesIslandSource = fs.readFileSync(
  path.join(root, "src", "partialReplacement", "SourceUploadSurfacesIsland.tsx"),
  "utf8"
);
const appCss = fs.readFileSync(path.join(root, "src", "App.css"), "utf8");
const bridgeHtml = fs.readFileSync(path.join(root, "public", "legacy-bridge.html"), "utf8");
const repoRoot = path.resolve(root, "..", "..");
const aiSequenceAuditReportPath = path.join(repoRoot, "logs", "ai-sequence-source-audit.md");
const aiSequenceAuditReport = fs.existsSync(aiSequenceAuditReportPath)
  ? fs.readFileSync(aiSequenceAuditReportPath, "utf8")
  : "";
const replacementReadinessReportPath = path.join(repoRoot, "logs", "ai-sequence-source-replacement-readiness.md");
const replacementReadinessReport = fs.existsSync(replacementReadinessReportPath)
  ? fs.readFileSync(replacementReadinessReportPath, "utf8")
  : "";

const required = ["/src/main.tsx"];
const sourceRequired = ["/legacy-bridge.html", "data-legacy-runtime-frame"];
const colorReferenceRequired = [
  "ColorReferencePicker",
  "boardId: string | null",
  "inputIdPrefix?: string",
  "inputIdPrefix = \"source-color-ref-input\"",
  "`${inputIdPrefix}-${boardId ?? \"empty\"}`",
  "<label",
  "htmlFor={inputId}",
  "type=\"file\"",
  "accept={COLOR_REFERENCE_ACCEPT}",
  "image/png,image/jpeg,image/webp",
  "fileName: file.name",
  "objectUrl: URL.createObjectURL(file)",
  "mimeType: file.type",
  "createdAt: Date.now()",
  "URL.createObjectURL(file)",
  "data-source-color-reference-input",
  "data-source-color-reference-picker",
  "onClear"
];
const referenceImageRequired = [
  "type=\"file\"",
  "accept=\"image/*\"",
  "useId",
  "htmlFor={inputId}",
  "URL.createObjectURL(file)",
  "URL.revokeObjectURL",
  "data-source-reference-image-input",
  "data-source-reference-image-picker",
  "参考图"
];
const imageSequenceRequired = [
  "ImageSequencePicker",
  "type=\"file\"",
  "accept=\"image/*\"",
  "multiple",
  "useId",
  "htmlFor={inputId}",
  "URL.createObjectURL(file)",
  "URL.revokeObjectURL",
  "localeCompare",
  "data-source-image-sequence-input",
  "data-source-image-sequence-picker",
  "data-source-image-sequence-meta"
];
const videoPreviewPickerRequired = [
  "VideoPreviewPicker",
  "VideoPreviewState",
  "type=\"file\"",
  "accept=\"video/webm,video/mp4\"",
  "useId",
  "htmlFor={inputId}",
  "URL.createObjectURL(file)",
  "URL.revokeObjectURL(url)",
  "data-source-video-preview-input",
  "data-source-video-preview-picker",
  "data-source-video-preview-meta",
  "readVideoPreview",
  "onClick={resetInput}"
];
const processingToolsRequired = [
  "ProcessingToolsPanel",
  "ProcessingToolsPanelProps",
  "data-source-processing-tools-panel",
  "boardId: string | null",
  "<ReferenceImagePicker",
  "<ColorReferencePicker",
  "boardId={boardId}",
  "<ImageSequencePicker",
  "<VideoPreviewPicker",
  "disabled?: boolean",
  "colorReferenceInputIdPrefix?: string",
  "inputIdPrefix={colorReferenceInputIdPrefix}",
  "自定义色彩参照"
];
const boardSwitcherRequired = [
  "BoardSwitcher",
  "AISequenceBoardSession",
  "data-source-board-switcher",
  "data-source-board-switcher-item",
  "data-source-board-switcher-active",
  "data-source-board-switcher-add",
  "onSelectBoard",
  "onCreateBoard",
  "onRemoveBoard"
];
const aiSequencePreviewRequired = [
  "AISequencePreviewArea",
  "activeBoard: AISequenceBoardSession | null",
  "data-source-ai-seq-workspace",
  "data-source-ai-seq-preview-area",
  "data-source-ai-seq-preview-stage",
  "data-source-ai-seq-bottom-dock",
  "data-source-ai-seq-empty-state",
  "timeline: ReactNode",
  "imageSequenceFrames: ImageSequenceFrame[]",
  "currentFrame: number",
  "Math.min(currentFrame, imageSequenceFrames.length - 1)",
  "<AddBoardButton",
  "<AISequenceBoard"
];
const aiSequenceBoardRequired = [
  "AISequenceFramePreview",
  "AISequenceVideoPreview",
  "AISequenceBoardSession",
  "data-source-ai-seq-board",
  "data-source-ai-seq-board-id",
  "--ai-seq-board-aspect",
  "--ai-seq-board-fit-width",
  "board.generationParameters",
  "frame: ImageSequenceFrame | null",
  "board.videoPreview",
  "timelineState: TimelineState",
  "onVideoEnded: () => void"
];
const aiSequenceFramePreviewRequired = [
  "AISequenceFramePreview",
  "ImageSequenceFrame",
  "data-source-ai-seq-frame-preview=\"empty\"",
  "data-source-ai-seq-frame-preview=\"image\"",
  "data-source-ai-seq-frame-preview-image",
  "src={frame.url}",
  "alt={frame.name}"
];
const aiSequenceVideoPreviewRequired = [
  "AISequenceVideoPreview",
  "VideoPreviewState",
  "TimelineState",
  "HTMLVideoElement",
  "data-source-ai-seq-video-preview=\"1\"",
  "data-source-ai-seq-video-preview-element=\"1\"",
  "controls={false}",
  "muted",
  "playsInline",
  "video.play().catch",
  "console.warn(\"[SourceVideoPreview] video.play() failed\"",
  "video.pause()",
  "video.currentTime = targetTime",
  "clampTime",
  "onEnded"
];
const addBoardRequired = [
  "type=\"button\"",
  "data-source-add-board-button",
  "+ 添加画板"
];
const aiSequenceTypeRequired = [
  "AISequenceBoardModel",
  "id: string",
  "width: number",
  "height: number",
  "name: string"
];
const aiSequenceBoardSessionTypeRequired = [
  "AISequenceBoardSession",
  "GenerationParameters",
  "TimelineState",
  "ImageSequenceFrame",
  "UploadedImageState",
  "ColorReference",
  "VideoPreviewState",
  "generationParameters: GenerationParameters",
  "timelineState: TimelineState",
  "imageSequenceFrames: ImageSequenceFrame[]",
  "referenceImage: UploadedImageState | null",
  "colorReference?: ColorReference | null",
  "videoPreview: VideoPreviewState | null",
  "DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS",
  "width: 512",
  "height: 720",
  "frames: 24",
  "fps: 12",
  "DEFAULT_BOARD_SESSION_TIMELINE_STATE",
  "totalFrames: DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS.frames"
];
const videoPreviewTypeRequired = [
  "VideoPreviewState",
  "fileName: string",
  "url: string",
  "mime: string",
  "size: number",
  "duration: number",
  "width: number",
  "height: number"
];
const generationParametersRequired = [
  "GenerationParametersPanel",
  "data-source-generation-parameters-panel",
  "type=\"number\"",
  "min={GENERATION_PARAMETER_MIN[key]}",
  "data-source-generation-number-input",
  "textarea",
  "data-source-generation-prompt",
  "data-source-generation-negative-prompt",
  "width",
  "height",
  "frames",
  "fps",
  "prompt",
  "negativePrompt"
];
const generationParametersTypeRequired = [
  "GenerationParameters",
  "width: number",
  "height: number",
  "frames: number",
  "fps: number",
  "prompt: string",
  "negativePrompt: string",
  "width: 512",
  "height: 720",
  "frames: 49",
  "fps: 16"
];
const timelinePanelRequired = [
  "TimelinePanel",
  "data-source-timeline-panel",
  "<TimelineTransport",
  "<TimelineTrack"
];
const timelineTransportRequired = [
  "TimelineTransport",
  "data-source-timeline-transport",
  "data-source-timeline-prev-frame",
  "data-source-timeline-play-toggle",
  "data-source-timeline-next-frame",
  "data-source-timeline-current-frame",
  "onTogglePlaying",
  "onStepFrame"
];
const timelineTrackRequired = [
  "TimelineTrack",
  "data-source-timeline-track",
  "data-source-timeline-frame-count",
  "data-source-timeline-frame-cell",
  "data-source-timeline-frame",
  "Array.from({ length: totalFrames }",
  "onSelectFrame",
  "<TimelinePlayhead"
];
const timelinePlayheadRequired = [
  "TimelinePlayhead",
  "data-source-timeline-playhead",
  "data-source-timeline-playhead-frame"
];
const timelineTypeRequired = [
  "TimelineState",
  "currentFrame: number",
  "totalFrames: number",
  "fps: number",
  "isPlaying: boolean",
  "clampTimelineFrame"
];
const imageSequenceTypeRequired = [
  "ImageSequenceFrame",
  "id: string",
  "name: string",
  "url: string",
  "width: number",
  "height: number",
  "size: number",
  "mime: string"
];
const colorReferenceTypeRequired = [
  "ColorReference",
  "id: string",
  "fileName: string",
  "objectUrl: string",
  "mimeType: string",
  "size: number",
  "createdAt: number"
];
const sourcePartialReplacementFlagRequired = [
  "SourcePartialReplacementFlags",
  "EffectiveSourcePartialReplacementFlags",
  "SourcePartialReplacementFlagResolution",
  "SOURCE_PARTIAL_REPLACEMENT: boolean",
  "SOURCE_UPLOAD_SURFACES: boolean",
  "SOURCE_PREVIEW_SURFACES: boolean",
  "SOURCE_BOARD_SESSION: boolean",
  "SOURCE_GENERATION_PANEL: boolean",
  "uploadsEnabled: boolean",
  "previewEnabled: boolean",
  "boardSessionEnabled: boolean",
  "generationPanelEnabled: boolean",
  "DEFAULT_SOURCE_PARTIAL_REPLACEMENT_FLAGS",
  "SOURCE_PARTIAL_REPLACEMENT: false",
  "SOURCE_UPLOAD_SURFACES: false",
  "SOURCE_PREVIEW_SURFACES: false",
  "SOURCE_BOARD_SESSION: false",
  "SOURCE_GENERATION_PANEL: false",
  "computeEffectiveSourcePartialReplacementFlags",
  "resolveSourcePartialReplacementFlags",
  "__NOVAFLOW_SOURCE_PARTIAL_REPLACEMENT_FLAGS__",
  "__NOVAFLOW_SOURCE_PARTIAL_FLAGS__",
  "localStorage",
  "URLSearchParams",
  "fallbackResolution",
  "uploadsEnabled: masterEnabled && flags.SOURCE_UPLOAD_SURFACES === true",
  "previewEnabled: masterEnabled && flags.SOURCE_PREVIEW_SURFACES === true",
  "boardSessionEnabled: masterEnabled && flags.SOURCE_BOARD_SESSION === true",
  "generationPanelEnabled: masterEnabled && flags.SOURCE_GENERATION_PANEL === true"
];
const sourceIslandManagerRequired = [
  "mountSourceIsland",
  "unmountSourceIsland",
  "getSourceIslandRoot",
  "renderSourceIslandReact",
  "ReactNode",
  "createRoot",
  "identifierPrefix: \"source-island-\"",
  "activeReactRoot",
  "activeReactRoot.unmount()",
  "SourceIslandCleanup",
  "SourceIslandMountOptions",
  "SourceIslandHandle",
  "SOURCE_ISLAND_ROOT_ID",
  "novaflow-source-island-root",
  "SOURCE_ISLAND_PHASE",
  "phase1",
  "SOURCE_ISLAND_OWNER",
  "source-runtime",
  "data-novaflow-source-island",
  "data-novaflow-runtime-ignore",
  "data-novaflow-source-owner",
  "data-novaflow-source-island-placeholder",
  "createSourceIslandRoot",
  "isSourceOwnedIsland",
  "addCleanupCallback",
  "runCleanupCallbacks",
  "activeCleanupCallbacks",
  "activeRoot = null",
  "runtimeDocument.body.appendChild(activeRoot)",
  "root.parentNode?.removeChild(root)"
];
const sourceUploadSurfacesIslandRequired = [
  "SourceUploadSurfacesIsland",
  "SourceUploadSurfacesIslandProps",
  "ProcessingToolsPanel",
  "ProcessingToolsPanelProps",
  "data-source-upload-surfaces-island=\"1\"",
  "aria-label=\"Source upload surfaces island\"",
  "colorReferenceInputIdPrefix=\"source-island-color-ref-input\""
];
const aiSequenceSourceStateHookRequired = [
  "useAISequenceSourceState",
  "useState<AISequenceBoardSession[]>([])",
  "boards",
  "activeBoardId",
  "activeBoard",
  "setActiveBoardId",
  "generationParameters",
  "updateGenerationParameters",
  "timelineState",
  "updateTimelineState",
  "referenceImage",
  "setReferenceImage",
  "clearReferenceImage",
  "colorReference",
  "setColorReference",
  "clearColorReference",
  "videoPreview",
  "setVideoPreview",
  "clearVideoPreview",
  "imageSequenceFrames",
  "setImageSequenceFrames",
  "clearImageSequenceFrames",
  "updateActiveBoardSession",
  "updateBoardSession",
  "revokeImageSequenceFrames",
  "revokeUploadedImage",
  "revokeColorReference",
  "revokeVideoPreview",
  "revokeBoardResources",
  "crypto.randomUUID()",
  "playbackFrameCount",
  "activeBoard && !activeBoard.videoPreview",
  "Math.min(activeBoard.generationParameters.frames, activeBoard.imageSequenceFrames.length)",
  "requestAnimationFrame(advanceFrame)",
  "cancelAnimationFrame(playbackRafRef.current)",
  "const frameDuration = 1000 / Math.max(1, timelineState.fps)",
  "playableFrameCount",
  "Math.min(board.timelineState.totalFrames, board.imageSequenceFrames.length)",
  "currentFrame: (board.timelineState.currentFrame + steps) % playableFrameCount",
  "createBoard",
  "removeBoard",
  "stopBoardPlayback(previousId)",
  "toggleTimelinePlaying",
  "stepTimelineFrame",
  "selectTimelineFrame",
  "frames: next.length",
  "totalFrames: next.length",
  "currentFrame: 0",
  "totalFrames: next.frames",
  "fps: next.fps",
  "currentFrame: clampTimelineFrame(board.timelineState.currentFrame, next.frames)",
  "isPlaying: !current.isPlaying",
  "currentFrame: clampTimelineFrame(current.currentFrame + delta, current.totalFrames)",
  "currentFrame: clampTimelineFrame(frame, current.totalFrames)"
];
const aiSequenceCssRequired = [
  "--ai-seq-bottom-dock-height",
  ".board-switcher",
  ".source-shell__ai-sequence-area",
  ".ai-seq-preview-area",
  "position: relative",
  "min-height: 420px",
  "height: calc(100% - var(--ai-seq-bottom-dock-height) - 12px)",
  "overflow: hidden",
  ".ai-seq-bottom-dock",
  ".generation-parameters-panel",
  ".timeline-panel",
  ".timeline-transport",
  ".timeline-track",
  ".timeline-playhead",
  ".image-sequence-picker",
  ".video-preview-picker",
  ".ai-seq-frame-preview",
  ".ai-seq-video-preview",
  "aspect-ratio: var(--ai-seq-board-aspect)"
];
const bridgeForwardingRequired = [
  "const forwardToLegacy = false",
  "BRIDGE_COLOR_REF_SELECTED",
  "BRIDGE_COLOR_REF_CLEARED",
  "[LegacyBridge] forwarding disabled",
  "data-forward-enabled",
  "data-nested-test-count",
  "installNestedLegacyTestListener"
];

const forbidden = [
  "assets/index-Bqc1waVn.js",
  "assets/index-",
  "/runtime/ai-sequence-state-machine-runtime.js",
  "/runtime/novaflow-brand-runtime.js"
];

for (const token of required) {
  if (!indexHtml.includes(token)) {
    throw new Error(`Missing source-runtime token: ${token}`);
  }
}

for (const token of [
  "resolveSourcePartialReplacementFlags",
  "mountSourceIsland",
  "unmountSourceIsland",
  "sourcePartialReplacementFlags",
  "window.__NOVAFLOW_SOURCE_PARTIAL_REPLACEMENT_FLAGS__",
  "sourcePartialReplacementFlags",
  "if (sourcePartialReplacementFlags.flags.SOURCE_PARTIAL_REPLACEMENT)",
  "mountSourceIsland();",
  "unmountSourceIsland();",
  "[SourcePartialReplacement] source island fallback to legacy-safe empty state"
]) {
  if (!mainSource.includes(token)) {
    throw new Error(`Missing source partial replacement bootstrap token in main.tsx: ${token}`);
  }
}

for (const token of sourcePartialReplacementFlagRequired) {
  if (!sourcePartialReplacementFlagsSource.includes(token)) {
    throw new Error(`Missing source partial replacement flag token: ${token}`);
  }
}

for (const forbiddenNoopFlagToken of [
  "novaflow-source-island-root",
  "data-novaflow-source-island",
  "data-novaflow-runtime-ignore",
  "querySelector",
  "appendChild",
  "removeChild",
  "style.display",
  "hidden = true",
  "input.click(",
  "document.addEventListener(\"click\"",
  "document.addEventListener('click'",
  "postMessage(",
  "Comfy",
  "workflow"
]) {
  if (sourcePartialReplacementFlagsSource.includes(forbiddenNoopFlagToken)) {
    throw new Error(`No-op source partial replacement flag bootstrap must not include: ${forbiddenNoopFlagToken}`);
  }
}

for (const forbiddenMainNoopToken of [
  "data-novaflow-source-island",
  "data-novaflow-runtime-ignore",
  "style.display",
  "hidden = true",
  "uploadsEnabled",
  "previewEnabled",
  "boardSessionEnabled",
  "generationPanelEnabled"
]) {
  if (mainSource.includes(forbiddenMainNoopToken)) {
    throw new Error(`main.tsx no-op flag bootstrap must not mount or hide Source/legacy DOM: ${forbiddenMainNoopToken}`);
  }
}

for (const token of sourceIslandManagerRequired) {
  if (!sourceIslandManagerSource.includes(token)) {
    throw new Error(`Missing source island manager token: ${token}`);
  }
}

for (const forbiddenIslandToken of [
  "style.display",
  "hidden = true",
  ".hidden =",
  "aria-hidden",
  "querySelector",
  "input.click(",
  "document.addEventListener(\"click\"",
  "document.addEventListener('click'",
  "postMessage(",
  "Comfy",
  "workflow",
  "ReferenceImagePicker",
  "ColorReferencePicker",
  "ImageSequencePicker",
  "VideoPreviewPicker",
  "AISequencePreviewArea",
  "GenerationParametersPanel",
  "ProcessingToolsPanel",
  "LegacyRuntimeMount",
  "SOURCE_UPLOAD_SURFACES",
  "SOURCE_PREVIEW_SURFACES",
  "SOURCE_BOARD_SESSION",
  "SOURCE_GENERATION_PANEL"
]) {
  if (sourceIslandManagerSource.includes(forbiddenIslandToken)) {
    throw new Error(`Source island manager must stay an empty mount boundary and must not include: ${forbiddenIslandToken}`);
  }
}

for (const token of sourceRequired) {
  if (!legacyFrameSource.includes(token)) {
    throw new Error(`Missing legacy iframe source token: ${token}`);
  }
}

for (const token of colorReferenceRequired) {
  if (!colorReferenceSource.includes(token)) {
    throw new Error(`Missing color reference source token: ${token}`);
  }
}

if (colorReferenceSource.includes("inputRef.current?.click") || colorReferenceSource.includes(".click()")) {
  throw new Error("ColorReferencePicker must use native label/input activation instead of input.click().");
}

for (const forbiddenColorReferenceToken of [
  "input.click(",
  "document.addEventListener(\"click\"",
  "document.addEventListener('click'",
  "proxy",
  "Proxy",
  "postMessage",
  "ColorReferenceMetadata",
  "SourceToLegacyMessage"
]) {
  if (colorReferenceSource.includes(forbiddenColorReferenceToken)) {
    throw new Error(`ColorReferencePicker must use local native label/input upload only, forbidden token: ${forbiddenColorReferenceToken}`);
  }
}

for (const token of referenceImageRequired) {
  if (!referenceImageSource.includes(token)) {
    throw new Error(`Missing reference image source token: ${token}`);
  }
}

if (referenceImageSource.includes("inputRef.current?.click") || referenceImageSource.includes(".click()")) {
  throw new Error("ReferenceImagePicker must use native label/input activation instead of input.click().");
}

for (const token of imageSequenceRequired) {
  if (!imageSequenceSource.includes(token)) {
    throw new Error(`Missing image sequence source token: ${token}`);
  }
}

if (imageSequenceSource.includes("inputRef.current?.click") || imageSequenceSource.includes(".click()")) {
  throw new Error("ImageSequencePicker must use native label/input activation instead of input.click().");
}

for (const token of videoPreviewPickerRequired) {
  if (!videoPreviewPickerSource.includes(token)) {
    throw new Error(`Missing video preview picker source token: ${token}`);
  }
}

if (videoPreviewPickerSource.includes("inputRef.current?.click") || videoPreviewPickerSource.includes(".click()")) {
  throw new Error("VideoPreviewPicker must use native label/input activation instead of input.click().");
}

for (const token of processingToolsRequired) {
  if (!processingToolsSource.includes(token)) {
    throw new Error(`Missing processing tools source token: ${token}`);
  }
}

for (const token of boardSwitcherRequired) {
  if (!boardSwitcherSource.includes(token)) {
    throw new Error(`Missing board switcher source token: ${token}`);
  }
}

for (const token of aiSequencePreviewRequired) {
  if (!aiSequencePreviewSource.includes(token)) {
    throw new Error(`Missing AI sequence preview source token: ${token}`);
  }
}

for (const token of aiSequenceBoardRequired) {
  if (!aiSequenceBoardSource.includes(token)) {
    throw new Error(`Missing AI sequence board source token: ${token}`);
  }
}

for (const token of aiSequenceFramePreviewRequired) {
  if (!aiSequenceFramePreviewSource.includes(token)) {
    throw new Error(`Missing AI sequence frame preview source token: ${token}`);
  }
}

for (const token of aiSequenceVideoPreviewRequired) {
  if (!aiSequenceVideoPreviewSource.includes(token)) {
    throw new Error(`Missing AI sequence video preview source token: ${token}`);
  }
}

for (const token of addBoardRequired) {
  if (!addBoardSource.includes(token)) {
    throw new Error(`Missing add board source token: ${token}`);
  }
}

if (addBoardSource.includes("type=\"file\"") || addBoardSource.includes("input") || addBoardSource.includes("File")) {
  throw new Error("AddBoardButton must remain a plain button and must not trigger upload behavior.");
}

for (const token of aiSequenceTypeRequired) {
  if (!aiSequenceBoardTypesSource.includes(token)) {
    throw new Error(`Missing AI sequence board type token: ${token}`);
  }
}

for (const token of aiSequenceBoardSessionTypeRequired) {
  if (!aiSequenceBoardSessionTypesSource.includes(token)) {
    throw new Error(`Missing AI sequence board session type token: ${token}`);
  }
}

for (const token of videoPreviewTypeRequired) {
  if (!videoPreviewTypesSource.includes(token)) {
    throw new Error(`Missing video preview type token: ${token}`);
  }
}

for (const token of generationParametersRequired) {
  if (!generationParametersPanelSource.includes(token)) {
    throw new Error(`Missing generation parameters panel token: ${token}`);
  }
}

for (const token of generationParametersTypeRequired) {
  if (!generationParametersTypesSource.includes(token)) {
    throw new Error(`Missing generation parameters type token: ${token}`);
  }
}

if (generationParametersPanelSource.includes("postMessage") || generationParametersPanelSource.includes("legacyFrameRef")) {
  throw new Error("GenerationParametersPanel must not communicate with legacy.");
}

for (const token of timelinePanelRequired) {
  if (!timelinePanelSource.includes(token)) {
    throw new Error(`Missing timeline panel token: ${token}`);
  }
}

for (const token of timelineTransportRequired) {
  if (!timelineTransportSource.includes(token)) {
    throw new Error(`Missing timeline transport token: ${token}`);
  }
}

for (const token of timelineTrackRequired) {
  if (!timelineTrackSource.includes(token)) {
    throw new Error(`Missing timeline track token: ${token}`);
  }
}

for (const token of timelinePlayheadRequired) {
  if (!timelinePlayheadSource.includes(token)) {
    throw new Error(`Missing timeline playhead token: ${token}`);
  }
}

for (const token of timelineTypeRequired) {
  if (!timelineTypesSource.includes(token)) {
    throw new Error(`Missing timeline type token: ${token}`);
  }
}

for (const token of imageSequenceTypeRequired) {
  if (!imageSequenceTypesSource.includes(token)) {
    throw new Error(`Missing image sequence type token: ${token}`);
  }
}

for (const token of colorReferenceTypeRequired) {
  if (!colorReferenceTypesSource.includes(token)) {
    throw new Error(`Missing color reference type token: ${token}`);
  }
}

for (const token of aiSequenceSourceStateHookRequired) {
  if (!aiSequenceSourceStateHookSource.includes(token)) {
    throw new Error(`Missing AI sequence source state hook token: ${token}`);
  }
}

for (const forbiddenSharedHookStateToken of [
  "useState<ReferenceImage",
  "useState<ColorReference",
  "useState<ImageSequenceFrame[]>([])",
  "useState<GenerationParameters>",
  "useState<TimelineState>"
]) {
  if (aiSequenceSourceStateHookSource.includes(forbiddenSharedHookStateToken)) {
    throw new Error(`AI sequence source state must be board-session scoped, not global shared state: ${forbiddenSharedHookStateToken}`);
  }
}

const timelineSources = [
  timelinePanelSource,
  timelineTransportSource,
  timelineTrackSource,
  timelinePlayheadSource,
  imageSequenceSource,
  aiSequenceFramePreviewSource,
  aiSequenceSourceStateHookSource,
  sourceShellSource
].join("\n");

for (const forbiddenTimelineToken of ["setInterval", "setTimeout", ".play()", "<video", "HTMLVideoElement", "webm", "WEBM"]) {
  if (timelineSources.includes(forbiddenTimelineToken)) {
    throw new Error(`Timeline shell must not include playback/runtime token: ${forbiddenTimelineToken}`);
  }
}

for (const forbiddenPlaybackOwnerToken of ["requestAnimationFrame", "cancelAnimationFrame"]) {
  const nonHookSources = [
    timelinePanelSource,
    timelineTransportSource,
    timelineTrackSource,
    timelinePlayheadSource,
    imageSequenceSource,
    aiSequenceFramePreviewSource,
    sourceShellSource
  ].join("\n");
  if (nonHookSources.includes(forbiddenPlaybackOwnerToken)) {
    throw new Error(`Source playback loop must stay inside useAISequenceSourceState: ${forbiddenPlaybackOwnerToken}`);
  }
}

for (const forbiddenHookToken of ["postMessage", "legacyFrameRef", "SOURCE_COLOR_REF", "Comfy", "workflow"]) {
  if (aiSequenceSourceStateHookSource.includes(forbiddenHookToken)) {
    throw new Error(`AI sequence source state hook must stay local-only and must not include: ${forbiddenHookToken}`);
  }
}

for (const token of aiSequenceCssRequired) {
  if (!appCss.includes(token)) {
    throw new Error(`Missing AI sequence CSS token: ${token}`);
  }
}

if (!bridgeHtml.includes("[LegacyBridge] message received")) {
  throw new Error("Legacy bridge does not log received messages.");
}

if (!bridgeHtml.includes("data-legacy-bridge-log")) {
  throw new Error("Legacy bridge does not expose an isolated message log for validation.");
}

if (!bridgeHtml.includes("src=\"/legacy/index.html\"")) {
  throw new Error("Legacy bridge does not contain the nested legacy iframe.");
}

for (const token of bridgeForwardingRequired) {
  if (!bridgeHtml.includes(token)) {
    throw new Error(`Missing guarded bridge forwarding token: ${token}`);
  }
}

if (/const\s+forwardToLegacy\s*=\s*true/.test(bridgeHtml)) {
  throw new Error("Legacy bridge forwarding must default to false.");
}

const selectedForwardStart = bridgeHtml.indexOf("type: \"BRIDGE_COLOR_REF_SELECTED\"");
const selectedForwardEnd = bridgeHtml.indexOf("};", selectedForwardStart);
const selectedForwardBlock = bridgeHtml.slice(selectedForwardStart, selectedForwardEnd);
const forbiddenForwardPayloadTokens = ["file", "blob", "objectURL", "objectUrl", "url", "dataUrl"];
for (const token of forbiddenForwardPayloadTokens) {
  if (selectedForwardBlock.includes(token)) {
    throw new Error(`Bridge selected forwarding payload must not include: ${token}`);
  }
}

if (sourceShellSource.includes("File") || sourceShellSource.includes("Blob") || sourceShellSource.includes(".url")) {
  throw new Error("SourceShell messaging must not pass File, Blob, or object URLs to legacy.");
}

for (const forbiddenSourceShellColorRefToken of [
  "postMessage",
  "SOURCE_COLOR_REF",
  "ColorReferenceMetadata",
  "SourceToLegacyMessage",
  "novaflow-source-runtime-test-selected",
  "novaflow-source-runtime-test-cleared",
  "data-source-message-test-selected",
  "data-source-message-test-cleared"
]) {
  if (sourceShellSource.includes(forbiddenSourceShellColorRefToken)) {
    throw new Error(`SourceShell color_ref must stay local-only and must not include: ${forbiddenSourceShellColorRefToken}`);
  }
}

if (!sourceShellSource.includes("<ProcessingToolsPanel")) {
  throw new Error("ProcessingToolsPanel is not mounted by SourceShell.");
}

for (const token of [
  "useEffect",
  "renderSourceIslandReact",
  "unmountSourceIsland",
  "SourceUploadSurfacesIsland",
  "flags.uploadsEnabled === true",
  "<SourceUploadSurfacesIsland",
  "boardId={aiSequence.activeBoardId}",
  "onReferenceImageChange={aiSequence.setReferenceImage}",
  "onColorReferenceChange={aiSequence.setColorReference}",
  "onImageSequenceChange={aiSequence.setImageSequenceFrames}",
  "onVideoPreviewChange={aiSequence.setVideoPreview}"
]) {
  if (!sourceShellSource.includes(token)) {
    throw new Error(`SourceShell is not wired to gated upload island token: ${token}`);
  }
}

for (const forbiddenSourceShellUploadGateToken of [
  "style.display",
  "hidden = true",
  ".hidden =",
  "postMessage(",
  "Comfy",
  "workflow"
]) {
  if (sourceShellSource.includes(forbiddenSourceShellUploadGateToken)) {
    throw new Error(`SourceShell upload gate must not hide legacy or connect generation: ${forbiddenSourceShellUploadGateToken}`);
  }
}

for (const token of sourceUploadSurfacesIslandRequired) {
  if (!sourceUploadSurfacesIslandSource.includes(token)) {
    throw new Error(`Missing source upload surfaces island token: ${token}`);
  }
}

for (const forbiddenUploadIslandToken of [
  "input.click(",
  "document.addEventListener(\"click\"",
  "document.addEventListener('click'",
  "postMessage(",
  "proxy",
  "Proxy",
  "Comfy",
  "workflow",
  "cutout",
  "GenerationParametersPanel",
  "AISequencePreviewArea",
  "LegacyRuntimeMount",
  "SOURCE_PREVIEW_SURFACES",
  "SOURCE_BOARD_SESSION",
  "SOURCE_GENERATION_PANEL"
]) {
  if (sourceUploadSurfacesIslandSource.includes(forbiddenUploadIslandToken)) {
    throw new Error(`Source upload surfaces island must only compose upload surfaces and must not include: ${forbiddenUploadIslandToken}`);
  }
}

if (!sourceShellSource.includes("<BoardSwitcher")) {
  throw new Error("BoardSwitcher is not mounted by SourceShell.");
}

if (!sourceShellSource.includes("<AISequencePreviewArea")) {
  throw new Error("AISequencePreviewArea is not mounted by SourceShell.");
}

if (!sourceShellSource.includes("<GenerationParametersPanel")) {
  throw new Error("GenerationParametersPanel is not mounted by SourceShell.");
}

if (!sourceShellSource.includes("<TimelinePanel")) {
  throw new Error("TimelinePanel is not mounted by SourceShell.");
}

if (!sourceShellSource.includes("useAISequenceSourceState()")) {
  throw new Error("SourceShell must consume AI sequence state from useAISequenceSourceState.");
}

for (const forbiddenSourceShellStateToken of [
  "const [boards, setBoards]",
  "const [activeBoardId, setActiveBoardId]",
  "const [generationParameters, setGenerationParameters]",
  "const [timelineState, setTimelineState]",
  "const [referenceImage, setReferenceImage]",
  "const [colorReference, setColorReference]",
  "nextBoardIndexRef"
]) {
  if (sourceShellSource.includes(forbiddenSourceShellStateToken)) {
    throw new Error(`SourceShell must not directly hold AI sequence source state: ${forbiddenSourceShellStateToken}`);
  }
}

for (const token of [
  "aiSequence.referenceImage",
  "aiSequence.setReferenceImage",
  "aiSequence.colorReference",
  "aiSequence.setColorReference",
  "aiSequence.clearColorReference",
  "aiSequence.imageSequenceFrames",
  "aiSequence.setImageSequenceFrames",
  "aiSequence.clearImageSequenceFrames",
  "aiSequence.videoPreview",
  "aiSequence.setVideoPreview",
  "aiSequence.clearVideoPreview",
  "aiSequence.generationParameters",
  "aiSequence.updateGenerationParameters",
  "aiSequence.boards",
  "aiSequence.activeBoardId",
  "aiSequence.activeBoard",
  "aiSequence.setActiveBoardId",
  "aiSequence.createBoard",
  "aiSequence.removeBoard",
  "aiSequence.timelineState",
  "aiSequence.toggleTimelinePlaying",
  "aiSequence.stepTimelineFrame",
  "aiSequence.selectTimelineFrame"
]) {
  if (!sourceShellSource.includes(token)) {
    throw new Error(`SourceShell is not wired to source state hook token: ${token}`);
  }
}

if (!sourceShellSource.includes("data-source-runtime-layout")) {
  throw new Error("SourceShell runtime layout boundary is missing.");
}

const auditChecklistRequired = [
  "AI序列动画 Source 版完整验收清单",
  "A. 已完成模块",
  "B. 未完成模块",
  "C. 风险模块",
  "D. 当前是否可作为主 AI序列动画入口",
  "ReferenceImagePicker",
  "ColorReferencePicker",
  "ImageSequencePicker",
  "useAISequenceSourceState",
  "AISequencePreviewArea",
  "AISequenceBoard",
  "AISequenceFramePreview",
  "TimelinePanel",
  "TimelineTransport",
  "TimelineTrack",
  "TimelinePlayhead",
  "legacy iframe",
  "index-Bqc1waVn.js",
  "WEBM",
  "AI生成",
  "抠图",
  "不能作为主 AI序列动画入口"
];

for (const token of auditChecklistRequired) {
  if (!aiSequenceAuditReport.includes(token)) {
    throw new Error(`Missing AI sequence source audit checklist token: ${token}`);
  }
}

const replacementReadinessRequired = [
  "AI Sequence Source Runtime Replacement Readiness",
  "Current Source Runtime Completion",
  "Functional Coverage",
  "UI Coverage",
  "State Stability",
  "Playback And Performance Risk",
  "Remaining Legacy Dependencies",
  "Replacement Readiness Classification",
  "Recommended Replacement Route",
  "可直接替换",
  "可部分替换",
  "不可替换",
  "Direct full replacement: not ready",
  "Full formal entry replacement: blocked",
  "Do not directly replace the formal 4783 AI sequence entry yet",
  "AI generation workflow",
  "ComfyUI workflow integration",
  "Cutout, AI cutout, chroma key, and color correction processing",
  "WEBM/video export pipeline",
  "formal 4783 dist",
  "no locked bundle/runtime patch"
];

for (const token of replacementReadinessRequired) {
  if (!replacementReadinessReport.includes(token)) {
    throw new Error(`Missing replacement readiness report token: ${token}`);
  }
}

for (const token of forbidden) {
  if (indexHtml.includes(token)) {
    throw new Error(`Locked bundle token must not be used by source runtime: ${token}`);
  }
}

const distIndex = path.join(root, "dist", "index.html");
if (fs.existsSync(distIndex)) {
  const builtHtml = fs.readFileSync(distIndex, "utf8");
  if (builtHtml.includes("assets/index-Bqc1waVn.js")) {
    throw new Error("Built source runtime still references the locked bundle.");
  }
  if (builtHtml.includes("/runtime/ai-sequence-state-machine-runtime.js")) {
    throw new Error("Built source runtime must not load legacy runtime scripts in the parent document.");
  }
}

console.log("SOURCE_RUNTIME_BASELINE_OK");
