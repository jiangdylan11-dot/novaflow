export type GenerationParameters = {
  width: number;
  height: number;
  frames: number;
  fps: number;
  prompt: string;
  negativePrompt: string;
};

export type GenerationNumberParameter = "width" | "height" | "frames" | "fps";

export const GENERATION_PARAMETER_MIN: Record<GenerationNumberParameter, number> = {
  width: 64,
  height: 64,
  frames: 1,
  fps: 1
};

export const DEFAULT_GENERATION_PARAMETERS: GenerationParameters = {
  width: 512,
  height: 720,
  frames: 49,
  fps: 16,
  prompt: "",
  negativePrompt: ""
};
