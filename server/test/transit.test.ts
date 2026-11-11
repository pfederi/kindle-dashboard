import { describe, expect, it } from 'vitest';
import { departsAt, leaveAt, reachable, shortStop, upcoming } from '../src/sources/transit.js';

describe('transit', () => {
  it('knows which departures can still be caught on foot and when to leave', () => {
    const dep = (hm: string, delayMin = 0) => ({ line: '11', planned: new Date(`2026-11-03T${hm}:00+01:00`), delayMin, to: '', inbound: true });
    const now = new Date('2026-11-03T07:40:00+01:00');
    expect(departsAt(dep('07:50', 6))).toEqual(new Date('2026-11-03T07:56:00+01:00'));
    expect(reachable(dep('07:43'), now, 4)).toBe(false);
    expect(reachable(dep('07:44'), now, 4)).toBe(true); // just in time
    expect(reachable(dep('07:42', 3), now, 4)).toBe(true); // the delay helps
    expect(leaveAt([dep('07:43'), dep('07:49')], now, 4)).toEqual(new Date('2026-11-03T07:45:00+01:00'));
    expect(leaveAt([dep('07:43')], now, 4)).toBeNull();
    expect(leaveAt([dep('07:49')], now, 0)).toBeNull(); // no walking time configured
  });

  it('shortens stop names by the city', () => {
    expect(shortStop('Zürich, Bahnhofplatz/HB')).toBe('Bahnhofplatz/HB');
    expect(shortStop('Zürich HB')).toBe('HB');
    expect(shortStop('Uetliberg')).toBe('Uetliberg');
  });

  it('drops departed journeys (including delay) and limits to n', () => {
    const dep = (line: string, hm: string, delayMin = 0) => ({ line, planned: new Date(`2026-11-03T${hm}:00+01:00`), delayMin, to: '', inbound: true });
    const deps = [dep('9', '07:42'), dep('14', '07:43', 2), dep('11', '07:47'), dep('10', '07:48')];
    const now = new Date('2026-11-03T07:44:30+01:00');
    expect(upcoming(deps, now).map((d) => d.line)).toEqual(['14', '11', '10']); // the 9 at 07:42 has left
    expect(upcoming(deps, new Date('2026-11-03T07:45:30+01:00'), 1).map((d) => d.line)).toEqual(['11']);
  });
});
