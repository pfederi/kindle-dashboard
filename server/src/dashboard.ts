import { createHash } from 'node:crypto';
import type { Clock } from './clock.js';
import type { BirthdayConfig, GuestWifi, QuietHours } from './config.js';
import { addDays, isoDate, startOfDay } from './format.js';
import { guestActive, hideEntries, toggleGuest, visitorNames } from './guest.js';
import { type Battery, batteryLow } from './monitor.js';
import type { Renderer } from './render/renderer.js';
import { type ShoppingSource, urgentFirst } from './sources/bring/source.js';
import { type CalendarEvent, type DayEntry, entriesForDay } from './sources/calendar.js';
import { type Departure, shortStop, type StationBoard, TRANSIT_TTL_MS, upcoming } from './sources/transit.js';
import { type Pickup, pickupEntries } from './sources/waste.js';
import type { Weather } from './sources/weather.js';
import type { Commute } from './sources/commute.js';
import {
  type Action,
  applyKey,
  type DeviceState,
  initialState,
  maybeReset,
  isQuiet,
  navigate,
  type Notice,
  parseAction,
  refreshSeconds,
  takeFullRefresh,
  type ViewName,
} from './state.js';
import { einkaufHtml, pageCount } from './views/einkauf.js';
import { heuteHtml } from './views/heute.js';
import { hinzufuegenHtml } from './views/hinzufuegen.js';
import { nachtHtml } from './views/nacht.js';
import { stationHtml } from './views/station.js';
import { wetterHtml } from './views/wetter.js';
import { wifiPayload } from './views/qr.js';
import { wocheHtml } from './views/woche.js';
import { hitTest } from './zones.js';

export interface Sources {
  weather: { get(force?: boolean): Promise<Weather | null> };
  /** Zürichsee surface temperature; optional so a missing source simply hides it. */
  lake?: { get(force?: boolean): Promise<number | null> };
  /** Paper/cardboard collections; optional so a missing source simply hides them. */
  waste?: { pickups(force?: boolean): Promise<Pickup[] | null> };
  calendar: { events(from: Date, to: Date, force?: boolean): Promise<CalendarEvent[] | null> };
  transit: { boards(force?: boolean): Promise<StationBoard[]> };
  bring: ShoppingSource;
  /** Household tasks (a second Bring! list); optional so a missing list simply hides them. */
  tasks?: ShoppingSource;
  /** Scooter travel time with traffic; optional so a missing configuration hides the line. */
  commute?: { label: string; get(force?: boolean): Promise<Commute | null> };
}

export interface Screen {
  png: Buffer;
  etag: string;
  refreshSeconds: number;
  fullRefresh: boolean;
}

export interface DashboardOptions {
  sources: Sources;
  renderer: Renderer;
  clock: Clock;
  refreshSeconds: number;
  quietHours: QuietHours | null;
  viewResetSeconds: number;
  /** Greeted on Heute and the night screen on their day. */
  birthdays?: BirthdayConfig[];
  /** Guest WLAN: during a visit the events in Heute give way to a greeting and its QR code. */
  guestWifi?: GuestWifi | null;
  /** Called with the refresh interval of every screen delivered to the Kindle (not for previews). */
  onDelivered?: (refreshSeconds: number) => void;
}

/**
 * Upcoming departures of a board. An empty list from stale data (older than 2 × TTL, i.e. the
 * ÖV API has been failing) means «keine Daten», not «keine Abfahrten».
 */
function boardDepartures(board: StationBoard, now: Date, inbound: boolean, n?: number): Departure[] | null {
  if (!board.departures || !board.fetchedAt) return null;
  const next = upcoming(
    board.departures.filter((d) => d.inbound === inbound),
    now,
    n,
  );
  const stale = now.getTime() - board.fetchedAt.getTime() > 2 * TRANSIT_TTL_MS;
  return next.length === 0 && stale ? null : next;
}

/** The most frequent terminus, shortened; null without departures. */
function mainTerminus(deps: Departure[]): string | null {
  const counts = new Map<string, number>();
  for (const d of deps) counts.set(shortStop(d.to), (counts.get(shortStop(d.to)) ?? 0) + 1);
  let best: string | null = null;
  for (const [to, n] of counts) if (to && (best === null || n > (counts.get(best) ?? 0))) best = to;
  return best;
}

export const STATION_ROWS = 8;


/** Names whose birthday («MM-DD») falls on the local date of `day`. */
export function birthdaysOn(birthdays: BirthdayConfig[], day: Date): string[] {
  const md = isoDate(day).slice(5);
  return birthdays.filter((b) => b.date === md).map((b) => b.name);
}

/** Preview options: which station to show, and Heute as at 19:30 to see the evening mode by day. */
export interface PreviewOptions {
  station?: number;
  evening?: boolean;
  /** Heute as 30 minutes into the quiet hours, to see the night screen by day. */
  night?: boolean;
  /** Guest mode on, whatever the calendar and the device say. */
  guest?: boolean;
  /** The battery as at PREVIEW_BATTERY %, whatever the Kindle reports. */
  lowBattery?: boolean;
}

export const PREVIEW_BATTERY = 15;

interface RenderContext {
  now: Date;
  station: number;
  /** Previews never change the device state. */
  preview: boolean;
  guest?: boolean;
  lowBattery?: boolean;
}
/** From this hour Heute shows tonight's remaining events, tomorrow's and tomorrow's weather. */
export const EVENING_HOUR = 19;

export class Dashboard {
  private state: DeviceState;
  private battery: Battery | null = null;

  constructor(private readonly opts: DashboardOptions) {
    this.state = initialState(opts.clock().getTime());
  }

  get view(): ViewName {
    return this.state.view;
  }

  /** The battery state the Kindle sent with its last screen request. */
  reportBattery(b: Battery): void {
    this.battery = b;
  }

  /** The level to show: only when low and not charging, else null. */
  private lowBattery(ctx?: RenderContext): number | null {
    if (ctx?.lowBattery) return PREVIEW_BATTERY;
    // A preview shows what the Kindle shows.
    return batteryLow(this.battery) ? this.battery.level : null;
  }

  async screen(): Promise<Screen> {
    this.state = maybeReset(this.state, this.opts.clock().getTime(), this.opts.viewResetSeconds * 1000);
    return this.renderCurrent(false);
  }

  /** A tap, or with `hold` a long press. */
  async tap(x: number, y: number, hold = false): Promise<Screen | null> {
    if (this.state.zones.length === 0) return this.renderCurrent(false);
    const hit = hitTest(this.state.zones, x, y, hold);
    const action = hit ? parseAction(hit) : null;
    if (!action) return null;
    this.state = { ...this.state, lastInteraction: this.opts.clock().getTime() };
    const force = await this.apply(action);
    return this.renderCurrent(force);
  }

  async previewHtml(view: ViewName, opts: PreviewOptions = {}): Promise<string> {
    return this.html(view, false, this.previewContext(opts));
  }

  async previewPng(view: ViewName, opts: PreviewOptions = {}): Promise<Buffer> {
    return (await this.opts.renderer.render(await this.html(view, false, this.previewContext(opts)))).png;
  }

  private previewContext(opts: PreviewOptions): RenderContext {
    let now = this.opts.clock();
    if (opts.evening && now.getHours() < EVENING_HOUR) {
      now = new Date(now);
      now.setHours(EVENING_HOUR, 30, 0, 0);
    }
    const quiet = this.opts.quietHours;
    if (opts.night && quiet) {
      now = new Date(now);
      now.setHours(Math.floor(quiet.start / 60), (quiet.start % 60) + 30, 0, 0);
    }
    return { now, station: opts.station ?? this.state.station, preview: true, guest: opts.guest, lowBattery: opts.lowBattery };
  }

  private async apply(action: Action): Promise<boolean> {
    switch (action.type) {
      case 'nav':
        this.state = navigate(this.state, action.view, action.mode);
        return false;
      case 'close':
        this.state = navigate(this.state, this.state.returnView);
        return false;
      case 'refresh':
        // The flash of a full refresh is the feedback, even when nothing changed.
        this.state = { ...this.state, fullRefreshPending: true };
        return true;
      case 'key':
        this.state = { ...this.state, input: applyKey(this.state.input, action.key), status: null, urgentOffer: null };
        return false;
      case 'page':
        // The render keeps the page within the list.
        this.state = { ...this.state, einkaufPage: Math.max(0, this.state.einkaufPage + action.delta), status: null, done: null };
        return false;
      case 'urgent-added':
        await this.urgentAdded();
        return false;
      case 'add':
        await this.add(action.name);
        return false;
      case 'add-input':
        if (this.state.input.trim()) await this.add(this.state.input.trim());
        return false;
      case 'done':
        return this.complete(action.key);
      case 'undo':
        await this.undo();
        return false;
      case 'station':
        this.state = { ...navigate(this.state, 'station'), station: action.index };
        return false;
      case 'task': {
        const tasks = this.opts.sources.tasks;
        if (!tasks) return false;
        const r = await tasks.complete(action.key);
        // No banner in Heute: a flash says it did not work; `gone` reloads the list.
        if (r.kind === 'failed') this.state = { ...this.state, fullRefreshPending: true };
        return r.kind === 'gone';
      }
      case 'urgent': {
        const r = await this.opts.sources.bring.toggleUrgent(action.key);
        // The tile turning black is the feedback; a flash says it did not work; `gone` reloads the list.
        if (r.kind === 'failed') this.state = { ...this.state, fullRefreshPending: true };
        return r.kind === 'gone';
      }
      case 'tab':
        if (action.mode !== this.state.addMode) {
          this.state = { ...this.state, addMode: action.mode, input: '', status: null, added: [], tiles: null, urgentOffer: null };
        }
        return false;
      case 'guest': {
        const now = this.opts.clock();
        const events = await this.opts.sources.calendar.events(now, new Date(now.getTime() + 1));
        // The flash of a full refresh confirms the long press and wipes the e-ink ghosts of the titles.
        this.state = { ...this.state, guest: toggleGuest(events ?? [], now, this.state.guest), fullRefreshPending: true };
        return false;
      }
    }
  }

  /**
   * Entries as shown: in guest mode the titles are withheld. Never forces a reload: it runs next to
   * the view's own (possibly forced) calendar query and joins that load instead of starting another.
   */
  private async guestFilter(now: Date, ctx?: RenderContext): Promise<{ guest: boolean; show: (e: DayEntry[]) => DayEntry[]; visitors: string[] }> {
    const running = (await this.opts.sources.calendar.events(now, new Date(now.getTime() + 1))) ?? [];
    const guest = ctx?.guest || guestActive(running, now, this.state.guest);
    return { guest, show: guest ? hideEntries : (e) => e, visitors: visitorNames(running, now) };
  }

  /** The list «Hinzufügen» writes to. */
  private addSource(): ShoppingSource {
    const { tasks, bring } = this.opts.sources;
    return this.state.addMode === 'aufgabe' && tasks ? tasks : bring;
  }

  private async add(name: string): Promise<void> {
    const r = await this.addSource().add(name);
    const status: Notice =
      r.kind === 'added'
        ? { text: `${r.name} erfasst`, ok: true }
        : r.kind === 'duplicate'
          ? { text: r.urgent ? `${r.name} steht schon auf der Liste und ist dringend` : `${r.name} steht schon auf der Liste`, ok: false }
          : { text: `Konnte ${r.name} nicht erfassen – bitte nochmals`, ok: false };
    // The tapped tile and the catalog name both get the check mark.
    const added = r.kind === 'failed' ? this.state.added : [...this.state.added, name.toLowerCase(), r.name.toLowerCase()];
    // Also for a duplicate: on a long list it is the way to reach an item Einkauf does not show.
    const urgentOffer = r.kind !== 'failed' && r.key && !r.urgent ? { key: r.key, name: r.name } : null;
    this.state = { ...this.state, status, added, urgentOffer, input: r.kind === 'failed' ? this.state.input : '' };
  }

  /** «Dringend» in the notice: sets the item just added urgent. */
  private async urgentAdded(): Promise<void> {
    const offer = this.state.urgentOffer;
    if (!offer) return;
    const r = await this.addSource().toggleUrgent(offer.key, true);
    this.state =
      r.kind === 'failed'
        ? { ...this.state, status: { text: `Konnte ${offer.name} nicht auf dringend setzen – bitte nochmals`, ok: false } }
        : {
            ...this.state,
            urgentOffer: null,
            status: r.kind === 'done' ? { text: `${offer.name} ist dringend`, ok: true } : { text: `${offer.name} steht nicht mehr auf der Liste`, ok: false },
          };
  }

  /** Ticks an item off; returns true (force reload) when the shown list was stale. */
  private async complete(key: string): Promise<boolean> {
    const r = await this.opts.sources.bring.complete(key);
    const status: Notice =
      r.kind === 'done'
        ? { text: `${r.name} abgehakt`, ok: true }
        : r.kind === 'gone'
          ? { text: `${r.name} ist schon abgehakt`, ok: false }
          : { text: `Konnte ${r.name} nicht abhaken – bitte nochmals`, ok: false };
    this.state = { ...this.state, status, done: r.kind === 'done' ? { key: r.key, name: r.name, spec: r.spec } : null };
    return r.kind === 'gone';
  }

  private async undo(): Promise<void> {
    const d = this.state.done;
    if (!d) return;
    const ok = await this.opts.sources.bring.restore(d.key, d.spec);
    this.state = {
      ...this.state,
      done: ok ? null : d,
      status: ok
        ? { text: `${d.name} ist wieder auf der Liste`, ok: true }
        : { text: `Konnte ${d.name} nicht zurücklegen – bitte nochmals`, ok: false },
    };
  }

  private async renderCurrent(force: boolean): Promise<Screen> {
    const now = this.opts.clock();
    const html = await this.html(this.state.view, force);
    const { png, zones } = await this.opts.renderer.render(html);
    const { state, full } = takeFullRefresh({ ...this.state, zones }, now.getTime());
    this.state = state;
    let refresh = refreshSeconds(now, this.opts.refreshSeconds, this.opts.quietHours);
    // Outside Heute the next poll comes exactly when the view reset is due, even during quiet hours,
    // so the screen returns to Heute after viewResetSeconds rather than at the next regular poll.
    if (this.state.view !== 'heute') {
      const dueIn = Math.ceil((this.state.lastInteraction + this.opts.viewResetSeconds * 1000 - now.getTime()) / 1000);
      refresh = Math.min(refresh, Math.max(dueIn, 1));
    }
    this.opts.onDelivered?.(refresh);
    return {
      png,
      etag: `"${createHash('sha1').update(png).digest('hex')}"`,
      refreshSeconds: refresh,
      fullRefresh: full,
    };
  }

  /** The night screen shows the day the night leads into: tomorrow before midnight, else today. */
  private async nachtHtmlFor(now: Date, force: boolean, ctx?: RenderContext): Promise<string> {
    const { weather, waste, calendar } = this.opts.sources;
    const day = startOfDay(now.getHours() >= 12 ? addDays(now, 1) : now);
    const [w, events, pickups, { guest, show }] = await Promise.all([
      weather.get(force),
      calendar.events(day, addDays(day, 1), force),
      waste ? waste.pickups(force) : null,
      this.guestFilter(now, ctx),
    ]);
    return nachtHtml({
      now,
      day,
      weather: w,
      entries: events ? show([...pickupEntries(pickups ?? [], day), ...entriesForDay(events, day, now)]) : null,
      guest,
      birthdays: birthdaysOn(this.opts.birthdays ?? [], day),
      battery: this.lowBattery(ctx),
    });
  }

  private async html(view: ViewName, force: boolean, ctx?: RenderContext): Promise<string> {
    const now = ctx?.now ?? this.opts.clock();
    const preview = ctx?.preview ?? false;
    const { weather, lake, waste, calendar, transit, bring, tasks, commute } = this.opts.sources;
    switch (view) {
      case 'heute': {
        if (isQuiet(now, this.opts.quietHours)) return this.nachtHtmlFor(now, force, ctx);
        const day = startOfDay(now);
        const evening = now.getHours() >= EVENING_HOUR;
        const tomorrow = addDays(day, 1);
        const [w, lakeTemp, events, boards, shopping, pickups, { guest, show, visitors }, taskList, travel] = await Promise.all([
          weather.get(force),
          lake ? lake.get(force) : null,
          calendar.events(day, addDays(day, evening ? 2 : 1), force),
          transit.boards(force),
          bring.list(force),
          waste ? waste.pickups(force) : null,
          this.guestFilter(now, ctx),
          tasks ? tasks.list(force) : undefined,
          commute ? commute.get(force) : undefined,
        ]);
        // Bundles must be out by 7:00, so tomorrow's collection shows the day before.
        const collections = pickups ? [...pickupEntries(pickups, day), ...pickupEntries(pickups, tomorrow, 'morgen')] : [];
        const agenda = evening
          ? {
              evening,
              events: events ? show(entriesForDay(events, now, now).filter((e) => !e.allDay && !e.past)) : null,
              tomorrow: events ? show([...pickupEntries(pickups ?? [], tomorrow), ...entriesForDay(events, tomorrow, now)]) : null,
            }
          : { evening, events: events ? show([...collections, ...entriesForDay(events, now, now)]) : null };
        const wifi = this.opts.guestWifi;
        return heuteHtml({
          now,
          guest,
          welcome: guest && wifi ? { guests: visitors, wifi: wifiPayload(wifi) } : undefined,
          commute: commute ? { label: commute.label, travel: travel ?? null } : undefined,
          battery: this.lowBattery(ctx),
          birthdays: birthdaysOn(this.opts.birthdays ?? [], now),
          // Bring! lists items in the order they were added: «Dringend» first, then the newest, for the box.
          tasks: taskList === undefined ? undefined : taskList.ok ? urgentFirst([...taskList.items].reverse()).map(({ key, name }) => ({ key, name })) : null,
          weather: w,
          lakeTemp,
          ...agenda,
          boards: boards.map((b) => ({
            name: b.station.name,
            lines: b.station.lines,
            departures: boardDepartures(b, now, true),
            walk: b.station.walk ?? 0,
          })),
          shopping,
        });
      }
      case 'woche': {
        // Seven days from today, so on a Sunday the coming week is visible.
        const first = startOfDay(now);
        const [events, pickups, w, { guest, show }] = await Promise.all([
          calendar.events(first, addDays(first, 7), force),
          waste ? waste.pickups(force) : null,
          weather.get(force),
          this.guestFilter(now, ctx),
        ]);
        return wocheHtml({
          now,
          guest,
          days: events
            ? Array.from({ length: 7 }, (_, i) => {
                const date = addDays(first, i);
                return {
                  date,
                  entries: show([...pickupEntries(pickups ?? [], date), ...entriesForDay(events, date, now)]),
                  weather: w?.daily.find((d) => d.date === isoDate(date)) ?? null,
                };
              })
            : null,
        });
      }
      case 'einkauf': {
        const shopping = await bring.list(force);
        // Ticking off the last item of the last page steps back a page.
        const page = Math.min(this.state.einkaufPage, pageCount(shopping.ok ? shopping.items.length : 0) - 1);
        if (!preview && page !== this.state.einkaufPage) this.state = { ...this.state, einkaufPage: page };
        return einkaufHtml({ shopping, status: this.state.status, undo: this.state.done !== null, page });
      }
      case 'wetter': {
        const [w, lakeTemp] = await Promise.all([weather.get(force), lake ? lake.get(force) : null]);
        return wetterHtml({ now, weather: w, lakeTemp });
      }
      case 'station': {
        const index = ctx?.station ?? this.state.station;
        const board = (await transit.boards(force))[index];
        if (!board && preview) return stationHtml({ name: `Haltestelle ${index + 1}`, inbound: null, outbound: null, outboundTo: null });
        if (!board) {
          // The station list changed under a stale tap: fall back to the tab we came from.
          this.state = navigate(this.state, this.state.returnView);
          return this.html(this.state.view, force, ctx);
        }
        const outbound = boardDepartures(board, now, false, STATION_ROWS);
        return stationHtml({
          // The full stop name fits here, e.g. «Messe/Hallenstadion» for the «Hallenstadion» column.
          name: board.officialName ? shortStop(board.officialName) : board.station.name,
          now,
          walk: board.station.walk ?? 0,
          inbound: boardDepartures(board, now, true, STATION_ROWS),
          outbound,
          outboundTo: outbound ? mainTerminus(outbound) : null,
        });
      }
      case 'hinzufuegen': {
        const src = this.addSource();
        const [suggestions, tiles, list] = await Promise.all([
          src.suggestions(this.state.input),
          this.state.tiles ?? src.frequent(),
          // Only the task list may be missing (it is optional); the shopping list reports its own state.
          src === tasks ? src.list() : null,
        ]);
        if (!preview && view === this.state.view && this.state.tiles === null) this.state = { ...this.state, tiles };
        return hinzufuegenHtml({
          input: this.state.input,
          suggestions,
          frequent: tiles,
          added: this.state.added,
          status: this.state.status,
          mode: this.state.addMode,
          tabs: tasks !== undefined,
          unavailable: list && !list.ok ? list.message : undefined,
          urgentOffer: this.state.urgentOffer !== null && this.state.status !== null,
        });
      }
    }
  }
}
