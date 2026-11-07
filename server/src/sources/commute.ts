import type { CommuteConfig } from '../config.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

/** Travel time by scooter with the current traffic. */
export interface Commute {
  /** Minutes with the current traffic. */
  minutes: number;
  /** Minutes more than usual at this time of day (negative: faster). */
  delayMinutes: number;
}

/**
 * HERE Routing v8 in scooter mode: roads open to motorcycles, motorways only if allowed (125 cm³).
 * Without departureTime HERE routes for now, with live traffic.
 */
export function commuteUrl(c: CommuteConfig): string {
  const q = new URLSearchParams({
    transportMode: 'scooter',
    origin: `${c.from.lat},${c.from.lon}`,
    destination: `${c.to.lat},${c.to.lon}`,
    return: 'summary,typicalDuration',
    'scooter[allowHighway]': String(c.highway),
    apiKey: c.apiKey,
  });
  return `https://router.hereapi.com/v8/routes?${q}`;
}

interface Summary {
  duration?: unknown;
  baseDuration?: unknown;
  typicalDuration?: unknown;
}

/** Sums the sections of the first route; the delay is measured against the typical duration, else the one without traffic. */
export function parseCommute(json: unknown): Commute {
  const sections = (json as { routes?: { sections?: { summary?: Summary }[] }[] } | null)?.routes?.[0]?.sections;
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('here: no route');
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

export async function fetchCommute(fetchFn: FetchFn, c: CommuteConfig): Promise<Commute> {
  const res = await fetchFn(commuteUrl(c), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Never the URL in errors: it carries the API key.
  if (!res.ok) throw new Error(`here HTTP ${res.status}`);
  return parseCommute(await res.json());
}
