import { render } from 'preact-render-to-string';
import { formatTime } from '../format.js';
import { type CommuteRoute, JAM_RATIO, type LatLon, MAP_PX, project, SLOW_RATIO, type Stretch } from '../sources/commute-route.js';
import { COMMUTE_ICONS, Icon } from './components.js';
import { COMMUTE_DELAY_MIN } from './heute.js';
import type { ArbeitswegModel } from './model.js';
import { page } from './page.js';

/** The name with the most metres among the stretches that pass `pick`, or null. */
function longestName(stretches: Stretch[], pick: (s: Stretch) => boolean): string | null {
  const metres = new Map<string, number>();
  for (const s of stretches) if (s.name && pick(s)) metres.set(s.name, (metres.get(s.name) ?? 0) + s.length);
  let best: string | null = null;
  for (const [name, m] of metres) if (best === null || m > metres.get(best)!) best = name;
  return best;
}

/** Where the jam is: the street with the longest jam, else the longest slow-moving one. */
export function jamStreet(route: CommuteRoute): string | null {
  return longestName(route.stretches, (s) => s.ratio < JAM_RATIO) ?? longestName(route.stretches, (s) => s.ratio < SLOW_RATIO);
}

/** What sets the alternative apart: its longest street the main route does not take. */
export function altVia(main: CommuteRoute, alt: CommuteRoute): string | null {
  const taken = new Set(main.stretches.map((s) => s.name));
  return longestName(alt.stretches, (s) => !taken.has(s.name));
}

function RouteMap({ m }: { m: ArbeitswegModel }) {
  const detail = m.detail!;
  const xy = project(detail.view, MAP_PX.width, MAP_PX.height);
  const points = (pts: LatLon[]) =>
    pts
      .map((p) => {
        const [x, y] = xy(p);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  const [main, alt] = detail.routes;
  const all = (r: CommuteRoute) => points(r.stretches.flatMap((s) => s.points));
  const first = main?.stretches[0]?.points[0];
  const lastStretch = main?.stretches.at(-1);
  const last = lastStretch?.points.at(-1);
  const dot = (p: LatLon | undefined, cls: string, r: number) => {
    if (!p) return null;
    const [x, y] = xy(p);
    return <circle class={cls} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r} />;
  };
  return (
    <div class="aw-map">
      {detail.image && <img src={detail.image} alt="" />}
      <svg viewBox={`0 0 ${MAP_PX.width} ${MAP_PX.height}`}>
        {alt && <polyline class="aw-alt" points={all(alt)} />}
        {main && <polyline class="aw-casing" points={all(main)} />}
        {main && <polyline class="aw-route" points={all(main)} />}
        {main?.stretches
          .filter((s) => s.ratio < SLOW_RATIO)
          .map((s) => (
            <polyline class={s.ratio < JAM_RATIO ? 'aw-jam' : 'aw-slow'} points={points(s.points)} />
          ))}
        {dot(first, 'aw-from', 18)}
        {dot(last, 'aw-to', 20)}
      </svg>
    </div>
  );
}

/** A short piece of each line style, as on the map. */
function Legend({ alt }: { alt: boolean }) {
  const sample = (cls: string) => (
    <svg class="aw-sample" viewBox="0 0 60 26">
      {cls === 'aw-slow' && <line class="aw-route" x1="0" y1="13" x2="60" y2="13" />}
      <line class={cls} x1={cls === 'aw-alt' ? 4 : 0} y1="13" x2="60" y2="13" />
    </svg>
  );
  return (
    <div class="aw-legend">
      <span>{sample('aw-jam')}Stau</span>
      <span>{sample('aw-slow')}stockend</span>
      {alt && <span>{sample('aw-alt')}Alternative</span>}
    </div>
  );
}

function Arbeitsweg({ m }: { m: ArbeitswegModel }) {
  const [main, alt] = m.detail?.routes ?? [];
  const minutes = (r: CommuteRoute) => r.minutes + m.walk;
  const jam = main && main.delayMinutes >= COMMUTE_DELAY_MIN ? jamStreet(main) : null;
  const via = main && alt ? altVia(main, alt) : null;
  return (
    <div class="screen view-arbeitsweg">
      <div class="main">
        <div class="topbar">
          {m.tabs.length > 1 ? (
            <div class="segs">
              {m.tabs.map((t, i) => (
                <div class={i === m.active ? 'seg on' : 'seg'} data-action={`commute:${i}`}>
                  {t.badge && <span class="cal">{t.badge}</span>}
                  <Icon name={COMMUTE_ICONS[t.icon]} size={36} /> {t.label}
                </div>
              ))}
            </div>
          ) : (
            <div class="title serif">{m.tabs[0]?.label}</div>
          )}
          <div class="close" data-action="close">
            <Icon name="x" size={34} /> Schliessen
          </div>
        </div>
        <div class="rule" />
        {main ? (
          <>
            <RouteMap m={m} />
            <div class="aw-time">
              <b>{minutes(main)} Min.</b> an {formatTime(new Date(m.now.getTime() + minutes(main) * 60_000))}
            </div>
            <div class="aw-row">
              {main.delayMinutes >= COMMUTE_DELAY_MIN ? (
                <>
                  <b class="late">+{main.delayMinutes} Min. Stau</b>
                  {jam && ` ${jam}`}
                </>
              ) : (
                'Verkehr wie üblich'
              )}
            </div>
            {alt && (
              <div class="aw-row">
                Alternative{via && ` via ${via}`}: {minutes(alt)} Min.
              </div>
            )}
            <Legend alt={alt !== undefined} />
          </>
        ) : (
          <div class="aw-map aw-none">keine Verkehrsdaten</div>
        )}
      </div>
    </div>
  );
}

export function arbeitswegMarkup(m: ArbeitswegModel): string {
  return render(<Arbeitsweg m={m} />);
}

export function arbeitswegHtml(m: ArbeitswegModel): string {
  return page(arbeitswegMarkup(m));
}
