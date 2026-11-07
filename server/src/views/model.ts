import type { DayEntry } from '../sources/calendar.js';
import type { ShoppingData } from '../sources/bring/source.js';
import type { Holiday } from '../holidays.js';
import type { Commute } from '../sources/commute.js';
import type { Departure } from '../sources/transit.js';
import type { DailyWeather, Weather } from '../sources/weather.js';
import type { AddMode, Notice } from '../state.js';

/** An open household task (Bring! list «Aufgaben»). */
export interface TaskItem {
  key: string;
  name: string;
}

export interface BoardModel {
  name: string;
  lines: string[];
  departures: Departure[] | null;
  /** Minutes on foot to the stop; 0 = no reachability hints. */
  walk?: number;
}

export interface HeuteModel {
  now: Date;
  weather: Weather | null;
  /** Zürichsee surface temperature in °C; null or absent when unavailable. */
  lakeTemp?: number | null;
  /** Today's entries; in the evening only those still to come. */
  events: DayEntry[] | null;
  /** From 19:00: Heute switches to tonight + tomorrow and tomorrow's weather. */
  evening?: boolean;
  /** Tomorrow's entries, set in the evening. */
  tomorrow?: DayEntry[] | null;
  /** Guest mode: titles are hidden; shown with a lock. */
  guest?: boolean;
  /** Names of those whose birthday is today; greeted above the events. */
  birthdays?: string[];
  /** Today's holiday, greeted like a birthday (a birthday comes first). */
  holiday?: Holiday | null;
  /** Battery level in percent when low (not charging); shown in the header. */
  battery?: number | null;
  /** In guest mode with a guest WLAN: a greeting and the WLAN QR code instead of the events. */
  welcome?: { guests: string[]; wifi: string };
  /** Scooter travel time above the departures; travel null = no data; absent = not configured. */
  commute?: { label: string; travel: Commute | null };
  /** Open tasks, newest first; null = list unavailable; absent = no task list configured. */
  tasks?: TaskItem[] | null;
  boards: BoardModel[];
  shopping: ShoppingData;
}

export interface WetterModel {
  now: Date;
  weather: Weather | null;
  /** Zürichsee surface temperature in °C */
  lakeTemp: number | null;
}

export interface StationModel {
  name: string;
  now?: Date;
  /** Minutes on foot to the stop; 0 = no reachability hints. */
  walk?: number;
  /** Towards town (via stop); null = no data. */
  inbound: Departure[] | null;
  outbound: Departure[] | null;
  /** Most frequent outbound terminus, e.g. «Seebach». */
  outboundTo: string | null;
}

export interface WocheModel {
  now: Date;
  days: { date: Date; entries: DayEntry[]; weather?: DailyWeather | null }[] | null;
  /** Guest mode: titles are hidden; shown with a lock. */
  guest?: boolean;
}

export interface EinkaufModel {
  shopping: ShoppingData;
  status?: Notice | null;
  /** Show «Rückgängig» for the item just ticked off. */
  undo?: boolean;
  /** Page to show, from 0 (the dashboard keeps it within the list). */
  page?: number;
}

export interface HinzufuegenModel {
  input: string;
  suggestions: string[];
  frequent: string[];
  /** Lower-case names added during this visit; their tiles are shown checked. */
  added?: string[];
  status: Notice | null;
  /** Which list the entry goes to; default einkauf. */
  mode?: AddMode;
  /** Show «Einkauf | Aufgabe» instead of the title (a task list is configured). */
  tabs?: boolean;
  /** The list cannot be written (e.g. «Liste «Aufgaben» nicht gefunden»): shown instead of the tiles. */
  unavailable?: string;
  /** Offer «Dringend» for the item just added, in the notice. */
  urgentOffer?: boolean;
}
