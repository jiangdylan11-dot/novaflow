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
if (!api || typeof api.createController !== "function") {
  throw new Error("AI sequence state machine runtime API is missing");
}

const controller = api.createController();
let board1 = controller.setActiveBoard("board-1");

if (board1.mode !== "resource") throw new Error("State A resource is not the default mode");
if (controller.expandTools(false) !== false) throw new Error("Empty board should not enter editor-preview through processing tools");

controller.replaceSource({ id: "media-1", kind: "image" });
if (!controller.canUploadResource()) throw new Error("State A should allow resource upload");
if (!controller.expandTools(true)) throw new Error("State B editor-preview is not reachable with source media");
board1 = controller.getActiveSession();
if (board1.mode !== "editor-preview" || board1.activeTool !== null) throw new Error("Processing tool expand should enter State B with no active tool");
if (controller.canDropResource("right-drag")) throw new Error("State B should block right-drag resource drop");

if (!controller.beginTool("ai-cutout")) throw new Error("State C editing is not reachable from State B");
board1 = controller.getActiveSession();
if (board1.mode !== "editing" || board1.activeTool !== "ai-cutout") throw new Error("AI cutout should set State C and activeTool");
if (controller.addBoard("board-x") !== null) throw new Error("State C must not allow adding a board");
if (controller.canUploadResource()) throw new Error("State C must not allow upload replacement");

if (!controller.saveAndClose({ params: { threshold: 0.7 }, result: { id: "processed-1", kind: "image" } })) {
  throw new Error("AI cutout save and close should commit in State C");
}
board1 = controller.getActiveSession();
if (board1.mode !== "resource" || board1.activeTool !== null) throw new Error("AI cutout save and close must exit processing mode");
if (board1.sourceMedia?.id !== "processed-1") throw new Error("AI cutout committed asset should replace the board source");
if (board1.processedMedia !== null) throw new Error("AI cutout save must not leave processedMedia stashed");
if (board1.aiCutoutCache.result !== null) throw new Error("AI cutout cache result should be cleared after commit");
if (!controller.expandTools(true)) throw new Error("Committed cutout source should allow a fresh editor-preview session");

const board2 = controller.addBoard("board-2");
if (!board2 || board2.mode !== "editor-preview") throw new Error("Adding a board in State B should create an editor-preview session");
controller.setPreviewBackground("checker");
controller.replaceSource({ id: "media-2", kind: "image" }, { mode: "editor-preview" });
controller.beginTool("chroma-key");
controller.saveAndClose({ params: { key: "#00ff00" }, result: { id: "processed-2", kind: "image" } });

controller.setActiveBoard("board-1");
board1 = controller.getActiveSession();
if (board1.sourceMedia?.id !== "processed-1") throw new Error("Board 1 committed source was polluted by Board 2");
if (board1.processedMedia !== null) throw new Error("Board 1 should not restore a stashed AI cutout processedMedia");
if (board1.previewBackground !== "transparent") throw new Error("Board 1 preview background should remain independent");
if (board1.chromaKeyCache.result !== null) throw new Error("Board 1 chroma cache was polluted by Board 2");

controller.expandTools(true);
controller.beginTool("ai-cutout");
if (!controller.cancelEditing({ clearCache: true })) throw new Error("AI cutout cancel should succeed from State C");
board1 = controller.getActiveSession();
if (board1.mode !== "resource" || board1.activeTool !== null) throw new Error("AI cutout cancel must exit processing mode");
if (board1.sourceMedia?.id !== "processed-1") throw new Error("AI cutout cancel should keep the original board source");
if (board1.aiCutoutCache.result !== null || board1.editingDraft !== null) throw new Error("AI cutout cancel should clear temporary edit state");

controller.setActiveBoard("board-2");
const currentBoard2 = controller.getActiveSession();
if (currentBoard2.processedMedia?.id !== "processed-2") throw new Error("Board 2 processedMedia should remain independent");
if (currentBoard2.previewBackground !== "checker") throw new Error("Board 2 preview background cache should remain independent");

controller.collapseTools();
if (controller.getActiveSession().mode !== "resource") throw new Error("Collapsing processing tools must return to State A");

console.log("AI_SEQUENCE_BOARD_STATE_MACHINE_OK");
