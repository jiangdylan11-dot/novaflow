import { clampTimeSec } from './timelineMath'

export function SimpleTimelineTransport({
  playing,
  timeSec,
  durationSec,
  onTogglePlaying,
  onTimeChange,
  markerTimes = [],
  activeMarkerTimeSec = null,
  activeMarkerLabel = '',
  fractionDigits = 5
}: {
  playing: boolean
  timeSec: number
  durationSec: number
  onTogglePlaying: () => void
  onTimeChange: (t: number) => void
  markerTimes?: number[]
  activeMarkerTimeSec?: number | null
  activeMarkerLabel?: string
  fractionDigits?: number
}) {
  const dur = Math.max(0.01, Number(durationSec) || 0.01)
  const t = clampTimeSec(timeSec, dur)
  const markers = (Array.isArray(markerTimes) ? markerTimes : [])
    .map((time) => clampTimeSec(Number(time) || 0, dur))
    .filter((time, index, list) => list.findIndex((item) => Math.abs(item - time) < 0.001) === index)
    .sort((a, b) => a - b)
  const activeMarker = Number.isFinite(Number(activeMarkerTimeSec))
    ? clampTimeSec(Number(activeMarkerTimeSec) || 0, dur)
    : null

  const setT = (next: number) => {
    onTimeChange(clampTimeSec(next, dur))
  }

  const text = Number.isFinite(t) ? t.toFixed(Math.max(0, Math.min(8, Math.round(Number(fractionDigits) || 0)))) : '0'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onTogglePlaying()
        }}
        style={{ width: 34, height: 34, borderRadius: 8, background: playing ? '#1ea672' : '#24282e', border: '1px solid transparent', color: '#fff', cursor: 'pointer' }}
        title={playing ? '暂停' : '播放'}
      >
        <i className={`fas fa-${playing ? 'pause' : 'play'}`} />
      </button>
      <div style={{ position: 'relative', flex: 1, height: 22, display: 'flex', alignItems: 'center' }}>
        {markers.length > 0 && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none', zIndex: 2 }}>
            {markers.map((marker, index) => {
              const selected = activeMarker != null && Math.abs(activeMarker - marker) < 0.001
              return (
                <div
                  key={`${marker}-${index}`}
                  title={`${selected ? `${activeMarkerLabel || '当前事件'} · ` : ''}${marker.toFixed(3)}s`}
                  style={{ position: 'absolute', left: `${(marker / dur) * 100}%`, top: '50%', width: 8, height: 16, transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <span style={{ width: 3, height: 14, borderRadius: 999, background: selected ? '#1ea672' : 'rgba(229,235,242,0.58)', boxShadow: selected ? '0 0 0 1px rgba(15,23,42,0.95), 0 0 8px rgba(30,166,114,0.58)' : '0 0 0 1px rgba(15,23,42,0.9), 0 0 6px rgba(229,235,242,0.24)' }} />
                </div>
              )
            })}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={dur}
          step={0.001}
          value={t}
          onChange={(e) => setT(+e.target.value)}
          style={{ position: 'relative', zIndex: 1, width: '100%', accentColor: '#e5e7eb', height: 5, background: '#2a2f38', borderRadius: 3, appearance: 'none', cursor: 'pointer' }}
        />
      </div>
      <div style={{ minWidth: 88, padding: '6px 10px', background: '#0f1319', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, color: '#fff', fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {text}
      </div>
    </div>
  )
}

