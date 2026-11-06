import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

/** Alplakes (Eawag) Simstrat 1D model of the lower Lake Zurich basin, as used by Next Wave. */
export const LAKE_MODEL = 'upperzurich';

function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export function lakeUrl(now: Date, model = LAKE_MODEL): string {
  return `https://alplakes-api.eawag.ch/simulations/1d/profile/simstrat/${model}/${utcStamp(now)}`;
}

/** Surface water temperature in °C: the value at the depth closest to 0 m. */
export function parseLakeTemp(json: unknown): number {
  const root = (json ?? {}) as { depth?: { data?: unknown }; variables?: { T?: { data?: unknown } } };
  const depths = root.depth?.data;
  const temps = root.variables?.T?.data;
  if (!Array.isArray(depths) || !Array.isArray(temps) || depths.length === 0 || depths.length !== temps.length) {
    throw new Error('alplakes: unexpected profile');
  }
  let best = -1;
  depths.forEach((d, i) => {
    if (typeof d === 'number' && typeof temps[i] === 'number' && (best < 0 || Math.abs(d) < Math.abs(depths[best] as number))) best = i;
  });
  if (best < 0) throw new Error('alplakes: no temperature');
  return temps[best] as number;
}

export async function fetchLakeTemp(fetchFn: FetchFn, now: Date): Promise<number> {
  const res = await fetchFn(lakeUrl(now), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`alplakes HTTP ${res.status}`);
  return parseLakeTemp(await res.json());
}
