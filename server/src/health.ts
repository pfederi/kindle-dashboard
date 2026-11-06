/** Last success and last failure of one data source (a named TtlCache). */
export interface SourceHealth {
  name: string;
  lastOk: Date | null;
  lastError: { at: Date; message: string } | null;
}

/** What every data source last did, for the status page; kept in memory since the server start. */
export class HealthRegistry {
  private readonly sources = new Map<string, SourceHealth>();

  private entry(name: string): SourceHealth {
    let e = this.sources.get(name);
    if (!e) this.sources.set(name, (e = { name, lastOk: null, lastError: null }));
    return e;
  }

  ok(name: string, at: Date): void {
    this.entry(name).lastOk = at;
  }

  /** `message` must already be free of secrets (URLs scrubbed). */
  fail(name: string, at: Date, message: string): void {
    this.entry(name).lastError = { at, message };
  }

  list(): SourceHealth[] {
    return [...this.sources.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Shared by all caches of the process. */
export const sourceHealth = new HealthRegistry();
