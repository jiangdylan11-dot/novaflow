import { AISequencePreviewArea } from "./AISequencePreviewArea";
import { BoardSwitcher } from "./BoardSwitcher";
import { GenerationParametersPanel } from "./GenerationParametersPanel";
import { LegacyRuntimeMount } from "./LegacyRuntimeMount";
import { ProcessingToolsPanel } from "./ProcessingToolsPanel";
import { TimelinePanel } from "./TimelinePanel";
import { useEffect, useRef } from "react";
import { useAISequenceSourceState } from "../hooks/useAISequenceSourceState";
import { renderSourceIslandReact, unmountSourceIsland } from "../partialReplacement/sourceIslandManager";
import { SourceUploadSurfacesIsland } from "../partialReplacement/SourceUploadSurfacesIsland";

const shellMarker = "SOURCE_SHELL_COLOR_REFERENCE_LOCAL_ONLY_V2";

export function SourceShell() {
  const aiSequence = useAISequenceSourceState();
  const legacyFrameRef = useRef<HTMLIFrameElement | null>(null);
  const islandCleanupVersionRef = useRef(0);
  const uploadSurfacesEnabled = window.__NOVAFLOW_SOURCE_PARTIAL_REPLACEMENT_FLAGS__?.flags.uploadsEnabled === true;

  useEffect(() => {
    if (!uploadSurfacesEnabled) return;
    const cleanupVersion = islandCleanupVersionRef.current + 1;
    islandCleanupVersionRef.current = cleanupVersion;

    return () => {
      queueMicrotask(() => {
        if (islandCleanupVersionRef.current === cleanupVersion) {
          unmountSourceIsland();
        }
      });
    };
  }, [uploadSurfacesEnabled]);

  useEffect(() => {
    if (!uploadSurfacesEnabled) return;

    renderSourceIslandReact(
      <SourceUploadSurfacesIsland
        boardId={aiSequence.activeBoardId}
        referenceImage={aiSequence.referenceImage}
        onReferenceImageChange={aiSequence.setReferenceImage}
        colorReference={aiSequence.colorReference}
        onColorReferenceChange={aiSequence.setColorReference}
        onColorReferenceClear={aiSequence.clearColorReference}
        imageSequenceFrames={aiSequence.imageSequenceFrames}
        onImageSequenceChange={aiSequence.setImageSequenceFrames}
        onImageSequenceClear={aiSequence.clearImageSequenceFrames}
        videoPreview={aiSequence.videoPreview}
        onVideoPreviewChange={aiSequence.setVideoPreview}
        onVideoPreviewClear={aiSequence.clearVideoPreview}
        disabled={!aiSequence.activeBoard}
      />
    );
  }, [
    aiSequence.activeBoard,
    aiSequence.activeBoardId,
    aiSequence.clearColorReference,
    aiSequence.clearImageSequenceFrames,
    aiSequence.clearVideoPreview,
    aiSequence.colorReference,
    aiSequence.imageSequenceFrames,
    aiSequence.referenceImage,
    aiSequence.setColorReference,
    aiSequence.setImageSequenceFrames,
    aiSequence.setReferenceImage,
    aiSequence.setVideoPreview,
    aiSequence.videoPreview,
    uploadSurfacesEnabled
  ]);

  return (
    <>
      <main className="source-shell" data-source-shell-root="1" data-source-runtime-marker={shellMarker}>
        <header className="source-shell__topbar" data-source-shell-topbar="1">
          <div className="source-shell__brand">NovaFlow</div>
          <div className="source-shell__status">Source Shell</div>
        </header>

        <div className="source-shell__body">
          <aside className="source-shell__sidebar" data-source-shell-sidebar="1" aria-label="Source navigation">
            <button type="button" className="source-shell__nav-item source-shell__nav-item--active">
              Runtime
            </button>
            <button type="button" className="source-shell__nav-item">
              Assets
            </button>
            <button type="button" className="source-shell__nav-item">
              Tools
            </button>
          </aside>

          <section className="source-shell__workspace" data-source-shell-workspace="1">
            <div className="source-shell__workspace-header">
              <div>
                <p className="source-shell__kicker">Phase 18</p>
                <h1>Source Color Reference Upload</h1>
              </div>
              <div className="source-shell__toolbar" data-source-shell-toolbar="1">
                <div className="source-shell__badge">Legacy isolated in iframe</div>
              </div>
            </div>

            <div className="source-shell__runtime-layout" data-source-runtime-layout="1">
              <div className="source-shell__left-panels" data-source-shell-left-panels="1">
                <ProcessingToolsPanel
                  boardId={aiSequence.activeBoardId}
                  referenceImage={aiSequence.referenceImage}
                  onReferenceImageChange={aiSequence.setReferenceImage}
                  colorReference={aiSequence.colorReference}
                  onColorReferenceChange={aiSequence.setColorReference}
                  onColorReferenceClear={aiSequence.clearColorReference}
                  imageSequenceFrames={aiSequence.imageSequenceFrames}
                  onImageSequenceChange={aiSequence.setImageSequenceFrames}
                  onImageSequenceClear={aiSequence.clearImageSequenceFrames}
                  videoPreview={aiSequence.videoPreview}
                  onVideoPreviewChange={aiSequence.setVideoPreview}
                  onVideoPreviewClear={aiSequence.clearVideoPreview}
                  disabled={!aiSequence.activeBoard}
                />
                <GenerationParametersPanel
                  value={aiSequence.generationParameters}
                  onChange={aiSequence.updateGenerationParameters}
                  disabled={!aiSequence.activeBoard}
                />
              </div>
              <div className="source-shell__workbench" data-source-shell-workbench="1">
                <div className="source-shell__ai-sequence-area" data-source-shell-ai-sequence-area="1">
                  <BoardSwitcher
                    boards={aiSequence.boards}
                    activeBoardId={aiSequence.activeBoardId}
                    onSelectBoard={aiSequence.setActiveBoardId}
                    onCreateBoard={aiSequence.createBoard}
                    onRemoveBoard={aiSequence.removeBoard}
                  />
                  <AISequencePreviewArea
                    activeBoard={aiSequence.activeBoard}
                    imageSequenceFrames={aiSequence.imageSequenceFrames}
                    currentFrame={aiSequence.timelineState.currentFrame}
                    timelineState={aiSequence.timelineState}
                    onAddBoard={aiSequence.createBoard}
                    onVideoEnded={() => aiSequence.selectTimelineFrame(0)}
                    timeline={
                      <TimelinePanel
                        state={aiSequence.timelineState}
                        onTogglePlaying={aiSequence.toggleTimelinePlaying}
                        onStepFrame={aiSequence.stepTimelineFrame}
                        onSelectFrame={aiSequence.selectTimelineFrame}
                        disabled={!aiSequence.activeBoard}
                      />
                    }
                  />
                </div>
                <LegacyRuntimeMount legacyFrameRef={legacyFrameRef} />
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
