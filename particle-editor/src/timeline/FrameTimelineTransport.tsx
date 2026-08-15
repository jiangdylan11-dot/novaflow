import { useEffect, useMemo, useRef, useState } from 'react'
import { clampTimeSec } from './timelineMath'

function FrameTransportIcon({
  name,
  active
}: {
  name: 'toStart' | 'stepBack' | 'play' | 'pause' | 'stepFwd' | 'toEnd' | 'loop'
  active?: boolean
}) {
  const stroke = active ? '#ffffff' : 'rgba(255,255,255,0.78)'
  const fill = active ? '#ffffff' : 'rgba(255,255,255,0.78)'
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', style: { display: 'block' as const } }
  if (name === 'toStart') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <rect x="6" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <polygon points="15,4 15,14 9,9" fill={fill} />
      </svg>
    )
  }
  if (name === 'toEnd') {
    return (
      <svg {...common}>
        <rect x="13" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <rect x="10" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <polygon points="3,4 3,14 9,9" fill={fill} />
      </svg>
    )
  }
  if (name === 'stepBack') {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <polygon points="14,4 14,14 7,9" fill={fill} />
      </svg>
    )
  }
  if (name === 'stepFwd') {
    return (
      <svg {...common}>
        <rect x="12" y="4" width="2" height="10" rx="0.5" fill={fill} />
        <polygon points="4,4 4,14 11,9" fill={fill} />
      </svg>
    )
  }
  if (name === 'play') {
    return (
      <svg {...common}>
        <polygon points="5.5,4 5.5,14 13.5,9" fill={fill} />
      </svg>
    )
  }
  if (name === 'pause') {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="3" height="10" rx="0.8" fill={fill} />
        <rect x="10" y="4" width="3" height="10" rx="0.8" fill={fill} />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M6.5 5.3c2.7-2 6.8-.4 7.3 2.8.5 3.2-3.1 5.8-6 4.4" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.2 4.2l-2.6 1.2 2.1 2.0" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FrameTimelineTransport({
  playing,
  timeSec,
  durationSec,
  fps,
  fpsMax,
  loopEnabled,
  getLiveTimeSec,
  lockDuration,
  onLockDurationChange,
  onFpsValueChange,
  onTogglePlaying,
  onToggleLoop,
  onTimeChange,
  onStep,
  onToStart,
  onToEnd
}: {
  playing: boolean
  timeSec: number
  durationSec: number
  fps: number
  fpsMax?: number
  loopEnabled: boolean
  getLiveTimeSec?: null | (() => number)
  lockDuration?: boolean
  onLockDurationChange?: (v: boolean) => void
  onFpsValueChange?: (fps: number) => void
  onTogglePlaying: () => void
  onToggleLoop: () => void
  onTimeChange: (t: number) => void
  onStep: (deltaFrames: number) => void
  onToStart: () => void
  onToEnd: () => void
}) {
  const maxFps0 = Math.max(1, Math.min(120, Math.round(Number(fpsMax ?? 120) || 120)))
  const fpsRangeMax = Math.max(1, Math.min(60, maxFps0))
  const f = Math.max(1, Math.min(maxFps0, Math.round(Number(fps) || 1)))
  const dur = Math.max(0.01, Number(durationSec) || 0.01)
  const t = clampTimeSec(timeSec, dur)
  const totalFrames = Math.max(1, Math.round(dur * f))
  const [liveFrame0, setLiveFrame0] = useState<number | null>(null)
  const liveFrame0Ref = useRef<number | null>(null)

  useEffect(() => {
    if (!playing || !getLiveTimeSec) {
      liveFrame0Ref.current = null
      setLiveFrame0(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t2 = clampTimeSec(Number(getLiveTimeSec()) || 0, dur)
      const next0 = Math.max(0, Math.min(totalFrames - 1, Math.round(t2 * f)))
      if (liveFrame0Ref.current === next0) return
      liveFrame0Ref.current = next0
      setLiveFrame0(next0)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, getLiveTimeSec, dur, f, totalFrames])

  const curFrame0 = liveFrame0 != null ? liveFrame0 : Math.max(0, Math.min(totalFrames - 1, Math.round(t * f)))
  const curFrame1 = curFrame0 + 1

  const setFrame0 = (idx0: number) => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, Math.round(idx0)))
    onTimeChange(clamped / f)
  }

  const rulerRef = useRef<HTMLDivElement | null>(null)
  const [rulerW, setRulerW] = useState(0)
  const [zoom, setZoom] = useState(0.2)
  const [viewStart0, setViewStart0] = useState(0)

  useEffect(() => {
    const el = rulerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRulerW(el.clientWidth || 0))
    ro.observe(el)
    setRulerW(el.clientWidth || 0)
    return () => ro.disconnect()
  }, [])

  const padPx = 14
  const usableW = Math.max(1, rulerW - padPx * 2)
  const basePx = usableW / Math.max(1, totalFrames - 1)
  const pxPerFrame = Math.max(1, Math.round((basePx * zoom) * 10) / 10)
  const visibleFrames = Math.max(2, Math.min(totalFrames, Math.floor(usableW / pxPerFrame) + 1))
  const maxStart0 = Math.max(0, totalFrames - visibleFrames)
  const viewStartBase0 = Math.max(0, Math.min(maxStart0, Math.round(viewStart0)))
  let viewStartEffective0 = viewStartBase0
  if (maxStart0 > 0) {
    const viewEndBase0 = Math.min(totalFrames - 1, viewStartBase0 + visibleFrames - 1)
    if (curFrame0 < viewStartEffective0) viewStartEffective0 = curFrame0
    else if (curFrame0 > viewEndBase0) viewStartEffective0 = Math.max(0, curFrame0 - Math.max(0, visibleFrames - 1))
  }
  const viewStartClamped = Math.max(0, Math.min(maxStart0, Math.round(viewStartEffective0)))
  const viewEnd0 = Math.min(totalFrames - 1, viewStartClamped + visibleFrames - 1)

  useEffect(() => {
    const el = rulerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (maxStart0 <= 0) return
      const dy = Number((e as any)?.deltaY || 0)
      const dx = Number((e as any)?.deltaX || 0)
      const d = Math.abs(dx) > Math.abs(dy) ? dx : dy
      if (!Number.isFinite(d) || d === 0) return
      if (e.cancelable) e.preventDefault()
      const step = Math.max(1, Math.round(visibleFrames / 10))
      setViewStart0((v) => Math.max(0, Math.min(maxStart0, Math.round(v + (d > 0 ? step : -step)))))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel as any)
  }, [maxStart0, visibleFrames])

  const niceStep = (raw: number) => {
    const n = Math.max(1, raw)
    const p = Math.pow(10, Math.floor(Math.log10(n)))
    const m = n / p
    const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10
    return k * p
  }

  const majorEvery = Math.max(1, niceStep(Math.round(64 / Math.max(1, pxPerFrame))))
  const minorEvery = Math.max(1, Math.round(majorEvery / 5))

  const marks = useMemo(() => {
    const out: number[] = []
    const start = viewStartClamped
    const end = viewEnd0
    const first = Math.ceil(start / majorEvery) * majorEvery
    out.push(start)
    for (let i = first; i <= end; i += majorEvery) out.push(i)
    if (out[out.length - 1] !== end) out.push(end)
    return Array.from(new Set(out))
  }, [viewStartClamped, viewEnd0, majorEvery])

  const scrubRef = useRef<{ dragging: boolean; pointerId: number | null }>({ dragging: false, pointerId: null })
  const pointerToFrame = (clientX: number) => {
    const el = rulerRef.current
    if (!el) return curFrame0
    const r = el.getBoundingClientRect()
    const x = Math.max(padPx, Math.min(r.width - padPx, clientX - r.left))
    const i = viewStartClamped + Math.round((x - padPx) / pxPerFrame)
    return Math.max(viewStartClamped, Math.min(viewEnd0, i))
  }

  const onScrubPointerDown = (e: any) => {
    if (!rulerRef.current) return
    scrubRef.current.dragging = true
    scrubRef.current.pointerId = e.pointerId ?? null
    try { e.currentTarget?.setPointerCapture?.(e.pointerId) } catch (err) { void err }
    setFrame0(pointerToFrame(e.clientX))
  }

  const onScrubPointerMove = (e: any) => {
    if (!scrubRef.current.dragging) return
    setFrame0(pointerToFrame(e.clientX))
  }

  const onScrubPointerUp = (e: any) => {
    scrubRef.current.dragging = false
    try { e.currentTarget?.releasePointerCapture?.(e.pointerId) } catch (err) { void err }
  }

  const cursorX = (curFrame0 - viewStartClamped) * pxPerFrame
  const endFrame0 = totalFrames - 1
  const endX = (endFrame0 - viewStartClamped) * pxPerFrame
  const isEndVisible = endFrame0 >= viewStartClamped && endFrame0 <= viewEnd0
  const fpsRangePct = fpsRangeMax > 1 ? Math.max(0, Math.min(100, ((f - 1) / (fpsRangeMax - 1)) * 100)) : 0
  const zoomRangePct = Math.max(0, Math.min(100, ((zoom - 0.2) / (5 - 0.2)) * 100))

  const btnBase: React.CSSProperties = {
    width: 34,
    height: 32,
    borderRadius: 8,
    background: '#24282e',
    border: '1px solid transparent',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
          <button type="button" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onToStart() }} style={btnBase} title="起始帧">
            <FrameTransportIcon name="toStart" />
          </button>
          <button type="button" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onStep(-1) }} style={btnBase} title="后退 1 帧">
            <FrameTransportIcon name="stepBack" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePlaying() }}
            style={{ ...btnBase, background: playing ? '#1ea672' : '#24282e', border: playing ? 'none' : btnBase.border }}
            title={playing ? '暂停' : '播放'}
          >
            <FrameTransportIcon name={playing ? 'pause' : 'play'} active={playing} />
          </button>
          <button type="button" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onStep(1) }} style={btnBase} title="快进 1 帧">
            <FrameTransportIcon name="stepFwd" />
          </button>
          <button type="button" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onToEnd() }} style={btnBase} title="最后帧">
            <FrameTransportIcon name="toEnd" />
          </button>
          <button
            type="button"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggleLoop() }}
            style={{ ...btnBase, width: 36, background: loopEnabled ? '#1ea672' : '#24282e', border: loopEnabled ? 'none' : btnBase.border }}
            title="循环"
          >
            <FrameTransportIcon name="loop" active={loopEnabled} />
          </button>
          {onFpsValueChange && (
            <div
              data-novaflow-ai-timeline-edit-group-locked="0"
              data-novaflow-source-layout="1"
              style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 10 }}
            >
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.70)', fontWeight: 1000, width: 32 }}>帧率</div>
              <input
                type="range"
                min={1}
                max={fpsRangeMax}
                step={1}
                value={f}
                onChange={(e) => onFpsValueChange(Math.max(1, Math.min(maxFps0, Math.round(Number((e.target as any)?.value || 1)))))}
                style={{ width: 144, accentColor: '#1ea672', cursor: 'pointer', '--nf-range-pct': `${fpsRangePct}%` } as any}
              />
              <input
                type="number"
                min={1}
                max={maxFps0}
                step={1}
                value={f}
                onChange={(e) => onFpsValueChange(Math.max(1, Math.min(maxFps0, Math.round(Number((e.target as any)?.value || 1)))))}
                style={{ width: 45, padding: '5px 8px', background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', fontSize: 12, outline: 'none', textAlign: 'right' }}
              />
            </div>
          )}
          {onLockDurationChange && (
            <label
              data-novaflow-ai-timeline-edit-group-locked="0"
              data-novaflow-ai-timeline-lock-label="1"
              data-novaflow-source-layout="1"
              aria-label="lock"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 1000, userSelect: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <input type="checkbox" checked={!!lockDuration} onChange={(e) => onLockDurationChange(!!(e.target as any)?.checked)} />
              锁定时长
            </label>
          )}

          <div style={{ marginLeft: 10, display: 'flex', gap: 10, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: 1000 }}>
              第 {curFrame1} 帧 / {totalFrames}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: '0 0 auto' }}>
          <input
            type="range"
            min={0.2}
            max={5}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Math.max(0.2, Math.min(5, Number((e.target as any)?.value || 1) || 1)))}
            style={{ width: 144, accentColor: '#e5e7eb', cursor: 'pointer', '--nf-range-pct': `${zoomRangePct}%` } as any}
          />
        </div>
      </div>

      <div
        ref={rulerRef}
        style={{ position: 'relative', height: 56, borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(31,41,55,0.60)', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0, paddingLeft: padPx, paddingRight: padPx }}>
          <div style={{ position: 'absolute', left: padPx, right: padPx, top: 4, height: 18 }}>
            {marks.map((i0) => {
              const x = (i0 - viewStartClamped) * pxPerFrame
              const isLeft = i0 === viewStartClamped
              const isRight = i0 === viewEnd0
              const isEndFrame = isEndVisible && i0 === endFrame0
              return (
                <div
                  key={i0}
                  style={{
                    position: 'absolute',
                    left: x,
                    transform: isLeft ? 'translateX(0)' : (isEndFrame ? 'translateX(-50%)' : (isRight ? 'translateX(-100%)' : 'translateX(-50%)')),
                    fontSize: 12,
                    fontWeight: 1000,
                    color: isEndFrame ? '#ef4444' : 'rgba(255,255,255,0.72)',
                    textShadow: '0 1px 0 rgba(0,0,0,0.35)'
                  }}
                >
                  {i0}
                </div>
              )
            })}
          </div>

          <div
            style={{
              position: 'absolute',
              left: padPx,
              right: padPx,
              bottom: 6,
              height: 16,
              backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.20) 2px, transparent 2px)',
              backgroundSize: `${Math.max(1, minorEvery) * pxPerFrame}px 100%`,
              backgroundRepeat: 'repeat',
              opacity: 0.9
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: padPx,
              right: padPx,
              bottom: 6,
              height: 18,
              backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.48) 2px, transparent 2px)',
              backgroundSize: `${Math.max(1, majorEvery) * pxPerFrame}px 100%`,
              backgroundRepeat: 'repeat',
              opacity: 1
            }}
          />

          <div style={{ position: 'absolute', left: padPx, right: padPx, top: 0, bottom: 0, pointerEvents: 'none' }}>
            {isEndVisible && (
              <>
                <div style={{ position: 'absolute', left: endX, transform: 'translateX(-50%)', top: 28, bottom: 4, width: 4, background: '#ef4444', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 10px rgba(239,68,68,0.35)' }} />
                <div
                  style={{
                    position: 'absolute',
                    left: endX,
                    transform: 'translateX(-50%)',
                    top: 28,
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '9px solid #ef4444',
                    filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.35))'
                  }}
                />
              </>
            )}

            <div style={{ position: 'absolute', left: cursorX, transform: 'translateX(-50%)', top: 28, bottom: 4, width: 3, background: '#22d3ee', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 10px rgba(34,211,238,0.25)' }} />
            <div
              style={{
                position: 'absolute',
                left: cursorX,
                transform: 'translateX(-50%)',
                top: 28,
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: '9px solid #22d3ee',
                filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.35))'
              }}
            />
          </div>

          <div
            onPointerDown={onScrubPointerDown}
            onPointerMove={onScrubPointerMove}
            onPointerUp={onScrubPointerUp}
            onPointerCancel={onScrubPointerUp}
            style={{
              position: 'absolute',
              left: padPx,
              right: padPx,
              bottom: 0,
              top: 0,
              cursor: 'pointer',
              touchAction: 'none'
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
