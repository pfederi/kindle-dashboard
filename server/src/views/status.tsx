import { render } from 'preact-render-to-string';
import { formatTime, formatWeekday, isoDate, startOfDay } from '../format.js';
import type { SourceHealth } from '../health.js';
import { BATTERY_LOW } from '../monitor.js';
import type { BatterySample } from '../status.js';
import { monthLabel } from '../roster/parse.js';

/** Later than announced by this much, the Kindle counts as overdue. */
export const OVERDUE_MS = 5 * 60_000;

export interface StatusModel {
  now: Date;
  startedAt: Date;
  lastSeen: Date | null;
  nextDue: Date | null;
  battery: readonly BatterySample[];
  sources: SourceHealth[];
  /** Uploaded duty rosters; absent = roster off. */
  roster?: { months: { month: string; uploadedAt: Date }[]; lastError: { at: Date; text: string } | null; /** The plans survive a deploy; absent = unknown. */ persistent?: boolean };
}

const dateTime = (d: Date) => `${formatWeekday(d)} ${isoDate(d).slice(8, 10)}.${isoDate(d).slice(5, 7)}. ${formatTime(d)}`;

function ago(now: Date, d: Date): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  return h < 48 ? `vor ${h} Std.` : `vor ${Math.floor(h / 24)} Tagen`;
}

/** A status word with its icon, never color alone. */
function Badge({ ok, text }: { ok: boolean; text: string }) {
  return <span class={ok ? 'badge good' : 'badge bad'}>{ok ? '✓' : '⚠'} {text}</span>;
}

const W = 720;
const H = 240;
const M = { top: 12, right: 16, bottom: 28, left: 44 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

/** Battery level over time as a step line; charging stretches shaded; native tooltips (no scripts on preview pages). */
function BatteryChart({ samples, now }: { samples: readonly BatterySample[]; now: Date }) {
  const t0 = samples[0]!.at.getTime();
  const t1 = Math.max(now.getTime(), t0 + 3600_000);
  const x = (t: number) => M.left + ((t - t0) / (t1 - t0)) * PW;
  const y = (level: number) => M.top + (1 - level / 100) * PH;
  const end = (i: number) => (i + 1 < samples.length ? samples[i + 1]!.at.getTime() : now.getTime());

  let d = '';
  samples.forEach((s, i) => {
    d += `${i === 0 ? 'M' : 'V'}${y(s.level).toFixed(1)}`.replace(/^M/, `M${x(s.at.getTime()).toFixed(1)} `);
    d += `H${x(end(i)).toFixed(1)}`;
  });

  // Day boundaries for a week, every three hours within a day.
  const ticks: { t: number; label: string }[] = [];
  if (t1 - t0 > 24 * 3600_000) {
    for (let day = startOfDay(new Date(t0 + 24 * 3600_000)); day.getTime() < t1; day = new Date(day.getTime() + 24 * 3600_000)) {
      ticks.push({ t: day.getTime(), label: formatWeekday(day) });
    }
  } else {
    const first = new Date(t0);
    first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600_000; t < t1; t += 3600_000) if (new Date(t).getHours() % 3 === 0) ticks.push({ t, label: formatTime(new Date(t)) });
  }

  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ladestand des Kindle über die Zeit">
      {samples.map((s, i) =>
        s.charging ? <rect class="charging" x={x(s.at.getTime())} y={M.top} width={Math.max(1, x(end(i)) - x(s.at.getTime()))} height={PH} /> : null,
      )}
      {[0, 50, 100].map((v) => (
        <>
          <line class="grid" x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />
          <text class="axis" x={M.left - 8} y={y(v) + 4} text-anchor="end">
            {v} %
          </text>
        </>
      ))}
      <line class="threshold" x1={M.left} x2={W - M.right} y1={y(BATTERY_LOW)} y2={y(BATTERY_LOW)} />
      <text class="axis" x={M.left - 8} y={y(BATTERY_LOW) + 4} text-anchor="end">
        {BATTERY_LOW} %
      </text>
      {ticks.map((tk) => (
        <text class="axis" x={x(tk.t)} y={H - 8} text-anchor="middle">
          {tk.label}
        </text>
      ))}
      <path class="line" d={d} />
      {samples.map((s) => (
        <circle class="hit" cx={x(s.at.getTime())} cy={y(s.level)} r={8}>
          <title>{`${dateTime(s.at)} · ${s.level} %${s.charging ? ' · lädt' : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Status({ m }: { m: StatusModel }) {
  const overdue = m.nextDue !== null && m.now.getTime() > m.nextDue.getTime() + OVERDUE_MS;
  const latest = m.battery.at(-1);
  const changes = [...m.battery].filter((s, i, all) => i === 0 || s.level !== all[i - 1]!.level || s.charging !== all[i - 1]!.charging).reverse().slice(0, 15);
  return (
    <main>
      <h1>Dashboard-Status</h1>
      <p class="muted">
        Stand {dateTime(m.now)} · Server läuft seit {dateTime(m.startedAt)}; Abfragen und Datenquellen seit dann (nach einem Deployment beginnt ihre Aufzeichnung neu), der Ladestand bleibt über Deployments erhalten (Volume auf /app/state).
      </p>

      <h2>Kindle</h2>
      <dl>
        <dt>Letzte Abfrage</dt>
        <dd>{m.lastSeen ? `${dateTime(m.lastSeen)} (${ago(m.now, m.lastSeen)})` : 'noch keine seit dem Serverstart'}</dd>
        <dt>Nächste erwartet</dt>
        <dd>
          {m.nextDue ? dateTime(m.nextDue) : '–'} {m.nextDue && <Badge ok={!overdue} text={overdue ? 'überfällig' : 'pünktlich'} />}
        </dd>
        <dt>Akku</dt>
        <dd>
          {latest ? (
            <>
              {latest.level} %{latest.charging ? ' · lädt' : ''} {!latest.charging && latest.level <= BATTERY_LOW && <Badge ok={false} text="fast leer" />}
            </>
          ) : (
            'keine Angabe (Kindle-Client ab 2026-11-06 schickt den Ladestand)'
          )}
        </dd>
      </dl>

      <h2>Ladestand</h2>
      {m.battery.length === 0 ? (
        <p class="muted">Noch keine Werte.</p>
      ) : (
        <>
          <p class="muted">
            Letzte 7 Tage, höchstens seit dem Serverstart. <span class="key" /> lädt; die Linie bei {BATTERY_LOW} % ist die Schwelle für Anzeige und Push. Zeiger auf einen Punkt zeigt Zeit und Wert.
          </p>
          <BatteryChart samples={m.battery} now={m.now} />
          <table>
            <thead>
              <tr>
                <th>Zeit</th>
                <th class="num">Ladestand</th>
                <th>Netzteil</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((s) => (
                <tr>
                  <td>{dateTime(s.at)}</td>
                  <td class="num">{s.level} %</td>
                  <td>{s.charging ? 'lädt' : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {m.roster && (
        <>
          <h2>Dienstplan</h2>
          <dl>
            <dt>Pläne</dt>
            <dd>{m.roster.months.length === 0 ? 'noch keiner hochgeladen' : m.roster.months.map((r) => `${monthLabel(r.month)} · hochgeladen ${dateTime(r.uploadedAt)}`).join(', ')}</dd>
            <dt>Letzter Fehler</dt>
            <dd>{m.roster.lastError ? `${dateTime(m.roster.lastError.at)}: ${m.roster.lastError.text}` : '–'}</dd>
            {m.roster.persistent !== undefined && (
              <>
                <dt>Ablage</dt>
                <dd>{m.roster.persistent ? <Badge ok text="Volume" /> : <Badge ok={false} text="kein Volume: Pläne gehen beim nächsten Deploy verloren" />}</dd>
              </>
            )}
          </dl>
        </>
      )}

      <h2>Datenquellen</h2>
      {m.sources.length === 0 ? (
        <p class="muted">Noch keine Abfragen.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quelle</th>
              <th>Zustand</th>
              <th>Letzter Erfolg</th>
              <th>Letzter Fehler</th>
            </tr>
          </thead>
          <tbody>
            {m.sources.map((s) => {
              const failing = s.lastError !== null && (s.lastOk === null || s.lastError.at > s.lastOk);
              return (
                <tr>
                  <td>{s.name}</td>
                  <td>
                    <Badge ok={!failing} text={failing ? 'Fehler' : 'OK'} />
                  </td>
                  <td>{s.lastOk ? dateTime(s.lastOk) : '–'}</td>
                  <td>{s.lastError ? `${dateTime(s.lastError.at)}: ${s.lastError.message}` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p>
        <a href="/preview">Zur Vorschau</a>
      </p>
    </main>
  );
}

const CSS = `
:root{--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--series:#2a78d6;--charging:#2a78d61f;--good:#0ca30c;--critical:#d03b3b}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--ink:#fff;--ink-2:#c3c2b7;--grid:#2c2c2a;--axis:#383835;--series:#3987e5;--charging:#3987e526}}
body{margin:0;background:var(--surface);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 8px}
.muted{color:var(--ink-2)}a{color:var(--series)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{color:var(--ink-2)}dd{margin:0}
.badge{font-weight:600;white-space:nowrap}.badge.good{color:var(--good)}.badge.bad{color:var(--critical)}
.key{display:inline-block;width:14px;height:10px;background:var(--charging);border:1px solid var(--axis);vertical-align:-1px}
.chart{width:100%;height:auto;display:block;margin:8px 0 16px}
.chart .grid{stroke:var(--grid);stroke-width:1}.chart .threshold{stroke:var(--axis);stroke-width:1}
.chart .axis{fill:var(--muted);font-size:12px}
.chart .line{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .charging{fill:var(--charging)}.chart .hit{fill:transparent}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--ink-2);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}
@media (max-width:560px){table{display:block;overflow-x:auto}}
`;

export function statusHtml(m: StatusModel): string {
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard-Status</title><style>${CSS}</style></head><body>${render(<Status m={m} />)}</body></html>`;
}
