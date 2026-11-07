import { describe, expect, it } from 'vitest';
import { litPath, moonPhase, phaseName } from '../src/moon.js';

describe('moonPhase', () => {
  // Published times (UTC) of new, first quarter, full and last quarter moons.
  it.each([
    ['2024-01-11T11:57:00Z', 0],
    ['2024-01-18T03:53:00Z', 90],
    ['2024-01-25T17:54:00Z', 180],
    ['2024-02-02T23:18:00Z', 270],
    ['2026-11-24T14:53:00Z', 180],
  ])('at %s the elongation is %i° within 2°', (at, deg) => {
    const e = moonPhase(new Date(at)).elongation;
    expect(Math.abs((((e - deg + 540) % 360) - 180))).toBeLessThan(2);
  });

  it('names the phases and computes the lit fraction; a preview can set the elongation', () => {
    expect([0, 45, 90, 135, 180, 225, 270, 315].map(phaseName)).toEqual([
      'Neumond',
      'Zunehmende Sichel',
      'Zunehmender Halbmond',
      'Zunehmender Mond',
      'Vollmond',
      'Abnehmender Mond',
      'Abnehmender Halbmond',
      'Abnehmende Sichel',
    ]);
    expect(moonPhase(new Date(), 90)).toMatchObject({ waxing: true, name: 'Zunehmender Halbmond' });
    expect(moonPhase(new Date(), 90).illumination).toBeCloseTo(0.5);
    expect(moonPhase(new Date(), -90)).toMatchObject({ elongation: 270, waxing: false });
  });

  it('draws the lit part on the right while waxing, on the left while waning', () => {
    // Half moons: the terminator is a straight line (rx 0) through the centre.
    expect(litPath(90, 100, 100, 50)).toBe('M100 50A50 50 0 0 1 100 150A0.00 50 0 0 0 100 50Z');
    expect(litPath(270, 100, 100, 50).startsWith('M100 50A50 50 0 0 0 100 150')).toBe(true);
    // A waxing crescent bulges its terminator towards the lit side (sweep 0), a waxing gibbous away (sweep 1).
    expect(litPath(45, 100, 100, 50)).toContain('A35.36 50 0 0 0 100 50Z');
    expect(litPath(135, 100, 100, 50)).toContain('A35.36 50 0 0 1 100 50Z');
  });
});
