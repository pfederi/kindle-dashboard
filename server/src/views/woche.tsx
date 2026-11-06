import { render } from 'preact-render-to-string';
import { formatWeekday, startOfDay } from '../format.js';
import { describeWmo } from '../sources/wmo.js';
import type { DailyWeather } from '../sources/weather.js';
import { EventList, GuestMark, Icon, Tabs } from './components.js';
import type { WocheModel } from './model.js';
import { page } from './page.js';

export const MAX_EVENTS_PER_DAY = 3;

function part(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return d.toLocaleDateString('de-CH', { ...opts, timeZone: 'Europe/Zurich' });
}

function range(days: { date: Date }[]): string {
  const first = days[0]?.date;
  const last = days.at(-1)?.date;
  if (!first || !last) return '';
  const fm = part(first, { month: 'long' });
  const lm = part(last, { month: 'long' });
  const fd = part(first, { day: 'numeric' });
  const ld = part(last, { day: 'numeric' });
  const sameMonth = fm === lm && part(first, { year: 'numeric' }) === part(last, { year: 'numeric' });
  return sameMonth ? `${fd}.–${ld}. ${lm}` : `${fd}. ${fm} – ${ld}. ${lm}`;
}

/** Icon and «max°/min°» under the weekday. */
function DayWeather({ w }: { w: DailyWeather }) {
  if (w.max === null || w.min === null) return null;
  return (
    <div class="dw">
      <Icon name={describeWmo(w.code).icon} size={30} />
      <span>
        {Math.round(w.max)}°/{Math.round(w.min)}°
      </span>
    </div>
  );
}

function Woche({ m }: { m: WocheModel }) {
  const today = startOfDay(m.now).getTime();
  return (
    <div class="screen view-woche">
      <div class="main">
        <div class="topbar">
          <div class="title serif">Nächste 7 Tage</div>
          <div class="close" data-action="nav:heute">
            <Icon name="x" size={34} /> Schliessen
          </div>
        </div>
        <div class="meta">
          {m.days ? range(m.days) : ''}
          {m.guest && <GuestMark />}
        </div>
        {m.days === null ? (
          <div class="empty" style="margin-top:30px">Termine: keine Daten</div>
        ) : (
          <div class="week" data-hold="guest">
            {m.days.map((d) => {
              const isToday = startOfDay(d.date).getTime() === today;
              return (
                <>
                  <div class={isToday ? 'day today' : 'day'}>
                    {`${formatWeekday(d.date)} ${d.date.getDate()}`}
                    {d.weather && <DayWeather w={d.weather} />}
                  </div>
                  <div class={isToday ? 'entries today' : 'entries'}>
                    {d.entries.length === 0 ? <div class="dash">—</div> : <EventList entries={d.entries} max={MAX_EVENTS_PER_DAY} />}
                  </div>
                </>
              );
            })}
          </div>
        )}
      </div>
      <Tabs active="woche" />
    </div>
  );
}

export function wocheMarkup(m: WocheModel): string {
  return render(<Woche m={m} />);
}

export function wocheHtml(m: WocheModel): string {
  return page(wocheMarkup(m));
}
