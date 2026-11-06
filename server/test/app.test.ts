import { describe, expect, it, vi } from 'vitest';
import { buildApp, type DashboardLike, PREVIEW_LOCK_MS, PREVIEW_MAX_FAILURES } from '../src/app.js';

const screen = { png: Buffer.from('PNG'), etag: '"abc"', refreshSeconds: 120, fullRefresh: true };

function app(over: Partial<DashboardLike> = {}, now?: () => number) {
  const dashboard: DashboardLike = {
    screen: vi.fn(async () => screen),
    tap: vi.fn(async () => screen),
    previewHtml: vi.fn(async () => '<html>preview</html>'),
    previewPng: vi.fn(async () => Buffer.from('PREVIEW')),
    ...over,
  };
  return { dashboard, app: buildApp({ dashboard, deviceToken: 'device-token', previewPassword: 'pw', stations: ['Sternen', 'Oerlikon', 'Hallenstadion'], now }) };
}

const bearer = { authorization: 'Bearer device-token' };
const basic = (u: string, p: string) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });

describe('HTTP API', () => {
  it('serves healthz without auth', async () => {
    const res = await app().app.inject({ method: 'GET', url: '/healthz' });
    expect([res.statusCode, res.body]).toEqual([200, 'ok']);
  });

  it('rejects missing or wrong device tokens with an empty 401', async () => {
    const { app: a } = app();
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'device-token' }]) {
      const res = await a.inject({ method: 'GET', url: '/screen.png', headers });
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('');
    }
  });

  it('returns the screen with headers', async () => {
    const res = await app().app.inject({ method: 'GET', url: '/screen.png', headers: bearer });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers.etag).toBe('"abc"');
    expect(res.headers['x-refresh-seconds']).toBe('120');
    expect(res.headers['x-full-refresh']).toBe('1');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.toString()).toBe('PNG');
  });

  it('omits X-Full-Refresh when not needed', async () => {
    const { app: a } = app({ screen: vi.fn(async () => ({ ...screen, fullRefresh: false })) });
    const res = await a.inject({ method: 'GET', url: '/screen.png', headers: bearer });
    expect(res.headers['x-full-refresh']).toBeUndefined();
  });

  it('handles taps: image, 204 and validation', async () => {
    const { app: a, dashboard } = app();
    const ok = await a.inject({ method: 'POST', url: '/tap', headers: bearer, payload: { x: 10, y: 790 } });
    expect(ok.statusCode).toBe(200);
    expect(dashboard.tap).toHaveBeenCalledWith(10, 790, false);
    await a.inject({ method: 'POST', url: '/tap', headers: bearer, payload: { x: 10, y: 790, hold: true } });
    expect(dashboard.tap).toHaveBeenLastCalledWith(10, 790, true);

    const { app: b } = app({ tap: vi.fn(async () => null) });
    expect((await b.inject({ method: 'POST', url: '/tap', headers: bearer, payload: { x: 1, y: 1 } })).statusCode).toBe(204);

    // device px of the 600×800 screen
    for (const payload of [{ x: 'a', y: 1 }, { x: 1 }, { x: 1, y: 1, hold: 'ja' }, { x: -1, y: 5 }, { x: 600, y: 1 }, { x: 1, y: 800 }]) {
      expect((await a.inject({ method: 'POST', url: '/tap', headers: bearer, payload })).statusCode).toBe(400);
    }
    expect((await a.inject({ method: 'POST', url: '/tap', payload: { x: 1, y: 1 } })).statusCode).toBe(401);
  });

  it('protects previews with basic auth and validates the view', async () => {
    const { app: a } = app();
    const denied = await a.inject({ method: 'GET', url: '/preview/heute' });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['www-authenticate']).toBe('Basic realm="kindle-dashboard"');
    expect((await a.inject({ method: 'GET', url: '/preview/heute', headers: basic('admin', 'wrong') })).statusCode).toBe(401);

    const html = await a.inject({ method: 'GET', url: '/preview/heute', headers: basic('admin', 'pw') });
    expect([html.statusCode, html.headers['content-type'], html.body]).toEqual([200, 'text/html; charset=utf-8', '<html>preview</html>']);

    const png = await a.inject({ method: 'GET', url: '/preview/woche?png=1', headers: basic('admin', 'pw') });
    expect(png.headers['content-type']).toBe('image/png');

    expect((await a.inject({ method: 'GET', url: '/preview/nope', headers: basic('admin', 'pw') })).statusCode).toBe(404);
  });

  it('lists all previews on an index page behind the same password', async () => {
    const { app: a } = app();
    expect((await a.inject({ method: 'GET', url: '/preview' })).statusCode).toBe(401);
    const index = await a.inject({ method: 'GET', url: '/preview', headers: basic('admin', 'pw') });
    expect(index.statusCode).toBe(200);
    for (const href of ['/preview/heute?abend=1', '/preview/heute?nacht=1', '/preview/heute?gast=1', '/preview/woche?gast=1', '/preview/wetter', '/preview/station?station=2', '/preview/station?station=2&amp;png=1']) {
      expect(index.body).toContain(`href="${href}"`);
    }
    expect(index.body).toContain('>Haltestelle Hallenstadion</a>');
  });

  it('passes the station and the evening simulation to the preview', async () => {
    const { app: a, dashboard } = app();
    await a.inject({ method: 'GET', url: '/preview/station?station=2', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('station', { station: 2, evening: false, night: false, guest: false });
    await a.inject({ method: 'GET', url: '/preview/heute?abend=1&png=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewPng).toHaveBeenLastCalledWith('heute', { station: undefined, evening: true, night: false, guest: false });
    await a.inject({ method: 'GET', url: '/preview/heute?nacht=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: true, guest: false });
    await a.inject({ method: 'GET', url: '/preview/wetter', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('wetter', { station: undefined, evening: false, night: false, guest: false });
    await a.inject({ method: 'GET', url: '/preview/woche?gast=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('woche', { station: undefined, evening: false, night: false, guest: true });
    expect((await a.inject({ method: 'GET', url: '/preview/station?station=x', headers: basic('admin', 'pw') })).statusCode).toBe(400);
  });

  it('sends security headers, and no-store plus a strict CSP on previews', async () => {
    const { app: a } = app();
    const health = await a.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['referrer-policy']).toBe('no-referrer');
    expect(health.headers['content-security-policy']).toBeUndefined();
    const preview = await a.inject({ method: 'GET', url: '/preview/heute', headers: basic('admin', 'pw') });
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await a.inject({ method: 'GET', url: '/screen.png', headers: bearer })).headers['cache-control']).toBe('no-store');
  });

  it('locks the preview after repeated wrong passwords, also for the right one, until the window passes', async () => {
    let t = 1_000_000;
    const { app: a } = app({}, () => t);
    expect((await a.inject({ method: 'GET', url: '/preview' })).statusCode).toBe(401); // login prompt, not counted
    for (let i = 0; i < PREVIEW_MAX_FAILURES; i++) {
      expect((await a.inject({ method: 'GET', url: '/preview', headers: basic('admin', `guess${i}`) })).statusCode).toBe(401);
    }
    const locked = await a.inject({ method: 'GET', url: '/preview', headers: basic('admin', 'pw') });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await a.inject({ method: 'GET', url: '/screen.png', headers: bearer })).statusCode).toBe(200); // the Kindle is unaffected
    t += PREVIEW_LOCK_MS;
    expect((await a.inject({ method: 'GET', url: '/preview', headers: basic('admin', 'pw') })).statusCode).toBe(200);
  });

  it('answers 500 without details when rendering fails', async () => {
    const { app: a } = app({ screen: vi.fn(async () => { throw new Error('chromium crashed at https://secret'); }) });
    const res = await a.inject({ method: 'GET', url: '/screen.png', headers: bearer });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret');
  });

  it('answers 401 before validation or view lookup', async () => {
    const { app: a } = app();
    const tap = await a.inject({ method: 'POST', url: '/tap', payload: { x: 'a' } });
    expect([tap.statusCode, tap.body]).toEqual([401, '']);
    expect((await a.inject({ method: 'GET', url: '/preview/nope' })).statusCode).toBe(401);
  });

  it('answers 500 for non-Error throws', async () => {
    const { app: a } = app({ screen: vi.fn(async () => { throw 'boom https://secret'; }) });
    const res = await a.inject({ method: 'GET', url: '/screen.png', headers: bearer });
    expect([res.statusCode, res.json()]).toEqual([500, { error: 'internal error' }]);
  });
});
