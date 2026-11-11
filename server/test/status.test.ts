import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BatteryFile, DeviceStatus } from '../src/status.js';
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

describe('battery curve in a file', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'battery-')), 'battery.json');

  it('survives a restart, seven days back', () => {
    const path = file();
    const clock = testClock('2026-11-06T20:00:00+01:00');
    const a = new DeviceStatus(clock, new BatteryFile(path));
    a.battery({ level: 90, charging: false });
    clock.advance(3600_000);
    a.battery({ level: 85, charging: true });
    expect(new DeviceStatus(clock, new BatteryFile(path)).history()).toEqual(a.history());
    clock.advance(7 * 24 * 3600_000 - 30 * 60_000); // the first sample is now older than seven days
    expect(new DeviceStatus(clock, new BatteryFile(path)).history().map((s) => s.level)).toEqual([85]);
  });

  it('starts empty from a missing or broken file, and keeps counting when it cannot write', () => {
    const clock = testClock('2026-11-06T20:00:00+01:00');
    const broken = file();
    writeFileSync(broken, '{kaputt');
    expect(new DeviceStatus(clock, new BatteryFile(broken)).history()).toEqual([]);
    const odd = file();
    writeFileSync(odd, JSON.stringify([{ at: 'gestern', level: 5, charging: false }, { at: '2026-11-06T19:00:00+01:00', level: 'voll', charging: false }]));
    expect(new DeviceStatus(clock, new BatteryFile(odd)).history()).toEqual([]);
    const s = new DeviceStatus(clock, new BatteryFile(join(tmpdir(), 'battery-missing-dir', 'nope', 'battery.json')));
    expect(() => s.battery({ level: 50, charging: false })).not.toThrow();
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
    expect(html).toContain('der Ladestand bleibt über Deployments erhalten');
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

  it('lists the uploaded rosters and the last failed upload, only when the roster is on', () => {
    expect(statusHtml(base)).not.toContain('Dienstplan');
    const html = statusHtml({
      ...base,
      roster: { months: [{ month: '2026-11', uploadedAt: new Date('2026-11-06T20:54:00+01:00') }], lastError: { at: new Date('2026-11-06T20:50:00+01:00'), text: 'Dienstplan nicht erkannt: Name «X» nicht gefunden' } },
    });
    expect(html).toContain('<h2>Dienstplan</h2>');
    expect(html).toContain('November 2026 · hochgeladen Fr 06.11. 20:54');
    expect(html).toContain('Fr 06.11. 20:50: Dienstplan nicht erkannt: Name «X» nicht gefunden');
    expect(statusHtml({ ...base, roster: { months: [], lastError: null } })).toContain('noch keiner hochgeladen');
    expect(statusHtml({ ...base, roster: { months: [], lastError: null, persistent: false } })).toContain('⚠ kein Volume: Pläne gehen beim nächsten Deploy verloren');
    expect(statusHtml({ ...base, roster: { months: [], lastError: null, persistent: true } })).toContain('✓ Volume');
  });
});
