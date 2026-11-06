import { describe, expect, it } from 'vitest';
import { hitTest } from '../src/zones.js';

describe('hitTest', () => {
  const zones = [
    { action: 'nav:woche', x: 0, y: 1318, w: 268, h: 130 },
    { action: 'big', x: 0, y: 0, w: 1072, h: 400 },
    { action: 'small', x: 100, y: 100, w: 50, h: 50 },
  ];
  it('returns the containing zone, preferring the smallest', () => {
    expect(hitTest(zones, 10, 1400)).toBe('nav:woche');
    expect(hitTest(zones, 120, 120)).toBe('small');
    expect(hitTest(zones, 300, 300)).toBe('big');
  });
  it('treats edges as inside on the top/left and outside on the bottom/right', () => {
    expect(hitTest(zones, 0, 1318)).toBe('nav:woche');
    expect(hitTest(zones, 268, 1400)).toBeNull();
  });
  it('returns null outside all zones', () => {
    expect(hitTest(zones, 600, 900)).toBeNull();
    expect(hitTest([], 1, 1)).toBeNull();
  });
  it('answers a long press with the smallest zone that has a hold action', () => {
    const z = [
      { action: 'nav:woche', hold: 'guest', x: 0, y: 0, w: 500, h: 500 },
      { action: 'small', x: 10, y: 10, w: 50, h: 50 },
      { action: '', hold: 'inner', x: 300, y: 300, w: 100, h: 100 },
    ];
    expect(hitTest(z, 20, 20, true)).toBe('guest');
    expect(hitTest(z, 350, 350, true)).toBe('inner');
    expect(hitTest(z, 350, 350)).toBe('nav:woche');
    expect(hitTest(z, 600, 600, true)).toBeNull();
  });
});
