import { AISequenceFramePreview } from "./AISequenceFramePreview";
import { AISequenceVideoPreview } from "./AISequenceVideoPreview";
import type { CSSProperties } from "react";
import type { AISequenceBoardSession } from "../types/aiSequenceBoardSession";
import type { ImageSequenceFrame } from "../types/imageSequence";
import type { TimelineState } from "../types/timeline";

type Props = {
  board: AISequenceBoardSession;
  frame: ImageSequenceFrame | null;
  timelineState: TimelineState;
  onVideoEnded: () => void;
};

export function AISequenceBoard({ board, frame, timelineState, onVideoEnded }: Props) {
  const { width, height } = board.generationParameters;
  const boardStyle = {
    "--ai-seq-board-aspect": `${width} / ${height}`,
    "--ai-seq-board-fit-width": `min(${width}px, calc(100cqw - 48px), calc((100cqh - 48px) * ${width} / ${height}))`
  } as CSSProperties;

  return (
    <article
      className="ai-seq-board"
      data-source-ai-seq-board="1"
      data-source-ai-seq-board-id={board.id}
      style={boardStyle}
    >
      {board.videoPreview ? (
        <AISequenceVideoPreview
          videoPreview={board.videoPreview}
          timelineState={timelineState}
          fps={board.generationParameters.fps}
          onEnded={onVideoEnded}
        />
      ) : (
        <AISequenceFramePreview frame={frame} />
      )}
      <div className="ai-seq-board__label">
        <strong>{board.name}</strong>
        <span>
          {width} x {height}
        </span>
      </div>
    </article>
  );
}
