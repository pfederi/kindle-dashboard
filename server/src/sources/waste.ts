import { addDays, isoDate } from '../format.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';
import type { DayEntry } from './calendar.js';

/** Collections shown on the dashboard; OpenERZ knows more (waste, organic, …). */
export const WASTE_TYPES = ['paper', 'cardboard'] as const;
export type WasteType = (typeof WASTE_TYPES)[number];

export const WASTE_TITLES: Record<WasteType, string> = { paper: 'Papier', cardboard: 'Karton' };

export interface Pickup {
  /** YYYY-MM-DD in Zurich */
  date: string;
  type: WasteType;
}

/** OpenERZ (Entsorgung + Recycling Zürich open data); repeated `types` select several kinds. */
export function wasteUrl(zip: string, from: Date, to: Date): string {
  const types = WASTE_TYPES.map((t) => `types=${t}`).join('&');
  return `https://openerz.metaodi.ch/api/calendar.json?zip=${encodeURIComponent(zip)}&${types}&start=${isoDate(from)}&end=${isoDate(to)}`;
}

export function parseWaste(json: unknown): Pickup[] {
  const rows = (json as { result?: unknown } | null)?.result;
  if (!Array.isArray(rows)) throw new Error('openerz: unexpected response');
  const out: Pickup[] = [];
  for (const r of rows as { date?: unknown; waste_type?: unknown }[]) {
    const type = r?.waste_type;
    if (typeof r?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    if (!(WASTE_TYPES as readonly unknown[]).includes(type)) continue;
    out.push({ date: r.date, type: type as WasteType });
  }
  return out;
}

/** Pickups from `from` for three weeks, enough for the current week view and tomorrow. */
export async function fetchWaste(fetchFn: FetchFn, zip: string, from: Date): Promise<Pickup[]> {
  const res = await fetchFn(wasteUrl(zip, from, addDays(from, 21)), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`openerz HTTP ${res.status}`);
  return parseWaste(await res.json());
}

/** All-day entries for the pickups on `day`; `label` replaces «ganzt.», e.g. «morgen». */
export function pickupEntries(pickups: Pickup[], day: Date, label = 'ganzt.'): DayEntry[] {
  const date = isoDate(day);
  return pickups
    .filter((p) => p.date === date)
    .map((p) => ({ calendar: '', title: WASTE_TITLES[p.type], label, allDay: true, past: false, sortTime: day.getTime(), waste: p.type }));
}
