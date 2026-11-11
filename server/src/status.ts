import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Clock } from './clock.js';
import type { Battery } from './monitor.js';

export interface BatterySample extends Battery {
  at: Date;
}

/** Battery history kept for the status page. */
export const BATTERY_HISTORY_MS = 7 * 24 * 3600_000;
/** A sample at least this often, so the curve has points through long flat stretches. */
const SAMPLE_EVERY_MS = 3600_000;

const isSample = (v: unknown): v is { at: string; level: number; charging: boolean } => {
  const o = v as { at?: unknown; level?: unknown; charging?: unknown } | null;
  return typeof o?.at === 'string' && !Number.isNaN(Date.parse(o.at)) && typeof o.level === 'number' && typeof o.charging === 'boolean';
};

/** The battery curve in a file (on the state volume), so it survives a deploy. */
export class BatteryFile {
  private warned = false;

  constructor(private readonly path: string) {}

  /** The samples of the last seven days; none from a missing or broken file. */
  load(now: Date): BatterySample[] {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (!Array.isArray(data)) return [];
      const keepFrom = now.getTime() - BATTERY_HISTORY_MS;
      return data.filter(isSample).map((s) => ({ at: new Date(s.at), level: s.level, charging: s.charging })).filter((s) => s.at.getTime() >= keepFrom);
    } catch {
      return [];
    }
  }

  /** Writes through a temporary file; a failure is logged once and never thrown. */
  save(samples: readonly BatterySample[]): void {
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(samples));
      renameSync(`${this.path}.tmp`, this.path);
    } catch (err) {
      if (!this.warned) console.warn(`[battery] not saved: ${err instanceof Error ? err.message : String(err)}`);
      this.warned = true;
    }
  }
}

/** What the Kindle last did: calls since the server start, and the battery curve (kept in `file` if given). */
export class DeviceStatus {
  readonly startedAt: Date;
  lastSeen: Date | null = null;
  nextDue: Date | null = null;
  private samples: BatterySample[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly file?: BatteryFile,
  ) {
    this.startedAt = clock();
    this.samples = file?.load(this.startedAt) ?? [];
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
    const sample = changed || now.getTime() - last.at.getTime() >= SAMPLE_EVERY_MS;
    if (sample) this.samples.push({ at: now, level: b.level, charging: b.charging });
    const keepFrom = now.getTime() - BATTERY_HISTORY_MS;
    while (this.samples.length > 0 && this.samples[0]!.at.getTime() < keepFrom) this.samples.shift();
    if (sample) this.file?.save(this.samples);
    return changed;
  }

  history(): readonly BatterySample[] {
    return this.samples;
  }
}
