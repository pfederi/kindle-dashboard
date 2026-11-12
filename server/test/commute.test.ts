import { describe, expect, it } from 'vitest';
import { commuteUrl, fetchCommute, parseCommute } from '../src/sources/commute.js';
import { fakeFetch, jsonResponse } from './helpers.js';

const config = { apiKey: 'k3y', from: { lat: 47.411, lon: 8.544 }, to: { lat: 47.378, lon: 8.54 }, highway: true, label: 'Zur Arbeit' };
const route = (...summaries: object[]) => ({ routes: [{ sections: summaries.map((summary) => ({ summary })) }] });

describe('commute (HERE scooter routing)', () => {
  it('asks for a scooter route now, motorways as configured, with the typical duration', () => {
    const u = new URL(commuteUrl(config));
    expect(u.origin + u.pathname).toBe('https://router.hereapi.com/v8/routes');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      transportMode: 'scooter',
      origin: '47.411,8.544',
      destination: '47.378,8.54',
      return: 'summary,typicalDuration',
      'scooter[allowHighway]': 'true',
      apiKey: 'k3y',
    });
    expect(new URL(commuteUrl({ ...config, highway: false })).searchParams.get('scooter[allowHighway]')).toBe('false');
  });

  it('asks for a car route, without motorways avoiding them as a feature', () => {
    const car = new URL(commuteUrl({ ...config, mode: 'car' })).searchParams;
    expect(car.get('transportMode')).toBe('car');
    expect(car.has('scooter[allowHighway]')).toBe(false);
    expect(car.has('avoid[features]')).toBe(false);
    expect(new URL(commuteUrl({ ...config, mode: 'car', highway: false })).searchParams.get('avoid[features]')).toBe('controlledAccessHighway');
  });

  it('sums the sections and measures the delay against the typical time, else the time without traffic', () => {
    expect(parseCommute(route({ duration: 900, typicalDuration: 700, baseDuration: 600 }, { duration: 180, typicalDuration: 140 }))).toEqual({ minutes: 18, delayMinutes: 4 });
    expect(parseCommute(route({ duration: 900, baseDuration: 840 }))).toEqual({ minutes: 15, delayMinutes: 1 });
    expect(parseCommute(route({ duration: 600, typicalDuration: 840 }))).toEqual({ minutes: 10, delayMinutes: -4 });
    expect(() => parseCommute({ routes: [] })).toThrow(/no route/);
    expect(() => parseCommute(route({ length: 5000 }))).toThrow(/no duration/);
  });

  it('never puts the URL (with the API key) into an error', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 403 }));
    await expect(fetchCommute(f, config)).rejects.toThrow(/^here HTTP 403$/);
    const ok = fakeFetch(() => jsonResponse(route({ duration: 600, typicalDuration: 600 })));
    expect(await fetchCommute(ok, config)).toEqual({ minutes: 10, delayMinutes: 0 });
  });

  it('asks for the usual traffic at a planned departure', async () => {
    const at = new Date('2026-11-12T12:55:00+01:00');
    expect(new URL(commuteUrl(config, at)).searchParams.get('departureTime')).toBe('2026-11-12T11:55:00Z');
    expect(new URL(commuteUrl(config)).searchParams.has('departureTime')).toBe(false);
    const f = fakeFetch(() => jsonResponse(route({ duration: 1320, typicalDuration: 1320 })));
    expect(await fetchCommute(f, config, at)).toEqual({ minutes: 22, delayMinutes: 0 });
    expect(f.calls[0]!.url).toContain('departureTime=2026-11-12T11%3A55%3A00Z');
  });
});
