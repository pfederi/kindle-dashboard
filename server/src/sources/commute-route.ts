import type { CommuteConfig } from '../config.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';
import { type Commute, type Summary, sumSections } from './commute.js';

/** [latitude, longitude] */
export type LatLon = [number, number];

/** A stretch of a route with one traffic speed. */
export interface Stretch {
  points: LatLon[];
  /** Speed with traffic against the speed without: 1 = free, 0.3 = crawling. */
  ratio: number;
  /** Street name, '' when HERE has none. */
  name: string;
  /** Metres. */
  length: number;
}

export interface CommuteRoute extends Commute {
  stretches: Stretch[];
}

/** Centre and zoom of the base map (zoom as in web map tiles of 256 px, fractions allowed). */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

/** The route with traffic, the alternative if any, and the base map they are drawn on. */
export interface CommuteDetail {
  /** Fastest first, then the alternative. */
  routes: CommuteRoute[];
  view: MapView;
  /** Base map as a data URL; null when it could not be loaded (the route is drawn on white). */
  image: string | null;
}

/** Below this share of the free-flow speed a stretch counts as a jam, below SLOW as slow-moving. */
export const JAM_RATIO = 0.5;
export const SLOW_RATIO = 0.75;

/**
 * Size of the base map in image px. HERE draws it at ppi 200 (labels twice as large), so two image
 * px make one device px: 553 × 538 on the Kindle.
 */
export const MAP_PX = { width: 1106, height: 1076 } as const;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Decodes HERE's flexible polyline (a third dimension, if any, is dropped). */
export function decodePolyline(encoded: string): LatLon[] {
  let i = 0;
  const unsigned = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      if (i >= encoded.length) throw new Error('here: bad polyline');
      const c = ALPHABET.indexOf(encoded[i++]!);
      if (c < 0) throw new Error('here: bad polyline');
      // Multiplication, not <<: coordinates outgrow 32 bits.
      value += (c & 0x1f) * 2 ** shift;
      shift += 5;
      if ((c & 0x20) === 0) return value;
    }
  };
  const signed = (): number => {
    const v = unsigned();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  };
  if (unsigned() !== 1) throw new Error('here: bad polyline');
  const header = unsigned();
  const factor = 10 ** (header & 15);
  const third = Math.floor(header / 16) & 7;
  const points: LatLon[] = [];
  let lat = 0;
  let lon = 0;
  while (i < encoded.length) {
    lat += signed();
    lon += signed();
    if (third) signed();
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/** Like commuteUrl, with the geometry, the traffic speed and street name per stretch, and one alternative. */
export function routesUrl(c: CommuteConfig): string {
  const q = new URLSearchParams({
    transportMode: 'scooter',
    origin: `${c.from.lat},${c.from.lon}`,
    destination: `${c.to.lat},${c.to.lon}`,
    return: 'polyline,summary,typicalDuration',
    spans: 'dynamicSpeedInfo,names,length',
    alternatives: '1',
    'scooter[allowHighway]': String(c.highway),
    apiKey: c.apiKey,
  });
  return `https://router.hereapi.com/v8/routes?${q}`;
}

interface Span {
  offset?: unknown;
  names?: { value?: unknown }[];
  length?: unknown;
  dynamicSpeedInfo?: { trafficSpeed?: unknown; baseSpeed?: unknown };
}

interface Section {
  polyline?: unknown;
  spans?: Span[];
  summary?: Summary;
}

function stretches(section: Section): Stretch[] {
  if (typeof section.polyline !== 'string') throw new Error('here: no polyline');
  const points = decodePolyline(section.polyline);
  const spans = Array.isArray(section.spans) ? section.spans : [];
  // Without spans the section is one stretch at free flow.
  if (spans.length === 0) return [{ points, ratio: 1, name: '', length: 0 }];
  return spans.map((span, k) => {
    const start = typeof span.offset === 'number' ? span.offset : 0;
    const next = spans[k + 1]?.offset;
    const end = typeof next === 'number' ? next : points.length - 1;
    const traffic = span.dynamicSpeedInfo?.trafficSpeed;
    const base = span.dynamicSpeedInfo?.baseSpeed;
    const name = span.names?.[0]?.value;
    return {
      points: points.slice(start, end + 1),
      ratio: typeof traffic === 'number' && typeof base === 'number' && base > 0 ? traffic / base : 1,
      name: typeof name === 'string' ? name : '',
      length: typeof span.length === 'number' ? span.length : 0,
    };
  });
}

export function parseRoutes(json: unknown): CommuteRoute[] {
  const routes = (json as { routes?: { sections?: Section[] }[] } | null)?.routes;
  if (!Array.isArray(routes) || routes.length === 0) throw new Error('here: no route');
  return routes.map((r) => {
    const sections = r.sections;
    if (!Array.isArray(sections) || sections.length === 0) throw new Error('here: no route');
    return { ...sumSections(sections), stretches: sections.flatMap(stretches) };
  });
}

export async function fetchRoutes(fetchFn: FetchFn, c: CommuteConfig): Promise<CommuteRoute[]> {
  const res = await fetchFn(routesUrl(c), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Never the URL in errors: it carries the API key.
  if (!res.ok) throw new Error(`here HTTP ${res.status}`);
  return parseRoutes(await res.json());
}

// Web Mercator as used by map tiles: the world is 256 × 2^zoom px wide.
const TILE = 256;
const worldX = (lon: number, zoom: number) => ((lon + 180) / 360) * TILE * 2 ** zoom;
const worldY = (lat: number, zoom: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** zoom;
};
const latitude = (y0: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y0) / TILE))) * 180) / Math.PI;

/**
 * The view that fits the points into width × height px, filling `fill` of it. Zoom and centre are
 * rounded so that slightly different routes share a view, and with it the cached base map.
 */
export function fitView(points: LatLon[], width: number, height: number, fill = 0.85): MapView {
  if (points.length === 0) throw new Error('no points');
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const dx = worldX(east, 0) - worldX(west, 0);
  const dy = worldY(south, 0) - worldY(north, 0);
  const zoom = Math.min(18, Math.log2((width * fill) / dx), Math.log2((height * fill) / dy));
  const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
  return {
    lat: round(latitude((worldY(south, 0) + worldY(north, 0)) / 2), 4),
    lon: round((west + east) / 2, 4),
    zoom: Math.floor(zoom * 10) / 10,
  };
}

/** Position in px on a width × height map of the view. */
export function project(view: MapView, width: number, height: number): (p: LatLon) => [number, number] {
  const cx = worldX(view.lon, view.zoom);
  const cy = worldY(view.lat, view.zoom);
  return ([lat, lon]) => [worldX(lon, view.zoom) - cx + width / 2, worldY(lat, view.zoom) - cy + height / 2];
}

/** HERE Map Image API: the light style made as a background for overlays, without POIs, labels in German. */
export function mapUrl(apiKey: string, view: MapView): string {
  const q = new URLSearchParams({ style: 'lite.day', ppi: '200', lang: 'de', features: 'pois:disabled', apiKey });
  return `https://image.maps.hereapi.com/mia/v3/base/mc/center:${view.lat},${view.lon};zoom=${view.zoom}/${MAP_PX.width}x${MAP_PX.height}/png?${q}`;
}

export async function fetchMap(fetchFn: FetchFn, apiKey: string, view: MapView): Promise<string> {
  const res = await fetchFn(mapUrl(apiKey, view), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`here map HTTP ${res.status}`);
  if (!res.headers.get('content-type')?.startsWith('image/png')) throw new Error('here map: not a PNG');
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

/** Base maps kept; a view only changes when the route takes another way. */
const MAX_MAPS = 8;

/** Route and map for the «Arbeitsweg» screen. The base map of a view is loaded once and kept. */
export class CommuteRouteSource {
  private readonly maps = new Map<string, string>();

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly config: CommuteConfig,
  ) {}

  async load(): Promise<CommuteDetail> {
    const routes = await fetchRoutes(this.fetchFn, this.config);
    const points = [this.config.from, this.config.to].map((p): LatLon => [p.lat, p.lon]);
    const view = fitView([...points, ...routes.flatMap((r) => r.stretches.flatMap((s) => s.points))], MAP_PX.width, MAP_PX.height);
    return { routes, view, image: await this.map(view) };
  }

  private async map(view: MapView): Promise<string | null> {
    const key = `${view.lat},${view.lon},${view.zoom}`;
    const cached = this.maps.get(key);
    if (cached) return cached;
    try {
      const image = await fetchMap(this.fetchFn, this.config.apiKey, view);
      if (this.maps.size >= MAX_MAPS) this.maps.delete(this.maps.keys().next().value!);
      this.maps.set(key, image);
      return image;
    } catch (err) {
      // The route still shows, on white; the next load tries again.
      console.warn(`[commute:map] ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
