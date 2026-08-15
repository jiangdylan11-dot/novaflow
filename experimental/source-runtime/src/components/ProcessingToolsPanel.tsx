import { ColorReferencePicker } from "./ColorReferencePicker";
import { ImageSequencePicker } from "./ImageSequencePicker";
import { ReferenceImagePicker, type ReferenceImage } from "./ReferenceImagePicker";
import { VideoPreviewPicker } from "./VideoPreviewPicker";
import type { ColorReference } from "../types/colorReference";
import type { ImageSequenceFrame } from "../types/imageSequence";
import type { VideoPreviewState } from "../types/videoPreview";

export type ProcessingToolsPanelProps = {
  boardId: string | null;
  referenceImage: ReferenceImage | null;
  onReferenceImageChange: (next: ReferenceImage | null) => void;
  colorReference: ColorReference | null;
  onColorReferenceChange: (next: ColorReference | null) => void;
  onColorReferenceClear: () => void;
  imageSequenceFrames: ImageSequenceFrame[];
  onImageSequenceChange: (next: ImageSequenceFrame[]) => void;
  onImageSequenceClear: () => void;
  videoPreview: VideoPreviewState | null;
  onVideoPreviewChange: (next: VideoPreviewState | null) => void;
  onVideoPreviewClear: () => void;
  colorReferenceInputIdPrefix?: string;
  disabled?: boolean;
};

export function ProcessingToolsPanel({
  boardId,
  referenceImage,
  onReferenceImageChange,
  colorReference,
  onColorReferenceChange,
  onColorReferenceClear,
  imageSequenceFrames,
  onImageSequenceChange,
  onImageSequenceClear,
  videoPreview,
  onVideoPreviewChange,
  onVideoPreviewClear,
  colorReferenceInputIdPrefix,
  disabled = false
}: ProcessingToolsPanelProps) {
  return (
    <section
      className="processing-tools-panel"
      data-source-processing-tools-panel="1"
      aria-label="处理工具：参考图和自定义色彩参照"
    >
      <div className="processing-tools-panel__header">
        <h2>处理工具</h2>
      </div>
      <ReferenceImagePicker value={referenceImage} onChange={onReferenceImageChange} disabled={disabled} />
      <ColorReferencePicker
        boardId={boardId}
        value={colorReference}
        onChange={onColorReferenceChange}
        onClear={onColorReferenceClear}
        inputIdPrefix={colorReferenceInputIdPrefix}
        disabled={disabled}
      />
      <ImageSequencePicker
        value={imageSequenceFrames}
        onChange={onImageSequenceChange}
        onClear={onImageSequenceClear}
        disabled={disabled}
      />
      <VideoPreviewPicker
        value={videoPreview}
        onChange={onVideoPreviewChange}
        onClear={onVideoPreviewClear}
        disabled={disabled}
      />
    </section>
  );
}
