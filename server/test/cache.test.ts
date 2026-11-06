import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../src/cache.js';
import { testClock } from './helpers.js';

describe('TtlCache', () => {
  it('serves a fresh value without reloading', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    const load = vi.fn(async () => 1);
    const cache = new TtlCache(60_000, load, clock);
    expect((await cache.get())?.value).toBe(1);
    clock.advance(59_000);
    expect((await cache.get())?.value).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads after the ttl and when forced', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    let n = 0;
    const cache = new TtlCache(60_000, async () => ++n, clock);
    await cache.get();
    clock.advance(60_000);
    expect((await cache.get())?.value).toBe(2);
    expect((await cache.get(true))?.value).toBe(3);
  });

  it('keeps the stale value when a reload fails', async () => {
    const clock = testClock('2026-11-03T07:00:00+01:00');
    let fail = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new TtlCache(60_000, async () => {
      if (fail) throw new Error('boom');
      return 'ok';
    }, clock);
    const first = await cache.get();
    fail = true;
    clock.advance(120_000);
    const second = await cache.get();
    expect(second?.value).toBe('ok');
    expect(second?.fetchedAt).toEqual(first?.fetchedAt);
    warn.mockRestore();
  });

  it('scrubs URLs from the load-failure warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const messages = ['Failed to parse URL from calendar.google.com/calendar/ical/secret/basic.ics', 'GET https://cal.test/private-abc/basic.ics failed'];
    for (const message of messages) {
      const cache = new TtlCache(60_000, async () => {
        throw new TypeError(message);
      }, testClock('2026-11-03T07:00:00+01:00'), 'calendar:PF');
      await cache.get();
    }
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      '[calendar:PF] load failed: <url>',
      '[calendar:PF] load failed: GET <url> failed',
    ]);
    warn.mockRestore();
  });

  it('returns null when the first load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new TtlCache(60_000, async () => {
      throw new Error('boom');
    }, testClock('2026-11-03T07:00:00+01:00'));
    expect(await cache.get()).toBeNull();
    warn.mockRestore();
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const load = vi.fn(async () => 'v');
    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('invalidate forces a reload but keeps the value as fallback', async () => {
    let n = 0;
    let fail = false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new TtlCache(60_000, async () => {
      if (fail) throw new Error('boom');
      return ++n;
    }, testClock('2026-11-03T07:00:00+01:00'));
    await cache.get();
    cache.invalidate();
    expect((await cache.get())?.value).toBe(2);
    cache.invalidate();
    fail = true;
    expect((await cache.get())?.value).toBe(2);
    warn.mockRestore();
  });

  it('invalidate() during in-flight load triggers a new load after the old one completes', async () => {
    const load = vi.fn(async () => 'value');
    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));
    const p1 = cache.get();
    cache.invalidate();
    await p1;
    const p2 = cache.get();
    expect((await p2)?.value).toBe('value');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('get(true) during in-flight load triggers a new load', async () => {
    const load = vi.fn(async () => 'value');
    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));
    const p1 = cache.get();
    await Promise.resolve(); // Let the first load start
    const p2 = cache.get(true);
    expect(p1).not.toBe(p2);
    expect((await p2)?.value).toBe('value');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('sync-throwing load is caught and returns null or stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new TtlCache(60_000, () => {
      throw new Error('sync boom');
    }, testClock('2026-11-03T07:00:00+01:00'));
    expect(await cache.get()).toBeNull();
    warn.mockRestore();
  });

  it('load1 started, get(true) starts load2, load2 resolves first → both get new value, no extra loads', async () => {
    let load1Resolve: (value: string) => void = () => {};
    const load1Promise = new Promise<string>((resolve) => {
      load1Resolve = resolve;
    });

    let load2Resolve: (value: string) => void = () => {};
    const load2Promise = new Promise<string>((resolve) => {
      load2Resolve = resolve;
    });

    let callCount = 0;
    const load = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return load1Promise;
      if (callCount === 2) return load2Promise;
      throw new Error('unexpected call');
    });

    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));

    const p1 = cache.get(); // Starts load1
    const p2 = cache.get(true); // Starts load2

    load2Resolve('new'); // load2 resolves first
    expect((await p2)?.value).toBe('new');

    load1Resolve('old'); // load1 resolves after load2
    expect((await p1)?.value).toBe('new'); // load1 chains to load2's result

    const p3 = cache.get(); // Should use cached entry
    expect((await p3)?.value).toBe('new');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('plain get() joins in-flight load started by get(true)', async () => {
    let load1Resolve: (value: string) => void = () => {};
    const load1Promise = new Promise<string>((resolve) => {
      load1Resolve = resolve;
    });

    let load2Resolve: (value: string) => void = () => {};
    const load2Promise = new Promise<string>((resolve) => {
      load2Resolve = resolve;
    });

    let callCount = 0;
    const load = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return load1Promise;
      if (callCount === 2) return load2Promise;
      throw new Error('unexpected call');
    });

    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));

    const p1 = cache.get(); // Starts load1
    load1Resolve('value1'); // load1 completes
    await p1;

    const p2 = cache.get(true); // Starts load2
    const p3 = cache.get(); // Plain get while load2 is in flight

    load2Resolve('value2');
    expect((await p2)?.value).toBe('value2');
    expect((await p3)?.value).toBe('value2');

    expect(load).toHaveBeenCalledTimes(2); // Should not start a third load
  });

  it('cold cache: get() → load1, invalidate(), get() → load2; first get() resolves to load2 value', async () => {
    let load1Resolve: (value: string) => void = () => {};
    const load1Promise = new Promise<string>((resolve) => {
      load1Resolve = resolve;
    });

    let load2Resolve: (value: string) => void = () => {};
    const load2Promise = new Promise<string>((resolve) => {
      load2Resolve = resolve;
    });

    let callCount = 0;
    const load = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return load1Promise;
      if (callCount === 2) return load2Promise;
      throw new Error('unexpected call');
    });

    const cache = new TtlCache(60_000, load, testClock('2026-11-03T07:00:00+01:00'));

    const p1 = cache.get(); // Starts load1, entry is null
    cache.invalidate(); // Bump generation
    const p2 = cache.get(); // Starts load2

    load1Resolve('value1'); // load1 resolves
    // p1 should now chain to p2

    load2Resolve('value2'); // load2 resolves

    const result1 = await p1;
    expect(result1?.value).toBe('value2'); // p1 got load2's value through chaining

    expect(load).toHaveBeenCalledTimes(2);
  });
});
