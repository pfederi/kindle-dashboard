import { describe, expect, it, vi } from 'vitest';
import { KindleMonitor, type Notice, ntfySender } from '../src/monitor.js';
import { fakeFetch, jsonResponse, testClock } from './helpers.js';

describe('KindleMonitor', () => {
  const setup = () => {
    const clock = testClock('2026-11-04T10:00:00+01:00');
    const sent: Notice[] = [];
    const monitor = new KindleMonitor(async (n) => void sent.push(n), clock, 15 * 60_000, 120);
    return { clock, sent, monitor };
  };

  it('alerts once when the Kindle is overdue by more than the grace time, and once when it is back', async () => {
    const { clock, sent, monitor } = setup();
    monitor.seen(120);
    clock.advance(16 * 60_000); // 2 min expected + 15 min grace not yet over
    await monitor.check();
    expect(sent).toEqual([]);
    clock.advance(2 * 60_000);
    await monitor.check();
    await monitor.check();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'Kindle meldet sich nicht', priority: 'high' });
    expect(sent[0]!.message).toContain('seit 10:00 Uhr');
    clock.advance(60_000);
    await monitor.seen(120);
    expect(sent[1]).toMatchObject({ title: 'Kindle wieder online', priority: 'default' });
    expect(sent[1]!.message).toContain('10:19');
  });

  it('stays quiet through long quiet hours the Kindle was told about', async () => {
    const { clock, sent, monitor } = setup();
    monitor.seen(5.5 * 3600); // told to come back after the night
    clock.advance(5 * 3600_000);
    await monitor.check();
    expect(sent).toEqual([]);
  });

  it('expects the first call after a (re)start within the regular interval plus grace', async () => {
    const { clock, sent, monitor } = setup();
    clock.advance(16 * 60_000);
    await monitor.check();
    expect(sent).toEqual([]);
    clock.advance(2 * 60_000);
    await monitor.check();
    expect(sent[0]!.message).toContain('seit dem Serverstart');
  });
});

describe('ntfySender', () => {
  it('posts title, tags and priority as headers and the text as body', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({}));
    await ntfySender({ server: 'https://ntfy.sh', topic: 'kindle-x7Gq2pLm9vRt', graceMinutes: 15 }, fetchFn)({ title: 'Kindle meldet sich nicht', message: 'Bitte prüfen', tags: 'warning', priority: 'high' });
    const call = fetchFn.calls[0]!;
    expect([call.method, call.url, call.body]).toEqual(['POST', 'https://ntfy.sh/kindle-x7Gq2pLm9vRt', 'Bitte prüfen']);
    expect(call.headers).toMatchObject({ Title: 'Kindle meldet sich nicht', Tags: 'warning', Priority: 'high' });
  });

  it('never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = fakeFetch(() => {
      throw new Error('offline');
    });
    await expect(ntfySender({ server: 'https://ntfy.sh', topic: 't'.repeat(12), graceMinutes: 15 }, failing)({ title: 'x', message: 'y', tags: 'z', priority: 'default' })).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
