import { describe, expect, it, vi } from 'vitest';
import { rosterEvents, withRoster } from '../src/roster/calendar.js';
import type { RosterDay } from '../src/roster/parse.js';
import { isoDate } from '../src/format.js';

const d = (iso: string) => new Date(iso);
const days: Record<string, RosterDay> = {
  '2026-11-12': { kind: 'work', start: '22:00', end: '06:00' },
  '2026-11-13': { kind: 'work', start: '13:30', end: '22:30' },
  '2026-11-14': { kind: 'free' },
  '2026-11-16': { kind: 'school', start: '07:30', end: '16:25' },
};
const roster = { day: (date: Date) => days[isoDate(date)] ?? null };

describe('roster in the calendar', () => {
  it('turns duties into events with the badge, a night duty from the day before included, days off left out', () => {
    expect(rosterEvents(roster, 'JO', d('2026-11-13T00:00:00+01:00'), d('2026-11-15T00:00:00+01:00'))).toEqual([
      { calendar: 'JO', title: 'Arbeit', start: d('2026-11-12T22:00:00+01:00'), end: d('2026-11-13T06:00:00+01:00'), allDay: false },
      { calendar: 'JO', title: 'Arbeit', start: d('2026-11-13T13:30:00+01:00'), end: d('2026-11-13T22:30:00+01:00'), allDay: false },
    ]);
    expect(rosterEvents(roster, 'JO', d('2026-11-16T00:00:00+01:00'), d('2026-11-17T00:00:00+01:00')).map((e) => e.title)).toEqual(['Schule']);
  });

  it('adds them to the calendar source in time order, and passes its failure on', async () => {
    const own = { calendar: 'FAM', title: 'Zahnarzt', start: d('2026-11-13T09:00:00+01:00'), end: d('2026-11-13T10:00:00+01:00'), allDay: false };
    const source = { events: vi.fn(async () => [own]) };
    const merged = await withRoster(source, roster, 'JO').events(d('2026-11-13T08:00:00+01:00'), d('2026-11-14T00:00:00+01:00'), true);
    expect(merged?.map((e) => e.title)).toEqual(['Zahnarzt', 'Arbeit']);
    expect(source.events).toHaveBeenCalledWith(d('2026-11-13T08:00:00+01:00'), d('2026-11-14T00:00:00+01:00'), true);
    source.events.mockResolvedValueOnce(null as never);
    expect(await withRoster(source, roster, 'JO').events(d('2026-11-13T00:00:00+01:00'), d('2026-11-14T00:00:00+01:00'))).toBeNull();
  });
});
