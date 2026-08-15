import { AddBoardButton } from "./AddBoardButton";
import { AISequenceBoard } from "./AISequenceBoard";
import type { ReactNode } from "react";
import type { AISequenceBoardSession } from "../types/aiSequenceBoardSession";
import type { ImageSequenceFrame } from "../types/imageSequence";
import type { TimelineState } from "../types/timeline";

type Props = {
  activeBoard: AISequenceBoardSession | null;
  imageSequenceFrames: ImageSequenceFrame[];
  currentFrame: number;
  timelineState: TimelineState;
  onAddBoard: () => void;
  onVideoEnded: () => void;
  timeline: ReactNode;
};

export function AISequencePreviewArea({
  activeBoard,
  imageSequenceFrames,
  currentFrame,
  timelineState,
  onAddBoard,
  onVideoEnded,
  timeline
}: Props) {
  const frameIndex = imageSequenceFrames.length ? Math.min(currentFrame, imageSequenceFrames.length - 1) : -1;
  const activeFrame = frameIndex >= 0 ? imageSequenceFrames[frameIndex] : null;

  return (
    <section className="ai-seq-workspace" data-source-ai-seq-workspace="1">
      <div className="ai-seq-preview-area" data-source-ai-seq-preview-area="1">
        {activeBoard ? (
          <>
            <div className="ai-seq-preview-area__actions">
              <AddBoardButton variant="compact" onAddBoard={onAddBoard} />
            </div>
            <div className="ai-seq-preview-area__stage" data-source-ai-seq-preview-stage="1">
              <AISequenceBoard
                board={activeBoard}
                frame={activeFrame}
                timelineState={timelineState}
                onVideoEnded={onVideoEnded}
              />
            </div>
          </>
        ) : (
          <div className="ai-seq-preview-area__empty" data-source-ai-seq-empty-state="1">
            <AddBoardButton variant="empty" onAddBoard={onAddBoard} />
          </div>
        )}
      </div>

      <div className="ai-seq-bottom-dock" data-source-ai-seq-bottom-dock="1">
        {timeline}
      </div>
    </section>
  );
}
