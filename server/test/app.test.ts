import { describe, expect, it, vi } from 'vitest';
import { buildApp, type DashboardLike, PREVIEW_LOCK_MS, PREVIEW_MAX_FAILURES, ROSTER_MAX_BYTES } from '../src/app.js';

const screen = { png: Buffer.from('PNG'), etag: '"abc"', refreshSeconds: 120, fullRefresh: true };

function app(over: Partial<DashboardLike> = {}, now?: () => number, onBattery?: (b: { level: number; charging: boolean }) => void) {
  const dashboard: DashboardLike = {
    screen: vi.fn(async () => screen),
    tap: vi.fn(async () => screen),
    previewHtml: vi.fn(async () => '<html>preview</html>'),
    previewPng: vi.fn(async () => Buffer.from('PREVIEW')),
    ...over,
  };
  return { dashboard, app: buildApp({ dashboard, deviceToken: 'device-token', previewPassword: 'pw', stations: ['Sternen', 'Oerlikon', 'Hallenstadion'], commutes: ['Zur Arbeit', 'Schule'], now, onBattery }) };
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

  it('passes the battery state of a screen request on, ignoring missing or invalid values', async () => {
    const seen: unknown[] = [];
    const { app: a } = app({}, undefined, (b) => seen.push(b));
    const get = (h: Record<string, string>) => a.inject({ method: 'GET', url: '/screen.png', headers: { ...bearer, ...h } });
    await get({ 'x-battery': '18' });
    await get({ 'x-battery': '100', 'x-charging': '1' });
    for (const bad of [{}, { 'x-battery': '101' }, { 'x-battery': '-1' }, { 'x-battery': '1e2' }, { 'x-battery': '' }]) expect((await get(bad)).statusCode).toBe(200);
    expect(seen).toEqual([
      { level: 18, charging: false },
      { level: 100, charging: true },
    ]);
    // Without a valid token the battery state is not taken.
    await a.inject({ method: 'GET', url: '/screen.png', headers: { 'x-battery': '5' } });
    expect(seen).toHaveLength(2);
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

  it('serves the status page behind the preview password, 404 when not wired', async () => {
    const dashboard = app().dashboard;
    const a = buildApp({ dashboard, deviceToken: 'device-token', previewPassword: 'pw', statusHtml: () => '<html>status</html>' });
    expect((await a.inject({ method: 'GET', url: '/preview/status' })).statusCode).toBe(401);
    const res = await a.inject({ method: 'GET', url: '/preview/status', headers: basic('admin', 'pw') });
    expect([res.statusCode, res.body, res.headers['cache-control']]).toEqual([200, '<html>status</html>', 'no-store']);
    expect((await app().app.inject({ method: 'GET', url: '/preview/status', headers: basic('admin', 'pw') })).statusCode).toBe(404);
  });

  it('previews the night with a chosen moon phase or holiday, and lists them on /preview/nacht', async () => {
    const { app: a, dashboard } = app();
    await a.inject({ method: 'GET', url: '/preview/heute?nacht=1&mond=180&feiertag=weihnachten', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', expect.objectContaining({ night: true, moon: 180, holiday: 'weihnachten' }));
    for (const bad of ['mond=360', 'mond=x', 'feiertag=fasnacht', 'feiertag=toString']) {
      expect((await a.inject({ method: 'GET', url: `/preview/heute?${bad}`, headers: basic('admin', 'pw') })).statusCode).toBe(400);
    }
    expect((await a.inject({ method: 'GET', url: '/preview/nacht' })).statusCode).toBe(401);
    const page = await a.inject({ method: 'GET', url: '/preview/nacht', headers: basic('admin', 'pw') });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('href="/preview/heute?nacht=1&amp;mond=180"');
    expect(page.body).toContain('href="/preview/heute?nacht=1&amp;feiertag=ostern"');
    expect(page.body.match(/<svg class="sky"/g)).toHaveLength(8);
    expect(page.body).not.toContain('<script');
  });

  it('lists all previews on an index page behind the same password', async () => {
    const { app: a } = app();
    expect((await a.inject({ method: 'GET', url: '/preview' })).statusCode).toBe(401);
    const index = await a.inject({ method: 'GET', url: '/preview', headers: basic('admin', 'pw') });
    expect(index.statusCode).toBe(200);
    for (const href of ['/preview/heute?abend=1', '/preview/heute?nacht=1', '/preview/heute?gast=1', '/preview/woche?gast=1', '/preview/wetter', '/preview/station?station=2', '/preview/station?station=2&amp;png=1', '/preview/status', '/preview/heute?akku=1', '/preview/heute?laden=1', '/preview/heute?nebel=1', '/preview/nacht', '/preview/arbeitsweg?ziel=0', '/preview/arbeitsweg?ziel=0&amp;stau=1', '/preview/arbeitsweg?ziel=1', '/preview/heute?schule=1']) {
      expect(index.body).toContain(`href="${href}"`);
    }
    expect(index.body).toContain('>Haltestelle Hallenstadion</a>');
  });

  it('passes the station, the evening simulation and a low or charging battery to the preview', async () => {
    const { app: a, dashboard } = app();
    await a.inject({ method: 'GET', url: '/preview/station?station=2', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('station', { station: 2, evening: false, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/heute?abend=1&png=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewPng).toHaveBeenLastCalledWith('heute', { station: undefined, evening: true, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/heute?nacht=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: true, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/wetter', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('wetter', { station: undefined, evening: false, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/woche?gast=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('woche', { station: undefined, evening: false, night: false, guest: true, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/heute?akku=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: false, guest: false, lowBattery: true, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/heute?laden=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: false, guest: false, lowBattery: false, charging: true, moon: undefined, holiday: undefined, jam: false, school: false, fog: false });
    await a.inject({ method: 'GET', url: '/preview/arbeitsweg?ziel=1&stau=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('arbeitsweg', { station: undefined, evening: false, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: true, commute: 1, school: false, fog: false });
    expect((await a.inject({ method: 'GET', url: '/preview/arbeitsweg?ziel=x', headers: basic('admin', 'pw') })).statusCode).toBe(400);
    await a.inject({ method: 'GET', url: '/preview/heute?schule=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: true, fog: false });
    await a.inject({ method: 'GET', url: '/preview/heute?nebel=1', headers: basic('admin', 'pw') });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', { station: undefined, evening: false, night: false, guest: false, lowBattery: false, charging: false, moon: undefined, holiday: undefined, jam: false, school: false, fog: true });
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

  describe('POST /dienstplan', () => {
    const token = 'roster-token-roster-token';
    const withRoster = () => {
      const receive = vi.fn(async () => ({ status: 200, text: 'November 2026: 10× Arbeit' }));
      const dashboard: DashboardLike = { screen: vi.fn(), tap: vi.fn(), previewHtml: vi.fn(), previewPng: vi.fn() };
      return { receive, a: buildApp({ dashboard, deviceToken: 'device-token', previewPassword: 'pw', roster: { token, receive } }) };
    };
    const post = (a: ReturnType<typeof buildApp>, headers: Record<string, string>, payload: Buffer | string = Buffer.from('%PDF-1.7')) =>
      a.inject({ method: 'POST', url: '/dienstplan', headers, payload });

    it('is not there without a token configured', async () => {
      expect((await post(app().app, { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' })).statusCode).toBe(404);
    });

    it('takes the PDF with the token and answers in plain text', async () => {
      const { a, receive } = withRoster();
      const res = await post(a, { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' });
      expect([res.statusCode, res.headers['content-type'], res.body]).toEqual([200, 'text/plain; charset=utf-8', 'November 2026: 10× Arbeit']);
      expect(Buffer.isBuffer(receive.mock.calls[0]![0])).toBe(true);
      // Some versions of Shortcuts send the file as octet-stream.
      expect((await post(a, { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' })).statusCode).toBe(200);
    });

    it('refuses a wrong token before reading', async () => {
      const { a, receive } = withRoster();
      expect((await post(a, { authorization: 'Bearer device-token', 'content-type': 'application/pdf' })).statusCode).toBe(401);
      expect((await post(a, { 'content-type': 'application/pdf' })).statusCode).toBe(401);
      expect(receive).not.toHaveBeenCalled();
    });

    it('hands any body to the check as bytes, so a wrong file gets a sentence the shortcut can show', async () => {
      const { a, receive } = withRoster();
      const auth = { authorization: `Bearer ${token}` };
      for (const type of ['image/jpeg', 'text/plain', 'application/json', 'multipart/form-data; boundary=x']) {
        expect((await post(a, { ...auth, 'content-type': type }, 'GIF89a')).statusCode).toBe(200);
        expect((receive.mock.calls.at(-1) as unknown as [Buffer])[0].toString()).toBe('GIF89a');
      }
      expect((await post(a, auth, 'GIF89a')).statusCode).toBe(200); // no type at all
      expect((await post(a, auth, '')).statusCode).toBe(200); // nothing at all
      expect((receive.mock.calls.at(-1) as unknown as [Buffer])[0]).toEqual(Buffer.alloc(0));
    });

    it('says in plain text when the file is too large, without reading it', async () => {
      const { a, receive } = withRoster();
      const res = await post(a, { authorization: `Bearer ${token}`, 'content-type': 'application/pdf' }, Buffer.alloc(ROSTER_MAX_BYTES + 1));
      expect([res.statusCode, res.headers['content-type'], res.body]).toEqual([413, 'text/plain; charset=utf-8', 'Dienstplan nicht erkannt: Datei zu gross (höchstens 2 MB)']);
      expect(receive).not.toHaveBeenCalled();
    });

    it('keeps its parsers to itself: other routes still refuse raw bytes', async () => {
      const { a } = withRoster();
      const res = await a.inject({ method: 'POST', url: '/tap', headers: { ...bearer, 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
      expect(res.statusCode).toBe(415);
    });
  });

  it('previews Heute with a duty, and lists it', async () => {
    const { app: a, dashboard } = app();
    const auth = basic('admin', 'pw');
    expect((await a.inject({ method: 'GET', url: '/preview/heute?dienst=arbeit', headers: auth })).statusCode).toBe(200);
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', expect.objectContaining({ shift: 'work' }));
    await a.inject({ method: 'GET', url: '/preview/heute?dienst=schule', headers: auth });
    expect(dashboard.previewHtml).toHaveBeenLastCalledWith('heute', expect.objectContaining({ shift: 'school' }));
    expect((await a.inject({ method: 'GET', url: '/preview/heute?dienst=nacht', headers: auth })).statusCode).toBe(400);
    const index = (await a.inject({ method: 'GET', url: '/preview', headers: auth })).body;
    expect(index).toContain('Heute mit Dienst (Arbeit)');
    expect(index).toContain('Heute mit Dienst (Schule)');
  });
});
