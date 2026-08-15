import type { ImageSequenceFrame } from "../types/imageSequence";

type Props = {
  frame: ImageSequenceFrame | null;
};

export function AISequenceFramePreview({ frame }: Props) {
  if (!frame) {
    return <div className="ai-seq-frame-preview ai-seq-frame-preview--empty" data-source-ai-seq-frame-preview="empty" />;
  }

  return (
    <figure className="ai-seq-frame-preview" data-source-ai-seq-frame-preview="image">
      <img
        className="ai-seq-frame-preview__image"
        src={frame.url}
        alt={frame.name}
        data-source-ai-seq-frame-preview-image="1"
      />
      <figcaption className="ai-seq-frame-preview__caption" data-source-ai-seq-frame-preview-caption="1">
        {frame.name}
      </figcaption>
    </figure>
  );
}
