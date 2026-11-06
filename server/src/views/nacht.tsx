import { render } from 'preact-render-to-string';
import { formatLongDate, isoDate } from '../format.js';
import type { DayEntry } from '../sources/calendar.js';
import { type DailyWeather, firstRainHour, type Weather } from '../sources/weather.js';
import { describeWmo } from '../sources/wmo.js';
import { BatteryMark, BirthdayBanner, EventList, GuestMark, Icon, Tabs } from './components.js';
import { page } from './page.js';

/** Rows of the coming day's entries on the night screen. */
export const NIGHT_EVENTS = 5;

export interface NachtModel {
  now: Date;
  /** Midnight of the day the night leads into. */
  day: Date;
  weather: Weather | null;
  /** Entries of `day`, collections first; null = no calendar data. */
  entries: DayEntry[] | null;
  /** Guest mode: titles are hidden; shown with a lock. */
  guest?: boolean;
  /** Names of those whose birthday is on `day`. */
  birthdays?: string[];
  /** Battery level in percent when low (not charging); shown in the header. */
  battery?: number | null;
}

function DayWeather({ weather, day }: { weather: Weather; day: Date }) {
  const daily: DailyWeather | undefined = weather.daily.find((d) => d.date === isoDate(day));
  if (!daily) return <div class="empty">Wetter: keine Daten</div>;
  const info = describeWmo(daily.code);
  const from = new Date(day);
  from.setHours(6);
  const to = new Date(day);
  to.setHours(22);
  const rain = firstRainHour(weather, from, to);
  return (
    <div class="nw">
      <Icon name={info.icon} size={96} />
      <div>
        <div class="nw-text">{info.text}</div>
        <div class="nw-sub">
          {daily.max !== null && <b>Max {Math.round(daily.max)}°</b>}
          {daily.max !== null && daily.min !== null && ' · '}
          {daily.min !== null && <b>Min {Math.round(daily.min)}°</b>}
          {' · '}
          {rain === null ? 'kein Regen' : `Regen ab ${rain} Uhr`}
        </div>
      </div>
    </div>
  );
}

/** Calm screen for the quiet hours: good night, and the essentials of the coming day. */
function Nacht({ m }: { m: NachtModel }) {
  const label = isoDate(m.day) === isoDate(m.now) ? 'Heute' : 'Morgen';
  return (
    <div class="screen view-nacht">
      <div class="main">
        <div class="head">
          <div class="date serif">{formatLongDate(m.day)}</div>
          {m.battery != null && (
            <div class="meta">
              <BatteryMark level={m.battery} />
            </div>
          )}
        </div>
        <div class="rule" />
        <div class="gn">
          <Icon name="moon" size={110} />
          <span class="serif">Gute Nacht</span>
        </div>
        <div class="rule" />
        {m.birthdays && m.birthdays.length > 0 && <BirthdayBanner birthdays={m.birthdays} />}
        <div class="section-title">
          {label}
          {m.guest && <GuestMark />}
        </div>
        {m.weather ? <DayWeather weather={m.weather} day={m.day} /> : <div class="empty">Wetter: keine Daten</div>}
        <div class="nevents" data-hold="guest">
          {m.entries === null && <div class="empty">Termine: keine Daten</div>}
          {m.entries?.length === 0 && <div class="empty">Keine Termine</div>}
          {m.entries && m.entries.length > 0 && <EventList entries={m.entries} max={NIGHT_EVENTS} />}
        </div>
      </div>
      <Tabs active="heute" />
    </div>
  );
}

export function nachtMarkup(m: NachtModel): string {
  return render(<Nacht m={m} />);
}

export function nachtHtml(m: NachtModel): string {
  return page(nachtMarkup(m));
}
