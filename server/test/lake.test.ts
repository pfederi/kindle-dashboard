import { describe, expect, it } from 'vitest';
import { fetchLakeTemp, lakeUrl, parseLakeTemp } from '../src/sources/lake.js';
import { fakeFetch, jsonResponse, textResponse } from './helpers.js';

const profile = {
  time: '2026-11-04T07:00:02+00:00',
  depth: { data: [47, 46, 1, 0], unit: 'm' },
  variables: { T: { data: [7.08, 7.09, 13.2, 13.33], unit: 'degC' } },
};

describe('lake', () => {
  it('asks Alplakes for the upperzurich profile at the current UTC minute', () => {
    expect(lakeUrl(new Date('2026-11-04T08:05:30+01:00'))).toBe(
      'https://alplakes-api.eawag.ch/simulations/1d/profile/simstrat/upperzurich/202611040705',
    );
  });

  it('takes the value at the depth closest to the surface, whatever the order', () => {
    expect(parseLakeTemp(profile)).toBe(13.33);
    expect(parseLakeTemp({ depth: { data: [0.5, 10] }, variables: { T: { data: [12.1, 9] } } })).toBe(12.1);
  });

  it('rejects malformed profiles', () => {
    expect(() => parseLakeTemp({})).toThrow(/unexpected profile/);
    expect(() => parseLakeTemp({ depth: { data: [0, 1] }, variables: { T: { data: [1] } } })).toThrow(/unexpected profile/);
    expect(() => parseLakeTemp({ depth: { data: [0] }, variables: { T: { data: [null] } } })).toThrow(/no temperature/);
  });

  it('fetches and parses, and reports HTTP errors', async () => {
    const ok = fakeFetch(() => jsonResponse(profile));
    expect(await fetchLakeTemp(ok, new Date('2026-11-04T07:00:00Z'))).toBe(13.33);
    expect(ok.calls[0]?.url).toContain('/upperzurich/202611040700');
    const bad = fakeFetch(() => textResponse('nope', 503));
    await expect(fetchLakeTemp(bad, new Date())).rejects.toThrow(/alplakes HTTP 503/);
  });
});
