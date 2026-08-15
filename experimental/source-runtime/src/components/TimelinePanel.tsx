import { TimelineTrack } from "./TimelineTrack";
import { TimelineTransport } from "./TimelineTransport";
import type { TimelineState } from "../types/timeline";

type Props = {
  state: TimelineState;
  onTogglePlaying: () => void;
  onStepFrame: (delta: number) => void;
  onSelectFrame: (frame: number) => void;
  disabled?: boolean;
};

export function TimelinePanel({ state, onTogglePlaying, onStepFrame, onSelectFrame, disabled = false }: Props) {
  return (
    <section className="timeline-panel" data-source-timeline-panel="1" aria-label="时间轴">
      <TimelineTransport
        state={state}
        onTogglePlaying={onTogglePlaying}
        onStepFrame={onStepFrame}
        disabled={disabled}
      />
      <TimelineTrack
        currentFrame={state.currentFrame}
        totalFrames={state.totalFrames}
        onSelectFrame={onSelectFrame}
        disabled={disabled}
      />
    </section>
  );
}
