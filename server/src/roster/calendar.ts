import { addDays, startOfDay } from '../format.js';
import type { CalendarEvent } from '../sources/calendar.js';
import type { RosterDay } from './parse.js';
import { SHIFT_LABEL, shiftOn } from './shift.js';

export interface RosterDays {
  day(date: Date): RosterDay | null;
}

export interface EventSource {
  events(from: Date, to: Date, force?: boolean): Promise<CalendarEvent[] | null>;
}

/** Duties overlapping [from, to) as calendar events «Arbeit» / «Schule»; a night duty of the day before counts. */
export function rosterEvents(roster: RosterDays, badge: string, from: Date, to: Date): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (let date = addDays(startOfDay(from), -1); date < to; date = addDays(date, 1)) {
    const day = roster.day(date);
    const shift = day ? shiftOn(day, date) : null;
    if (shift && shift.end > from && shift.start < to) out.push({ calendar: badge, title: SHIFT_LABEL[shift.kind], start: shift.start, end: shift.end, allDay: false });
  }
  return out;
}

/** The calendar with the duties in it, so «Heute», «Woche» and the night screen show them like any event. */
export function withRoster(source: EventSource, roster: RosterDays, badge: string): EventSource {
  return {
    events: async (from, to, force) => {
      const events = await source.events(from, to, force);
      if (events === null) return null;
      return [...events, ...rosterEvents(roster, badge, from, to)].sort((a, b) => a.start.getTime() - b.start.getTime());
    },
  };
}
