type Props = {
  frame: number;
};

export function TimelinePlayhead({ frame }: Props) {
  return (
    <span
      className="timeline-playhead"
      data-source-timeline-playhead="1"
      data-source-timeline-playhead-frame={frame}
      aria-hidden="true"
    />
  );
}
