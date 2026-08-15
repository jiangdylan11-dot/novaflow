import { describe, expect, it } from 'vitest';
import { advanceTimeSec, clampTimeSec } from './timelineMath';

describe('timelineMath', () => {
  it('clamps to [0,duration]', () => {
    expect(clampTimeSec(-1, 2)).toBe(0);
    expect(clampTimeSec(3, 2)).toBe(2);
    expect(clampTimeSec(1, 2)).toBe(1);
  });

  it('advances with loop wrap', () => {
    expect(advanceTimeSec(1.9, 0.3, 2, true)).toBeCloseTo(0.2, 6);
  });

  it('advances without loop clamps to duration', () => {
    expect(advanceTimeSec(1.9, 0.3, 2, false)).toBeCloseTo(2, 9);
  });
});
