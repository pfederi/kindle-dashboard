import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Roster } from '../src/roster/parse.js';
import { leaveBy, plannedDeparture, shiftOn } from '../src/roster/shift.js';
import { RosterStore } from '../src/roster/store.js';
import { summarize } from '../src/roster/summary.js';

const d = (iso: string) => new Date(iso);
const november: Roster = {
  month: '2026-11',
  days: { 2: { kind: 'school', start: '07:30', end: '16:25' }, 11: { kind: 'free' }, 12: { kind: 'free' }, 13: { kind: 'work', start: '13:30', end: '22:30' }, 14: { kind: 'work', start: '22:00', end: '06:00' } },
};
const tmp = () => mkdtempSync(join(tmpdir(), 'roster-'));

describe('shifts', () => {
  it('turns a day into local times; a night duty ends the next morning; a day off has none', () => {
    expect(shiftOn({ kind: 'work', start: '13:30', end: '22:30' }, d('2026-11-13T09:00:00+01:00'))).toEqual({ kind: 'work', start: d('2026-11-13T13:30:00+01:00'), end: d('2026-11-13T22:30:00+01:00') });
    expect(shiftOn({ kind: 'work', start: '22:00', end: '06:00' }, d('2026-11-14T00:30:00+01:00'))?.end).toEqual(d('2026-11-15T06:00:00+01:00'));
    expect(shiftOn({ kind: 'free' }, d('2026-11-11T09:00:00+01:00'))).toBeNull();
  });

  it('leaves the buffer and the ride before the start; asks HERE about the departure to 5 minutes', () => {
    expect(leaveBy(d('2026-11-13T13:30:00+01:00'), 5, 27)).toEqual(d('2026-11-13T12:58:00+01:00'));
    expect(plannedDeparture(d('2026-11-13T13:02:00+01:00'))).toEqual(d('2026-11-13T13:00:00+01:00'));
  });
});

describe('RosterStore', () => {
  it('keeps a month across restarts, by local date, and nothing for other months', () => {
    const dir = tmp();
    new RosterStore(dir).save(november, d('2026-11-11T20:54:00+01:00'));
    const store = new RosterStore(dir);
    store.load();
    expect(store.day(d('2026-11-13T00:30:00+01:00'))).toEqual({ kind: 'work', start: '13:30', end: '22:30' });
    expect(store.day(d('2026-12-01T09:00:00+01:00'))).toBeNull();
    expect(store.list()).toEqual([{ month: '2026-11', uploadedAt: d('2026-11-11T20:54:00+01:00') }]);
    expect(readdirSync(dir)).toEqual(['roster-2026-11.json']); // no temporary file left
  });

  it('replaces a month with the next upload, and keeps other months', () => {
    const store = new RosterStore(tmp());
    store.save(november, d('2026-11-01T10:00:00+01:00'));
    store.save({ month: '2026-12', days: { 1: { kind: 'free' } } }, d('2026-11-20T10:00:00+01:00'));
    store.save({ month: '2026-11', days: { 13: { kind: 'free' } } }, d('2026-11-21T10:00:00+01:00'));
    expect(store.day(d('2026-11-13T09:00:00+01:00'))).toEqual({ kind: 'free' });
    expect(store.list().map((m) => m.month)).toEqual(['2026-11', '2026-12']);
  });

  it('says what today brings: a duty, a day off, or no plan', () => {
    const store = new RosterStore(tmp());
    store.save(november, d('2026-11-01T10:00:00+01:00'));
    expect(store.today(d('2026-11-13T07:00:00+01:00'))).toMatchObject({ kind: 'work', start: d('2026-11-13T13:30:00+01:00') });
    expect(store.today(d('2026-11-12T07:00:00+01:00'))).toBe('free');
    expect(store.today(d('2026-12-02T07:00:00+01:00'))).toBeNull();
  });

  it('knows whether its directory is a volume of its own, so a deploy keeps the plans', () => {
    const dir = tmp();
    expect(new RosterStore(dir, () => true).persistent()).toBe(true);
    expect(new RosterStore(dir).persistent()).toBe(false); // a temp dir shares the device of its parent
    expect(new RosterStore(join(dir, 'nope')).persistent()).toBe(false);
  });

  it('starts without the directory and skips unreadable files; saving there throws', () => {
    const missing = new RosterStore(join(tmp(), 'nope'));
    expect(() => missing.load()).not.toThrow();
    expect(() => missing.save(november, new Date())).toThrow();
    const dir = tmp();
    writeFileSync(join(dir, 'roster-2026-10.json'), '{kaputt');
    writeFileSync(join(dir, 'roster-2026-09.json'), JSON.stringify({ month: '2026-09' }));
    const store = new RosterStore(dir);
    store.load();
    expect(store.list()).toEqual([]);
    expect(existsSync(join(dir, 'roster-2026-10.json'))).toBe(true); // left for a look, not deleted
  });
});

describe('summarize', () => {
  it('counts the days and names the next duty', () => {
    expect(summarize(november, d('2026-11-11T20:00:00+01:00'))).toBe('November 2026: 2× Arbeit, 1× Schule, 2× frei. Nächster Dienst: Fr 13.11. Arbeit 13:30–22:30');
  });

  it('leaves the next duty out when the month is over', () => {
    expect(summarize(november, d('2026-11-30T20:00:00+01:00'))).toBe('November 2026: 2× Arbeit, 1× Schule, 2× frei.');
  });
});
