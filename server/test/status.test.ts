import { describe, expect, it } from 'vitest';
import { DeviceStatus } from '../src/status.js';
import { statusHtml } from '../src/views/status.js';
import { testClock } from './helpers.js';

describe('DeviceStatus', () => {
  it('remembers the last call and when the next one is due', () => {
    const clock = testClock('2026-11-06T20:00:00+01:00');
    const s = new DeviceStatus(clock);
    expect([s.lastSeen, s.nextDue]).toEqual([null, null]);
    clock.advance(60_000);
    s.delivered(120);
    expect([s.lastSeen, s.nextDue]).toEqual([new Date('2026-11-06T20:01:00+01:00'), new Date('2026-11-06T20:03:00+01:00')]);
  });

  it('keeps a battery sample per change and one an hour, for seven days', () => {
    const clock = testClock('2026-11-06T20:00:00+01:00');
    const s = new DeviceStatus(clock);
    expect(s.battery({ level: 90, charging: false })).toBe(true);
    clock.advance(120_000);
    expect(s.battery({ level: 90, charging: false })).toBe(false);
    expect(s.history()).toHaveLength(1);
    clock.advance(3600_000);
    expect(s.battery({ level: 90, charging: false })).toBe(false); // hourly point, no change
    expect(s.battery({ level: 90, charging: true })).toBe(true);
    expect(s.history().map((b) => b.charging)).toEqual([false, false, true]);
    clock.advance(7 * 24 * 3600_000 + 60_000);
    s.battery({ level: 100, charging: true });
    expect(s.history()).toHaveLength(1);
  });
});

describe('status page', () => {
  const now = new Date('2026-11-06T21:00:00+01:00');
  const base = { now, startedAt: new Date('2026-11-06T08:00:00+01:00'), lastSeen: null, nextDue: null, battery: [], sources: [] };

  it('says when nothing has been recorded yet', () => {
    const html = statusHtml(base);
    expect(html).toContain('noch keine seit dem Serverstart');
    expect(html).toContain('Noch keine Werte.');
    expect(html).not.toContain('<script');
  });

  it('flags an overdue Kindle, a low battery and a failing source with icon and word', () => {
    const html = statusHtml({
      ...base,
      lastSeen: new Date('2026-11-06T20:40:00+01:00'),
      nextDue: new Date('2026-11-06T20:42:00+01:00'),
      battery: [
        { at: new Date('2026-11-06T19:00:00+01:00'), level: 22, charging: false },
        { at: new Date('2026-11-06T20:00:00+01:00'), level: 18, charging: false },
      ],
      sources: [
        { name: 'transit:Sternen', lastOk: new Date('2026-11-06T20:00:00+01:00'), lastError: { at: new Date('2026-11-06T20:30:00+01:00'), message: 'transport HTTP 503' } },
        { name: 'weather', lastOk: new Date('2026-11-06T20:50:00+01:00'), lastError: { at: new Date('2026-11-06T10:00:00+01:00'), message: 'timeout' } },
      ],
    });
    expect(html).toContain('vor 20 Min.');
    expect(html).toContain('⚠ überfällig');
    expect(html).toContain('⚠ fast leer');
    expect(html).toMatch(/transit:Sternen<\/td><td><span class="badge bad">⚠ Fehler/);
    expect(html).toMatch(/weather<\/td><td><span class="badge good">✓ OK/);
    expect(html).toContain('<path class="line"');
    expect(html).toContain('<title>Fr 06.11. 20:00 · 18 %</title>');
  });
});
