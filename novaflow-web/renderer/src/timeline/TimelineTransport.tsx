import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clampTimeSec } from './timelineMath';

type TimelineTransportProps = {
  playing: boolean;
  timeSec: number;
  durationSec: number;
  onTogglePlaying: () => void;
  onTimeChange: (t: number) => void;
  getLiveTimeSec?: (() => number) | null;
};

type RangeStyle = CSSProperties & { '--nf-range-pct': string };

export function TimelineTransport({
  playing,
  timeSec,
  durationSec,
  onTogglePlaying,
  onTimeChange,
  getLiveTimeSec,
}: TimelineTransportProps) {
  const dur = Math.max(0.01, Number(durationSec) || 0.01);
  const [displayTime, setDisplayTime] = useState(() => clampTimeSec(timeSec, dur));
  const draggingRef = useRef(false);
  const resumeAfterDragRef = useRef(false);
  const draftTimeRef = useRef(displayTime);
  const lastDisplayRef = useRef(displayTime);
  const playingRef = useRef(playing);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (draggingRef.current) return;
    const next = clampTimeSec(timeSec, dur);
    draftTimeRef.current = next;
    lastDisplayRef.current = next;
    setDisplayTime(next);
  }, [timeSec, dur]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastPaint = 0;

    const readLiveTime = () => {
      const fromRuntime = getLiveTimeSec?.();
      return clampTimeSec(Number.isFinite(Number(fromRuntime)) ? Number(fromRuntime) : timeSec, dur);
    };

    const tick = (now: number) => {
      if (!draggingRef.current) {
        const next = readLiveTime();
        if (Math.abs(next - lastDisplayRef.current) > 1 / 120 || now - lastPaint > 33) {
          lastDisplayRef.current = next;
          draftTimeRef.current = next;
          lastPaint = now;
          setDisplayTime(next);
        }
      }
      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [playing, getLiveTimeSec, timeSec, dur]);

  const setT = (next: number) => {
    const clamped = clampTimeSec(next, dur);
    draftTimeRef.current = clamped;
    lastDisplayRef.current = clamped;
    setDisplayTime(clamped);
    onTimeChange(clamped);
  };

  const startDrag = () => {
    if (draggingRef.current) return;
    draggingRef.current = true;
    resumeAfterDragRef.current = playingRef.current;
    if (playingRef.current) onTogglePlaying();
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onTimeChange(clampTimeSec(draftTimeRef.current, dur));
    if (resumeAfterDragRef.current) onTogglePlaying();
    resumeAfterDragRef.current = false;
  };

  const t = clampTimeSec(displayTime, dur);
  const rangeStyle: RangeStyle = {
    flex: 1,
    accentColor: '#e5e7eb',
    height: 5,
    background: '#2a2f38',
    borderRadius: 3,
    appearance: 'none',
    cursor: 'pointer',
    '--nf-range-pct': `${(t / dur) * 100}%`,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTogglePlaying();
        }}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: playing ? '#1ea672' : '#24282e',
          border: '1px solid transparent',
          color: '#fff',
          cursor: 'pointer',
        }}
        title={playing ? '\u6682\u505c' : '\u64ad\u653e'}
      >
        <i className={`fas fa-${playing ? 'pause' : 'play'}`} />
      </button>
      <input
        type="range"
        min={0}
        max={dur}
        step={0.001}
        value={t}
        onPointerDown={startDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseDown={startDrag}
        onMouseUp={endDrag}
        onBlur={endDrag}
        onChange={(e) => setT(+e.target.value)}
        style={rangeStyle}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="number"
          value={t}
          min={0}
          max={dur}
          step={0.01}
          onChange={(e) => setT(+e.target.value || 0)}
          style={{
            width: 74,
            padding: '6px 8px',
            background: '#0f1319',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            color: '#fff',
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}
