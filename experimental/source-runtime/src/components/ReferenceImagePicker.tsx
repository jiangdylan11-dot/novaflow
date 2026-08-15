import { useEffect, useId, useRef, useState } from "react";
import type { UploadedImageState } from "../types/colorReference";

export type ReferenceImage = UploadedImageState;

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

type Props = {
  value: ReferenceImage | null;
  onChange: (next: ReferenceImage | null) => void;
  disabled?: boolean;
};

export function ReferenceImagePicker({ value, onChange, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentObjectUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    currentObjectUrlRef.current = value?.url || null;
  }, [value?.url]);

  useEffect(() => {
    return () => {
      if (currentObjectUrlRef.current) URL.revokeObjectURL(currentObjectUrlRef.current);
    };
  }, []);

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  const clearCurrent = () => {
    if (disabled) return;
    if (value?.url) URL.revokeObjectURL(value.url);
    currentObjectUrlRef.current = null;
    resetInput();
    setError(null);
    onChange(null);
  };

  const handleFile = (file: File) => {
    if (disabled) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      resetInput();
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      if (currentObjectUrlRef.current) URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = nextUrl;
      setError(null);
      onChange({
        file,
        url: nextUrl,
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        size: file.size,
        mime: file.type
      });
      resetInput();
    };

    image.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      setError("图片读取失败");
      resetInput();
    };

    image.src = nextUrl;
  };

  return (
    <section className="reference-image-picker" data-source-reference-image-picker="1">
      <label className="reference-image-picker__card" htmlFor={inputId}>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          className="reference-image-picker__input"
          data-source-reference-image-input="1"
          onClick={resetInput}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (!file) return;
            handleFile(file);
          }}
        />
        <span className="reference-image-picker__title">参考图</span>
        {value ? (
          <span className="reference-image-picker__preview-wrap">
            <img className="reference-image-picker__preview" src={value.url} alt="参考图" />
          </span>
        ) : (
          <span className="reference-image-picker__empty">+</span>
        )}
      </label>

      <div className="reference-image-picker__meta" data-source-reference-image-meta="1">
        {value ? (
          <>
            <strong title={value.name}>{value.name}</strong>
            <span>
              {value.width} x {value.height} · {formatBytes(value.size)}
            </span>
          </>
        ) : (
          <span>未选择图片</span>
        )}
      </div>

      {error ? <div className="reference-image-picker__error">{error}</div> : null}

      <button
        type="button"
        className="reference-image-picker__clear"
        disabled={disabled || !value}
        onClick={clearCurrent}
      >
        清空
      </button>
    </section>
  );
}
