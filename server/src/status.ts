import type { Clock } from './clock.js';
import type { Battery } from './monitor.js';

export interface BatterySample extends Battery {
  at: Date;
}

/** Battery history kept for the status page. */
export const BATTERY_HISTORY_MS = 7 * 24 * 3600_000;
/** A sample at least this often, so the curve has points through long flat stretches. */
const SAMPLE_EVERY_MS = 3600_000;

/** What the Kindle last did: calls and battery, in memory since the server start. */
export class DeviceStatus {
  readonly startedAt: Date;
  lastSeen: Date | null = null;
  nextDue: Date | null = null;
  private samples: BatterySample[] = [];

  constructor(private readonly clock: Clock) {
    this.startedAt = clock();
  }

  /** A screen went out; the Kindle comes back in refreshSeconds. */
  delivered(refreshSeconds: number): void {
    const now = this.clock();
    this.lastSeen = now;
    this.nextDue = new Date(now.getTime() + refreshSeconds * 1000);
  }

  /** Records a reported battery state; returns true when level or charging changed. */
  battery(b: Battery): boolean {
    const now = this.clock();
    const last = this.samples.at(-1);
    const changed = !last || last.level !== b.level || last.charging !== b.charging;
    if (changed || now.getTime() - last.at.getTime() >= SAMPLE_EVERY_MS) this.samples.push({ at: now, level: b.level, charging: b.charging });
    const keepFrom = now.getTime() - BATTERY_HISTORY_MS;
    while (this.samples.length > 0 && this.samples[0]!.at.getTime() < keepFrom) this.samples.shift();
    return changed;
  }

  history(): readonly BatterySample[] {
    return this.samples;
  }
}
