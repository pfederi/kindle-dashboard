import type { Clock } from './clock.js';
import type { NtfyConfig } from './config.js';
import { formatTime } from './format.js';
import type { FetchFn } from './http.js';
import { TIMEOUT_MS } from './http.js';

export interface Notice {
  title: string;
  message: string;
  tags: string;
  /** ntfy priority; `urgent` makes the phone ring through Do Not Disturb where allowed. */
  priority: 'default' | 'high' | 'urgent';
}

/** Sends a push notification to an ntfy topic; failures are logged, never thrown. */
export function ntfySender(config: NtfyConfig, fetchFn: FetchFn): (n: Notice) => Promise<void> {
  return async (n) => {
    try {
      const res = await fetchFn(`${config.server}/${config.topic}`, {
        method: 'POST',
        // ntfy reads title and tags from headers, which must be ASCII; umlauts go into the body.
        headers: { Title: n.title, Tags: n.tags, Priority: n.priority },
        body: n.message,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) console.warn(`[ntfy] HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[ntfy] failed: ${err instanceof Error ? err.name : 'error'}`);
    }
  };
}

/**
 * Notices when the Kindle stops calling in. Every delivered screen tells the Kindle when to come
 * back; the monitor alerts once if it is later than that by more than the grace time (so long
 * quiet hours raise no alarm), and once more when it is back.
 */
export class KindleMonitor {
  private lastSeen: Date | null = null;
  private dueBy: number;
  private alerted = false;

  /** @param firstDueSeconds how long after start the first call is expected (a deploy may happen at night). */
  constructor(
    private readonly notify: (n: Notice) => Promise<void>,
    private readonly clock: Clock,
    private readonly graceMs: number,
    firstDueSeconds: number,
  ) {
    this.dueBy = clock().getTime() + firstDueSeconds * 1000 + graceMs;
  }

  /** The Kindle got a screen and was told to return in refreshSeconds. */
  seen(refreshSeconds: number): Promise<void> | undefined {
    const now = this.clock();
    const wasAlerted = this.alerted;
    this.lastSeen = now;
    this.dueBy = now.getTime() + refreshSeconds * 1000 + this.graceMs;
    this.alerted = false;
    if (!wasAlerted) return undefined;
    return this.notify({ title: 'Kindle wieder online', message: `Das Dashboard meldet sich wieder (${formatTime(now)}).`, tags: 'white_check_mark', priority: 'default' });
  }

  /** Call periodically. */
  check(): Promise<void> | undefined {
    if (this.alerted || this.clock().getTime() <= this.dueBy) return undefined;
    this.alerted = true;
    const since = this.lastSeen ? `seit ${formatTime(this.lastSeen)} Uhr` : 'seit dem Serverstart';
    return this.notify({
      title: 'Kindle meldet sich nicht',
      message: `Das Dashboard hat sich ${since} nicht mehr gemeldet. Strom, WLAN oder Akku prüfen.`,
      tags: 'warning',
      priority: 'high',
    });
  }
}

/** Charge level in percent and charging state, as the Kindle reports them with every screen request. */
export interface Battery {
  level: number;
  charging: boolean;
}

/** From this level (and not charging) the dashboard shows the battery and sends a push notification. */
export const BATTERY_LOW = 20;
/** From this level the second, urgent alert: charge now. */
export const BATTERY_CRITICAL = 5;
/** The alert re-arms above this level or on charging, so a level wavering around 20 % alerts only once. */
export const BATTERY_REARM = 25;

export function batteryLow(b: Battery | null): b is Battery {
  return b !== null && !b.charging && b.level <= BATTERY_LOW;
}

/**
 * Alerts once when the battery runs low and once more, urgently, at BATTERY_CRITICAL; both again only
 * after it has been charged. A first report already at the critical level sends only the urgent one.
 */
export class BatteryMonitor {
  private alerted: 'none' | 'low' | 'critical' = 'none';

  constructor(private readonly notify: (n: Notice) => Promise<void>) {}

  report(b: Battery): Promise<void> | undefined {
    if (b.charging || b.level > BATTERY_REARM) {
      this.alerted = 'none';
      return undefined;
    }
    if (!batteryLow(b) || this.alerted === 'critical') return undefined;
    if (b.level <= BATTERY_CRITICAL) {
      this.alerted = 'critical';
      return this.notify({
        title: 'Kindle-Akku: JETZT LADEN',
        message: `Der Akku des Dashboards ist bei ${b.level} %. Jetzt das Netzteil anschliessen, sonst schaltet der Kindle ab.`,
        tags: 'rotating_light',
        priority: 'urgent',
      });
    }
    if (this.alerted === 'low') return undefined;
    this.alerted = 'low';
    return this.notify({
      title: 'Kindle-Akku fast leer',
      message: `Der Akku des Dashboards ist bei ${b.level} %. Bitte das Netzteil anschliessen.`,
      tags: 'battery',
      priority: 'high',
    });
  }
}
