import { TtlCache } from '../cache.js';
import type { Clock } from '../clock.js';
import type { StationConfig } from '../config.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

export interface Departure {
  line: string;
  planned: Date;
  delayMin: number;
  /** Actual terminus of this journey, e.g. «Zürich, Bahnhofplatz/HB». */
  to: string;
  /** Passes the station's `via` stop, i.e. heads into town. */
  inbound: boolean;
}

export interface StationBoard {
  station: StationConfig;
  /** Official stop name from the stationboard, e.g. «Zürich, Messe/Hallenstadion»; null without data. */
  officialName?: string | null;
  departures: Departure[] | null;
  /** When `departures` was fetched; null if there is no data. */
  fetchedAt: Date | null;
}

export const TRANSIT_TTL_MS = 2 * 60_000;
/** From this delay on, the departure time is shown inverted. */
export const LATE_MIN = 5;

const RAIL_CATEGORIES = new Set(['S', 'SN']);

export function lineName(category: string, number: string): string {
  return RAIL_CATEGORIES.has(category) ? `${category}${number}` : number;
}

export function stationboardUrl(id: string): string {
  // Both directions are kept, so ask for enough journeys to fill the station screen.
  return `https://transport.opendata.ch/v1/stationboard?id=${encodeURIComponent(id)}&limit=40`;
}

interface RawJourney {
  category?: unknown;
  number?: unknown;
  to?: unknown;
  stop?: { departureTimestamp?: unknown; delay?: unknown };
  passList?: { station?: { name?: unknown } }[];
}

export function parseStationboard(json: unknown, station: StationConfig): Departure[] {
  const raw = (json as { stationboard?: unknown } | null)?.stationboard;
  const journeys: RawJourney[] = Array.isArray(raw) ? (raw as RawJourney[]) : [];
  const out: Departure[] = [];
  for (const j of journeys) {
    // passList[0] is the station itself; the via stop must come after it.
    const inbound = (j.passList ?? []).slice(1).some((p) => p?.station?.name === station.via);
    const line = lineName(String(j.category ?? ''), String(j.number ?? ''));
    if (station.lines.length > 0 && !station.lines.includes(line)) continue;
    const planned = new Date(Number(j.stop?.departureTimestamp) * 1000);
    if (Number.isNaN(planned.getTime())) continue;
    const delay = Number(j.stop?.delay ?? 0);
    out.push({ line, planned, delayMin: Number.isFinite(delay) ? delay : 0, to: typeof j.to === 'string' ? j.to : '', inbound });
  }
  return out;
}

/** Actual departure time including the delay. */
export function departsAt(d: Departure): Date {
  return new Date(d.planned.getTime() + d.delayMin * 60_000);
}

/** Whether one can still catch d when leaving the house now. */
export function reachable(d: Departure, now: Date, walkMin: number): boolean {
  return departsAt(d).getTime() - walkMin * 60_000 >= now.getTime();
}

/** When to leave the house for the first reachable departure; null without a walking time or departure. */
export function leaveAt(deps: Departure[], now: Date, walkMin: number): Date | null {
  if (walkMin <= 0) return null;
  const next = deps.find((d) => reachable(d, now, walkMin));
  return next ? new Date(departsAt(next).getTime() - walkMin * 60_000) : null;
}

/** Stop name without the city, e.g. «Zürich, Seebach» → «Seebach», «Zürich HB» → «HB». */
export function shortStop(name: string): string {
  return name.replace(/^Zürich,?\s+/, '');
}

/** The stop's official name, e.g. «Zürich, Messe/Hallenstadion». */
export function parseStationName(json: unknown): string | null {
  const name = (json as { station?: { name?: unknown } } | null)?.station?.name;
  return typeof name === 'string' && name !== '' ? name : null;
}

export function upcoming(deps: Departure[], now: Date, n = 4): Departure[] {
  return deps
    .filter((d) => d.planned.getTime() + d.delayMin * 60_000 >= now.getTime())
    .sort((a, b) => a.planned.getTime() - b.planned.getTime())
    .slice(0, n);
}

export class TransitSource {
  private readonly entries: { station: StationConfig; cache: TtlCache<{ name: string | null; departures: Departure[] }> }[];

  constructor(stations: StationConfig[], fetchFn: FetchFn, clock: Clock) {
    this.entries = stations.map((station) => ({
      station,
      cache: new TtlCache(
        TRANSIT_TTL_MS,
        async () => {
          const res = await fetchFn(stationboardUrl(station.id), { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!res.ok) throw new Error(`stationboard HTTP ${res.status}`);
          const json = await res.json();
          return { name: parseStationName(json), departures: parseStationboard(json, station) };
        },
        clock,
        `transit:${station.name}`,
      ),
    }));
  }

  async boards(force = false): Promise<StationBoard[]> {
    return Promise.all(
      this.entries.map(async ({ station, cache }) => {
        const cached = await cache.get(force);
        return {
          station,
          officialName: cached?.value.name ?? null,
          departures: cached?.value.departures ?? null,
          fetchedAt: cached?.fetchedAt ?? null,
        };
      }),
    );
  }
}
