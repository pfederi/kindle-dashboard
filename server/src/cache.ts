import type { Clock } from './clock.js';
import { type HealthRegistry, sourceHealth } from './health.js';

/** After a failed load, wait this long before trying again (unless forced), so a dead source costs one timeout, not one per request. */
export const RETRY_BACKOFF_MS = 60_000;

export interface Cached<T> {
  value: T;
  fetchedAt: Date;
}

/** Replaces URLs (which may contain secrets, e.g. private iCal paths) in log messages. */
export function scrubUrls(message: string): string {
  return message.replace(/https?:\/\/\S+|Failed to parse URL from \S+/g, '<url>');
}

/**
 * Time-based cache that never throws: a failed load keeps serving the last good value
 * (or null if there never was one). Concurrent callers share one in-flight load.
 */
export class TtlCache<T> {
  private entry: Cached<T> | null = null;
  private dirty = false;
  private failedAt: number | null = null;
  private inflight: Promise<Cached<T> | null> | null = null;
  private generation = 0;
  private inflightGeneration = 0;
  private entryGeneration = -1;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly clock: Clock,
    private readonly name = 'cache',
    private readonly health: HealthRegistry = sourceHealth,
  ) {}

  async get(force = false): Promise<Cached<T> | null> {
    const now = this.clock().getTime();
    const fresh = this.entry !== null && now - this.entry.fetchedAt.getTime() < this.ttlMs;
    if (!force && !this.dirty && fresh && this.entryGeneration === this.generation) return this.entry;

    const stillBackingOff = this.failedAt !== null && now - this.failedAt < RETRY_BACKOFF_MS;
    if (!force && !this.dirty && stillBackingOff && !this.inflight) return this.entry;

    // Bump generation if forcing to ensure a new load
    if (force) this.generation++;

    const currentGen = this.generation;

    // If there's an in-flight load of the current generation, return it
    if (this.inflight && this.inflightGeneration === currentGen) {
      return this.inflight;
    }

    // Need to start a new load (either no inflight or inflight is of an older generation)
    this.inflightGeneration = currentGen;
    const thisPromise: Promise<Cached<T> | null> = Promise.resolve()
      .then(() => this.load())
      .then(
        (value) => {
          this.health.ok(this.name, this.clock());
          this.failedAt = null;
          // Only update if generation hasn't changed since THIS load started (currentGen captured at start)
          if (currentGen === this.generation) {
            this.entry = { value, fetchedAt: this.clock() };
            this.entryGeneration = currentGen;
            this.dirty = false;
          } else if (this.inflight && this.inflight !== thisPromise) {
            // This load is superseded but a newer load is in flight; chain to it
            return this.inflight;
          }
          return this.entry;
        },
        (err: unknown) => {
          const message = scrubUrls(err instanceof Error ? err.message : String(err));
          console.warn(`[${this.name}] load failed: ${message}`);
          this.health.fail(this.name, this.clock(), message);
          this.failedAt = this.clock().getTime();
          if (currentGen === this.generation) {
            return this.entry;
          } else if (this.inflight && this.inflight !== thisPromise) {
            // This load is superseded but a newer load is in flight; chain to it
            return this.inflight;
          } else {
            return this.entry;
          }
        },
      )
      .finally(() => {
        // Only clear inflight if this specific promise is still inflight and generation matches
        if (this.inflight === thisPromise && currentGen === this.generation) {
          this.inflight = null;
        }
      });

    this.inflight = thisPromise;
    return thisPromise;
  }

  invalidate(): void {
    this.dirty = true;
    this.failedAt = null;
    this.generation++;
  }
}
