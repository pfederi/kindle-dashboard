import { describe, expect, it } from 'vitest';
import { fetchAboveFog, lastHour, type Measurement, parseSmn, smnUrl, sunAboveFog } from '../src/sources/uetliberg.js';
import { fakeFetch, textResponse } from './helpers.js';

const HEAD = 'station_abbr;reference_timestamp;tre200s0;gre000z0;ods000z0;sre000z0;tso005s0';
/** A station's file with these minutes of sun and radiation per 10 minutes, the last at 14:10 UTC. */
function csv(station: string, values: [number | '', number | ''][]): string {
  const rows = values.map(([sun, rad], i) => {
    const min = 14 * 60 + 10 - (values.length - 1 - i) * 10;
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    return `${station};08.11.2026 ${hh}:${mm};4.2;${rad};;${sun};`;
  });
  return [HEAD, ...rows].join('\n') + '\n';
}
const hour = (sun: number, rad: number): [number, number][] => Array.from({ length: 6 }, () => [sun, rad]);
const NOW = new Date('2026-11-08T14:25:00Z');

describe('Uetliberg above the fog (MeteoSwiss SwissMetNet)', () => {
  it('reads the 10-minute files of the Uetliberg and of Fluntern', () => {
    expect(smnUrl('ueb')).toBe('https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/ueb/ogd-smn_ueb_t_now.csv');
  });

  it('takes the minutes of sun and the radiation per 10 minutes, timestamps in UTC', () => {
    expect(parseSmn(csv('UEB', [[10, 360], ['', '']]))).toEqual<Measurement[]>([
      { at: new Date('2026-11-08T14:00:00Z'), sun: 10, radiation: 360 },
      { at: new Date('2026-11-08T14:10:00Z'), sun: null, radiation: null },
    ]);
    expect(() => parseSmn('station_abbr;reference_timestamp\nUEB;08.11.2026 14:10')).toThrow(/unexpected columns/);
  });

  it('sums the last hour both stations have', () => {
    const city = parseSmn(csv('SMA', [[10, 300], ...hour(0, 40)]));
    // The Uetliberg is a value behind: the hour ends at 14:00.
    const top = parseSmn(csv('UEB', [[10, 300], ...hour(9, 250)])).slice(0, -1);
    expect(lastHour(city, top)).toEqual({ at: new Date('2026-11-08T14:00:00Z'), city: 10, top: 55, radiation: (300 + 5 * 250) / 6 });
    expect(lastHour(city, top.slice(-5))).toBeNull();
    expect(lastHour(parseSmn(csv('SMA', [...hour(0, 40).slice(1), ['', 40]])), parseSmn(csv('UEB', hour(9, 250))))).toBeNull();
  });

  it('says sunny above the fog only when the city is grey and the Uetliberg in bright sun, measured lately', () => {
    const fog = { at: new Date('2026-11-08T14:10:00Z'), city: 0, top: 60, radiation: 300 };
    expect(sunAboveFog(fog, NOW)).toBe(true);
    expect(sunAboveFog({ ...fog, city: 6 }, NOW)).toBe(false); // the city has sun too
    expect(sunAboveFog({ ...fog, top: 44 }, NOW)).toBe(false); // clouds up there as well
    expect(sunAboveFog({ ...fog, radiation: 60 }, NOW)).toBe(false); // dawn: low sun on the hilltop first
    expect(sunAboveFog(fog, new Date('2026-11-08T14:51:00Z'))).toBe(false); // stale
    expect(sunAboveFog(null, NOW)).toBe(false);
  });

  it('fetches both stations, and reports HTTP errors', async () => {
    const ok = fakeFetch(({ url }) => textResponse(url.includes('/ueb/') ? csv('UEB', hour(10, 320)) : csv('SMA', hour(0, 45))));
    const a = await fetchAboveFog(ok);
    expect(a).toEqual({ at: new Date('2026-11-08T14:10:00Z'), city: 0, top: 60, radiation: 320 });
    expect(sunAboveFog(a, NOW)).toBe(true);
    expect(ok.calls.map((c) => c.url).sort()).toEqual([smnUrl('sma'), smnUrl('ueb')]);
    await expect(fetchAboveFog(fakeFetch(() => new Response('', { status: 503 })))).rejects.toThrow(/^meteoswiss HTTP 503$/);
  });
});
