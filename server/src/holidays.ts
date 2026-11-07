import { isoDate } from './format.js';

/** The holidays greeted on Heute and the night screen, like a birthday. Deliberately only the main ones. */
export interface Holiday {
  text: string;
  icon: 'party' | 'egg' | 'swiss' | 'tree';
}

export const HOLIDAYS = {
  neujahr: { text: 'Frohes neues Jahr!', icon: 'party' },
  ostern: { text: 'Frohe Ostern!', icon: 'egg' },
  august: { text: 'Schönen 1. August!', icon: 'swiss' },
  weihnachten: { text: 'Frohe Weihnachten!', icon: 'tree' },
} as const satisfies Record<string, Holiday>;

export type HolidayId = keyof typeof HOLIDAYS;

/** Easter Sunday (Gregorian, anonymous algorithm) as «MM-DD». */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The day after a «MM-DD» date in the given year, as «MM-DD». */
function nextDay(year: number, md: string): string {
  const d = new Date(Date.UTC(year, Number(md.slice(0, 2)) - 1, Number(md.slice(3)) + 1));
  return d.toISOString().slice(5, 10);
}

/** The holiday on the local (Zurich) date of `day`, or null. */
export function holidayOn(day: Date): Holiday | null {
  const iso = isoDate(day);
  const year = Number(iso.slice(0, 4));
  const md = iso.slice(5);
  if (md === '01-01') return HOLIDAYS.neujahr;
  const easter = easterSunday(year);
  if (md === easter || md === nextDay(year, easter)) return HOLIDAYS.ostern;
  if (md === '08-01') return HOLIDAYS.august;
  if (md === '12-24' || md === '12-25' || md === '12-26') return HOLIDAYS.weihnachten;
  return null;
}
