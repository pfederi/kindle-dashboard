import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isoDate } from '../format.js';
import type { Roster, RosterDay } from './parse.js';
import { type Shift, shiftOn } from './shift.js';

const FILE = /^roster-\d{4}-\d{2}\.json$/;

function isStored(v: unknown): v is Roster & { uploadedAt: string } {
  const o = v as { month?: unknown; days?: unknown; uploadedAt?: unknown } | null;
  return (
    typeof o?.month === 'string' && /^\d{4}-\d{2}$/.test(o.month) && typeof o.days === 'object' && o.days !== null && typeof o.uploadedAt === 'string' && !Number.isNaN(Date.parse(o.uploadedAt))
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Read rosters, one JSON file per month in `dir` (a volume in Coolify); a new upload replaces its month. */
export class RosterStore {
  private readonly months = new Map<string, { roster: Roster; uploadedAt: Date }>();
  /** The last failed upload, for the status page; a good one clears it. */
  lastError: { at: Date; text: string } | null = null;

  constructor(private readonly dir: string) {}

  /** Reads what is there; a missing directory or a broken file is logged, never fatal. */
  load(): void {
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch (err) {
      console.warn(`[roster] ${this.dir} not readable: ${message(err)}`);
      return;
    }
    for (const f of files.filter((name) => FILE.test(name))) {
      try {
        const data = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as unknown;
        if (!isStored(data)) throw new Error('unexpected content');
        this.months.set(data.month, { roster: { month: data.month, days: data.days }, uploadedAt: new Date(data.uploadedAt) });
      } catch (err) {
        console.warn(`[roster] ${f} skipped: ${message(err)}`);
      }
    }
  }

  /** Writes through a temporary file, so a crash never leaves half a plan; throws when the directory is not writable. */
  save(roster: Roster, uploadedAt: Date): void {
    const file = join(this.dir, `roster-${roster.month}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...roster, uploadedAt: uploadedAt.toISOString() }));
    renameSync(`${file}.tmp`, file);
    this.months.set(roster.month, { roster, uploadedAt });
  }

  /** The entry of the local date; null when its month has no plan. */
  day(date: Date): RosterDay | null {
    const iso = isoDate(date);
    return this.months.get(iso.slice(0, 7))?.roster.days[Number(iso.slice(8, 10))] ?? null;
  }

  /** Today's duty, 'free' on a day off, null without a plan for this month. */
  today(now: Date): Shift | 'free' | null {
    const day = this.day(now);
    return day === null ? null : (shiftOn(day, now) ?? 'free');
  }

  /** Loaded months, oldest first. */
  list(): { month: string; uploadedAt: Date }[] {
    return [...this.months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, s]) => ({ month, uploadedAt: s.uploadedAt }));
  }
}
