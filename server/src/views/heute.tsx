import { render } from 'preact-render-to-string';
import { addDays, formatLongDate, formatTime, isoDate, startOfDay } from '../format.js';
import type { ShoppingData, ShoppingItem } from '../sources/bring/source.js';
import type { DayEntry } from '../sources/calendar.js';
import { describeWmo } from '../sources/wmo.js';
import { LATE_MIN, leaveAt, reachable } from '../sources/transit.js';
import { firstRainHour, type HourlyRain, nextHours, rainStartHour, type Weather } from '../sources/weather.js';
import { AddTaskButton, BatteryMark, BIRTHDAY_ROWS, BirthdayBanner, COMMUTE_ICONS, EventList, GuestMark, HolidayBanner, Icon, LineBadge, names, Tabs, TASK_ROWS, TaskBox } from './components.js';
import type { Commute } from '../sources/commute.js';
import type { BoardModel, HeuteModel } from './model.js';
import { page } from './page.js';
import { qrSvg } from './qr.js';

/** Rows that fit next to the rain strip, four departures per stop and their leave-by line (render test). */
export const MAX_EVENTS_HEUTE = 4;
export const EVENING_TONIGHT_ROWS = 3;
export const RAIN_HOURS = 12;
/** Below this probability in every hour the strip gives way to «Kein Regen bis …». */
export const RAIN_STRIP_MIN = 20;
const BAR_PX = 60;

/** One bar per hour, black from 50 %; the hour is printed under every third bar. */
function RainStrip({ hours }: { hours: HourlyRain[] }) {
  return (
    <div class="rain">
      <Icon name="umbrella" size={40} />
      <div class="hours">
        {hours.map((h, i) => (
          <div class="h">
            <div class="b">
              <div class={h.probability >= 50 ? 'bar wet' : 'bar'} style={`height:${Math.round((h.probability / 100) * BAR_PX)}px`} />
            </div>
            <div class="hr">{i % 3 === 0 ? h.time.getHours() : ''}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface WeatherView {
  big: number;
  /** Small caps label above the big number, e.g. «morgen». */
  bigLabel: string | null;
  code: number | null;
  /** Shown next to the big number; the max is left out when it is the big number. */
  max: number | null;
  min: number | null;
  rain: number | null;
  rainNow: boolean;
  hours: HourlyRain[];
}

/** From EVENING on (m.evening), the block shows tomorrow: its max, conditions and rain from 6 to 22 Uhr. */
function weatherView(weather: Weather, now: Date, evening: boolean): WeatherView {
  const tomorrow = evening ? weather.daily.find((d) => d.date === isoDate(addDays(now, 1))) : undefined;
  if (tomorrow && tomorrow.max !== null) {
    const from = addDays(startOfDay(now), 1);
    from.setHours(6);
    const to = new Date(from);
    to.setHours(22);
    return {
      big: tomorrow.max,
      bigLabel: 'morgen',
      code: tomorrow.code,
      max: null,
      min: tomorrow.min,
      rain: firstRainHour(weather, from, to),
      rainNow: false,
      hours: nextHours(weather, from, RAIN_HOURS),
    };
  }
  const rain = rainStartHour(weather, now);
  return {
    big: weather.currentTemp,
    bigLabel: null,
    code: weather.currentCode,
    max: weather.maxTemp,
    min: weather.minTemp,
    rain,
    rainNow: rain === now.getHours(),
    hours: nextHours(weather, now, RAIN_HOURS),
  };
}

/** Whether the weather block draws the rain strip; without it the agenda has room for one more row. */
function showsRainStrip(m: HeuteModel): boolean {
  return m.weather !== null && weatherView(m.weather, m.now, m.evening ?? false).hours.some((h) => h.probability >= RAIN_STRIP_MIN);
}

function WeatherBlock({ weather, lakeTemp, uetliberg, now, evening }: { weather: Weather | null; lakeTemp: number | null; uetliberg: boolean; now: Date; evening: boolean }) {
  if (!weather) return <div class="empty">Wetter: keine Daten</div>;
  const v = weatherView(weather, now, evening);
  const info = describeWmo(v.code);
  const showStrip = v.hours.some((h) => h.probability >= RAIN_STRIP_MIN);
  const dryUntil = v.hours.length > 0 && !showStrip ? (v.hours.at(-1)!.time.getHours() + 1) % 24 : null;
  const parts = [
    v.max !== null && <b>Max {Math.round(v.max)}°</b>,
    v.min !== null && <b>Min {Math.round(v.min)}°</b>,
    lakeTemp !== null && (
      <span>
        <Icon name="waves" size={44} /> See {Math.round(lakeTemp)}°
      </span>
    ),
  ].filter((p) => p !== false);
  const temps = parts.flatMap((p, i) => (i === 0 ? [p] : [' · ', p]));
  return (
    <div class="wxblock" data-action="weather">
      <div class="wx">
        <div class="tempbox">
          {v.bigLabel && <div class="tlabel">{v.bigLabel}</div>}
          <div class="temp serif">{Math.round(v.big)}°</div>
        </div>
        <div class="desc">
          <div>
            <Icon name={info.icon} size={44} /> {info.text}
          </div>
          {temps.length > 0 && <div>{temps}</div>}
          {v.rain !== null && (
            <div>
              <Icon name="umbrella" size={44} /> <b>Schirm mitnehmen</b>
              {' · '}
              {v.rainNow ? 'Regen ab jetzt' : `ab ${v.rain} Uhr Regen`}
            </div>
          )}
          {/* The third line: rain first, then the sun above the fog, else how long it stays dry. */}
          {v.rain === null && uetliberg && (
            <div>
              <Icon name="sun" size={44} /> <b>Uetliberg sonnig</b> · über dem Nebel
            </div>
          )}
          {v.rain === null && !uetliberg && dryUntil !== null && <div>Kein Regen bis {dryUntil} Uhr</div>}
        </div>
      </div>
      {showStrip && <RainStrip hours={v.hours} />}
    </div>
  );
}

/** Departures out of reach on foot are grey; the header says when to leave for the next one. */
function Board({ board, index, now }: { board: BoardModel; index: number; now: Date }) {
  const mixed = board.lines.length > 1;
  const walk = board.walk ?? 0;
  const deps = board.departures?.slice(0, 4) ?? [];
  const leave = leaveAt(deps, now, walk);
  return (
    <div class="col" data-action={`station:${index}`}>
      <div class="stn">
        {board.lines.map((l) => (
          <LineBadge line={l} />
        ))}
        <span>{board.name}</span>
      </div>
      <div class="dir">
        <span>→ Stadt</span>
        {leave && <b>los {formatTime(leave)}</b>}
      </div>
      {board.departures === null && <div class="none">keine Daten</div>}
      {board.departures?.length === 0 && <div class="none">keine Abfahrten</div>}
      {deps.map((d) => (
        <div class={walk > 0 && !reachable(d, now, walk) ? 'dep gone' : 'dep'}>
          {mixed && <LineBadge line={d.line} small />}
          <span class={d.delayMin >= LATE_MIN ? 't late' : 't'}>{formatTime(d.planned)}</span>
          {d.delayMin >= 1 && <span class="delay">+{d.delayMin}</span>}
        </div>
      ))}
    </div>
  );
}

/** Event rows the commute line takes from the agenda. */
export const COMMUTE_ROWS = 1;
/** The motorbike fills only 15 of its 24 units in height: at 52 px its ink is as tall as the 38 px text. */
const SCOOTER_ICON = 52;
/** Below this, a delay is noise and not shown. */
export const COMMUTE_DELAY_MIN = 3;

/**
 * «18 Min. · an 08:02 · +4 Min. Stau»: leaving now, against the usual time of day. `short` for two
 * destinations: without the arrival (on the map), as two of them do not fit.
 */
function Travel({ travel, now, short }: { travel: Commute | null; now: Date; short?: boolean }) {
  if (travel === null) return <span class="none">{short ? 'keine Daten' : 'keine Verkehrsdaten'}</span>;
  return (
    <>
      <b>{travel.minutes} Min.</b>
      {!short && <span>an {formatTime(new Date(now.getTime() + travel.minutes * 60_000))}</span>}
      {travel.delayMinutes >= COMMUTE_DELAY_MIN && <b class="late">+{travel.delayMinutes} {short ? 'Stau' : 'Min. Stau'}</b>}
    </>
  );
}

/** «Arbeit 13:30 · los 12:58 · 27 Min. · +4 Stau»: the duty and when to leave for it, door to door. */
function ShiftTravel({ shift, travel, now }: { shift: { label: string; start: Date; leave: Date | null }; travel: Commute | null; now: Date }) {
  return (
    <>
      <span>{`${shift.label} ${formatTime(shift.start)}`}</span>
      {travel === null || shift.leave === null ? (
        <span class="none">keine Verkehrsdaten</span>
      ) : (
        <>
          <b>{now >= shift.leave ? 'los sofort' : `los ${formatTime(shift.leave)}`}</b>
          <span>{travel.minutes} Min.</span>
          {travel.delayMinutes >= COMMUTE_DELAY_MIN && <b class="late">+{travel.delayMinutes} Stau</b>}
        </>
      )}
    </>
  );
}

/**
 * By scooter: «Zur Arbeit 18 Min. · an 08:02», or with a school as well an icon per destination after a
 * divider. With a duty from the roster only its destination, with the start and when to leave. A tap
 * opens the map of the destination tapped.
 */
function CommuteLine({ commutes, now }: { commutes: NonNullable<HeuteModel['commutes']>; now: Date }) {
  const [only] = commutes;
  // Whose rides they are, always right after the scooter.
  const badges = [...new Set(commutes.map((c) => c.badge).filter(Boolean))].map((b) => <span class="cal">{b}</span>);
  if (commutes.length === 1 && only) {
    return (
      <div class="commute" data-action={`commute:${only.index ?? 0}`}>
        <Icon name="scooter" size={SCOOTER_ICON} />
        {badges}
        {only.shift ? (
          <ShiftTravel shift={only.shift} travel={only.travel} now={now} />
        ) : (
          <>
            <span>{only.label}</span>
            <Travel travel={only.travel} now={now} />
          </>
        )}
      </div>
    );
  }
  return (
    <div class="commute" data-action="commute:0">
      <Icon name="scooter" size={SCOOTER_ICON} />
      {badges}
      <span class="sep" />
      {commutes.map((c, i) => (
        <span class="dest" data-action={`commute:${c.index ?? i}`}>
          <Icon name={COMMUTE_ICONS[c.icon]} size={40} />
          <Travel travel={c.travel} now={now} short />
        </span>
      ))}
    </div>
  );
}

/** «Dringend» first, bold after the runner, then the rest (newest first). */
function WidgetItems({ items }: { items: ShoppingItem[] }) {
  const urgent = items.filter((i) => i.urgent).map((i) => i.name);
  const rest = items.filter((i) => !i.urgent).map((i) => i.name);
  if (urgent.length === 0) return <>{rest.join(', ')}</>;
  return (
    <>
      <Icon name="run" size={34} />
      <b>{urgent.join(', ')}</b>
      {rest.length > 0 && `, ${rest.join(', ')}`}
    </>
  );
}

/** Bring! lists items in the order they were added, so the newest comes first when reversed. */
function BringWidget({ shopping }: { shopping: ShoppingData }) {
  return (
    <div class="widget">
      <div class="txt" data-action="nav:einkauf">
        <div class="lbl">
          <Icon name="cart" size={30} /> Einkaufsliste{shopping.ok ? ` · ${shopping.items.length}` : ''}
        </div>
        <div class="items ellipsis">
          {shopping.ok ? shopping.items.length > 0 ? <WidgetItems items={[...shopping.items].reverse()} /> : 'Alles erledigt' : shopping.message}
        </div>
      </div>
      <div class="btn" data-action="nav:hinzufuegen">
        <Icon name="plus" size={36} /> Hinzufügen
      </div>
    </div>
  );
}

const hasTasks = (m: HeuteModel) => (m.tasks?.length ?? 0) > 0;

/**
 * Event rows left in the agenda before a birthday greeting: one more on a dry day (no rain strip, about
 * 1.8 rows of room); the task box and the commute line above the departures take some.
 */
const rowsBeforeBirthday = (m: HeuteModel) =>
  MAX_EVENTS_HEUTE + (showsRainStrip(m) ? 0 : 1) - (hasTasks(m) ? TASK_ROWS : 0) - (m.commutes ? COMMUTE_ROWS : 0);

/** The greeting is compact (one row) in the evening, and whenever the full one would leave no event row. */
const compactBirthday = (m: HeuteModel) => (m.evening ?? false) || rowsBeforeBirthday(m) - BIRTHDAY_ROWS < 1;

/** A birthday or, failing that, a holiday greets above the events. */
const hasGreeting = (m: HeuteModel) => (m.birthdays?.length ?? 0) > 0 || Boolean(m.holiday);

/** Event rows left in the agenda. */
const agendaRows = (m: HeuteModel) => rowsBeforeBirthday(m) - (hasGreeting(m) ? (compactBirthday(m) ? 1 : BIRTHDAY_ROWS) : 0);

/** Past events only while everything fits in `rows`; otherwise they give way to the next ones, oldest first. */
function dropPast(entries: DayEntry[], rows: number): DayEntry[] {
  const out = [...entries];
  while (out.length > rows) {
    const i = out.findIndex((e) => e.past);
    if (i < 0) break;
    out.splice(i, 1);
  }
  return out;
}

/** A section title of the agenda; the first one carries the guest lock and «+ Aufgabe». */
function AgendaTitle({ m, text, first, cls = 'section-title' }: { m: HeuteModel; text: string; first: boolean; cls?: string }) {
  return (
    <div class={cls}>
      <span>
        {text}
        {m.guest && first && <GuestMark />}
      </span>
      {first && m.tasks !== undefined && <AddTaskButton />}
    </div>
  );
}

/** Tonight's remaining events (at most EVENING_TONIGHT_ROWS rows), then as much of tomorrow as fits. */
function EveningAgenda({ m }: { m: HeuteModel }) {
  if (m.events === null) return <div class="empty">Termine: keine Daten</div>;
  const rows = agendaRows(m);
  // A birthday and a task leave room for one section only: tonight if anything is left, else tomorrow.
  if (rows < 3) {
    const tonight = m.events.length > 0;
    const list = tonight ? m.events : m.tomorrow;
    return (
      <>
        <AgendaTitle m={m} text={tonight ? 'Heute Abend' : 'Morgen'} first />
        {list === null || list === undefined ? (
          <div class="empty">Termine: keine Daten</div>
        ) : list.length === 0 ? (
          <div class="empty">Keine Termine morgen</div>
        ) : (
          <EventList entries={list} max={rows} />
        )}
      </>
    );
  }
  // Tonight leaves tomorrow at least one row below its section title, which takes about one row.
  const tonightMax = Math.max(1, Math.min(EVENING_TONIGHT_ROWS, rows - 2));
  const tonightRows = Math.min(m.events.length, tonightMax);
  const tomorrowMax = Math.max(1, rows - tonightRows - (tonightRows > 0 ? 1 : 0));
  return (
    <>
      {m.events.length > 0 && (
        <>
          <AgendaTitle m={m} text="Heute Abend" first />
          <EventList entries={m.events} max={tonightMax} />
        </>
      )}
      <AgendaTitle m={m} text="Morgen" first={m.events.length === 0} cls={m.events.length > 0 ? 'section-title next' : 'section-title'} />
      {m.tomorrow === null || m.tomorrow === undefined ? (
        <div class="empty">Termine: keine Daten</div>
      ) : m.tomorrow.length === 0 ? (
        <div class="empty">Keine Termine morgen</div>
      ) : (
        <EventList entries={m.tomorrow} max={tomorrowMax} />
      )}
    </>
  );
}

/** QR code size on the device: fits the smallest agenda (rain strip, four departures, evening); smaller with the commute line. */
export const WELCOME_QR_PX = 150;
export const WELCOME_QR_PX_COMMUTE = 128;

/** Guest mode with a guest WLAN: greeting and QR code where the events are; network and password are not printed. */
function Welcome({ guests, wifi, qrPx }: { guests: string[]; wifi: string; qrPx: number }) {
  return (
    <div class="welcome">
      <div class={names(guests).length > 18 ? 'hello serif long' : 'hello serif'}>
        Herzlich willkommen
        {guests.length > 0 ? (
          <>
            <br />
            {names(guests)}!
          </>
        ) : (
          '!'
        )}
      </div>
      <div class="qr" dangerouslySetInnerHTML={{ __html: qrSvg(wifi, qrPx) }} />
    </div>
  );
}

function Heute({ m }: { m: HeuteModel }) {
  return (
    <div class="screen view-heute">
      <div class="main">
        <div class="head">
          <div class="date serif">{formatLongDate(m.now)}</div>
          <div class="meta">
            {m.battery != null && <BatteryMark battery={m.battery} />}
            Stand {formatTime(m.now)}
          </div>
        </div>
        <div class="rule" />
        <WeatherBlock weather={m.weather} lakeTemp={m.lakeTemp ?? null} uetliberg={m.uetliberg ?? false} now={m.now} evening={m.evening ?? false} />
        <div class="rule" />
        <div class={m.evening ? 'agenda evening' : 'agenda'} data-action="nav:woche" data-hold="guest">
          {m.welcome ? (
            <Welcome guests={m.welcome.guests} wifi={m.welcome.wifi} qrPx={m.commutes ? WELCOME_QR_PX_COMMUTE : WELCOME_QR_PX} />
          ) : (
            <>
              {m.birthdays && m.birthdays.length > 0 ? (
                <BirthdayBanner birthdays={m.birthdays} compact={compactBirthday(m)} />
              ) : (
                m.holiday && <HolidayBanner holiday={m.holiday} compact={compactBirthday(m)} />
              )}
              {m.tasks && <TaskBox tasks={m.tasks} />}
            </>
          )}
          {m.welcome ? null : m.evening ? (
            <EveningAgenda m={m} />
          ) : (
            <>
              <AgendaTitle m={m} text="Termine heute" first />
              {m.events === null && <div class="empty">Termine: keine Daten</div>}
              {m.events?.length === 0 && <div class="empty">Keine Termine heute</div>}
              {m.events && m.events.length > 0 && <EventList entries={dropPast(m.events, agendaRows(m))} max={agendaRows(m)} />}
            </>
          )}
        </div>
        <div class="transit">
          <div class="rule" />
          {m.commutes && (
            <>
              <CommuteLine commutes={m.commutes} now={m.now} />
              <div class="rule" />
            </>
          )}
          <div class="ov">
            {m.boards.map((b, i) => (
              <Board board={b} index={i} now={m.now} />
            ))}
          </div>
        </div>
      </div>
      <BringWidget shopping={m.shopping} />
      <Tabs active="heute" />
    </div>
  );
}

export function heuteMarkup(m: HeuteModel): string {
  return render(<Heute m={m} />);
}

export function heuteHtml(m: HeuteModel): string {
  return page(heuteMarkup(m));
}
