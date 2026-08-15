export type TimelineState = {
  currentFrame: number;
  totalFrames: number;
  fps: number;
  isPlaying: boolean;
};

export function clampTimelineFrame(frame: number, totalFrames: number) {
  const maxFrame = Math.max(0, totalFrames - 1);
  if (!Number.isFinite(frame)) return 0;
  return Math.min(maxFrame, Math.max(0, Math.trunc(frame)));
}
