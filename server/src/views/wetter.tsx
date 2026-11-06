import { render } from 'preact-render-to-string';
import { formatWeekday, isoDate } from '../format.js';
import type { HourlyPoint, Weather } from '../sources/weather.js';
import { atNight, describeWmo } from '../sources/wmo.js';
import { Icon } from './components.js';
import type { WetterModel } from './model.js';
import { page } from './page.js';

const CHART_W = 988;
const CHART_H = 288;
// The max label sits above the curve, so the curve starts well below the chart's top edge.
const CURVE_TOP = 62;
const CURVE_BOTTOM = 140;
const RAIN_TOP = 150;
const RAIN_BOTTOM = 184;
const WIND_TOP = 212;
const WIND_BOTTOM = 256;
/** Rain bars are full height at this many mm per hour. */
const RAIN_FULL_MM = 4;

/** Barometer dial: 960–1060 hPa over 240°, 0° pointing up. */
const BARO_MIN = 960;
const BARO_MAX = 1060;
const BARO_SWEEP = 240;
const BARO_ZONES: [number, string][] = [
  [965, 'Sturm'],
  [985, 'Regen'],
  [1005, 'Veränderlich'],
  [1025, 'Schön'],
  [1045, 'Trocken'],
];
/** Below this change in 3 h the pressure counts as steady. */
const STEADY_HPA = 1;

const SECTORS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export function compassSector(deg: number): string {
  return SECTORS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/** Point on a circle of radius r at a compass angle (0 = up, clockwise). */
function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
}

const f = (n: number) => n.toFixed(1);

/** Smooth path through the points (Catmull-Rom as cubic Béziers). */
export function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/** 25 points from the current hour to the same hour tomorrow, so the axis spans exactly 24 hours. */
function next24(w: Weather, now: Date): HourlyPoint[] {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const end = start.getTime() + 24 * 3_600_000;
  return w.hourly.filter((h) => h.time >= start && h.time.getTime() <= end);
}

/** x of hour i of n in the 24-hour chart, edge to edge; the icon row above uses the same positions. */
function chartX(i: number, n: number): number {
  return i * (CHART_W / (n - 1));
}

/** Labels at the first and last hour align with the edges instead of centring on them. */
function edgeAnchor(i: number, n: number): 'start' | 'middle' | 'end' {
  return i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
}

const HOUR_ICON = 40;

/** A weather icon every 3 hours above the chart, the moon at night. */
function HourIcons({ hours }: { hours: HourlyPoint[] }) {
  if (hours.length < 2) return null;
  return (
    <div class="hicons">
      {hours.map((h, i) => {
        if (i % 3 !== 0 || h.code == null) return null;
        const icon = describeWmo(h.code).icon;
        return (
          <span style={`left:${f(Math.min(Math.max(chartX(i, hours.length) - HOUR_ICON / 2, 0), CHART_W - HOUR_ICON))}px`}>
            <Icon name={h.isDay === false ? atNight(icon) : icon} size={HOUR_ICON} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Three bands over 24 hours on one hour axis: the temperature curve with max/min, rain bars
 * (probability grey, mm black) and the wind speed curve over a grey area for the gusts.
 */
function WeatherChart({ hours }: { hours: HourlyPoint[] }) {
  const temps = hours.map((h) => h.temp).filter((t): t is number => t !== null);
  if (hours.length < 2 || temps.length < 2) return <div class="empty">Verlauf: keine Daten</div>;
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = Math.max(hi - lo, 2);
  const step = CHART_W / (hours.length - 1);
  const x = (i: number) => chartX(i, hours.length);
  // Point labels stay inside the chart near the edges.
  const lx = (i: number) => Math.min(Math.max(x(i), 26), CHART_W - 26);
  const y = (t: number) => CURVE_BOTTOM - ((t - lo) / span) * (CURVE_BOTTOM - CURVE_TOP);
  const pts = hours.flatMap((h, i): [number, number][] => (h.temp === null ? [] : [[x(i), y(h.temp)]]));
  const curve = smoothPath(pts);
  const area = `${curve} L${f(pts.at(-1)![0])},${CURVE_BOTTOM} L${f(pts[0]![0])},${CURVE_BOTTOM} Z`;
  const iMax = hours.findIndex((h) => h.temp === hi);
  const iMin = hours.findIndex((h) => h.temp === lo);
  const barW = step * 0.7;
  const rainH = RAIN_BOTTOM - RAIN_TOP;
  const winds = hours.flatMap((h) => [h.wind, h.gust]).filter((v): v is number => v !== null);
  const windTop = Math.max(10, ...winds);
  const wy = (v: number) => WIND_BOTTOM - (v / windTop) * (WIND_BOTTOM - WIND_TOP);
  const windPts = hours.flatMap((h, i): [number, number][] => (h.wind === null ? [] : [[x(i), wy(h.wind)]]));
  const gustPts = hours.flatMap((h, i): [number, number][] => (h.gust === null ? [] : [[x(i), wy(h.gust)]]));
  const windMax = Math.max(...hours.map((h) => h.wind ?? -1));
  const iWind = hours.findIndex((h) => h.wind === windMax);
  return (
    <svg class="chart" width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
      <path d={area} fill="#ececec" />
      <path d={curve} fill="none" stroke="#000" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={f(x(iMax))} cy={f(y(hi))} r="8" fill="#000" />
      <text x={f(lx(iMax))} y={f(y(hi) - 16)} text-anchor="middle" class="lbl">
        {Math.round(hi)}°
      </text>
      <circle cx={f(x(iMin))} cy={f(y(lo))} r="8" fill="#fff" stroke="#000" stroke-width="4" />
      {/* Above the min point: the curve lies at or below it there, and the rain bars stay clear. */}
      <text x={f(lx(iMin))} y={f(y(lo) - 16)} text-anchor="middle" class="lbl">
        {Math.round(lo)}°
      </text>
      {/* Each hour's rain fills its slot from that hour to the next. */}
      {hours.slice(0, -1).map((h, i) => (
        <>
          {h.probability !== null && h.probability > 0 && (
            <rect x={f(x(i) + (step - barW) / 2)} y={f(RAIN_BOTTOM - (h.probability / 100) * rainH)} width={f(barW)} height={f((h.probability / 100) * rainH)} fill="#ececec" />
          )}
          {h.rainMm !== null && h.rainMm >= 0.1 && (
            <rect
              x={f(x(i) + (step - barW) / 2)}
              y={f(RAIN_BOTTOM - (Math.min(h.rainMm, RAIN_FULL_MM) / RAIN_FULL_MM) * rainH)}
              width={f(barW)}
              height={f((Math.min(h.rainMm, RAIN_FULL_MM) / RAIN_FULL_MM) * rainH)}
              fill="#000"
            />
          )}
        </>
      ))}
      {gustPts.length > 1 && (
        <path
          d={`${smoothPath(gustPts)} L${f(gustPts.at(-1)![0])},${WIND_BOTTOM} L${f(gustPts[0]![0])},${WIND_BOTTOM} Z`}
          fill="#ececec"
        />
      )}
      {windPts.length > 1 && (
        <>
          <path d={smoothPath(windPts)} fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round" />
          <circle cx={f(x(iWind))} cy={f(wy(windMax))} r="6" fill="#000" />
          <text
            x={f(Math.min(Math.max(x(iWind), 70), CHART_W - 70))}
            y={f(wy(windMax) - 12)}
            text-anchor="middle"
            class="wl"
          >
            {Math.round(windMax)} kn
          </text>
        </>
      )}
      <line x1="0" y1={WIND_BOTTOM} x2={CHART_W} y2={WIND_BOTTOM} stroke="#000" stroke-width="2" />
      {hours.map(
        (h, i) =>
          i % 3 === 0 && (
            <text x={f(x(i))} y={CHART_H - 4} text-anchor={edgeAnchor(i, hours.length)} class="ax">
              {h.time.getHours()}
            </text>
          ),
      )}
    </svg>
  );
}

/** Compass rose; the arrow points where the wind blows to. */
function WindRose({ dir }: { dir: number | null }) {
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg class="gauge" width="190" height="190" viewBox="-150 -150 300 300">
      <circle r="100" fill="none" stroke="#000" stroke-width="4" />
      {ticks.map((a) => {
        const [x1, y1] = polar(a % 90 === 0 ? 82 : 90, a);
        const [x2, y2] = polar(100, a);
        return <line x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} stroke="#000" stroke-width={a % 90 === 0 ? 5 : 3} />;
      })}
      {(['N', 'O', 'S', 'W'] as const).map((l, i) => {
        const [x, y] = polar(126, i * 90);
        return (
          <text x={f(x)} y={f(y + 11)} text-anchor="middle" class="cardinal">
            {l}
          </text>
        );
      })}
      {dir !== null && (
        <g transform={`rotate(${f((dir + 180) % 360)})`}>
          <line x1="0" y1="62" x2="0" y2="-40" stroke="#000" stroke-width="12" stroke-linecap="round" />
          <polygon points="0,-78 -26,-34 26,-34" fill="#000" />
        </g>
      )}
      <circle r="9" fill="#fff" stroke="#000" stroke-width="4" />
    </svg>
  );
}

function baroAngle(p: number): number {
  const c = Math.min(BARO_MAX, Math.max(BARO_MIN, p));
  return -BARO_SWEEP / 2 + ((c - BARO_MIN) / (BARO_MAX - BARO_MIN)) * BARO_SWEEP;
}

/** Classic aneroid barometer: needle for now, thin reference needle for 3 hours ago. */
function Barometer({ now, before }: { now: number | null; before: number | null }) {
  const [ax0, ay0] = polar(110, -BARO_SWEEP / 2);
  const [ax1, ay1] = polar(110, BARO_SWEEP / 2);
  const ticks = Array.from({ length: (BARO_MAX - BARO_MIN) / 5 + 1 }, (_, i) => BARO_MIN + i * 5);
  const needle = (p: number, len: number, width: number, color: string) => {
    const [x, y] = polar(len, baroAngle(p));
    return <line x1="0" y1="0" x2={f(x)} y2={f(y)} stroke={color} stroke-width={width} stroke-linecap="round" />;
  };
  return (
    <svg class="gauge" width="342" height="190" viewBox="-270 -165 540 300">
      <path d={`M${f(ax0)},${f(ay0)} A110,110 0 1 1 ${f(ax1)},${f(ay1)}`} fill="none" stroke="#000" stroke-width="4" />
      {ticks.map((p) => {
        const major = p % 10 === 0;
        const [x1, y1] = polar(major ? 94 : 102, baroAngle(p));
        const [x2, y2] = polar(110, baroAngle(p));
        return <line x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} stroke="#000" stroke-width={major ? 4 : 2} />;
      })}
      {[960, 980, 1000, 1020, 1040, 1060].map((p) => {
        const [x, y] = polar(74, baroAngle(p));
        return (
          <text x={f(x)} y={f(y + 8)} text-anchor="middle" class="num">
            {p}
          </text>
        );
      })}
      {BARO_ZONES.map(([p, label]) => {
        const [x, y] = polar(132, baroAngle(p));
        const anchor = x < -20 ? 'end' : x > 20 ? 'start' : 'middle';
        return (
          <text x={f(x)} y={f(y + 8)} text-anchor={anchor} class="zone">
            {label}
          </text>
        );
      })}
      {before !== null && needle(before, 100, 3, '#555')}
      {now !== null && needle(now, 96, 8, '#000')}
      <circle r="12" fill="#000" />
    </svg>
  );
}

export function trendText(now: number, before: number): string {
  const d = now - before;
  if (Math.abs(d) < STEADY_HPA) return '→ gleichbleibend';
  const v = `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} hPa in 3 h`;
  return d > 0 ? `↗ steigend · ${v}` : `↘ fallend · ${v}`;
}

const DAY_STRIP_W = 552;
const DAY_STRIP_H = 30;
/** Tick marks and hour labels on the day strips, every 3 hours. */
const DAY_TICKS = [3, 6, 9, 12, 15, 18, 21];
/** Shown next to the strip from this daily sum on. */
const DAY_RAIN_MIN_MM = 1;

/** 24 bars for the rain probability of each hour of a day, ticks every 3 hours. */
function DayRain({ hours }: { hours: HourlyPoint[] }) {
  const slot = DAY_STRIP_W / 24;
  return (
    <svg class="dayrain" width={DAY_STRIP_W} height={DAY_STRIP_H} viewBox={`0 0 ${DAY_STRIP_W} ${DAY_STRIP_H}`}>
      {DAY_TICKS.map((h) => (
        <line x1={f(h * slot)} y1="0" x2={f(h * slot)} y2={DAY_STRIP_H} stroke="#999" stroke-width="1" />
      ))}
      {hours.map((h) => {
        const p = h.probability ?? 0;
        if (p < 5) return null;
        const height = (p / 100) * (DAY_STRIP_H - 2);
        return (
          <rect
            x={f(h.time.getHours() * slot + 1)}
            y={f(DAY_STRIP_H - 2 - height)}
            width={f(slot - 2)}
            height={f(height)}
            fill={p >= 50 ? '#000' : '#999'}
          />
        );
      })}
      <line x1="0" y1={DAY_STRIP_H - 1} x2={DAY_STRIP_W} y2={DAY_STRIP_H - 1} stroke="#000" stroke-width="2" />
    </svg>
  );
}

/** Hour labels above the day strips, at the ticks. */
function DayRainHead() {
  const slot = DAY_STRIP_W / 24;
  return (
    <svg class="dayrain" width={DAY_STRIP_W} height="30" viewBox={`0 0 ${DAY_STRIP_W} 30`}>
      {DAY_TICKS.map((h) => (
        <text x={f(h * slot)} y="24" text-anchor="middle" class="rh">
          {h}
        </text>
      ))}
    </svg>
  );
}

/** Min and max per day, then when (24 hourly bars) and how much it rains. */
function SevenDays({ w, now }: { w: Weather; now: Date }) {
  const days = w.daily.filter((d) => d.min !== null && d.max !== null).slice(0, 7);
  if (days.length === 0) return <div class="empty">7 Tage: keine Daten</div>;
  const today = isoDate(now);
  return (
    <div class="wdays">
      <div class="wday wd-head">
        <span class="section-title">7 Tage</span>
        <DayRainHead />
        <span class="rh-label">Regen</span>
      </div>
      {days.map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return (
          <div class="wday">
            <span class="dn">{d.date === today ? 'Heute' : formatWeekday(date)}</span>
            <Icon name={describeWmo(d.code).icon} size={38} />
            <span class="lo">{Math.round(d.min!)}°</span>
            <span class="hi">{Math.round(d.max!)}°</span>
            <DayRain hours={w.hourly.filter((h) => isoDate(h.time) === d.date)} />
            <span class="mm">{d.rainMm != null && d.rainMm >= DAY_RAIN_MIN_MM ? `${Math.round(d.rainMm)} mm` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Wetter({ m }: { m: WetterModel }) {
  const w = m.weather;
  const info = w ? describeWmo(w.currentCode) : null;
  const today = w?.daily.find((d) => d.date === isoDate(m.now));
  const hours = w ? next24(w, m.now) : [];
  const hourStart = new Date(m.now);
  hourStart.setMinutes(0, 0, 0);
  const before = w?.hourly.find((h) => h.time.getTime() === hourStart.getTime() - 3 * 3_600_000)?.pressure ?? null;
  const pressure = w?.now.pressure ?? null;
  const n = w?.now;
  return (
    <div class="screen view-wetter">
      <div class="main">
        <div class="topbar">
          <div class="title serif">Wetter</div>
          <div class="close" data-action="close">
            <Icon name="x" size={34} /> Schliessen
          </div>
        </div>
        <div class="rule" />
        {!w || !info ? (
          <div class="empty">Wetter: keine Daten</div>
        ) : (
          <>
            <div class="wn">
              <div class="temp serif">{Math.round(w.currentTemp)}°</div>
              <div class="wn-desc">
                <div>
                  <Icon name={info.icon} size={44} /> {info.text}
                </div>
                <div class="sub">
                  {[n?.apparent != null && `gefühlt ${Math.round(n.apparent)}°`, n?.humidity != null && `Feuchte ${Math.round(n.humidity)} %`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {(today?.sunrise || m.lakeTemp !== null) && (
                  <div class="sub">
                    {today?.sunrise && today.sunset && (
                      <>
                        <Icon name="sunrise" size={36} /> {today.sunrise}
                        {'  '}
                        <Icon name="sunset" size={36} /> {today.sunset}
                      </>
                    )}
                    {today?.sunrise && m.lakeTemp !== null && ' · '}
                    {m.lakeTemp !== null && (
                      <>
                        <Icon name="waves" size={36} /> See {Math.round(m.lakeTemp)}°
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div class="rule" />
            <div class="section-title">Nächste 24 Stunden</div>
            <HourIcons hours={hours} />
            <WeatherChart hours={hours} />
            <div class="rule" />
            <div class="gauges">
              <div class="g">
                <div class="section-title">Wind</div>
                <WindRose dir={n?.windDir ?? null} />
                <div class="gv">{n?.wind != null ? `${Math.round(n.wind)} kn` : '–'}</div>
                <div class="gs">
                  {[n?.gust != null && `Böen ${Math.round(n.gust)}`, n?.windDir != null && `aus ${compassSector(n.windDir)}`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div class="g">
                <div class="section-title">Barometer</div>
                <Barometer now={pressure} before={before} />
                <div class="gv">{pressure !== null ? `${Math.round(pressure)} hPa` : '–'}</div>
                <div class="gs">{pressure !== null && before !== null ? trendText(pressure, before) : ''}</div>
              </div>
            </div>
            <div class="rule" />
            <SevenDays w={w} now={m.now} />
          </>
        )}
      </div>
    </div>
  );
}

export function wetterMarkup(m: WetterModel): string {
  return render(<Wetter m={m} />);
}

export function wetterHtml(m: WetterModel): string {
  return page(wetterMarkup(m));
}
