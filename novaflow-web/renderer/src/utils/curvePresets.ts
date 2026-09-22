import type { Key1D } from '../types'
import { safeJsonParse } from './storage'

export const curvePresetsStorageKey = 'particle-editor-curve-presets-v1'

export const defaultCurvePresets: Record<string, Record<string, Key1D[]>> = {
  size_curve: {
    '保持(100%)': [{ t: 0, v: 1 }, { t: 1, v: 1 }],
    '线性增长': [{ t: 0, v: 0 }, { t: 1, v: 1 }],
    '线性衰减': [{ t: 0, v: 1 }, { t: 1, v: 0 }],
    '先大后小': [{ t: 0, v: 0.7 }, { t: 0.25, v: 1.2 }, { t: 1, v: 0 }],
    '脉冲': [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 0.5, v: 0.2 }, { t: 0.8, v: 1 }, { t: 1, v: 0 }]
  },
  opacity_curve: {
    '淡出': [{ t: 0, v: 1 }, { t: 1, v: 0 }],
    '淡入': [{ t: 0, v: 0 }, { t: 1, v: 1 }],
    '淡入淡出': [{ t: 0, v: 0 }, { t: 0.2, v: 1 }, { t: 0.8, v: 1 }, { t: 1, v: 0 }],
    '闪烁': [{ t: 0, v: 0 }, { t: 0.1, v: 1 }, { t: 0.2, v: 0 }, { t: 0.3, v: 1 }, { t: 0.4, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }]
  },
  noise_scurve_strength: {
    '恒定': [{ t: 0, v: 1 }, { t: 1, v: 1 }],
    '前强后弱': [{ t: 0, v: 1 }, { t: 1, v: 0 }],
    '前弱后强': [{ t: 0, v: 0 }, { t: 1, v: 1 }],
    '中间增强': [{ t: 0, v: 0.3 }, { t: 0.5, v: 1 }, { t: 1, v: 0.3 }]
  },
  sprite_color_lifecycle_stops: {
    '两段(起止)': [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }],
    '三段(均分)': [{ t: 0, v: 0.5 }, { t: 0.5, v: 0.5 }, { t: 1, v: 0.5 }],
    '四段(均分)': [{ t: 0, v: 0.5 }, { t: 1 / 3, v: 0.5 }, { t: 2 / 3, v: 0.5 }, { t: 1, v: 0.5 }],
    '前段更密': [{ t: 0, v: 0.5 }, { t: 0.18, v: 0.5 }, { t: 0.42, v: 0.5 }, { t: 1, v: 0.5 }],
    '后段更密': [{ t: 0, v: 0.5 }, { t: 0.58, v: 0.5 }, { t: 0.82, v: 0.5 }, { t: 1, v: 0.5 }],
    '五段(均分)': [{ t: 0, v: 0.5 }, { t: 0.25, v: 0.5 }, { t: 0.5, v: 0.5 }, { t: 0.75, v: 0.5 }, { t: 1, v: 0.5 }]
  }
}

export type CurvePresetValue = Key1D[] | { points: Key1D[]; colorStops?: { t: number; color: string }[] }
export type CurvePresetMap = Record<string, Record<string, CurvePresetValue>>

export const saveCurvePresets = (data: CurvePresetMap) => {
  try {
    localStorage.setItem(curvePresetsStorageKey, JSON.stringify(data))
  } catch {
    return
  }
}

export const loadCurvePresets = (): CurvePresetMap => {
  try {
    const raw = localStorage.getItem(curvePresetsStorageKey)
    if (!raw) {
      saveCurvePresets(defaultCurvePresets)
      return defaultCurvePresets
    }
    const parsed = safeJsonParse<any>(raw, null)
    if (!parsed || typeof parsed !== 'object') return {}
    const base = parsed as CurvePresetMap
    const merged: CurvePresetMap = { ...defaultCurvePresets }
    for (const key of Object.keys(base)) {
      merged[key] = { ...(merged[key] || {}), ...(base[key] || {}) }
    }
    if (JSON.stringify(base) !== JSON.stringify(merged)) saveCurvePresets(merged)
    return merged
  } catch {
    saveCurvePresets(defaultCurvePresets)
    return defaultCurvePresets
  }
}

