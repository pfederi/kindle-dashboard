import type { PdfPage, PdfWord } from './pdf.js';

export type RosterDay = { kind: 'work' | 'school'; start: string; end: string } | { kind: 'free' };

/** One person's month; days by day of the month (1 = the first). */
export interface Roster {
  /** «2026-11». */
  month: string;
  days: Record<number, RosterDay>;
}

/** The plan cannot be read; the message is shown to the sender as is. */
export class RosterError extends Error {}

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** Codes for a day without duty: free, ill, holiday, vacation, accident, not worked. */
const FREE = new Set(['X', 'K', 'FT', 'FE', 'U', 'NG']);
/** Light blue cells are school days. */
export const SCHOOL_COLOR = '#00b0f0';
/** School hours, for plans whose cells carry no colour. */
const SCHOOL_HOURS = { start: '07:30', end: '16:25' };
const PLAIN = new Set(['#ffffff', '#000000']);

/** «2026-11» → «November 2026». */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${year}`;
}

const sameLine = (a: PdfWord, b: PdfWord) => Math.abs(a.y - b.y) < 1;
const isTime = (s: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s);

function monthOf(words: PdfWord[]): { year: number; month: number } {
  for (const w of words) {
    const m = MONTHS.findIndex((name) => name.toLowerCase() === w.text.toLowerCase());
    if (m < 0) continue;
    // The year may come as single digits: «2 0 2 6».
    const digits = words.filter((o) => sameLine(o, w) && o.x > w.x && /^\d+$/.test(o.text)).sort((a, b) => a.x - b.x).map((o) => o.text).join('');
    const year = /^20\d\d/.exec(digits);
    if (year) return { year: Number(year[0]), month: m + 1 };
  }
  throw new RosterError('Monat und Jahr nicht gefunden');
}

/** The header row «1. 2. … n.»: the centre x of each day. */
function columns(words: PdfWord[], days: number, label: string): number[] {
  const numbered = words.filter((w) => /^\d{1,2}\.$/.test(w.text));
  for (const first of numbered.filter((w) => w.text === '1.')) {
    const row = numbered.filter((w) => sameLine(w, first)).sort((a, b) => a.x - b.x);
    if (row.length >= 28 && row.every((w, i) => w.text === `${i + 1}.`)) {
      if (row.length !== days) throw new RosterError(`${row.length} Tage im Plan, ${label} hat ${days}`);
      return row.map((w) => w.x + w.w / 2);
    }
  }
  throw new RosterError('Tageszeile «1. 2. 3. …» nicht gefunden');
}

/**
 * One person's duties from the positions on the page: the day columns come from the header row, the
 * person's band reaches from just above their name to the «Überstunden» row below it. Two times in a
 * cell are a duty, a code or nothing a day off; anything else stops the import.
 */
export function parseRoster(page: PdfPage, name: string): Roster {
  const { words, rects } = page;
  const { year, month } = monthOf(words);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const label = `${MONTHS[month - 1]} ${year}`;
  const centres = columns(words, days, label);
  const width = (centres.at(-1)! - centres[0]!) / (centres.length - 1);

  const person = words.find((w) => w.text.toLowerCase() === name.trim().toLowerCase() && w.x + w.w < centres[0]! - width / 2);
  if (!person) throw new RosterError(`Name «${name}» nicht gefunden`);
  // The start times sit a little higher than the name.
  const top = person.y + width / 3;
  const below = words.filter((w) => w.text.startsWith('Überstunden') && w.y < person.y).sort((a, b) => b.y - a.y)[0];
  const bottom = below ? below.y + 2 : person.y - 2 * width;

  const cells: PdfWord[][] = centres.map(() => []);
  for (const w of words) {
    if (w === person || w.y > top || w.y <= bottom) continue;
    const centre = w.x + w.w / 2;
    const i = Math.round((centre - centres[0]!) / width);
    if (i >= 0 && i < days && Math.abs(centre - centres[i]!) <= width / 2) cells[i]!.push(w);
  }

  const coloured = rects.filter((r) => !PLAIN.has(r.color) && r.y1 > bottom && r.y0 < top);
  const out: Record<number, RosterDay> = {};
  let duties = 0;
  cells.forEach((cell, i) => {
    const day = i + 1;
    const tokens = cell.sort((a, b) => b.y - a.y);
    const texts = tokens.map((t) => t.text);
    if (texts.length === 0 || (texts.length === 1 && FREE.has(texts[0]!.toUpperCase()))) {
      out[day] = { kind: 'free' };
      return;
    }
    if (texts.length !== 2 || !texts.every(isTime)) throw new RosterError(`${day}. ${label} nicht lesbar: «${texts.join(' ')}»`);
    const [start, end] = texts.map((t) => t.padStart(5, '0')) as [string, string];
    const x = centres[i]!;
    const y = (tokens[0]!.y + tokens[1]!.y) / 2;
    const school =
      coloured.length > 0
        ? coloured.some((r) => r.color === SCHOOL_COLOR && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)
        : start === SCHOOL_HOURS.start && end === SCHOOL_HOURS.end;
    out[day] = { kind: school ? 'school' : 'work', start, end };
    duties++;
  });
  if (duties === 0) throw new RosterError(`Keine Dienste für «${name}» im ${label}`);
  return { month: `${year}-${String(month).padStart(2, '0')}`, days: out };
}
