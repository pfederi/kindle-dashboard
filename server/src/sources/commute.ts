import type { CommuteConfig, CommuteDestination, CommuteMode } from '../config.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

/** Travel time by scooter with the current traffic. */
export interface Commute {
  /** Minutes with the current traffic. */
  minutes: number;
  /** Minutes more than usual at this time of day (negative: faster). */
  delayMinutes: number;
}

/** One ride: from home to one destination. */
export interface Trip {
  apiKey: string;
  mode?: CommuteMode;
  from: { lat: number; lon: number };
  to: { lat: number; lon: number };
  highway: boolean;
}

export function trip(c: CommuteConfig, d: CommuteDestination): Trip {
  return { apiKey: c.apiKey, mode: c.mode, from: c.from, to: d.to, highway: c.highway };
}

/**
 * Vehicle parameters: the scooter mode also serves a motorcycle (HERE has no mode of its own for it);
 * a car without motorways avoids them as a route feature.
 */
export function modeParams(c: Trip): Record<string, string> {
  if (c.mode === 'car') return { transportMode: 'car', ...(c.highway ? {} : { 'avoid[features]': 'controlledAccessHighway' }) };
  return { transportMode: 'scooter', 'scooter[allowHighway]': String(c.highway) };
}

/**
 * HERE Routing v8 in scooter mode (or car, see modeParams): roads open to motorcycles, motorways only if allowed (125 cm³).
 * Without departureTime HERE routes for now, with live traffic; with it, with the traffic usual then.
 */
export function commuteUrl(c: Trip, departure?: Date): string {
  const q = new URLSearchParams({
    ...modeParams(c),
    origin: `${c.from.lat},${c.from.lon}`,
    destination: `${c.to.lat},${c.to.lon}`,
    return: 'summary,typicalDuration',
  });
  if (departure) q.set('departureTime', departure.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  q.set('apiKey', c.apiKey);
  return `https://router.hereapi.com/v8/routes?${q}`;
}

export interface Summary {
  duration?: unknown;
  baseDuration?: unknown;
  typicalDuration?: unknown;
}

/** Sums the sections of the first route; the delay is measured against the typical duration, else the one without traffic. */
export function parseCommute(json: unknown): Commute {
  const sections = (json as { routes?: { sections?: { summary?: Summary }[] }[] } | null)?.routes?.[0]?.sections;
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('here: no route');
  return sumSections(sections);
}

/** Travel time of one route from its sections. */
export function sumSections(sections: { summary?: Summary }[]): Commute {
  let duration = 0;
  let usual = 0;
  for (const s of sections) {
    const d = s.summary?.duration;
    if (typeof d !== 'number') throw new Error('here: no duration');
    const t = s.summary?.typicalDuration;
    const b = s.summary?.baseDuration;
    duration += d;
    usual += typeof t === 'number' ? t : typeof b === 'number' ? b : d;
  }
  return { minutes: Math.max(1, Math.round(duration / 60)), delayMinutes: Math.round((duration - usual) / 60) };
}

export async function fetchCommute(fetchFn: FetchFn, c: Trip, departure?: Date): Promise<Commute> {
  const res = await fetchFn(commuteUrl(c, departure), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Never the URL in errors: it carries the API key.
  if (!res.ok) throw new Error(`here HTTP ${res.status}`);
  return parseCommute(await res.json());
}
