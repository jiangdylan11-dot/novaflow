// NovaFlow visual tokens.
//
// These are the SAME values the stable Desktop renderer paints with - read out
// of particle-editor/novaflow-brand-runtime.js at stable HEAD f5b31cf, not
// re-picked by eye. Keeping them in one file is what lets the Web line evolve
// on its own without drifting away from the product's look.

export const T = {
  // layout
  topbarHeight: 56,
  railWidth: 80,
  railItemHeight: 96,
  railGap: 9,
  panelWidth: 242,
  panelInset: 11,
  contentLeft: 89,          // railWidth + railGap
  columnWidth: 339,         // contentLeft + 250
  secondaryEntryHeight: 35,
  gap: 5,                   // NOVAFLOW_UNIFORM_GAP

  // surfaces
  topbarBg: '#242424',
  railBg: '#2a2a2a',
  panelBg: '#181818',
  canvasBg: '#0b0b0b',
  workspaceBg: '#151515',
  surfaceMuted: '#171717',
  fieldBg: '#070707',
  selectHover: '#111111',
  buttonBg: '#333333',
  buttonDisabled: '#2b2b2b',
  rowActive: '#333333',
  rowInactive: '#222222',
  toggleOff: '#222222',

  // secondary entries
  entryBg: '#303030',
  entryHover: '#3b3b3b',

  // accent
  accent: '#1ea672',
  accentHover: '#25bc84',
  accentText: '#7ce8b5',
  rangeAccent: '#20c997',
  accentGlow: 'rgba(33, 196, 135, 0.12)',

  // upload zone
  uploadBg: '#1B1B1B',
  uploadBgAlt: '#171717',
  uploadPanelBg: '#202020',
  uploadBorder: '#353535',
  uploadDashed: '#3A3A3A',
  uploadHoverBorder: '#21C487',
  uploadHoverBg: '#242424',
  uploadText: '#E8E8E8',
  uploadMuted: '#A0A0A0',

  // text
  text: '#e5e7eb',
  textMuted: '#a0a0a0',
  textDim: '#6b7280',
  danger: '#ef4444',
  warn: '#f59e0b',

  modalBackdrop: 'rgba(0, 0, 0, 0.55)',
  panelEdge: 'rgba(154, 159, 165, 0.05)'
} as const;

// The rail's two-tone background: rail colour for the first 80px, panel colour
// after it, exactly as LEFT_COLUMN_BACKGROUND_IMAGE builds it.
export const leftColumnBackground =
  `linear-gradient(to right, ${T.railBg} 0, ${T.railBg} ${T.railWidth}px, ${T.panelBg} ${T.railWidth}px, ${T.panelBg} 100%)`;

// Section organisation, copied from SECONDARY_ENTRY_GROUPS / PRIMARY_ENTRY_LABELS.
// Entries the Web line cannot serve are present but disabled, so the product's
// shape is recognisable and the gap is explicit rather than hidden.
export type SecondaryEntry = {
  label: string;
  taskType?: 'qwen_t2i' | 'qwen2511_edit' | 'h3_i2v';
  enabled: boolean;
  reason?: string;
};

export type PrimarySection = {
  label: string;
  icon: string;
  entries: SecondaryEntry[];
};

export const SECTIONS: PrimarySection[] = [
  {
    label: '特效',
    icon: 'fa-wand-magic-sparkles',
    entries: [
      { label: '粒子特效', enabled: false, reason: '本地编辑器功能，Web 版暂不提供' },
      { label: 'AI特效', enabled: false, reason: '需要 AI特效 工作流，后续版本接入' }
    ]
  },
  {
    label: '动画',
    icon: 'fa-film',
    entries: [
      { label: 'AI序列动画', taskType: 'h3_i2v', enabled: true },
      { label: '骨骼动画', enabled: false, reason: '本地编辑器功能，Web 版暂不提供' }
    ]
  },
  {
    label: '美工',
    icon: 'fa-palette',
    entries: [
      { label: '绘图', taskType: 'qwen_t2i', enabled: true },
      { label: 'UI', enabled: false, reason: '后续版本接入' }
    ]
  },
  {
    label: '工具',
    icon: 'fa-screwdriver-wrench',
    entries: [
      { label: '图生图', taskType: 'qwen2511_edit', enabled: true },
      { label: '实用工具', enabled: false, reason: '本地编辑器功能，Web 版暂不提供' }
    ]
  }
];
