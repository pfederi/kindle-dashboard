import { TtlCache } from '../cache.js';
import type { Clock } from '../clock.js';
import type { StationConfig } from '../config.js';
import type { FetchFn } from '../http.js';
import { OJP_URL, ojpStopEventRequest, parseStopEvents } from './ojp.js';

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

/** Shorter than the default: a dead API must not hold up the whole home screen. */
const TRANSIT_TIMEOUT_MS = 5_000;
export const TRANSIT_TTL_MS = 2 * 60_000;
/** From this delay on, the departure time is shown inverted. */
export const LATE_MIN = 5;

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

export function upcoming(deps: Departure[], now: Date, n = 4): Departure[] {
  return deps
    .filter((d) => d.planned.getTime() + d.delayMin * 60_000 >= now.getTime())
    .sort((a, b) => a.planned.getTime() - b.planned.getTime())
    .slice(0, n);
}

export class TransitSource {
  private readonly entries: { station: StationConfig; cache: TtlCache<{ name: string | null; departures: Departure[] }> }[];

  /** Departures come from the official opentransportdata.swiss OJP API, which needs an API key. */
  constructor(stations: StationConfig[], fetchFn: FetchFn, clock: Clock, apiKey: string) {
    const load = async (station: StationConfig) => {
      const res = await fetchFn(OJP_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/xml' },
        body: ojpStopEventRequest(station.id, clock()),
        signal: AbortSignal.timeout(TRANSIT_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`OJP HTTP ${res.status}`);
      return parseStopEvents(await res.text(), station);
    };
    this.entries = stations.map((station) => ({
      station,
      cache: new TtlCache(TRANSIT_TTL_MS, () => load(station), clock, `transit:${station.name}`),
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
