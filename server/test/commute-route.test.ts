import { describe, expect, it, vi } from 'vitest';
import {
  CommuteRouteSource,
  decodePolyline,
  fetchMap,
  fitView,
  type LatLon,
  MAP_PX,
  mapUrl,
  parseRoutes,
  project,
  routesUrl,
  withJam,
} from '../src/sources/commute-route.js';
import { fakeFetch, jsonResponse } from './helpers.js';

const config = { apiKey: 'k3y', from: { lat: 47.411, lon: 8.544 }, to: { lat: 47.363, lon: 8.518 }, highway: true, label: 'Zur Arbeit', walkMinutes: 0 };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Flexible polyline, precision 5, two dimensions: the inverse of decodePolyline. */
function encode(points: LatLon[]): string {
  const unsigned = (v: number) => {
    let out = '';
    while (v > 0x1f) {
      out += ALPHABET[(v & 0x1f) | 0x20];
      v = Math.floor(v / 32);
    }
    return out + ALPHABET[v];
  };
  const signed = (v: number) => unsigned(v < 0 ? -2 * v - 1 : 2 * v);
  let out = unsigned(1) + unsigned(5);
  let lat = 0;
  let lon = 0;
  for (const [la, lo] of points) {
    const a = Math.round(la * 1e5);
    const o = Math.round(lo * 1e5);
    out += signed(a - lat) + signed(o - lon);
    lat = a;
    lon = o;
  }
  return out;
}

const PTS: LatLon[] = [
  [47.411, 8.544],
  [47.4, 8.54],
  [47.39, 8.53],
  [47.38, 8.525],
  [47.363, 8.518],
];

const span = (offset: number, name: string, length: number, trafficSpeed?: number, baseSpeed = 10) => ({
  offset,
  names: [{ value: name, language: 'de' }],
  length,
  ...(trafficSpeed === undefined ? {} : { dynamicSpeedInfo: { trafficSpeed, baseSpeed, turnTime: 0 } }),
});

const HERE = {
  routes: [
    {
      sections: [
        {
          summary: { duration: 1440, typicalDuration: 1020, baseDuration: 960 },
          polyline: encode(PTS),
          spans: [span(0, 'Schaffhauserstrasse', 1300, 10), span(2, 'Rosengartenstrasse', 450, 3), span(3, 'Seebahnstrasse', 1200, 6)],
        },
      ],
    },
    { sections: [{ summary: { duration: 1020, typicalDuration: 1020 }, polyline: encode([PTS[0]!, [47.38, 8.51], PTS[4]!]) }] },
  ],
};

describe('commute route (HERE routing with traffic per stretch)', () => {
  it('decodes flexible polylines, also with a third dimension', () => {
    // The examples of HERE's reference implementation.
    const expected = [
      [50.10228, 8.69821],
      [50.10201, 8.69567],
      [50.10063, 8.6915],
      [50.09878, 8.68752],
    ];
    expect(decodePolyline('BFoz5xJ67i1B1B7PzIhaxL7Y')).toEqual(expected);
    expect(decodePolyline('BlBoz5xJ67i1BU1B7PUzIhaUxL7YU')).toEqual(expected);
    expect(decodePolyline(encode(PTS))).toEqual(PTS);
    expect(() => decodePolyline('CFoz5xJ')).toThrow(/bad polyline/);
    expect(() => decodePolyline('BFoz5x!')).toThrow(/bad polyline/);
  });

  it('asks for the geometry, the traffic speed and the street names, and one alternative', () => {
    const u = new URL(routesUrl(config));
    expect(u.origin + u.pathname).toBe('https://router.hereapi.com/v8/routes');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      transportMode: 'scooter',
      origin: '47.411,8.544',
      destination: '47.363,8.518',
      return: 'polyline,summary,typicalDuration',
      spans: 'dynamicSpeedInfo,names,length',
      alternatives: '1',
      'scooter[allowHighway]': 'true',
      apiKey: 'k3y',
    });
  });

  it('splits a route into stretches with their share of the free-flow speed', () => {
    const [main, alt] = parseRoutes(HERE);
    expect(main).toMatchObject({ minutes: 24, delayMinutes: 7 });
    expect(main!.stretches).toEqual([
      { points: PTS.slice(0, 3), ratio: 1, name: 'Schaffhauserstrasse', length: 1300 },
      { points: PTS.slice(2, 4), ratio: 0.3, name: 'Rosengartenstrasse', length: 450 },
      { points: PTS.slice(3, 5), ratio: 0.6, name: 'Seebahnstrasse', length: 1200 },
    ]);
    // Without spans: one stretch at free flow.
    expect(alt).toMatchObject({ minutes: 17, delayMinutes: 0, stretches: [{ ratio: 1, name: '', length: 0 }] });
    expect(alt!.stretches[0]!.points).toHaveLength(3);
  });

  it('treats a stretch without speeds as free flow, and rejects answers without a route', () => {
    const json = { routes: [{ sections: [{ summary: { duration: 600 }, polyline: encode(PTS), spans: [span(0, 'A', 10)] }] }] };
    expect(parseRoutes(json)[0]!.stretches[0]!.ratio).toBe(1);
    expect(() => parseRoutes({ routes: [] })).toThrow(/no route/);
    expect(() => parseRoutes({ routes: [{ sections: [] }] })).toThrow(/no route/);
    expect(() => parseRoutes({ routes: [{ sections: [{ summary: { duration: 600 } }] }] })).toThrow(/no polyline/);
  });

  it('fits the points into the map with a margin, centred', () => {
    const view = fitView(PTS, MAP_PX.width, MAP_PX.height);
    expect(view.zoom).toBeLessThanOrEqual(18);
    expect(view.zoom * 10).toBe(Math.round(view.zoom * 10));
    const xy = project(view, MAP_PX.width, MAP_PX.height);
    for (const p of PTS) {
      const [x, y] = xy(p);
      expect(x).toBeGreaterThan(MAP_PX.width * 0.05);
      expect(x).toBeLessThan(MAP_PX.width * 0.95);
      expect(y).toBeGreaterThan(MAP_PX.height * 0.05);
      expect(y).toBeLessThan(MAP_PX.height * 0.95);
    }
    // The tall route fills the height, not more.
    const ys = PTS.map((p) => xy(p)[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(MAP_PX.height * 0.8);
    const [cx, cy] = xy([view.lat, view.lon]);
    expect([cx, cy]).toEqual([MAP_PX.width / 2, MAP_PX.height / 2]);
    expect(fitView([[47.4, 8.5]], 100, 100).zoom).toBe(18);
  });

  it('asks HERE for a light, grey-friendly base map at the view, with large labels and without POIs', () => {
    const u = new URL(mapUrl('k3y', { lat: 47.3868, lon: 8.529, zoom: 14.1 }));
    expect(u.origin + decodeURIComponent(u.pathname)).toBe(`https://image.maps.hereapi.com/mia/v3/base/mc/center:47.3868,8.529;zoom=14.1/${MAP_PX.width}x${MAP_PX.height}/png`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ style: 'lite.day', ppi: '200', lang: 'de', features: 'pois:disabled', apiKey: 'k3y' });
  });

  it('returns the map as a data URL and never puts the URL (with the API key) into an error', async () => {
    const view = { lat: 47.4, lon: 8.5, zoom: 14 };
    const png = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    expect(await fetchMap(png, 'k3y', view)).toBe('data:image/png;base64,AQID');
    await expect(fetchMap(fakeFetch(() => new Response('no', { status: 401 })), 'k3y', view)).rejects.toThrow(/^here map HTTP 401$/);
    await expect(fetchMap(fakeFetch(() => jsonResponse({ error: 'x' })), 'k3y', view)).rejects.toThrow(/^here map: not a PNG$/);
  });

  it('acts out a jam in the middle of the fastest route for the preview, and leaves the alternative alone', () => {
    const routes = parseRoutes(HERE).map((r) => ({ ...r, stretches: r.stretches.map((s) => ({ ...s, ratio: 1 })) }));
    // 1000 m in ten stretches: midpoints at 5 %, 15 %, … 95 %.
    routes[0]!.stretches = Array.from({ length: 10 }, (_, k) => ({ points: PTS.slice(0, 2), ratio: 1, name: `S${k}`, length: 100 }));
    const detail = { routes, view: { lat: 47.38, lon: 8.53, zoom: 14 }, image: null };
    const jammed = withJam(detail);
    expect(jammed.routes[0]!.stretches.map((s) => s.ratio)).toEqual([1, 1, 0.6, 0.6, 0.3, 0.3, 1, 1, 1, 1]);
    expect(jammed.routes[0]).toMatchObject({ minutes: routes[0]!.minutes + 7, delayMinutes: routes[0]!.delayMinutes + 7 });
    expect(jammed.routes[1]).toBe(routes[1]);
    // The real route is not touched.
    expect(detail.routes[0]!.stretches[4]!.ratio).toBe(1);
  });

  describe('CommuteRouteSource', () => {
    const answer = (mapOk: () => boolean) =>
      fakeFetch(({ url }) => {
        if (url.startsWith('https://router.hereapi.com/')) return jsonResponse(HERE);
        return mapOk() ? new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }) : new Response('', { status: 500 });
      });

    it('loads the routes each time and the base map of a view only once', async () => {
      const f = answer(() => true);
      const src = new CommuteRouteSource(f, config);
      const first = await src.load();
      expect(first.routes).toHaveLength(2);
      expect(first.image).toBe('data:image/png;base64,AQ==');
      const second = await src.load();
      expect(second.view).toEqual(first.view);
      expect(f.calls.map((c) => new URL(c.url).hostname)).toEqual(['router.hereapi.com', 'image.maps.hereapi.com', 'router.hereapi.com']);
    });

    it('draws on white when the map fails, and tries again next time', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let ok = false;
      const f = answer(() => ok);
      const src = new CommuteRouteSource(f, config);
      expect((await src.load()).image).toBeNull();
      expect(warn.mock.calls.flat().join(' ')).not.toContain('k3y');
      ok = true;
      expect((await src.load()).image).toBe('data:image/png;base64,AQ==');
      warn.mockRestore();
    });
  });
});
