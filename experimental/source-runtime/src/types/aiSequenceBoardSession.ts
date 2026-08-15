import type { ColorReference, UploadedImageState } from "./colorReference";
import type { GenerationParameters } from "./generationParameters";
import type { ImageSequenceFrame } from "./imageSequence";
import type { TimelineState } from "./timeline";
import type { VideoPreviewState } from "./videoPreview";

export interface AISequenceBoardSession {
  id: string;
  name: string;
  generationParameters: GenerationParameters;
  timelineState: TimelineState;
  imageSequenceFrames: ImageSequenceFrame[];
  referenceImage: UploadedImageState | null;
  colorReference?: ColorReference | null;
  videoPreview: VideoPreviewState | null;
}

export const DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS: GenerationParameters = {
  width: 512,
  height: 720,
  frames: 24,
  fps: 12,
  prompt: "",
  negativePrompt: ""
};

export const DEFAULT_BOARD_SESSION_TIMELINE_STATE: TimelineState = {
  currentFrame: 0,
  totalFrames: DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS.frames,
  fps: DEFAULT_BOARD_SESSION_GENERATION_PARAMETERS.fps,
  isPlaying: false
};
