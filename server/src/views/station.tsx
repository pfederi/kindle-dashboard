import { render } from 'preact-render-to-string';
import { formatTime } from '../format.js';
import { type Departure, LATE_MIN, leaveAt, reachable, shortStop } from '../sources/transit.js';
import { Icon, LineBadge } from './components.js';
import type { StationModel } from './model.js';
import { page } from './page.js';

function Rows({ deps, now, walk }: { deps: Departure[] | null; now: Date; walk: number }) {
  if (deps === null) return <div class="none">keine Daten</div>;
  if (deps.length === 0) return <div class="none">keine Abfahrten</div>;
  return (
    <div class="st-deps">
      {deps.map((d) => (
        <div class={walk > 0 && !reachable(d, now, walk) ? 'st-dep gone' : 'st-dep'}>
          <span class="time">{d.delayMin >= LATE_MIN ? <span class="late">{formatTime(d.planned)}</span> : formatTime(d.planned)}</span>
          <LineBadge line={d.line} />
          <span class="to ellipsis">{shortStop(d.to)}</span>
          {d.delayMin >= 1 && <span class="delay">+{d.delayMin}</span>}
        </div>
      ))}
    </div>
  );
}

function Station({ m }: { m: StationModel }) {
  const now = m.now ?? new Date();
  const walk = m.walk ?? 0;
  const leave = m.inbound ? leaveAt(m.inbound, now, walk) : null;
  return (
    <div class="screen view-station">
      <div class="main">
        <div class="topbar">
          <div class="title serif">{m.name}</div>
          <div class="close" data-action="close">
            <Icon name="x" size={34} /> Schliessen
          </div>
        </div>
        <div class="rule" />
        <div class="section-title">→ Richtung Stadt{leave && ` · los um ${formatTime(leave)}`}</div>
        <Rows deps={m.inbound} now={now} walk={walk} />
        <div class="section-title st-out">{m.outboundTo ? `← Richtung ${m.outboundTo}` : '← Gegenrichtung'}</div>
        <Rows deps={m.outbound} now={now} walk={walk} />
      </div>
    </div>
  );
}

export function stationMarkup(m: StationModel): string {
  return render(<Station m={m} />);
}

export function stationHtml(m: StationModel): string {
  return page(stationMarkup(m));
}
