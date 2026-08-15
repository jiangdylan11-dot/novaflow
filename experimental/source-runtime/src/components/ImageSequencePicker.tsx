import { useId, useRef, useState } from "react";
import type { ImageSequenceFrame } from "../types/imageSequence";

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function readImageFrame(file: File, index: number): Promise<ImageSequenceFrame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        name: file.name,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        size: file.size,
        mime: file.type
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(file.name));
    };

    image.src = url;
  });
}

type Props = {
  value: ImageSequenceFrame[];
  onChange: (next: ImageSequenceFrame[]) => void;
  onClear: () => void;
  disabled?: boolean;
};

export function ImageSequencePicker({ value, onChange, onClear, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFiles = async (fileList: FileList) => {
    if (disabled) return;
    const files = Array.from(fileList)
      .filter((file) => file.type.startsWith("image/"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    if (!files.length) {
      setError("请选择图片序列");
      resetInput();
      return;
    }

    const results = await Promise.allSettled(files.map((file, index) => readImageFrame(file, index)));
    const frames = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);

    if (!frames.length) {
      setError("图片序列读取失败");
      resetInput();
      return;
    }

    setError(results.some((result) => result.status === "rejected") ? "部分图片读取失败" : null);
    onChange(frames);
    resetInput();
  };

  const firstFrame = value[0] ?? null;

  return (
    <section className="image-sequence-picker" data-source-image-sequence-picker="1">
      <label className="image-sequence-picker__card" htmlFor={inputId}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          className="image-sequence-picker__input"
          data-source-image-sequence-input="1"
          onClick={resetInput}
          onChange={(event) => {
            const files = event.currentTarget.files;
            if (!files?.length) return;
            void handleFiles(files);
          }}
        />
        <span className="image-sequence-picker__title">图片序列</span>
        {firstFrame ? (
          <span className="image-sequence-picker__preview-wrap">
            <img className="image-sequence-picker__preview" src={firstFrame.url} alt={firstFrame.name} />
          </span>
        ) : (
          <span className="image-sequence-picker__empty">+</span>
        )}
      </label>

      <div className="image-sequence-picker__meta" data-source-image-sequence-meta="1">
        {value.length ? (
          <>
            <strong>{value.length} frames</strong>
            <span>
              {firstFrame?.width ?? 0} x {firstFrame?.height ?? 0} · {formatBytes(value.reduce((sum, frame) => sum + frame.size, 0))}
            </span>
          </>
        ) : (
          <span>未选择图片序列</span>
        )}
      </div>

      {error ? <div className="image-sequence-picker__error">{error}</div> : null}

      <button
        type="button"
        className="image-sequence-picker__clear"
        disabled={disabled || !value.length}
        onClick={() => {
          resetInput();
          setError(null);
          onClear();
        }}
      >
        清空
      </button>
    </section>
  );
}
