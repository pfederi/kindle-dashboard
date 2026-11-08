import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

/** SwissMetNet stations of MeteoSwiss: the Uetliberg, and Zürich-Fluntern for the city. */
export const TOP = 'ueb';
export const CITY = 'sma';

/**
 * Sun above the fog: in the last hour the city at most CITY_MAX minutes of sun, the Uetliberg at least TOP_MIN and
 * on average TOP_RADIATION W/m². Checked on the 10-minute values of 2026: 17 days, nearly all high-fog days in
 * winter; the radiation keeps out the low summer sun at dawn, which reaches the hilltop first.
 */
export const CITY_MAX = 5;
export const TOP_MIN = 45;
export const TOP_RADIATION = 80;
/** Values come every 10 minutes and are published about 10 minutes later; older ones count as no data. */
export const MAX_AGE_MS = 40 * 60_000;
const HOUR = 6;

export interface Measurement {
  at: Date;
  /** Minutes of sun in the 10 minutes up to `at`. */
  sun: number | null;
  /** Global radiation in W/m². */
  radiation: number | null;
}

/** The last hour at both stations, as minutes of sun; `at` is the newest value both have. */
export interface AboveFog {
  at: Date;
  city: number;
  top: number;
  /** Mean global radiation on the Uetliberg in W/m². */
  radiation: number;
}

export function smnUrl(station: string): string {
  return `https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/${station}/ogd-smn_${station}_t_now.csv`;
}

/** The 10-minute values of today and yesterday; timestamps «08.11.2026 14:10» are UTC. */
export function parseSmn(csv: string): Measurement[] {
  const [head, ...rows] = csv.trim().split(/\r?\n/);
  const cols = head?.split(';') ?? [];
  const iAt = cols.indexOf('reference_timestamp');
  const iSun = cols.indexOf('sre000z0');
  const iRad = cols.indexOf('gre000z0');
  if (iAt < 0 || iSun < 0 || iRad < 0) throw new Error('meteoswiss: unexpected columns');
  const num = (v: string | undefined) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return rows.flatMap((row) => {
    const f = row.split(';');
    const m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)$/.exec(f[iAt] ?? '');
    if (!m) return [];
    const [, d, mo, y, h, mi] = m.map(Number) as number[];
    return [{ at: new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!)), sun: num(f[iSun]), radiation: num(f[iRad]) }];
  });
}

/** The last hour of both stations up to their newest common value; null when a value is missing. */
export function lastHour(city: Measurement[], top: Measurement[]): AboveFog | null {
  const cityAt = new Map(city.map((m) => [m.at.getTime(), m]));
  const both = top.filter((m) => cityAt.has(m.at.getTime())).sort((a, b) => a.at.getTime() - b.at.getTime());
  const hour = both.slice(-HOUR);
  if (hour.length < HOUR) return null;
  let c = 0;
  let t = 0;
  let r = 0;
  for (const m of hour) {
    const cm = cityAt.get(m.at.getTime())!;
    if (cm.sun === null || m.sun === null || m.radiation === null) return null;
    c += cm.sun;
    t += m.sun;
    r += m.radiation;
  }
  return { at: hour.at(-1)!.at, city: c, top: t, radiation: r / HOUR };
}

/** Grey in the city, sun on the Uetliberg, measured within the last MAX_AGE_MS. */
export function sunAboveFog(a: AboveFog | null, now: Date): boolean {
  return a !== null && now.getTime() - a.at.getTime() <= MAX_AGE_MS && a.city <= CITY_MAX && a.top >= TOP_MIN && a.radiation >= TOP_RADIATION;
}

async function fetchStation(fetchFn: FetchFn, station: string): Promise<Measurement[]> {
  const res = await fetchFn(smnUrl(station), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`meteoswiss HTTP ${res.status}`);
  return parseSmn(await res.text());
}

export async function fetchAboveFog(fetchFn: FetchFn): Promise<AboveFog | null> {
  const [city, top] = await Promise.all([fetchStation(fetchFn, CITY), fetchStation(fetchFn, TOP)]);
  return lastHour(city, top);
}
