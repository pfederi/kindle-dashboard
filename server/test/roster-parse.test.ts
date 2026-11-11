import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { monthLabel, parseRoster, type Roster, RosterError } from '../src/roster/parse.js';
import type { PdfPage, PdfWord } from '../src/roster/pdf.js';

/** The November plan's positions, names anonymised. */
const november = JSON.parse(readFileSync(new URL('./fixtures/roster-page.json', import.meta.url), 'utf8')) as PdfPage;

/** «8:w13:30-20:00», «1:-»: one token per day. */
const compact = (r: Roster) =>
  Object.entries(r.days)
    .map(([d, v]) => `${d}:${v.kind === 'free' ? '-' : `${v.kind[0]}${v.start}-${v.end}`}`)
    .join(' ');

const DELTA =
  '1:- 2:s07:30-16:25 3:s07:30-16:25 4:- 5:- 6:- 7:- 8:w13:30-20:00 9:s07:30-16:25 10:s07:30-16:25 11:- 12:- 13:w13:30-22:30 14:w13:30-22:30 ' +
  '15:w11:30-20:00 16:s07:30-16:25 17:s07:30-16:25 18:- 19:- 20:w13:30-22:30 21:w13:30-22:30 22:w11:30-20:00 23:s07:30-16:25 24:s07:30-16:25 ' +
  '25:- 26:w13:30-22:30 27:w13:30-22:30 28:w13:30-22:30 29:- 30:s07:30-16:25';

/** A plan of `days` columns with one person «Zeta»; per day the words in its cell, top to bottom. */
function plan(cells: Record<number, string[]>, opts: { month?: string; days?: number } = {}): PdfPage {
  const col = (d: number) => 60 + 24 * (d - 1);
  const words: PdfWord[] = [
    { text: opts.month ?? 'November', x: 438, y: 511, w: 50 },
    ...'2026'.split('').map((text, i) => ({ text, x: 591 + 24 * i, y: 511, w: 6 })),
    ...Array.from({ length: opts.days ?? 30 }, (_, i) => ({ text: `${i + 1}.`, x: col(i + 1) - 5, y: 440, w: 10 })),
    { text: 'Zeta', x: 3, y: 300, w: 20 },
    { text: 'Überstunden', x: 3, y: 280, w: 40 },
  ];
  for (const [day, texts] of Object.entries(cells)) texts.forEach((text, i) => words.push({ text, x: col(Number(day)) - 8, y: 302 - 10 * i, w: 16 }));
  return { words, rects: [] };
}

describe('parseRoster', () => {
  it('reads one person of the November plan: times per day, school by its blue cells, free days', () => {
    const r = parseRoster(november, 'Delta');
    expect(r.month).toBe('2026-11');
    expect(compact(r)).toBe(DELTA);
  });

  it('finds the name whatever its case, and keeps the rows of others apart', () => {
    expect(compact(parseRoster(november, 'delta'))).toBe(DELTA);
    const gamma = parseRoster(november, 'Gamma');
    expect(gamma.days[11]).toEqual({ kind: 'work', start: '06:00', end: '14:30' });
    expect(gamma.days[1]).toEqual({ kind: 'free' });
  });

  it('without colours takes 07:30–16:25 as school', () => {
    expect(compact(parseRoster({ words: november.words, rects: [] }, 'Delta'))).toBe(DELTA);
    expect(parseRoster(plan({ 1: ['7:30', '16:25'], 2: ['13:30', '22:30'] }), 'Zeta').days[1]).toEqual({ kind: 'school', start: '07:30', end: '16:25' });
  });

  it('reads codes and empty cells as free, and a night duty as start before end', () => {
    const r = parseRoster(plan({ 1: ['22:00', '06:00'], 2: ['K'], 3: ['fe'] }), 'Zeta');
    expect(r.days[1]).toEqual({ kind: 'work', start: '22:00', end: '06:00' });
    expect([r.days[2], r.days[3], r.days[4]]).toEqual([{ kind: 'free' }, { kind: 'free' }, { kind: 'free' }]);
  });

  it('refuses what it cannot read, saying why', () => {
    const fails = (page: PdfPage, name: string, message: RegExp) => {
      expect(() => parseRoster(page, name)).toThrow(RosterError);
      expect(() => parseRoster(page, name)).toThrow(message);
    };
    fails(november, 'Nobody', /Name «Nobody» nicht gefunden/);
    fails(plan({ 1: ['13:30', '22:30'] }, { month: 'Monat' }), 'Zeta', /Monat und Jahr nicht gefunden/);
    fails(plan({ 1: ['13:30', '22:30'] }, { days: 29 }), 'Zeta', /29 Tage im Plan, November 2026 hat 30/);
    fails(plan({ 1: ['13:30'] }), 'Zeta', /1\. November 2026 nicht lesbar: «13:30»/);
    fails(plan({ 1: ['13:30', 'abc'] }), 'Zeta', /«13:30 abc»/);
    fails(plan({}), 'Zeta', /Keine Dienste für «Zeta» im November 2026/);
  });

  it('names a month in German', () => {
    expect(monthLabel('2026-12')).toBe('Dezember 2026');
  });
});
