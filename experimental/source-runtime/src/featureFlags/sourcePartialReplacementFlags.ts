export type SourcePartialReplacementFlags = {
  SOURCE_PARTIAL_REPLACEMENT: boolean;
  SOURCE_UPLOAD_SURFACES: boolean;
  SOURCE_PREVIEW_SURFACES: boolean;
  SOURCE_BOARD_SESSION: boolean;
  SOURCE_GENERATION_PANEL: boolean;
};

export type EffectiveSourcePartialReplacementFlags = SourcePartialReplacementFlags & {
  uploadsEnabled: boolean;
  previewEnabled: boolean;
  boardSessionEnabled: boolean;
  generationPanelEnabled: boolean;
};

export type SourcePartialReplacementFlagResolution = {
  rawFlags: SourcePartialReplacementFlags;
  flags: EffectiveSourcePartialReplacementFlags;
  sources: string[];
  fallbackReason: string | null;
};

type SourcePartialReplacementFlagKey = keyof SourcePartialReplacementFlags;
type SourcePartialReplacementFlagInput = Partial<Record<SourcePartialReplacementFlagKey, unknown>>;

declare global {
  interface Window {
    __NOVAFLOW_SOURCE_PARTIAL_FLAGS__?: SourcePartialReplacementFlagInput;
    __NOVAFLOW_SOURCE_PARTIAL_REPLACEMENT_FLAGS__?: SourcePartialReplacementFlagResolution;
  }
}

export const SOURCE_PARTIAL_REPLACEMENT_FLAG_KEYS: SourcePartialReplacementFlagKey[] = [
  "SOURCE_PARTIAL_REPLACEMENT",
  "SOURCE_UPLOAD_SURFACES",
  "SOURCE_PREVIEW_SURFACES",
  "SOURCE_BOARD_SESSION",
  "SOURCE_GENERATION_PANEL"
];

export const DEFAULT_SOURCE_PARTIAL_REPLACEMENT_FLAGS: SourcePartialReplacementFlags = {
  SOURCE_PARTIAL_REPLACEMENT: false,
  SOURCE_UPLOAD_SURFACES: false,
  SOURCE_PREVIEW_SURFACES: false,
  SOURCE_BOARD_SESSION: false,
  SOURCE_GENERATION_PANEL: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBooleanFlag(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return null;
}

function fallbackResolution(fallbackReason: string | null): SourcePartialReplacementFlagResolution {
  const rawFlags = { ...DEFAULT_SOURCE_PARTIAL_REPLACEMENT_FLAGS };
  return {
    rawFlags,
    flags: computeEffectiveSourcePartialReplacementFlags(rawFlags),
    sources: ["default"],
    fallbackReason
  };
}

function normalizeFlagInput(
  sourceName: string,
  input: unknown
): { flags: Partial<SourcePartialReplacementFlags>; fallbackReason: string | null } {
  if (input === undefined || input === null) return { flags: {}, fallbackReason: null };
  if (!isRecord(input)) return { flags: {}, fallbackReason: `${sourceName}:not-object` };

  const flags: Partial<SourcePartialReplacementFlags> = {};
  for (const key of SOURCE_PARTIAL_REPLACEMENT_FLAG_KEYS) {
    if (!(key in input)) continue;
    const parsed = parseBooleanFlag(input[key]);
    if (parsed === null) return { flags: {}, fallbackReason: `${sourceName}:${key}:invalid` };
    flags[key] = parsed;
  }

  return { flags, fallbackReason: null };
}

function readLocalStorageFlags(runtimeWindow: Window): SourcePartialReplacementFlagInput | null | string {
  try {
    const storage = runtimeWindow.localStorage;
    const flags: SourcePartialReplacementFlagInput = {};
    let hasFlag = false;

    for (const key of SOURCE_PARTIAL_REPLACEMENT_FLAG_KEYS) {
      const value = storage.getItem(key);
      if (value === null) continue;
      flags[key] = value;
      hasFlag = true;
    }

    return hasFlag ? flags : null;
  } catch {
    return "localStorage:unavailable";
  }
}

function readQueryFlags(runtimeWindow: Window): SourcePartialReplacementFlagInput | null | string {
  try {
    const search = runtimeWindow.location?.search ?? "";
    const params = new URLSearchParams(search);
    const flags: SourcePartialReplacementFlagInput = {};
    let hasFlag = false;

    for (const key of SOURCE_PARTIAL_REPLACEMENT_FLAG_KEYS) {
      if (!params.has(key)) continue;
      flags[key] = params.get(key);
      hasFlag = true;
    }

    return hasFlag ? flags : null;
  } catch {
    return "query:unavailable";
  }
}

export function computeEffectiveSourcePartialReplacementFlags(
  flags: SourcePartialReplacementFlags
): EffectiveSourcePartialReplacementFlags {
  const masterEnabled = flags.SOURCE_PARTIAL_REPLACEMENT === true;

  return {
    ...flags,
    uploadsEnabled: masterEnabled && flags.SOURCE_UPLOAD_SURFACES === true,
    previewEnabled: masterEnabled && flags.SOURCE_PREVIEW_SURFACES === true,
    boardSessionEnabled: masterEnabled && flags.SOURCE_BOARD_SESSION === true,
    generationPanelEnabled: masterEnabled && flags.SOURCE_GENERATION_PANEL === true
  };
}

export function resolveSourcePartialReplacementFlags(
  runtimeWindow: Window | undefined = typeof window === "undefined" ? undefined : window
): SourcePartialReplacementFlagResolution {
  if (!runtimeWindow) return fallbackResolution(null);

  const sources = [
    { name: "global", input: runtimeWindow.__NOVAFLOW_SOURCE_PARTIAL_FLAGS__ },
    { name: "localStorage", input: readLocalStorageFlags(runtimeWindow) },
    { name: "query", input: readQueryFlags(runtimeWindow) }
  ];
  const rawFlags = { ...DEFAULT_SOURCE_PARTIAL_REPLACEMENT_FLAGS };
  const activeSources: string[] = [];

  for (const source of sources) {
    if (typeof source.input === "string") return fallbackResolution(source.input);
    const { flags, fallbackReason } = normalizeFlagInput(source.name, source.input);
    if (fallbackReason) return fallbackResolution(fallbackReason);
    if (!Object.keys(flags).length) continue;
    Object.assign(rawFlags, flags);
    activeSources.push(source.name);
  }

  return {
    rawFlags,
    flags: computeEffectiveSourcePartialReplacementFlags(rawFlags),
    sources: activeSources.length ? activeSources : ["default"],
    fallbackReason: null
  };
}
