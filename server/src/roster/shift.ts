import { addDays, startOfDay } from '../format.js';
import type { RosterDay } from './parse.js';

export type ShiftKind = 'work' | 'school';

/** A duty as times; the end may be on the next day. */
export interface Shift {
  kind: ShiftKind;
  start: Date;
  end: Date;
}

/** Minutes to be there before the start. */
export type ShiftBuffers = Record<ShiftKind, number>;
export const DEFAULT_BUFFERS: ShiftBuffers = { work: 5, school: 10 };
export const SHIFT_LABEL: Record<ShiftKind, string> = { work: 'Arbeit', school: 'Schule' };

/** «13:30» on the local date of `date`. Relies on TZ=Europe/Zurich, like startOfDay. */
function at(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = startOfDay(date);
  d.setHours(h, m, 0, 0);
  return d;
}

/** The duty of the local date of `date`; null on a day off. */
export function shiftOn(day: RosterDay, date: Date): Shift | null {
  if (day.kind === 'free') return null;
  const start = at(date, day.start);
  const end = at(date, day.end);
  return { kind: day.kind, start, end: end > start ? end : addDays(end, 1) };
}

/** From this many minutes before leaving, live traffic tells the ride better than the usual traffic at that time. */
export const LIVE_BEFORE_MIN = 30;

/** When to leave home: the start less the buffer and the ride door to door, down to the minute. */
export function leaveBy(start: Date, bufferMin: number, doorToDoorMin: number): Date {
  return new Date(Math.floor((start.getTime() - (bufferMin + doorToDoorMin) * 60_000) / 60_000) * 60_000);
}

/** The departure to ask HERE about, down to 5 minutes so the cache holds while live traffic wobbles. */
export function plannedDeparture(leave: Date): Date {
  return new Date(Math.floor(leave.getTime() / 300_000) * 300_000);
}
