export function clampTimeSec(timeSec: number, durationSec: number) {
  const dur = Math.max(0, Number(durationSec) || 0);
  const t = Number(timeSec);
  if (!Number.isFinite(t)) return 0;
  if (dur <= 0) return Math.max(0, t);
  return Math.max(0, Math.min(dur, t));
}

export function advanceTimeSec(prevTimeSec: number, dtSec: number, durationSec: number, loopEnabled: boolean) {
  const dur = Math.max(0, Number(durationSec) || 0);
  const prev = clampTimeSec(prevTimeSec, dur);
  const dt = Number(dtSec);
  if (!Number.isFinite(dt) || dt <= 0) return prev;
  if (dur <= 0) return prev + dt;
  let next = prev + dt;
  if (next >= dur) {
    if (loopEnabled) {
      next = next % dur;
    } else {
      next = dur;
    }
  }
  if (!loopEnabled && Math.abs(next - dur) <= 1e-9) next = dur;
  if (Math.abs(next - dur) <= 1e-9) next = dur;
  if (Math.abs(next) <= 1e-12) next = 0;
  return next;
}
