import { render } from 'preact-render-to-string';
import { formatLongDate, isoDate } from '../format.js';
import type { DayEntry } from '../sources/calendar.js';
import { type DailyWeather, firstRainHour, type Weather } from '../sources/weather.js';
import { describeWmo } from '../sources/wmo.js';
import type { Holiday } from '../holidays.js';
import type { Battery } from '../monitor.js';
import { moonPhase, type MoonPhase } from '../moon.js';
import { BatteryMark, BirthdayBanner, EventList, GuestMark, HolidayBanner, Icon, MoonSky, Tabs } from './components.js';
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
  /** Names of those whose birthday is on `day`; only from midnight on. */
  birthdays?: string[];
  /** The holiday of `day`; only from midnight on. A birthday comes first. */
  holiday?: Holiday | null;
  /** Tonight's moon; without it the plain moon icon. */
  moon?: MoonPhase;
  /** The battery while charging or when low; shown in the header. */
  battery?: Battery | null;
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
      <div class="main" data-action="day">
        <div class="head">
          <div class="date serif">{formatLongDate(m.day)}</div>
          {m.battery != null && (
            <div class="meta">
              <BatteryMark battery={m.battery} />
            </div>
          )}
        </div>
        <div class="rule" />
        <div class="gn">
          {m.moon ? <MoonSky moon={m.moon} /> : <Icon name="moon" size={110} />}
          <div>
            <div class="serif">Gute Nacht</div>
            {m.moon && (
              <div class="moon">
                {m.moon.name} · {Math.round(m.moon.illumination * 100)} %
              </div>
            )}
          </div>
        </div>
        <div class="rule" />
        {m.birthdays && m.birthdays.length > 0 ? <BirthdayBanner birthdays={m.birthdays} /> : m.holiday && <HolidayBanner holiday={m.holiday} />}
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
        <div class="daystart">
          <Icon name="sun" size={40} /> Antippen: Tag starten
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

/** Elongations of the eight phases shown in the night preview. */
export const PREVIEW_PHASES = [0, 45, 90, 135, 180, 225, 270, 315];

/** /preview/nacht: every moon phase and holiday, each linking to the night screen (and Heute) that shows it. */
export function nachtPreviewHtml(holidays: { id: string; text: string }[]): string {
  const link = (q: string, label: string) => (
    <>
      <a href={`/preview/heute?${q}`}>{label}</a> · <a href={`/preview/heute?${q}&png=1`}>PNG</a>
    </>
  );
  const body = render(
    <main>
      <h1>Nachtbildschirm</h1>
      <p>
        {link('nacht=1', 'Heute Nacht (aktueller Mond)')}
      </p>
      <h2>Mondphasen</h2>
      <div class="grid">
        {PREVIEW_PHASES.map((e) => {
          const moon = moonPhase(new Date(), e);
          return (
            <figure>
              <MoonSky moon={moon} />
              <figcaption>
                {moon.name}
                <br />
                {link(`nacht=1&mond=${e}`, 'Nachtbildschirm')}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <h2>Feiertage</h2>
      <ul>
        {holidays.map((h) => (
          <li>
            {h.text} {link(`nacht=1&feiertag=${h.id}`, 'Nacht')} · {link(`feiertag=${h.id}`, 'Heute')}
          </li>
        ))}
      </ul>
      <p>
        <a href="/preview">Zur Vorschau</a>
      </p>
    </main>,
  );
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nacht-Vorschau</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px auto;max-width:760px;padding:0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px}figure{margin:0}figure svg{width:100%;height:auto}figcaption{font-size:14px}</style></head><body>${body}</body></html>`;
}
