import type { TimelineState } from "../types/timeline";

type Props = {
  state: TimelineState;
  onTogglePlaying: () => void;
  onStepFrame: (delta: number) => void;
  disabled?: boolean;
};

export function TimelineTransport({ state, onTogglePlaying, onStepFrame, disabled = false }: Props) {
  return (
    <div className="timeline-transport" data-source-timeline-transport="1">
      <button
        type="button"
        data-source-timeline-prev-frame="1"
        disabled={disabled}
        onClick={() => onStepFrame(-1)}
      >
        上一帧
      </button>
      <button
        type="button"
        data-source-timeline-play-toggle="1"
        data-source-timeline-playing={state.isPlaying}
        disabled={disabled}
        onClick={onTogglePlaying}
      >
        {state.isPlaying ? "暂停" : "播放"}
      </button>
      <button
        type="button"
        data-source-timeline-next-frame="1"
        disabled={disabled}
        onClick={() => onStepFrame(1)}
      >
        下一帧
      </button>
      <output className="timeline-transport__frame" data-source-timeline-current-frame="1">
        第 {state.currentFrame + 1} / {state.totalFrames} 帧 · {state.fps} FPS
      </output>
    </div>
  );
}
