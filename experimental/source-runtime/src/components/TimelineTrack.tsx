import { TimelinePlayhead } from "./TimelinePlayhead";

type Props = {
  currentFrame: number;
  totalFrames: number;
  onSelectFrame: (frame: number) => void;
  disabled?: boolean;
};

export function TimelineTrack({ currentFrame, totalFrames, onSelectFrame, disabled = false }: Props) {
  const frames = Array.from({ length: totalFrames }, (_, index) => index);

  return (
    <div className="timeline-track" data-source-timeline-track="1" data-source-timeline-frame-count={totalFrames}>
      {frames.map((frame) => (
        <button
          key={frame}
          type="button"
          className={frame === currentFrame ? "timeline-track__cell timeline-track__cell--active" : "timeline-track__cell"}
          data-source-timeline-frame-cell="1"
          data-source-timeline-frame={frame}
          disabled={disabled}
          onClick={() => onSelectFrame(frame)}
        >
          <span>{frame + 1}</span>
          {frame === currentFrame ? <TimelinePlayhead frame={frame} /> : null}
        </button>
      ))}
    </div>
  );
}
