import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repoRoot = process.cwd();
const runtimePath = path.join(repoRoot, "particle-editor", "ai-sequence-state-machine-runtime.js");
const source = fs.readFileSync(runtimePath, "utf8");
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: runtimePath });

const api = sandbox.NovaFlowAiSequenceStateMachine;
if (!api || typeof api.createController !== "function") throw new Error("AI sequence state machine runtime API is missing");

const controller = api.createController();
let session = controller.setActiveBoard("video-board");
if (session.mode !== "resource") throw new Error("Video merge board must start in resource mode");
if (!controller.expandTools(true)) throw new Error("Video merge must expand processing tools without current media");
if (!controller.beginTool("video-merge")) throw new Error("Video merge must enter editing from an explicitly expanded empty board");
session = controller.getActiveSession();
if (session.mode !== "editing" || session.activeTool !== "video-merge") throw new Error("Video merge must own the editing lock");
if (!session.videoMergeCache || session.videoMergeCache.dirty !== true) throw new Error("Video merge must receive an isolated dirty cache");
if (controller.addBoard("blocked-video-board") !== null) throw new Error("Video merge editing must block adding another board");

session.sourceMedia = { id: "original-video", kind: "video" };
session.processedMedia = { id: "existing-processed-video", kind: "video" };
session.videoMergeCache.result = { id: "draft-merge", kind: "video" };
if (!controller.cancelEditing({ clearCache: true, preserveMedia: true })) throw new Error("Video merge close must cancel editing");
session = controller.getActiveSession();
if (session.mode !== "resource" || session.activeTool !== null) throw new Error("Video merge close must return to resource mode");
if (session.sourceMedia?.id !== "original-video") throw new Error("Video merge close must not replace current source media");
if (session.processedMedia?.id !== "existing-processed-video") throw new Error("Video merge close must preserve previous processed media");
if (session.videoMergeCache.result !== null || session.editingDraft !== null) throw new Error("Video merge close must clear draft and cache state");
if (!controller.snapshot().sessions[0]?.videoMergeCache) throw new Error("Video merge cache must be included in snapshots");

controller.expandTools(true);
controller.beginTool("video-merge");
session = controller.getActiveSession();
session.processedMedia = { id: "temporary-processed-video", kind: "video" };
controller.cancelEditing({ clearCache: true });
if (controller.getActiveSession().processedMedia !== null) throw new Error("cancelEditing must preserve its existing media-clearing default");

console.log("AI_SEQUENCE_VIDEO_MERGE_STATE_MACHINE_OK");
