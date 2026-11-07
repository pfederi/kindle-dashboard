import type { QuietHours } from './config.js';
import type { GuestOverride } from './guest.js';
import type { Zone } from './zones.js';

export type ViewName = 'heute' | 'woche' | 'einkauf' | 'hinzufuegen' | 'station' | 'wetter' | 'arbeitsweg';
/** Views with a tab; the others are overlays with a close button. */
export type MainView = Exclude<ViewName, 'hinzufuegen' | 'station' | 'wetter' | 'arbeitsweg'>;
const OVERLAYS: ViewName[] = ['hinzufuegen', 'station', 'wetter', 'arbeitsweg'];

/** Which list «Hinzufügen» writes to. */
export type AddMode = 'einkauf' | 'aufgabe';

export type Action =
  | { type: 'nav'; view: ViewName; mode?: AddMode }
  | { type: 'refresh' }
  | { type: 'key'; key: string }
  | { type: 'add'; name: string }
  | { type: 'add-input' }
  | { type: 'done'; key: string }
  | { type: 'undo' }
  | { type: 'station'; index: number }
  | { type: 'commute'; index: number }
  | { type: 'guest' }
  | { type: 'day' }
  | { type: 'task'; key: string }
  | { type: 'urgent'; key: string }
  | { type: 'urgent-added' }
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'tab'; mode: AddMode }
  | { type: 'close' };

/** Feedback banner of the current view; `ok` draws it black, otherwise outlined. */
export interface Notice {
  text: string;
  ok: boolean;
}

/** The item last ticked off in Einkauf, kept for «Rückgängig». */
export interface DoneItem {
  key: string;
  name: string;
  spec: string;
}

export const MAX_INPUT = 40;
export const KEYS: string[] = [...'abcdefghijklmnopqrstuvwxyzäöü', 'space', 'backspace'];
const VIEWS: ViewName[] = ['heute', 'woche', 'einkauf', 'hinzufuegen'];

export function parseAction(s: string): Action | null {
  if (s === 'refresh') return { type: 'refresh' };
  if (s === 'close') return { type: 'close' };
  if (s === 'undo') return { type: 'undo' };
  if (s === 'guest') return { type: 'guest' };
  if (s === 'day') return { type: 'day' };
  if (s === 'urgent-added') return { type: 'urgent-added' };
  if (s === 'page:next') return { type: 'page', delta: 1 };
  if (s === 'page:prev') return { type: 'page', delta: -1 };
  if (s === 'nav:aufgabe') return { type: 'nav', view: 'hinzufuegen', mode: 'aufgabe' };
  if (s === 'weather') return { type: 'nav', view: 'wetter' };
  const i = s.indexOf(':');
  if (i < 0) return null;
  const kind = s.slice(0, i);
  const arg = s.slice(i + 1);
  if (kind === 'nav') return (VIEWS as string[]).includes(arg) ? { type: 'nav', view: arg as ViewName } : null;
  if (kind === 'key') return KEYS.includes(arg) ? { type: 'key', key: arg } : null;
  if (kind === 'add') {
    if (arg === 'input') return { type: 'add-input' };
    return arg.trim() ? { type: 'add', name: arg } : null;
  }
  if (kind === 'done') return arg ? { type: 'done', key: arg } : null;
  if (kind === 'task') return arg ? { type: 'task', key: arg } : null;
  if (kind === 'urgent') return arg ? { type: 'urgent', key: arg } : null;
  if (kind === 'tab') return arg === 'einkauf' || arg === 'aufgabe' ? { type: 'tab', mode: arg } : null;
  if (kind === 'station') return /^\d{1,2}$/.test(arg) ? { type: 'station', index: Number(arg) } : null;
  if (kind === 'commute') return /^\d$/.test(arg) ? { type: 'commute', index: Number(arg) } : null;
  return null;
}

export interface DeviceState {
  view: ViewName;
  returnView: MainView;
  input: string;
  status: Notice | null;
  /** Last item ticked off in Einkauf (for «Rückgängig»); cleared when the view changes. */
  done: DoneItem | null;
  /** Lower-case names added during this Hinzufügen visit; their tiles show a check mark. */
  added: string[];
  /** «Oft gekauft» tiles, frozen for this Hinzufügen visit so they do not move under the finger. */
  tiles: string[] | null;
  /** Index of the station shown in the station view. */
  station: number;
  /** Destination shown in «Arbeitsweg» (0 work, 1 school). */
  commute: number;
  /** Tab of «Hinzufügen». */
  addMode: AddMode;
  /** Page of «Einkauf», from 0; back to 0 whenever «Einkauf» is opened. */
  einkaufPage: number;
  /** The item just added in «Hinzufügen», offered as «Dringend» in the notice until the next key or view. */
  urgentOffer: { key: string; name: string } | null;
  /** Guest mode set by long press; null = follow the visits in the calendar. */
  guest: GuestOverride | null;
  /** «Tag starten» on the night screen: day mode until this epoch ms (the end of that night's quiet hours). */
  dayUntil: number | null;
  lastInteraction: number;
  zones: Zone[];
  lastFullRefresh: number;
  fullRefreshPending: boolean;
}

export function initialState(now: number): DeviceState {
  return {
    view: 'heute',
    returnView: 'heute',
    input: '',
    status: null,
    done: null,
    added: [],
    tiles: null,
    station: 0,
    commute: 0,
    addMode: 'einkauf',
    einkaufPage: 0,
    urgentOffer: null,
    guest: null,
    dayUntil: null,
    lastInteraction: now,
    zones: [],
    lastFullRefresh: now,
    fullRefreshPending: false,
  };
}

export function navigate(s: DeviceState, view: ViewName, mode?: AddMode): DeviceState {
  const changed = view !== s.view;
  const entering = changed && OVERLAYS.includes(view);
  const leaving = changed && OVERLAYS.includes(s.view);
  return {
    ...s,
    view,
    // From one overlay to another (not offered today) the original tab is kept.
    returnView: entering && !OVERLAYS.includes(s.view) ? (s.view as MainView) : s.returnView,
    input: view === 'hinzufuegen' && changed ? '' : s.input,
    status: changed ? null : s.status,
    done: changed ? null : s.done,
    added: changed ? [] : s.added,
    tiles: changed ? null : s.tiles,
    addMode: view === 'hinzufuegen' && changed ? (mode ?? 'einkauf') : s.addMode,
    urgentOffer: changed ? null : s.urgentOffer,
    einkaufPage: view === 'einkauf' && changed ? 0 : s.einkaufPage,
    fullRefreshPending: s.fullRefreshPending || entering || leaving,
  };
}

export function applyKey(input: string, key: string): string {
  if (key === 'backspace') return input.slice(0, -1);
  const atWordStart = input === '' || input.endsWith(' ');
  if (key === 'space') return atWordStart || input.length >= MAX_INPUT ? input : `${input} `;
  if (input.length >= MAX_INPUT) return input;
  return input + (atWordStart ? key.toUpperCase() : key.toLowerCase());
}

export function maybeReset(s: DeviceState, now: number, resetMs: number): DeviceState {
  if (s.view === 'heute' || now - s.lastInteraction < resetMs) return s;
  return { ...navigate(s, 'heute'), input: '', returnView: 'heute' };
}

const HOUR_MS = 3_600_000;

export function takeFullRefresh(s: DeviceState, now: number): { state: DeviceState; full: boolean } {
  const full = s.fullRefreshPending || now - s.lastFullRefresh >= HOUR_MS;
  if (!full) return { state: s, full };
  return { state: { ...s, lastFullRefresh: now, fullRefreshPending: false }, full };
}

/** Whether now lies in the quiet hours (which may cross midnight). */
export function isQuiet(now: Date, quiet: QuietHours | null): boolean {
  if (!quiet) return false;
  const minute = now.getHours() * 60 + now.getMinutes();
  return quiet.start < quiet.end ? minute >= quiet.start && minute < quiet.end : minute >= quiet.start || minute < quiet.end;
}

/** The next end of the quiet hours after `now`. */
export function quietEnd(now: Date, quiet: QuietHours): Date {
  const end = new Date(now);
  end.setHours(Math.floor(quiet.end / 60), quiet.end % 60, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}

export function refreshSeconds(now: Date, base: number, quiet: QuietHours | null): number {
  if (!quiet || !isQuiet(now, quiet)) return base;
  return Math.round((quietEnd(now, quiet).getTime() - now.getTime()) / 1000);
}
