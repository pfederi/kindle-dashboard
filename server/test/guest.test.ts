import { describe, expect, it } from 'vitest';
import { guestActive, hideEntries, isVisit, toggleGuest } from '../src/guest.js';
import type { CalendarEvent, DayEntry } from '../src/sources/calendar.js';

const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00+01:00`);
const ev = (title: string, start: string, end: string, allDay = false): CalendarEvent => ({ calendar: 'FAM', title, start: at(start), end: at(end), allDay });

describe('isVisit', () => {
  it('matches titles starting with «Besuch», ignoring case and leading spaces', () => {
    expect(isVisit('Besuch Müllers')).toBe(true);
    expect(isVisit('  besuch')).toBe(true);
    expect(isVisit('BESUCH: Oma')).toBe(true);
    expect(isVisit('Arzt, danach Besuch')).toBe(false);
    expect(isVisit('Besuchstag')).toBe(true);
  });
});

describe('guestActive', () => {
  const visit = ev('Besuch Müllers', '18:00', '23:00');
  it('is on while a visit runs, off before and after', () => {
    expect(guestActive([visit], at('17:59'), null)).toBe(false);
    expect(guestActive([visit], at('18:00'), null)).toBe(true);
    expect(guestActive([visit], at('23:00'), null)).toBe(false);
  });
  it('ignores other running events', () => {
    expect(guestActive([ev('Abendessen', '18:00', '22:00')], at('19:00'), null)).toBe(false);
  });
  it('follows an override until it expires', () => {
    expect(guestActive([], at('19:00'), { on: true, until: at('22:00').getTime() })).toBe(true);
    expect(guestActive([], at('22:00'), { on: true, until: at('22:00').getTime() })).toBe(false);
    expect(guestActive([], at('19:00'), { on: true, until: null })).toBe(true);
    expect(guestActive([visit], at('19:00'), { on: false, until: at('23:00').getTime() })).toBe(false);
  });
});

describe('toggleGuest', () => {
  it('turns on until the latest running timed event ends', () => {
    const events = [ev('Abendessen', '18:00', '22:00'), ev('Film', '19:30', '22:30'), ev('Ferien', '00:00', '23:59', true)];
    expect(toggleGuest(events, at('20:00'), null)).toEqual({ on: true, until: at('22:30').getTime() });
  });
  it('turns on until the next press when no timed event runs', () => {
    expect(toggleGuest([ev('Ferien', '00:00', '23:59', true), ev('Später', '21:00', '22:00')], at('20:00'), null)).toEqual({ on: true, until: null });
  });
  it('turns a manual mode off again', () => {
    expect(toggleGuest([], at('20:00'), { on: true, until: null })).toBeNull();
  });
  it('turns off during a visit until the visit ends, and back on', () => {
    const events = [ev('Besuch Oma', '14:00', '18:00'), ev('Besuch Opa', '15:00', '19:00')];
    const off = toggleGuest(events, at('16:00'), null);
    expect(off).toEqual({ on: false, until: at('19:00').getTime() });
    expect(toggleGuest(events, at('16:30'), off)).toBeNull();
  });
  it('ignores an expired override', () => {
    expect(toggleGuest([], at('20:00'), { on: true, until: at('19:00').getTime() })).toEqual({ on: true, until: null });
  });
});

describe('hideEntries', () => {
  const entry = (title: string, extra: Partial<DayEntry> = {}): DayEntry => ({ calendar: 'PF', title, label: '18:00', allDay: false, past: false, sortTime: 0, ...extra });
  it('hides every title except visits and collections, and drops the text', () => {
    const out = hideEntries([entry('Arzt'), entry('Besuch Müllers'), entry('Papier', { waste: 'paper', calendar: '' })]);
    expect(out[0]).toMatchObject({ hidden: true, title: '', label: '18:00', calendar: 'PF' });
    expect(out[1]).toMatchObject({ title: 'Besuch Müllers' });
    expect(out[1]!.hidden).toBeUndefined();
    expect(out[2]).toMatchObject({ title: 'Papier' });
    expect(out[2]!.hidden).toBeUndefined();
  });
});
