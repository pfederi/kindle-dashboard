import type { CalendarEvent, DayEntry } from './sources/calendar.js';

/**
 * Guest mode set by hand (long press on the events), overriding the visits for a while.
 * `until` is an epoch ms; null = until the next long press.
 */
export interface GuestOverride {
  on: boolean;
  until: number | null;
}

/** A visit («Besuch …») turns guest mode on while it runs and stays readable itself. */
export function isVisit(title: string): boolean {
  return /^\s*besuch/i.test(title);
}

const running = (events: CalendarEvent[], now: Date) => events.filter((e) => e.start <= now && e.end > now);
const latestEnd = (events: CalendarEvent[]) => Math.max(...events.map((e) => e.end.getTime()));

function current(override: GuestOverride | null, now: Date): GuestOverride | null {
  return override && (override.until === null || now.getTime() < override.until) ? override : null;
}

export function guestActive(events: CalendarEvent[], now: Date, override: GuestOverride | null): boolean {
  const o = current(override, now);
  return o ? o.on : running(events, now).some((e) => isVisit(e.title));
}

/**
 * The override after a long press: on until the running timed events end (an all-day «Ferien»
 * would keep it on for days), else until the next press; off during a visit until the visit ends.
 */
export function toggleGuest(events: CalendarEvent[], now: Date, override: GuestOverride | null): GuestOverride | null {
  const want = !guestActive(events, now, override);
  const active = running(events, now);
  const visits = active.filter((e) => isVisit(e.title));
  if (want === visits.length > 0) return null;
  if (!want) return { on: false, until: latestEnd(visits) };
  const timed = active.filter((e) => !e.allDay);
  return { on: true, until: timed.length > 0 ? latestEnd(timed) : null };
}

/** Guest mode: titles are dropped (not merely covered), except visits and waste collections. */
export function hideEntries(entries: DayEntry[]): DayEntry[] {
  return entries.map((e) => (e.waste || isVisit(e.title) ? e : { ...e, title: '', hidden: true }));
}

/** «Besuch Müllers» → «Müllers»; also «Besuch: …», «Besuch – …», «Besuch von …». */
export function visitorName(title: string): string {
  return title
    .replace(/^\s*besuch\s*/i, '')
    .replace(/^[:\-–—]\s*/, '')
    .replace(/^(von|bei)\s+/i, '')
    .trim();
}

/** Names of the visits running now, in calendar order, without duplicates. */
export function visitorNames(events: CalendarEvent[], now: Date): string[] {
  const out: string[] = [];
  for (const e of running(events, now)) {
    const name = isVisit(e.title) ? visitorName(e.title) : '';
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
