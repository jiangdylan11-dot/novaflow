import { useEffect, useRef, useState } from "react";
import type { TimelineState } from "../types/timeline";
import type { VideoPreviewState } from "../types/videoPreview";

type Props = {
  videoPreview: VideoPreviewState;
  timelineState: TimelineState;
  fps: number;
  onEnded: () => void;
};

function clampTime(value: number, duration: number) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, value);
  return Math.min(duration, Math.max(0, value));
}

export function AISequenceVideoPreview({ videoPreview, timelineState, fps, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const targetTime = clampTime(timelineState.currentFrame / Math.max(1, fps), videoPreview.duration);
    if (Math.abs(video.currentTime - targetTime) > 0.05) {
      video.currentTime = targetTime;
    }
  }, [fps, timelineState.currentFrame, videoPreview.duration, videoPreview.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!timelineState.isPlaying) {
      video.pause();
      return;
    }

    setPlayError(null);
    video.play().catch((error: unknown) => {
      console.warn("[SourceVideoPreview] video.play() failed", error);
      setPlayError("瑙嗛鎾斁琚祻瑙堝櫒鎷︽埅");
    });
  }, [timelineState.isPlaying, videoPreview.url]);

  const handleEnded = () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    onEnded();

    if (timelineState.isPlaying) {
      video.play().catch((error: unknown) => {
        console.warn("[SourceVideoPreview] video loop play failed", error);
        setPlayError("瑙嗛寰幆鎾斁琚祻瑙堝櫒鎷︽埅");
      });
    }
  };

  return (
    <figure className="ai-seq-video-preview" data-source-ai-seq-video-preview="1">
      <video
        ref={videoRef}
        className="ai-seq-video-preview__video"
        src={videoPreview.url}
        muted
        playsInline
        controls={false}
        preload="metadata"
        onEnded={handleEnded}
        data-source-ai-seq-video-preview-element="1"
      />
      <figcaption className="ai-seq-video-preview__caption" data-source-ai-seq-video-preview-caption="1">
        {videoPreview.fileName}
      </figcaption>
      {playError ? (
        <div className="ai-seq-video-preview__error" data-source-ai-seq-video-preview-error="1">
          {playError}
        </div>
      ) : null}
    </figure>
  );
}
