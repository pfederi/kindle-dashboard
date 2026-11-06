import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarSource, entriesForDay, parseIcs } from '../src/sources/calendar.js';
import { fakeFetch, testClock, textResponse } from './helpers.js';

const ics = readFileSync(new URL('./fixtures/family.ics', import.meta.url), 'utf8');
const from = new Date('2026-10-20T00:00:00+02:00');
const to = new Date('2026-11-16T00:00:00+01:00');

const VTIMEZONE = ics.slice(ics.indexOf('BEGIN:VTIMEZONE'), ics.indexOf('END:VTIMEZONE') + 'END:VTIMEZONE'.length);
const calendar = (...vevents: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', VTIMEZONE, ...vevents, 'END:VCALENDAR'].join('\r\n');
const vevent = (lines: Record<string, string>) =>
  ['BEGIN:VEVENT', ...Object.entries(lines).map(([k, v]) => `${k}:${v}`), 'END:VEVENT'].join('\r\n');
const iso = (events: { title: string; start: Date }[]) => events.map((e) => [e.title, e.start.toISOString()]);

/** Weekly Tuesday 18:00 series starting 1 Sep 2026. */
const probe = vevent({
  UID: 'probe',
  'DTSTART;TZID=Europe/Zurich': '20260901T180000',
  'DTEND;TZID=Europe/Zurich': '20260901T200000',
  RRULE: 'FREQ=WEEKLY;BYDAY=TU',
  SUMMARY: 'Probe',
});
const week = [new Date('2026-11-03T00:00:00+01:00'), new Date('2026-11-10T00:00:00+01:00')] as const;

describe('parseIcs', () => {
  const events = parseIcs(ics, 'FAM', from, to);

  it('expands recurrences across DST, applies EXDATE and moved instances, drops cancelled', () => {
    const volley = events.filter((e) => e.title.startsWith('Volleyball')).map((e) => [e.title, e.start.toISOString()]);
    expect(volley).toEqual([
      ['Volleyball', '2026-10-21T17:00:00.000Z'],
      ['Volleyball', '2026-10-28T18:00:00.000Z'],
      ['Volleyball (verschoben)', '2026-11-04T19:00:00.000Z'],
    ]);
    expect(events.some((e) => e.title === 'Abgesagt')).toBe(false);
  });

  it('marks all-day events and keeps exclusive end dates', () => {
    const ferien = events.find((e) => e.title === 'Herbstferien');
    expect(ferien).toMatchObject({ allDay: true, calendar: 'FAM' });
    expect(ferien?.start.toISOString()).toBe('2026-11-04T23:00:00.000Z');
    expect(ferien?.end.toISOString()).toBe('2026-11-07T23:00:00.000Z');
  });

  it('keeps the rest of a series when one instance was moved past the range', () => {
    const movedOut = vevent({
      UID: 'probe',
      'RECURRENCE-ID;TZID=Europe/Zurich': '20261013T180000',
      'DTSTART;TZID=Europe/Zurich': '20261215T180000',
      'DTEND;TZID=Europe/Zurich': '20261215T200000',
      SUMMARY: 'Probe (verschoben)',
    });
    expect(iso(parseIcs(calendar(probe, movedOut), 'FAM', ...week))).toEqual([['Probe', '2026-11-03T17:00:00.000Z']]);
    const dec = parseIcs(calendar(probe, movedOut), 'FAM', new Date('2026-12-15T00:00:00+01:00'), new Date('2026-12-16T00:00:00+01:00'));
    expect(iso(dec).sort((a, b) => a[0]!.localeCompare(b[0]!))).toEqual([
      ['Probe', '2026-12-15T17:00:00.000Z'],
      ['Probe (verschoben)', '2026-12-15T17:00:00.000Z'],
    ]);
  });

  it('includes an instance moved into the range from after it, exactly once', () => {
    const movedIn = vevent({
      UID: 'probe',
      'RECURRENCE-ID;TZID=Europe/Zurich': '20261117T180000',
      'DTSTART;TZID=Europe/Zurich': '20261105T180000',
      'DTEND;TZID=Europe/Zurich': '20261105T200000',
      SUMMARY: 'Probe (vorgezogen)',
    });
    const feed = calendar(probe, movedIn);
    expect(iso(parseIcs(feed, 'FAM', ...week))).toEqual([
      ['Probe', '2026-11-03T17:00:00.000Z'],
      ['Probe (vorgezogen)', '2026-11-05T17:00:00.000Z'],
    ]);
    const all = parseIcs(feed, 'FAM', new Date('2026-11-03T00:00:00+01:00'), new Date('2026-11-24T00:00:00+01:00'));
    // 17 Nov itself is gone (moved to 5 Nov); 24 Nov starts at the exclusive range end.
    expect(iso(all).sort((a, b) => a[1]!.localeCompare(b[1]!))).toEqual([
      ['Probe', '2026-11-03T17:00:00.000Z'],
      ['Probe (vorgezogen)', '2026-11-05T17:00:00.000Z'],
      ['Probe', '2026-11-10T17:00:00.000Z'],
    ]);
  });

  it('returns orphan instances (invite to one occurrence of a foreign series) as plain events', () => {
    const orphan = (uid: string, status?: string) =>
      vevent({
        UID: uid,
        'RECURRENCE-ID;TZID=Europe/Zurich': '20261104T100000',
        'DTSTART;TZID=Europe/Zurich': '20261104T100000',
        'DTEND;TZID=Europe/Zurich': '20261104T110000',
        SUMMARY: status ? 'Abgesagte Einladung' : 'Einladung',
        ...(status ? { STATUS: status } : {}),
      });
    const feed = calendar(orphan('foreign-series'), orphan('foreign-cancelled', 'CANCELLED'));
    expect(iso(parseIcs(feed, 'FAM', ...week))).toEqual([['Einladung', '2026-11-04T09:00:00.000Z']]);
    expect(parseIcs(feed, 'FAM', new Date('2026-11-05T00:00:00+01:00'), new Date('2026-11-06T00:00:00+01:00'))).toEqual([]);
  });

  it('only returns events overlapping the range', () => {
    const narrow = parseIcs(ics, 'FAM', new Date('2026-11-03T00:00:00+01:00'), new Date('2026-11-04T00:00:00+01:00'));
    expect(narrow.map((e) => e.title).sort()).toEqual(['Nachtschicht', 'Zahnarzt Lena']);
  });
});

describe('entriesForDay', () => {
  const events = parseIcs(ics, 'FAM', from, to);

  it('labels, sorts and flags past entries for today', () => {
    const now = new Date('2026-11-03T09:30:00+01:00');
    const today = entriesForDay(events, now, now);
    expect(today.map((e) => [e.label, e.title, e.past])).toEqual([
      ['09:00', 'Zahnarzt Lena', false],
      ['22:00', 'Nachtschicht', false],
    ]);
    const later = entriesForDay(events, now, new Date('2026-11-03T10:00:00+01:00'));
    expect(later[0]?.past).toBe(true);
  });

  it('shows continuing events as "bis HH:MM" and multi-day all-day events every day', () => {
    const day = new Date('2026-11-04T12:00:00+01:00');
    expect(entriesForDay(events, day, day).map((e) => [e.label, e.title])).toEqual([
      ['bis 02:00', 'Nachtschicht'],
      ['20:00', 'Volleyball (verschoben)'],
    ]);
    for (const d of ['2026-11-05', '2026-11-06', '2026-11-07']) {
      const entries = entriesForDay(events, new Date(`${d}T12:00:00+01:00`), day);
      expect(entries[0]).toMatchObject({ label: 'ganzt.', title: 'Herbstferien', allDay: true });
    }
    expect(entriesForDay(events, new Date('2026-11-08T12:00:00+01:00'), day)).toEqual([]);
  });

  it('sorts all-day first, then time, then calendar label', () => {
    const mk = (calendar: string, title: string, start: string, end: string, allDay = false) => ({
      calendar, title, start: new Date(start), end: new Date(end), allDay,
    });
    const list = [
      mk('PF', 'B', '2026-11-03T09:00:00+01:00', '2026-11-03T10:00:00+01:00'),
      mk('AB', 'A', '2026-11-03T09:00:00+01:00', '2026-11-03T10:00:00+01:00'),
      mk('FAM', 'Ganz', '2026-11-03T00:00:00+01:00', '2026-11-04T00:00:00+01:00', true),
    ];
    const now = new Date('2026-11-03T07:00:00+01:00');
    expect(entriesForDay(list, now, now).map((e) => e.title)).toEqual(['Ganz', 'A', 'B']);
  });
});

describe('CalendarSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const clock = testClock('2026-11-03T07:40:00+01:00');
  const range = [new Date('2026-11-03T00:00:00+01:00'), new Date('2026-11-04T00:00:00+01:00')] as const;

  it('merges feeds and keeps working when one feed fails', async () => {
    const fetchFn = fakeFetch((c) => (c.url.includes('a.ics') ? textResponse(ics) : textResponse('down', 500)));
    const source = new CalendarSource(
      [{ label: 'PF', url: 'https://cal.test/a.ics' }, { label: 'AB', url: 'https://cal.test/b.ics' }],
      fetchFn,
      clock,
    );
    const events = await source.events(...range);
    expect(events?.map((e) => e.calendar)).toEqual(['PF', 'PF']);
  });

  it('rejects non-calendar responses (e.g. an HTML login page) and returns null when all feeds fail', async () => {
    const fetchFn = fakeFetch(() => textResponse('<html>Sign in</html>', 200));
    const source = new CalendarSource([{ label: 'PF', url: 'https://cal.test/a.ics' }], fetchFn, clock);
    expect(await source.events(...range)).toBeNull();
  });

  it('parses a feed once per fetch and serves Heute and Woche ranges from it', async () => {
    const parse = vi.spyOn(ICAL, 'parse');
    const fetchFn = fakeFetch(() => textResponse(ics));
    const source = new CalendarSource([{ label: 'PF', url: 'https://cal.test/a.ics' }], fetchFn, testClock('2026-11-05T07:40:00+01:00'));
    const heute = await source.events(new Date('2026-11-05T00:00:00+01:00'), new Date('2026-11-06T00:00:00+01:00'));
    const woche = await source.events(new Date('2026-11-02T00:00:00+01:00'), new Date('2026-11-09T00:00:00+01:00'));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fetchFn.calls).toHaveLength(1);
    expect(heute?.map((e) => e.title)).toEqual(['Herbstferien']);
    expect(woche?.map((e) => e.title).sort()).toEqual(['Herbstferien', 'Nachtschicht', 'Volleyball (verschoben)', 'Zahnarzt Lena']);
  });

  it('falls back to parsing on demand for a range outside the cached window', async () => {
    const parse = vi.spyOn(ICAL, 'parse');
    const source = new CalendarSource([{ label: 'PF', url: 'https://cal.test/a.ics' }], fakeFetch(() => textResponse(ics)), clock);
    const later = await source.events(new Date('2026-12-02T00:00:00+01:00'), new Date('2026-12-03T00:00:00+01:00'));
    expect(later?.map((e) => [e.title, e.start.toISOString()])).toEqual([['Volleyball', '2026-12-02T18:00:00.000Z']]);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('treats an unparseable feed like a failed fetch without logging its content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = new CalendarSource(
      [{ label: 'PF', url: 'https://cal.test/a.ics' }],
      fakeFetch(() => textResponse('BEGIN:VCALENDAR\r\nGeheim ohne Doppelpunkt\r\n')),
      clock,
    );
    expect(await source.events(...range)).toBeNull();
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['[calendar:PF] load failed: ical: parse failed']);
  });

  it('returns an empty list when no feeds are configured', async () => {
    const source = new CalendarSource([], fakeFetch(() => textResponse('')), clock);
    expect(await source.events(...range)).toEqual([]);
  });
});
