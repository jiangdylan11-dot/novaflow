import { useState } from "react";
import type { ColorReference } from "../types/colorReference";

const COLOR_REFERENCE_ACCEPT = "image/png,image/jpeg,image/webp";
const SUPPORTED_COLOR_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const SUPPORTED_COLOR_REFERENCE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function createColorReferenceId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `color-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isSupportedColorReferenceFile(file: File) {
  const mimeType = String(file.type || "").toLowerCase();
  if (SUPPORTED_COLOR_REFERENCE_TYPES.has(mimeType)) return true;
  const fileName = file.name.toLowerCase();
  return SUPPORTED_COLOR_REFERENCE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

type Props = {
  boardId: string | null;
  value: ColorReference | null;
  disabled?: boolean;
  inputIdPrefix?: string;
  onChange: (next: ColorReference | null) => void;
  onClear: () => void;
};

export function ColorReferencePicker({
  boardId,
  value,
  disabled = false,
  inputIdPrefix = "source-color-ref-input",
  onChange,
  onClear
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const inputId = `${inputIdPrefix}-${boardId ?? "empty"}`;
  const isDisabled = disabled || !boardId;

  const clearCurrent = () => {
    if (isDisabled) return;
    setError(null);
    onClear();
  };

  const handleFile = (file: File) => {
    if (isDisabled) return;
    if (!isSupportedColorReferenceFile(file)) {
      setError("请选择 PNG、JPG、JPEG 或 WEBP 图片。");
      return;
    }

    setError(null);
    onChange({
      id: createColorReferenceId(),
      fileName: file.name,
      objectUrl: URL.createObjectURL(file),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      createdAt: Date.now()
    });
  };

  return (
    <section className="color-reference-picker" data-source-color-reference-picker="1">
      <label
        className={`color-reference-picker__card${isDisabled ? " color-reference-picker__card--disabled" : ""}`}
        htmlFor={inputId}
        aria-disabled={isDisabled}
      >
        {value ? (
          <span className="color-reference-picker__preview-wrap">
            <img className="color-reference-picker__preview" src={value.objectUrl} alt="自定义色彩参照" />
          </span>
        ) : (
          <span className="color-reference-picker__empty">+</span>
        )}
        <span className="color-reference-picker__title">上传自定义色彩参照</span>
      </label>

      <input
        id={inputId}
        type="file"
        accept={COLOR_REFERENCE_ACCEPT}
        disabled={isDisabled}
        className="color-reference-picker__input"
        data-source-color-reference-input="1"
        onClick={(event) => {
          event.currentTarget.value = "";
        }}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          handleFile(file);
        }}
      />

      <div className="color-reference-picker__meta" data-source-color-reference-meta="1">
        {value ? (
          <>
            <strong title={value.fileName}>{value.fileName}</strong>
            <span>
              {value.mimeType || "image"} / {formatBytes(value.size)}
            </span>
          </>
        ) : (
          <span>{boardId ? "未选择自定义色彩参照" : "请先新建或选择 Source board"}</span>
        )}
      </div>

      {error ? <div className="color-reference-picker__error">{error}</div> : null}

      <button
        type="button"
        className="color-reference-picker__clear"
        disabled={isDisabled || !value}
        onClick={clearCurrent}
      >
        清除
      </button>
    </section>
  );
}
