import ICAL from 'ical.js';
import { TtlCache } from '../cache.js';
import type { Clock } from '../clock.js';
import type { CalendarConfig } from '../config.js';
import { addDays, formatTime, startOfDay } from '../format.js';
import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';
import type { WasteType } from './waste.js';

export interface CalendarEvent {
  calendar: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalTime = InstanceType<typeof ICAL.Time>;

/** Safety cap on iterated occurrences per series (counted from DTSTART; daily for ~50 years). */
const MAX_OCCURRENCES = 20_000;

export function parseIcs(ics: string, calendar: string, from: Date, to: Date): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const exceptions = new Map<string, IcalComponent[]>();
  const masters: IcalComponent[] = [];
  for (const vevent of root.getAllSubcomponents('vevent')) {
    if (vevent.hasProperty('recurrence-id')) {
      const uid = String(vevent.getFirstPropertyValue('uid'));
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), vevent]);
    } else {
      masters.push(vevent);
    }
  }

  const out: CalendarEvent[] = [];
  const push = (component: IcalComponent, summary: string, start: IcalTime, end: IcalTime): void => {
    if (String(component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const s = start.toJSDate();
    const e = end.toJSDate();
    if (e > from && s < to) out.push({ calendar, title: summary || '(ohne Titel)', start: s, end: e, allDay: start.isDate });
  };
  const pushStandalone = (component: IcalComponent): void => {
    const event = new ICAL.Event(component);
    push(component, event.summary, event.startDate, event.endDate);
  };

  const masterUids = new Set<string>();
  for (const vevent of masters) {
    const event = new ICAL.Event(vevent);
    masterUids.add(event.uid);
    const own = exceptions.get(event.uid) ?? [];
    for (const ex of own) event.relateException(ex);
    if (!event.isRecurring()) {
      push(event.component, event.summary, event.startDate, event.endDate);
      continue;
    }
    // Stop on the *original* occurrence time: a moved instance must not end the series early.
    const it = event.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      if (next.toJSDate() >= to) break;
      const occ = event.getOccurrenceDetails(next);
      push(occ.item.component, occ.item.summary, occ.startDate, occ.endDate);
    }
    // Instances originally due at/after `to` were not iterated; they count if moved into the range.
    for (const ex of own) {
      const rid = ex.getFirstPropertyValue('recurrence-id') as IcalTime | null;
      if (rid && rid.toJSDate() >= to) pushStandalone(ex);
    }
  }

  // Orphans: single instances of a series whose master is not in this feed (e.g. an invite).
  for (const [uid, list] of exceptions) {
    if (!masterUids.has(uid)) for (const ex of list) pushStandalone(ex);
  }
  return out;
}

export interface DayEntry {
  calendar: string;
  title: string;
  /** «HH:MM», «bis HH:MM» or «ganzt.» */
  label: string;
  allDay: boolean;
  past: boolean;
  sortTime: number;
  /** Set for a waste collection: shown with its icon instead of a calendar label. */
  waste?: WasteType;
  /** Guest mode: the title is withheld and drawn as a black bar. */
  hidden?: boolean;
}

export function entriesForDay(events: CalendarEvent[], day: Date, now: Date): DayEntry[] {
  const d0 = startOfDay(day);
  const d1 = addDays(d0, 1);
  return events
    .filter((e) => e.start < d1 && e.end > d0)
    .map((e): DayEntry => {
      let label: string;
      let allDay: boolean;
      if (e.allDay) {
        label = 'ganzt.';
        allDay = true;
      } else if (e.start >= d0) {
        label = formatTime(e.start);
        allDay = false;
      } else if (e.end < d1) {
        label = `bis ${formatTime(e.end)}`;
        allDay = false;
      } else {
        label = 'ganzt.';
        allDay = true;
      }
      return {
        calendar: e.calendar,
        title: e.title,
        label,
        allDay,
        past: !e.allDay && e.end <= now,
        sortTime: Math.max(e.start.getTime(), d0.getTime()),
      };
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.sortTime - b.sortTime || a.calendar.localeCompare(b.calendar));
}

async function fetchIcs(fetchFn: FetchFn, url: string): Promise<string> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`ical HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('ical: response is not a calendar');
  return text;
}

/** Cached per feed: the expanded events of a window around the fetch time, plus the raw text. */
interface ParsedFeed {
  ics: string;
  from: Date;
  to: Date;
  events: CalendarEvent[];
}

/**
 * Days around the fetch day that are expanded once per fetch. Covers Heute and the whole Woche
 * (Monday may be 6 days back) also when the next day starts within the cache TTL.
 */
const WINDOW_BEFORE_DAYS = 7;
const WINDOW_AFTER_DAYS = 9;

export class CalendarSource {
  private readonly feeds: { label: string; cache: TtlCache<ParsedFeed> }[];

  constructor(feeds: CalendarConfig[], fetchFn: FetchFn, clock: Clock) {
    this.feeds = feeds.map((f) => ({
      label: f.label,
      cache: new TtlCache(
        10 * 60_000,
        async () => {
          const ics = await fetchIcs(fetchFn, f.url);
          const day = startOfDay(clock());
          const from = addDays(day, -WINDOW_BEFORE_DAYS);
          const to = addDays(day, WINDOW_AFTER_DAYS);
          let events: CalendarEvent[];
          try {
            events = parseIcs(ics, f.label, from, to);
          } catch {
            throw new Error('ical: parse failed');
          }
          return { ics, from, to, events };
        },
        clock,
        `calendar:${f.label}`,
      ),
    }));
  }

  /** Events of all feeds overlapping [from, to); null if every configured feed has no data. */
  async events(from: Date, to: Date, force = false): Promise<CalendarEvent[] | null> {
    const results = await Promise.all(
      this.feeds.map(async ({ label, cache }) => {
        const cached = await cache.get(force);
        if (!cached) return null;
        const feed = cached.value;
        if (from >= feed.from && to <= feed.to) return feed.events.filter((e) => e.end > from && e.start < to);
        // Outside the pre-expanded window (e.g. stale data after a long outage): expand on demand.
        try {
          return parseIcs(feed.ics, label, from, to);
        } catch {
          console.warn(`[calendar:${label}] parse failed`);
          return null;
        }
      }),
    );
    if (this.feeds.length > 0 && results.every((r) => r === null)) return null;
    return results.flatMap((r) => r ?? []);
  }
}
