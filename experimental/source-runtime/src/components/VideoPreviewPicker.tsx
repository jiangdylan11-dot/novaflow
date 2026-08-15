import { useId, useRef, useState } from "react";
import type { VideoPreviewState } from "../types/videoPreview";

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.00s";
  return `${seconds.toFixed(2)}s`;
}

function isSupportedVideo(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "video/webm"
    || file.type === "video/mp4"
    || name.endsWith(".webm")
    || name.endsWith(".mp4");
}

function readVideoPreview(file: File): Promise<VideoPreviewState> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");

    video.preload = "metadata";
    video.muted = true;

    video.onloadedmetadata = () => {
      resolve({
        fileName: file.name,
        url,
        mime: file.type || (file.name.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4"),
        size: file.size,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(file.name));
    };

    video.src = url;
  });
}

type Props = {
  value: VideoPreviewState | null;
  onChange: (next: VideoPreviewState | null) => void;
  onClear: () => void;
  disabled?: boolean;
};

export function VideoPreviewPicker({ value, onChange, onClear, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    if (disabled) return;

    if (!isSupportedVideo(file)) {
      setError("璇烽€夋嫨 WEBM 鎴?MP4 瑙嗛");
      resetInput();
      return;
    }

    try {
      const preview = await readVideoPreview(file);
      setError(null);
      onChange(preview);
    } catch {
      setError("瑙嗛棰勮璇诲彇澶辫触");
    } finally {
      resetInput();
    }
  };

  return (
    <section className="video-preview-picker" data-source-video-preview-picker="1">
      <label className="video-preview-picker__card" htmlFor={inputId}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="video/webm,video/mp4"
          disabled={disabled}
          className="video-preview-picker__input"
          data-source-video-preview-input="1"
          onClick={resetInput}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            void handleFile(file);
          }}
        />
        <span className="video-preview-picker__title">瑙嗛棰勮</span>
        <span className="video-preview-picker__empty">{value ? "WEBM / MP4" : "+"}</span>
      </label>

      <div className="video-preview-picker__meta" data-source-video-preview-meta="1">
        {value ? (
          <>
            <strong>{value.fileName}</strong>
            <span>
              {value.width} x {value.height} 路 {formatDuration(value.duration)} 路 {formatBytes(value.size)}
            </span>
          </>
        ) : (
          <span>鏈€夋嫨瑙嗛棰勮</span>
        )}
      </div>

      {error ? <div className="video-preview-picker__error">{error}</div> : null}

      <button
        type="button"
        className="video-preview-picker__clear"
        disabled={disabled || !value}
        onClick={() => {
          resetInput();
          setError(null);
          onClear();
        }}
      >
        娓呯┖
      </button>
    </section>
  );
}
