import { describe, expect, it } from 'vitest';
import { addDays, formatLongDate, formatTime, formatWeekday, startOfDay, startOfWeek } from '../src/format.js';

describe('format', () => {
  const d = new Date('2026-11-03T07:05:00+01:00');
  it('formats de-CH', () => {
    expect(formatTime(d)).toBe('07:05');
    expect(formatLongDate(d)).toBe('Dienstag, 3. November');
    expect(formatWeekday(d)).toBe('Di');
  });
  it('computes day boundaries in Europe/Zurich', () => {
    expect(startOfDay(d).toISOString()).toBe('2026-11-02T23:00:00.000Z');
    expect(addDays(startOfDay(new Date('2026-10-24T12:00:00+02:00')), 1).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(addDays(startOfDay(new Date('2026-10-24T12:00:00+02:00')), 2).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(startOfWeek(d).toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(startOfWeek(new Date('2026-11-08T20:00:00+01:00')).toISOString()).toBe('2026-11-01T23:00:00.000Z');
  });
});
