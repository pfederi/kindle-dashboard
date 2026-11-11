import { describe, expect, it, vi } from 'vitest';
import type { BirthdayConfig, QuietHours, GuestWifi } from '../src/config.js';
import { Dashboard, type Sources } from '../src/dashboard.js';
import type { Renderer } from '../src/render/renderer.js';
import type { ShoppingSource } from '../src/sources/bring/source.js';
import type { Zone } from '../src/zones.js';
import { dryWeather, heuteModel } from './fixtures/models.js';
import { testClock } from './helpers.js';

/** Fake renderer: every element with data-action or data-hold becomes a 10x10 zone stacked vertically; png = html bytes. */
class FakeRenderer implements Renderer {
  lastHtml = '';
  async render(html: string) {
    this.lastHtml = html;
    const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]+)"`))?.[1]?.replaceAll('&amp;', '&');
    const tags = [...html.matchAll(/<[^>]*data-(?:action|hold)="[^>]*>/g)].map((m) => m[0]);
    const zones: Zone[] = tags.map((tag, i) => {
      const hold = attr(tag, 'data-hold');
      return { action: attr(tag, 'data-action') ?? '', ...(hold ? { hold } : {}), x: 0, y: i * 10, w: 10, h: 10 };
    });
    return { png: Buffer.from(html), zones };
  }
  async close() {}
}

function sources(over: Partial<ShoppingSource> = {}): Sources & { bring: ShoppingSource } {
  const m = heuteModel();
  return {
    weather: { get: vi.fn(async () => m.weather) },
    calendar: { events: vi.fn(async () => []) },
    transit: { boards: vi.fn(async () => []) },
    bring: {
      list: vi.fn(async () => m.shopping),
      add: vi.fn(async (name: string) => ({ kind: 'added' as const, name, key: name, urgent: false })),
      complete: vi.fn(async (key: string) => ({ kind: 'done' as const, key, name: key, spec: key === 'Milch' ? '2 l' : '' })),
      toggleUrgent: vi.fn(async (key: string) => ({ kind: 'done' as const, key, name: key, urgent: true })),
      restore: vi.fn(async () => true),
      suggestions: vi.fn(async (input: string) => (input.length >= 2 ? ['Milch'] : [])),
      frequent: vi.fn(async () => ['Butter']),
      ...over,
    },
  };
}

/** Like Bring!: `names` and new entries in the order they were added, oldest first. */
function taskSource(names: string[]): ShoppingSource & { open: string[] } {
  const open = [...names];
  return {
    open,
    list: vi.fn(async () => ({ ok: true as const, listName: 'Aufgaben', items: open.map((n) => ({ key: n, name: n, spec: '' })) })),
    add: vi.fn(async (name: string) => {
      open.push(name.trim());
      return { kind: 'added' as const, name: name.trim() };
    }),
    complete: vi.fn(async (key: string) => {
      const i = open.indexOf(key);
      if (i < 0) return { kind: 'gone' as const, key, name: key, spec: '' };
      open.splice(i, 1);
      return { kind: 'done' as const, key, name: key, spec: '' };
    }),
    restore: vi.fn(async () => true),
    suggestions: vi.fn(async () => []),
    frequent: vi.fn(async () => ['Abfall entsorgen', 'Staubsaugen']),
    toggleUrgent: vi.fn(async (key: string) => ({ kind: 'done' as const, key, name: key, urgent: true })),
  };
}

function setup(over: Partial<ShoppingSource> = {}, opts: { at?: string; quietHours?: QuietHours | null; birthdays?: BirthdayConfig[]; guestWifi?: GuestWifi } = {}) {
  const clock = testClock(opts.at ?? '2026-11-03T07:40:00+01:00');
  const renderer = new FakeRenderer();
  const src = sources(over);
  const dash = new Dashboard({
    sources: src,
    renderer,
    clock,
    refreshSeconds: 120,
    quietHours: opts.quietHours ?? null,
    viewResetSeconds: 120,
    birthdays: opts.birthdays,
    guestWifi: opts.guestWifi,
  });
  const tapAction = async (action: string) => {
    const zones = (dash as unknown as { state: { zones: Zone[] } }).state.zones;
    const z = zones.find((zz) => zz.action === action);
    if (!z) throw new Error(`no zone ${action}; have ${zones.map((zz) => zz.action).join(',')}`);
    return dash.tap(z.x + 1, z.y + 1);
  };
  const holdAction = async (hold: string) => {
    const zones = (dash as unknown as { state: { zones: Zone[] } }).state.zones;
    const z = zones.find((zz) => zz.hold === hold);
    if (!z) throw new Error(`no hold zone ${hold}`);
    return dash.tap(z.x + 1, z.y + 1, true);
  };
  return { clock, renderer, src, dash, tapAction, holdAction };
}

describe('Dashboard', () => {
  it('renders Heute first with refresh headers and a stable etag', async () => {
    const { dash, renderer } = setup();
    const a = await dash.screen();
    expect(renderer.lastHtml).toContain('view-heute');
    expect(a.refreshSeconds).toBe(120);
    expect(a.fullRefresh).toBe(false);
    expect(a.etag).toMatch(/^"[0-9a-f]{40}"$/);
    expect((await dash.screen()).etag).toBe(a.etag);
    expect(renderer.lastHtml).not.toContain('See ');
  });

  it('shows the lake temperature when a lake source is configured', async () => {
    const { dash, renderer, src } = setup();
    src.lake = { get: vi.fn(async () => 12.6) };
    await dash.screen();
    expect(renderer.lastHtml).toContain('See 13°');
    expect(src.lake.get).toHaveBeenCalledWith(false);
  });

  it('says when the Uetliberg is sunny above the fog, from the last hour measured', async () => {
    const { dash, renderer, src, clock } = setup();
    const now = clock();
    const fog = { at: new Date(now.getTime() - 15 * 60_000), city: 0, top: 60, radiation: 300 };
    src.weather.get = vi.fn(async () => dryWeather());
    src.uetliberg = { get: vi.fn(async () => fog) };
    await dash.screen();
    expect(renderer.lastHtml).toContain('Uetliberg sonnig');
    expect(src.uetliberg.get).toHaveBeenCalledWith(false);
    src.uetliberg.get.mockResolvedValue({ ...fog, city: 30 });
    await dash.screen();
    expect(renderer.lastHtml).not.toContain('Uetliberg sonnig');
    expect(await dash.previewHtml('heute', { fog: true })).toContain('Uetliberg sonnig');
  });

  it('adds today\'s and tomorrow\'s waste collections to Heute and the week to Woche', async () => {
    const { dash, renderer, src, tapAction } = setup();
    src.waste = {
      pickups: vi.fn(async () => [
        { date: '2026-11-03', type: 'cardboard' as const },
        { date: '2026-11-04', type: 'paper' as const },
        { date: '2026-11-06', type: 'cardboard' as const },
      ]),
    };
    await dash.screen();
    const heute = renderer.lastHtml;
    expect(heute).toMatch(/<span class="time">ganzt\.<\/span><span class="cal waste">.*?<span class="ev-title ellipsis">Karton<\/span>/);
    expect(heute).toMatch(/<span class="time">morgen<\/span><span class="cal waste">.*?<span class="ev-title ellipsis">Papier<\/span>/);
    expect(heute.match(/class="cal waste"/g)).toHaveLength(2); // not yet the cardboard of the 6th
    await tapAction('nav:woche');
    expect(renderer.lastHtml.match(/class="cal waste"/g)).toHaveLength(3);
    expect(src.waste.pickups).toHaveBeenCalledWith(false);
  });

  it('shows seven days from today in Woche, also across the weekend', async () => {
    const { dash, renderer, src, tapAction } = setup({}, { at: '2026-11-08T10:00:00+01:00' }); // a Sunday
    await dash.screen();
    await tapAction('nav:woche');
    expect(src.calendar.events).toHaveBeenCalledWith(new Date('2026-11-08T00:00:00+01:00'), new Date('2026-11-15T00:00:00+01:00'), false);
    expect(renderer.lastHtml).toContain('8.–14. November');
    expect(renderer.lastHtml).toContain('class="day today">So 8</div>');
    expect(renderer.lastHtml).toContain('>Sa 14</div>');
  });

  it('opens a station with both directions and actual termini, and closes back to Heute', async () => {
    const { dash, renderer, src, tapAction } = setup();
    const at = (hm: string) => new Date(`2026-11-03T${hm}:00+01:00`);
    const dep = (line: string, hm: string, to: string, inbound: boolean, delayMin = 0) => ({ line, planned: at(hm), delayMin, to, inbound });
    const station = (id: string, name: string, lines: string[]) => ({ id, name, via: 'x', lines });
    src.transit.boards = vi.fn(async () => [
      { station: station('1', 'Sternen', ['10']), departures: [], fetchedAt: at('07:40') },
      { station: station('2', 'Oerlikon', ['S7']), departures: [], fetchedAt: at('07:40') },
      {
        station: station('3', 'Hallenstadion', ['11', '14']),
        officialName: 'Zürich, Messe/Hallenstadion',
        departures: [
          dep('11', '07:42', 'Zürich, Seebach', false),
          dep('14', '07:43', 'Zürich, Bahnhofplatz/HB', true, 2),
          dep('14', '07:45', 'Zürich, Seebach', false),
          dep('11', '07:47', 'Zürich, Rehalp', true),
          dep('11', '07:50', 'Zürich, Auzelg', false),
        ],
        fetchedAt: at('07:40'),
      },
    ]);
    await dash.screen();
    expect(renderer.lastHtml).toContain('<div class="col" data-action="station:2">');
    expect(renderer.lastHtml).toContain('07:43');
    expect(renderer.lastHtml).not.toContain('07:42'); // Heute keeps to «→ Stadt»
    const opened = await tapAction('station:2');
    expect(opened?.fullRefresh).toBe(true);
    const html = renderer.lastHtml;
    expect(html).toContain('<div class="title serif">Messe/Hallenstadion</div>');
    expect(html).toContain('Schliessen');
    expect(html).toContain('← Richtung Seebach');
    expect(html.indexOf('→ Richtung Stadt')).toBeLessThan(html.indexOf('Bahnhofplatz/HB'));
    expect(html.indexOf('Rehalp')).toBeLessThan(html.indexOf('← Richtung Seebach'));
    expect(html.indexOf('← Richtung Seebach')).toBeLessThan(html.indexOf('Auzelg'));
    expect(html).toContain('<span class="delay">+2</span>');
    const back = await tapAction('close');
    expect(dash.view).toBe('heute');
    expect(back?.fullRefresh).toBe(true);
  });

  it('answers the refresh tab with a full refresh as visible feedback', async () => {
    const { dash, tapAction } = setup();
    await dash.screen();
    const s = await tapAction('refresh');
    expect(s?.fullRefresh).toBe(true);
    expect((await dash.screen()).fullRefresh).toBe(false);
  });

  it('switches Heute to tonight and tomorrow from 19:00, with tomorrow\'s collection', async () => {
    const { dash, renderer, src } = setup({}, { at: '2026-11-03T19:30:00+01:00' });
    src.waste = { pickups: vi.fn(async () => [{ date: '2026-11-04', type: 'paper' as const }]) };
    await dash.screen();
    expect(src.calendar.events).toHaveBeenCalledWith(new Date('2026-11-03T00:00:00+01:00'), new Date('2026-11-05T00:00:00+01:00'), false);
    const html = renderer.lastHtml;
    expect(html).toContain('<div class="tlabel">morgen</div>');
    expect(html).toMatch(/<div class="section-title"><span>Morgen<\/span><\/div>.*<span class="time">ganzt\.<\/span><span class="cal waste">.*Papier/);
    expect(html).not.toContain('>morgen</span>'); // no «morgen» label in the evening list
  });

  it('shows the daily weather in Woche', async () => {
    const { dash, renderer, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:woche');
    expect(renderer.lastHtml).toContain('<span>9°/2°</span>');
    expect(renderer.lastHtml.match(/class="dw"/g)).toHaveLength(3); // the fixture has three days
  });

  it('opens the weather screen from the weather block and closes back to Heute', async () => {
    const { dash, renderer, src, tapAction } = setup();
    await dash.screen();
    expect(renderer.lastHtml).toContain('<div class="wxblock" data-action="weather">');
    src.lake = { get: vi.fn(async () => 12.6) };
    const opened = await tapAction('weather');
    expect(opened?.fullRefresh).toBe(true);
    expect(renderer.lastHtml).toContain('view-wetter');
    expect(renderer.lastHtml).toContain('See 13°');
    await tapAction('close');
    expect(dash.view).toBe('heute');
  });

  it('reports every delivered screen with its refresh interval, but not previews', async () => {
    const delivered: number[] = [];
    const renderer = new FakeRenderer();
    const dash = new Dashboard({ sources: sources(), renderer, clock: testClock('2026-11-03T07:40:00+01:00'), refreshSeconds: 120, quietHours: null, viewResetSeconds: 120, onDelivered: (s) => delivered.push(s) });
    await dash.screen();
    await dash.previewHtml('woche');
    await dash.previewPng('heute');
    expect(delivered).toEqual([120]);
  });

  it('shows the night screen for the coming day during quiet hours', async () => {
    const quietHours = { start: 0, end: 330 };
    const { dash, renderer, src } = setup({}, { at: '2026-11-04T00:30:00+01:00', quietHours });
    const s = await dash.screen();
    expect(renderer.lastHtml).toContain('view-nacht');
    expect(renderer.lastHtml).toContain('Gute Nacht');
    expect(renderer.lastHtml).toContain('Mittwoch, 4. November');
    expect(src.calendar.events).toHaveBeenCalledWith(new Date('2026-11-04T00:00:00+01:00'), new Date('2026-11-05T00:00:00+01:00'), false);
    expect(s.refreshSeconds).toBe(5 * 3600);
  });

  it('shows the battery level in the header of Heute and the night screen when low, or while charging with a bolt', async () => {
    const quietHours = { start: 0, end: 330 };
    const { dash, renderer, clock } = setup({}, { quietHours });
    await dash.screen();
    expect(renderer.lastHtml).not.toContain('class="batt"');
    dash.reportBattery({ level: 21, charging: false });
    await dash.screen();
    expect(renderer.lastHtml).not.toContain('class="batt"');
    dash.reportBattery({ level: 18, charging: false });
    await dash.screen();
    expect(renderer.lastHtml).toMatch(/class="batt">.*18 %<\/span>/);
    clock.set('2026-11-04T00:30:00+01:00');
    await dash.screen();
    expect(renderer.lastHtml).toContain('Gute Nacht');
    expect(renderer.lastHtml).toContain('18 %');
    dash.reportBattery({ level: 18, charging: true });
    await dash.screen();
    expect(renderer.lastHtml).toMatch(/class="batt charging">.*18 %<\/span>/);
    clock.set('2026-11-04T07:40:00+01:00');
    dash.reportBattery({ level: 100, charging: true });
    await dash.screen();
    expect(renderer.lastHtml).toMatch(/class="batt charging">.*100 %<\/span>/);
    dash.reportBattery({ level: 100, charging: false });
    await dash.screen();
    expect(renderer.lastHtml).not.toContain('class="batt');
  });

  it('adds the walk to the scooter to the ride: door to door, also for the arrival time', async () => {
    const { dash, renderer, src } = setup();
    src.commutes = [{ label: 'Zur Arbeit', icon: 'work', walkMinutes: 5, get: vi.fn(async () => ({ minutes: 18, delayMinutes: 4 })), route: vi.fn(async () => null) }];
    await dash.screen();
    expect(renderer.lastHtml).toContain('<b>23 Min.</b><span>an 08:03</span><b class="late">+4 Min. Stau</b>');
  });

  it('opens «Arbeitsweg» from the commute line, and closes back to Heute', async () => {
    const { dash, renderer, src, tapAction } = setup();
    const route = vi.fn(async () => ({
      routes: [{ minutes: 18, delayMinutes: 0, stretches: [{ points: [[47.41, 8.54], [47.36, 8.52]] as [number, number][], ratio: 1, name: 'A', length: 10 }] }],
      view: { lat: 47.385, lon: 8.53, zoom: 13 },
      image: null,
    }));
    src.commutes = [{ label: 'Ins Büro', icon: 'work', walkMinutes: 2, get: vi.fn(async () => ({ minutes: 18, delayMinutes: 0 })), route }];
    await dash.screen();
    expect(renderer.lastHtml).toContain('<div class="commute" data-action="commute:0">');
    const opened = await tapAction('commute:0');
    expect(dash.view).toBe('arbeitsweg');
    expect(opened?.fullRefresh).toBe(true);
    expect(route).toHaveBeenCalledOnce();
    expect(renderer.lastHtml).toContain('<div class="title serif">Ins Büro</div>');
    expect(renderer.lastHtml).toContain('<b>20 Min.</b> an 08:00');
    const back = await tapAction('close');
    expect(dash.view).toBe('heute');
    expect(back?.fullRefresh).toBe(true);
    // The preview can act out a jam on the real route.
    expect(await dash.previewHtml('arbeitsweg')).toContain('Verkehr wie üblich');
    expect(await dash.previewHtml('arbeitsweg', { jam: true })).toContain('+7 Min. Stau');
  });

  it('opens the school from its part of the line, and switches between the tabs with a full refresh', async () => {
    const { dash, renderer, src, tapAction } = setup();
    const detail = (minutes: number) => ({
      routes: [{ minutes, delayMinutes: 0, stretches: [{ points: [[47.41, 8.54], [47.36, 8.52]] as [number, number][], ratio: 1, name: 'A', length: 10 }] }],
      view: { lat: 47.385, lon: 8.53, zoom: 13 },
      image: null,
    });
    const work = vi.fn(async () => detail(18));
    const school = vi.fn(async () => detail(11));
    src.commutes = [
      { label: 'Zur Arbeit', icon: 'work', get: vi.fn(async () => ({ minutes: 18, delayMinutes: 0 })), route: work },
      { label: 'Schule', icon: 'school', badge: 'LE', get: vi.fn(async () => ({ minutes: 11, delayMinutes: 0 })), route: school },
    ];
    await dash.screen();
    expect(renderer.lastHtml).toContain('<span class="cal">LE</span><span class="sep"></span>');
    expect(renderer.lastHtml).toContain('<span class="dest" data-action="commute:1">');
    await tapAction('commute:1');
    expect(dash.view).toBe('arbeitsweg');
    expect(school).toHaveBeenCalledOnce();
    expect(work).not.toHaveBeenCalled();
    expect(renderer.lastHtml).toContain('<div class="seg on" data-action="commute:1">');
    expect(renderer.lastHtml).toContain('<b>11 Min.</b>');
    const swapped = await tapAction('commute:0');
    expect(swapped?.fullRefresh).toBe(true);
    expect(renderer.lastHtml).toContain('<div class="seg on" data-action="commute:0">');
    expect(renderer.lastHtml).toContain('<b>18 Min.</b>');
    // The same tab again: nothing to swap, no flash.
    expect((await tapAction('commute:0'))?.fullRefresh).toBe(false);
    expect(await dash.previewHtml('arbeitsweg', { commute: 1 })).toContain('<b>11 Min.</b>');
  });

  it('shows the school in Heute only on its days, without asking HERE on the others; the map keeps both tabs', async () => {
    const { dash, renderer, src, clock, tapAction } = setup(); // Tuesday
    const get = vi.fn(async () => ({ minutes: 11, delayMinutes: 0 }));
    const route = vi.fn(async () => null);
    src.commutes = [
      { label: 'Zur Arbeit', icon: 'work', get: vi.fn(async () => ({ minutes: 18, delayMinutes: 0 })), route: vi.fn(async () => null) },
      { label: 'Schule', icon: 'school', days: [1, 2], get, route },
    ];
    await dash.screen();
    expect(renderer.lastHtml).toContain('data-action="commute:1"');
    clock.set('2026-11-04T07:40:00+01:00'); // Wednesday
    get.mockClear();
    await dash.screen();
    expect(renderer.lastHtml).not.toContain('data-action="commute:1"');
    expect(renderer.lastHtml).toContain('<span>Zur Arbeit</span><b>18 Min.</b><span>an 07:58</span>');
    expect(get).not.toHaveBeenCalled();
    await tapAction('commute:0');
    expect(renderer.lastHtml).toContain('<div class="seg on" data-action="commute:0">');
    expect(route).not.toHaveBeenCalled();
    await tapAction('commute:1');
    expect(renderer.lastHtml).toContain('<div class="seg on" data-action="commute:1">');
    expect(route).toHaveBeenCalledOnce();
    // The preview «Heute mit Schule» shows it whatever the day.
    expect(await dash.previewHtml('heute', { school: true })).toContain('data-action="commute:1"');
    expect(await dash.previewHtml('heute')).not.toContain('data-action="commute:1"');
  });

  it('previews «Arbeitsweg» without a commute configured, and leaves the device where it is', async () => {
    const { dash } = setup();
    expect(await dash.previewHtml('arbeitsweg')).toContain('keine Verkehrsdaten');
    expect(dash.view).toBe('heute');
  });

  it('previews a low and a charging battery', async () => {
    const { dash } = setup();
    expect(await dash.previewHtml('heute')).not.toContain('class="batt"');
    expect(await dash.previewHtml('heute', { lowBattery: true })).toContain('15 %');
    expect(await dash.previewHtml('heute', { charging: true })).toMatch(/class="batt charging">.*62 %/);
  });

  describe('«Tag starten» on the night screen', () => {
    const quietHours = { start: 0, end: 7 * 60 };

    it('a tap on the night screen shows Heute with the regular refresh until the quiet hours end', async () => {
      const { dash, renderer, clock, tapAction } = setup({}, { at: '2026-11-04T05:00:00+01:00', quietHours });
      const night = await dash.screen();
      expect(renderer.lastHtml).toContain('view-nacht');
      expect(renderer.lastHtml).toContain('Antippen: Tag starten');
      expect(night.refreshSeconds).toBe(2 * 3600);
      const day = await tapAction('day');
      expect(renderer.lastHtml).toContain('view-heute');
      expect([day?.refreshSeconds, day?.fullRefresh]).toEqual([120, true]);
      clock.set('2026-11-04T06:30:00+01:00');
      expect((await dash.screen()).refreshSeconds).toBe(120);
      expect(renderer.lastHtml).toContain('view-heute');
      // The next night starts as usual.
      clock.set('2026-11-05T00:30:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).toContain('view-nacht');
    });

    it('the tabs on the night screen still work, and previews keep showing the night', async () => {
      const { dash, renderer, tapAction } = setup({}, { at: '2026-11-04T05:00:00+01:00', quietHours });
      await dash.screen();
      await tapAction('nav:woche');
      expect(renderer.lastHtml).toContain('view-woche');
      await tapAction('nav:heute');
      await tapAction('day');
      expect(await dash.previewHtml('heute', { night: true })).toContain('view-nacht');
    });
  });

  it('shows the moon of the night and a holiday greeting; previews choose phase and holiday', async () => {
    const { dash, renderer, clock } = setup({}, { at: '2026-12-25T07:40:00+01:00', quietHours: { start: 0, end: 330 } });
    await dash.screen();
    expect(renderer.lastHtml).toContain('Frohe Weihnachten!');
    clock.set('2026-12-26T01:00:00+01:00');
    await dash.screen();
    expect(renderer.lastHtml).toContain('Frohe Weihnachten!');
    expect(renderer.lastHtml).toMatch(/class="moon">(Zunehmend|Abnehmend|Vollmond|Neumond)[^<]* · \d+ %/);
    clock.set('2026-11-03T07:40:00+01:00');
    const html = await dash.previewHtml('heute', { night: true, moon: 180, holiday: 'ostern' });
    expect(html).toContain('Vollmond · 100 %');
    expect(html).toContain('Frohe Ostern!');
    expect(await dash.previewHtml('heute', { holiday: 'august' })).toContain('Schönen 1. August!');
  });

  it('previews the night screen by day', async () => {
    const quietHours = { start: 0, end: 330 };
    const { dash } = setup({}, { quietHours });
    expect(await dash.previewHtml('heute', { night: true })).toContain('Gute Nacht');
    expect(await dash.previewHtml('heute')).not.toContain('Gute Nacht');
  });

  it('navigates via tab zones', async () => {
    const { dash, renderer, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:woche');
    expect(renderer.lastHtml).toContain('view-woche');
    expect(dash.view).toBe('woche');
  });

  it('returns null when a tap hits nothing', async () => {
    const { dash } = setup();
    await dash.screen();
    expect(await dash.tap(900, 900)).toBeNull();
  });

  it('tap without zones returns a fresh screen (e.g. after a server restart)', async () => {
    const { dash, renderer } = setup();
    const s = await dash.tap(500, 500);
    expect(s).not.toBeNull();
    expect(renderer.lastHtml).toContain('view-heute');
  });

  it('types, suggests and adds the input, then shows the status', async () => {
    const { dash, renderer, src, tapAction } = setup();
    await dash.screen();
    const entered = await tapAction('nav:hinzufuegen');
    expect(entered?.fullRefresh).toBe(true);
    await tapAction('key:m');
    await tapAction('key:i');
    expect(renderer.lastHtml).toContain('Mi<span class="caret">');
    expect(renderer.lastHtml).toContain('data-action="add:Milch"');
    await tapAction('add:input');
    expect(src.bring.add).toHaveBeenCalledWith('Mi');
    expect(renderer.lastHtml).toContain('<div class="notice ok">');
    expect(renderer.lastHtml).toContain('Mi erfasst');
    expect(renderer.lastHtml).toContain('<span class="text ellipsis"><span class="caret">');
    await tapAction('key:b');
    expect(renderer.lastHtml).not.toContain('class="notice');
  });

  it('checks a tapped tile in place and keeps the other tiles where they were', async () => {
    let onList: string[] = [];
    const { dash, renderer, src, tapAction } = setup({
      frequent: vi.fn(async () => ['Butter', 'Joghurt', 'Käse'].filter((n) => !onList.includes(n))),
      add: vi.fn(async (name: string) => {
        onList = [...onList, name];
        return { kind: 'added' as const, name };
      }),
    });
    await dash.screen();
    await tapAction('nav:hinzufuegen');
    await tapAction('add:Joghurt');
    const html = renderer.lastHtml;
    expect(html).toContain('<div class="tile on">');
    expect(html).not.toContain('data-action="add:Joghurt"');
    expect(html.indexOf('add:Butter')).toBeLessThan(html.indexOf('tile on'));
    expect(html.indexOf('tile on')).toBeLessThan(html.indexOf('add:Käse'));
    expect(src.bring.frequent).toHaveBeenCalledTimes(1);
    // a new visit starts with fresh tiles
    await tapAction('close');
    await tapAction('nav:hinzufuegen');
    expect(renderer.lastHtml).not.toContain('Joghurt');
  });

  it('adds a tile and reports duplicates and failures; failure keeps the input', async () => {
    const { dash, renderer, tapAction } = setup({
      add: vi.fn(async (name: string) => (name === 'Butter' ? { kind: 'duplicate' as const, name } : { kind: 'failed' as const, name })),
    });
    await dash.screen();
    await tapAction('nav:hinzufuegen');
    await tapAction('add:Butter');
    expect(renderer.lastHtml).toContain('Butter steht schon auf der Liste');
    expect(renderer.lastHtml).toContain('<div class="notice">');
    expect(renderer.lastHtml).toContain('<div class="tile on">');
    await tapAction('key:x');
    await tapAction('add:input');
    expect(renderer.lastHtml).toContain('Konnte X nicht erfassen – bitte nochmals');
    expect(renderer.lastHtml).toContain('X<span class="caret">');
  });

  it('ticks an item off in Einkauf and undoes it', async () => {
    const { dash, renderer, src, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:einkauf');
    await tapAction('done:Milch');
    expect(src.bring.complete).toHaveBeenCalledWith('Milch');
    expect(renderer.lastHtml).toContain('<span class="ellipsis">Milch abgehakt</span>');
    await tapAction('undo');
    expect(src.bring.restore).toHaveBeenCalledWith('Milch', '2 l');
    expect(renderer.lastHtml).toContain('Milch ist wieder auf der Liste');
    expect(renderer.lastHtml).not.toContain('data-action="undo"');
  });

  it('forgets the undo when leaving Einkauf', async () => {
    const { dash, renderer, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:einkauf');
    await tapAction('done:Brot');
    await tapAction('nav:heute');
    await tapAction('nav:einkauf');
    expect(renderer.lastHtml).not.toContain('class="notice');
    expect(renderer.lastHtml).not.toContain('data-action="undo"');
  });

  it('reports items ticked off elsewhere (and reloads) and failures, and keeps undo after a failed restore', async () => {
    const { dash, renderer, src, tapAction } = setup({
      complete: vi.fn(async (key: string) =>
        key === 'Eier' ? { kind: 'gone' as const, key, name: key, spec: '' } : { kind: 'done' as const, key, name: key, spec: '' },
      ),
      restore: vi.fn(async () => false),
    });
    await dash.screen();
    await tapAction('nav:einkauf');
    await tapAction('done:Eier');
    expect(renderer.lastHtml).toContain('Eier ist schon abgehakt');
    expect(src.bring.list).toHaveBeenLastCalledWith(true);
    await tapAction('done:Brot');
    await tapAction('undo');
    expect(renderer.lastHtml).toContain('Konnte Brot nicht zurücklegen – bitte nochmals');
    expect(renderer.lastHtml).toContain('data-action="undo"');
  });

  it('close returns to the previous view with a full refresh', async () => {
    const { dash, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:einkauf');
    await tapAction('nav:hinzufuegen');
    const back = await tapAction('close');
    expect(dash.view).toBe('einkauf');
    expect(back?.fullRefresh).toBe(true);
  });

  it('resets to Heute on the next screen() after inactivity', async () => {
    const { dash, clock, renderer, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:woche');
    clock.advance(121_000);
    await dash.screen();
    expect(renderer.lastHtml).toContain('view-heute');
  });

  it('during quiet hours caps the refresh at the view reset time outside Heute, then resets', async () => {
    const quietHours = { start: 23 * 60, end: 6 * 60 };
    const { dash, clock, renderer, tapAction } = setup({}, { at: '2026-11-03T23:30:00+01:00', quietHours });
    const heute = await dash.screen();
    expect(heute.refreshSeconds).toBe(6.5 * 3600);
    const woche = await tapAction('nav:woche');
    expect(woche?.refreshSeconds).toBe(120);
    clock.advance(120_000);
    const back = await dash.screen();
    expect(dash.view).toBe('heute');
    expect(renderer.lastHtml).toContain('view-nacht'); // Heute is the night screen in quiet hours
    expect(back.refreshSeconds).toBe(6.5 * 3600 - 120);
  });

  it('schedules the next poll outside Heute for exactly when the reset is due', async () => {
    const clock = testClock('2026-11-03T10:00:00+01:00');
    const renderer = new FakeRenderer();
    const dash = new Dashboard({ sources: sources(), renderer, clock, refreshSeconds: 120, quietHours: null, viewResetSeconds: 180 });
    await dash.screen();
    const zones = (dash as unknown as { state: { zones: Zone[] } }).state.zones;
    const z = zones.find((zz) => zz.action === 'nav:woche')!;
    const woche = await dash.tap(z.x + 1, z.y + 1);
    expect(woche?.refreshSeconds).toBe(120); // regular poll comes first
    clock.advance(120_000);
    const still = await dash.screen();
    expect(renderer.lastHtml).toContain('view-woche');
    expect(still.refreshSeconds).toBe(60); // then exactly at 3 minutes
    clock.advance(60_000);
    await dash.screen();
    expect(renderer.lastHtml).toContain('view-heute');
  });

  it('tap uses the zones of the last delivered image even after the reset timeout', async () => {
    const { dash, clock, renderer, tapAction } = setup();
    await dash.screen();
    await tapAction('nav:woche');
    clock.advance(10 * 60_000);
    await tapAction('nav:einkauf');
    expect(renderer.lastHtml).toContain('view-einkauf');
  });

  it('refresh forces sources to reload', async () => {
    const { dash, src, tapAction } = setup();
    await dash.screen();
    await tapAction('refresh');
    expect(src.weather.get).toHaveBeenLastCalledWith(true);
    expect(src.transit.boards).toHaveBeenLastCalledWith(true);
    expect(src.bring.list).toHaveBeenLastCalledWith(true);
  });

  describe('transit freshness', () => {
    const station = { id: '1', name: 'Hallenstadion', via: 'X', lines: ['11'] };
    const departed = [{ line: '11', planned: new Date('2026-11-03T07:30:00+01:00'), delayMin: 0, to: 'Zürich, Rehalp', inbound: true }];

    it('shows «keine Daten» when the cached departures are all past and older than 2 × TTL', async () => {
      const { dash, renderer, src } = setup();
      src.transit.boards = vi.fn(async () => [{ station, departures: departed, fetchedAt: new Date('2026-11-03T07:35:59+01:00') }]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('keine Daten');
      expect(renderer.lastHtml).not.toContain('keine Abfahrten');
    });

    it('shows «keine Abfahrten» for fresh data without upcoming departures', async () => {
      const { dash, renderer, src } = setup();
      src.transit.boards = vi.fn(async () => [{ station, departures: departed, fetchedAt: new Date('2026-11-03T07:36:00+01:00') }]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('keine Abfahrten');
      expect(renderer.lastHtml).not.toContain('keine Daten');
    });

    it('keeps showing stale departures that are still upcoming', async () => {
      const { dash, renderer, src } = setup();
      const later = [{ line: '11', planned: new Date('2026-11-03T07:50:00+01:00'), delayMin: 0, to: 'Zürich, Rehalp', inbound: true }];
      src.transit.boards = vi.fn(async () => [{ station, departures: later, fetchedAt: new Date('2026-11-03T07:00:00+01:00') }]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('07:50');
      expect(renderer.lastHtml).not.toContain('keine Daten');
    });
  });

  it('previews any view without changing state', async () => {
    const { dash } = setup();
    await dash.screen();
    expect(await dash.previewHtml('einkauf')).toContain('view-einkauf');
    expect(await dash.previewHtml('wetter')).toContain('view-wetter');
    expect(await dash.previewHtml('station', { station: 7 })).toContain('Haltestelle 8'); // no such station: empty screen
    expect(dash.view).toBe('heute');
  });

  it('previews Heute as at 19:30 to show the evening mode during the day', async () => {
    const { dash } = setup();
    const html = await dash.previewHtml('heute', { evening: true });
    expect(html).toContain('Stand 19:30');
    expect(html).toContain('<div class="tlabel">morgen</div>');
    expect(await dash.previewHtml('heute')).toContain('Stand 07:40');
  });

  describe('guest mode', () => {
    const at = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00+01:00`);
    const event = (title: string, start: string, end: string) => ({ calendar: 'PF', title, start: at(start), end: at(end), allDay: false });

    it('a long press on the events hides their titles until the running event ends', async () => {
      const { dash, renderer, src, clock, holdAction } = setup();
      src.calendar.events = vi.fn(async () => [event('Zahnarzt', '07:30', '08:30'), event('Elterngespräch', '17:00', '18:00')]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('Zahnarzt');
      const s = await holdAction('guest');
      expect(s?.fullRefresh).toBe(true);
      expect(renderer.lastHtml).not.toContain('Zahnarzt');
      expect(renderer.lastHtml).not.toContain('Elterngespräch');
      expect(renderer.lastHtml).toContain('ev-title hidden');
      expect(renderer.lastHtml).toContain('class="guest"');
      expect(dash.view).toBe('heute');
      clock.set('2026-11-03T08:30:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).toContain('Zahnarzt');
    });

    it('stays on without a running event until the next long press, in every view with events', async () => {
      const { dash, renderer, src, holdAction, tapAction } = setup();
      src.calendar.events = vi.fn(async () => [event('Zahnarzt', '09:00', '10:00')]);
      await dash.screen();
      await holdAction('guest');
      expect(renderer.lastHtml).not.toContain('Zahnarzt');
      await tapAction('nav:woche');
      expect(renderer.lastHtml).not.toContain('Zahnarzt');
      await holdAction('guest');
      expect(renderer.lastHtml).toContain('Zahnarzt');
      expect(renderer.lastHtml).not.toContain('class="guest"');
    });

    describe('welcome in the agenda (GUEST_WIFI_SSID set)', () => {
      const guestWifi = { ssid: 'Gast-Netz', password: 'sonnenblume42' };

      it('greets the visitors with the WLAN QR code instead of the events, without printing network or password', async () => {
        const { dash, renderer, src, clock } = setup({}, { guestWifi });
        src.calendar.events = vi.fn(async () => [event('Besuch Müllers', '07:00', '08:00'), event('Besuch: Oma', '07:30', '09:00'), event('Zahnarzt', '07:30', '08:30')]);
        await dash.screen();
        expect(renderer.lastHtml).toContain('view-heute');
        expect(renderer.lastHtml).toContain('Müllers &amp; Oma!');
        expect(renderer.lastHtml).toContain('class="qr"');
        expect(renderer.lastHtml).not.toContain('Gast-Netz');
        expect(renderer.lastHtml).not.toContain('sonnenblume42');
        expect(renderer.lastHtml).not.toContain('Zahnarzt');
        expect(renderer.lastHtml).toContain('class="tabs"'); // the rest of Heute stays
        clock.set('2026-11-03T09:00:00+01:00');
        await dash.screen();
        expect(renderer.lastHtml).not.toContain('class="welcome"');
      });

      it('greets without names when switched on by hand, and a long press on it switches back', async () => {
        const { dash, renderer, src, holdAction } = setup({}, { guestWifi });
        src.calendar.events = vi.fn(async () => [event('Zahnarzt', '09:00', '10:00')]);
        await dash.screen();
        await holdAction('guest');
        expect(renderer.lastHtml).toContain('Herzlich willkommen!');
        await holdAction('guest');
        expect(renderer.lastHtml).toContain('Zahnarzt');
      });

      it('keeps Woche blacked out, the night screen in the quiet hours, and previews it with gast=1', async () => {
        const { dash, renderer, src, tapAction, clock } = setup({}, { guestWifi, quietHours: { start: 0, end: 330 } });
        src.calendar.events = vi.fn(async () => [event('Besuch Müllers', '00:00', '23:59'), event('Zahnarzt', '09:00', '10:00')]);
        await dash.screen();
        await tapAction('nav:woche');
        expect(renderer.lastHtml).toContain('ev-title hidden');
        clock.set('2026-11-03T03:00:00+01:00');
        await tapAction('nav:heute');
        expect(renderer.lastHtml).toContain('view-nacht');
        src.calendar.events = vi.fn(async () => []);
        clock.set('2026-11-03T07:40:00+01:00');
        expect(await dash.previewHtml('heute', { guest: true })).toContain('class="welcome"');
      });

      it('without GUEST_WIFI_SSID guest mode blacks out the titles as before', async () => {
        const { dash, renderer, src } = setup();
        src.calendar.events = vi.fn(async () => [event('Besuch Müllers', '07:00', '08:00')]);
        await dash.screen();
        expect(renderer.lastHtml).not.toContain('class="welcome"');
      });
    });

    it('turns on by itself during a visit, which stays readable; a long press turns it off until the visit ends', async () => {
      const { dash, renderer, src, clock, holdAction } = setup();
      src.calendar.events = vi.fn(async () => [event('Besuch Müllers', '07:00', '08:00'), event('Zahnarzt', '09:00', '10:00'), event('Besuch Oma', '09:00', '10:00')]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('Besuch Müllers');
      expect(renderer.lastHtml).not.toContain('Zahnarzt');
      await holdAction('guest');
      expect(renderer.lastHtml).toContain('Zahnarzt');
      clock.set('2026-11-03T09:10:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).not.toContain('Zahnarzt');
      expect(renderer.lastHtml).toContain('Besuch Oma');
    });

    it('also hides titles on the night screen', async () => {
      const { dash, renderer, src, holdAction } = setup({}, { at: '2026-11-03T23:00:00+01:00', quietHours: { start: 22 * 60, end: 6 * 60 } });
      const tomorrow = { calendar: 'PF', title: 'Zahnarzt', start: new Date('2026-11-04T09:00:00+01:00'), end: new Date('2026-11-04T10:00:00+01:00'), allDay: false };
      src.calendar.events = vi.fn(async () => [tomorrow]);
      await dash.screen();
      expect(renderer.lastHtml).toContain('view-nacht');
      expect(renderer.lastHtml).toContain('Zahnarzt');
      await holdAction('guest');
      expect(renderer.lastHtml).toContain('view-nacht');
      expect(renderer.lastHtml).toContain('ev-title hidden');
    });

    it('ignores a long press outside the events', async () => {
      const { dash } = setup();
      await dash.screen();
      expect(await dash.tap(1, 1, true)).toBeNull();
    });

    it('previews the guest mode without changing state', async () => {
      const { dash, src, renderer } = setup();
      src.calendar.events = vi.fn(async () => [event('Zahnarzt', '09:00', '10:00')]);
      expect(await dash.previewHtml('woche', { guest: true })).not.toContain('Zahnarzt');
      await dash.screen();
      expect(renderer.lastHtml).toContain('Zahnarzt');
    });

    it('a forced refresh reloads each calendar only once', async () => {
      const { dash, src, tapAction } = setup();
      await dash.screen();
      await tapAction('refresh');
      expect(vi.mocked(src.calendar.events).mock.calls.filter((c) => c[2] === true)).toHaveLength(1);
    });
  });

  describe('birthdays', () => {
    const birthdays = [
      { name: 'Anna', date: '12-01' },
      { name: 'Marianne', date: '11-07' },
      { name: 'Simone', date: '11-07' },
    ];

    it('greets on Heute all day by the local date, not on other days', async () => {
      const { dash, renderer, clock, tapAction } = setup({}, { at: '2026-12-01T00:30:00+01:00', birthdays });
      await dash.screen();
      expect(renderer.lastHtml).toContain('Happy Birthday Anna!');
      clock.set('2026-12-01T23:30:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).toContain('Happy Birthday Anna!');
      await tapAction('nav:woche');
      expect(renderer.lastHtml).not.toContain('Happy Birthday');
      clock.set('2026-12-02T00:10:00+01:00');
      await tapAction('nav:heute');
      expect(renderer.lastHtml).not.toContain('Happy Birthday');
    });

    it('greets on the night screen only from midnight on, even when the night starts at 22:00', async () => {
      const { dash, renderer, clock } = setup({}, { at: '2026-11-06T23:00:00+01:00', quietHours: { start: 22 * 60, end: 6 * 60 }, birthdays });
      await dash.screen();
      expect(renderer.lastHtml).toContain('view-nacht');
      expect(renderer.lastHtml).toContain('Samstag, 7. November'); // already the coming day
      expect(renderer.lastHtml).not.toContain('Happy Birthday');
      clock.set('2026-11-07T00:00:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).toContain('Happy Birthday Marianne &amp; Simone!');
      clock.set('2026-11-07T23:00:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).not.toContain('Happy Birthday');
    });
  });

  describe('tasks', () => {
    it('shows the newest task and ticks it off on tap, even with : and & in its text', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.tasks = taskSource(['Staubsaugen', 'Glas & PET: Keller']);
      await dash.screen();
      expect(renderer.lastHtml).toContain('Glas &amp; PET: Keller');
      await tapAction('task:Glas & PET: Keller');
      expect(src.tasks.complete).toHaveBeenCalledWith('Glas & PET: Keller');
      expect(renderer.lastHtml).not.toContain('Glas &amp; PET');
      expect(renderer.lastHtml).toContain('Staubsaugen');
      expect(src.bring.complete).not.toHaveBeenCalled();
    });

    it('shows the task added last, also right after adding it on the Kindle', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.tasks = taskSource(['Pflanzen giessen']);
      await dash.screen();
      await tapAction('nav:aufgabe');
      await tapAction('add:Abfall entsorgen');
      await tapAction('close');
      expect(renderer.lastHtml).toMatch(/class="taskbox" data-action="task:Abfall entsorgen">.*Abfall entsorgen<\/span><span class="more-inline">\+ 1</);
    });

    it('reloads when the task was ticked off on the phone meanwhile', async () => {
      const { dash, src, tapAction } = setup();
      const tasks = taskSource(['Abfall entsorgen']);
      src.tasks = tasks;
      await dash.screen();
      tasks.open.length = 0;
      await tapAction('task:Abfall entsorgen');
      expect(tasks.list).toHaveBeenLastCalledWith(true);
    });

    it('flashes when ticking off fails and keeps the task', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.tasks = { ...taskSource(['Abfall entsorgen']), complete: vi.fn(async (key: string) => ({ kind: 'failed' as const, key, name: key, spec: '' })) };
      await dash.screen();
      const s = await tapAction('task:Abfall entsorgen');
      expect(s?.fullRefresh).toBe(true);
      expect(renderer.lastHtml).toContain('Abfall entsorgen');
    });

    it('says in the task tab that the list is missing, without offering tiles', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.tasks = { ...taskSource([]), list: vi.fn(async () => ({ ok: false as const, message: 'Liste «Aufgaben» nicht gefunden' })) };
      await dash.screen();
      await tapAction('nav:aufgabe');
      expect(renderer.lastHtml).toContain('Liste «Aufgaben» nicht gefunden');
      expect(renderer.lastHtml).not.toContain('data-action="add:Abfall entsorgen"');
      await tapAction('tab:einkauf');
      expect(renderer.lastHtml).not.toContain('nicht gefunden');
      expect(renderer.lastHtml).toContain('data-action="add:Butter"');
    });

    it('keeps Heute working without the task list', async () => {
      const { dash, renderer, src } = setup();
      src.tasks = { ...taskSource([]), list: vi.fn(async () => ({ ok: false as const, message: 'Liste «Aufgaben» nicht gefunden' })) };
      await dash.screen();
      expect(renderer.lastHtml).toContain('data-action="nav:aufgabe"');
      expect(renderer.lastHtml).not.toContain('class="taskbox"');
      expect(renderer.lastHtml).not.toContain('nicht gefunden');
    });

    it('«+ Aufgabe» opens the task tab; entries go to the task list only; switching tabs clears the input', async () => {
      const { dash, renderer, src, tapAction } = setup();
      const tasks = taskSource([]);
      src.tasks = tasks;
      await dash.screen();
      await tapAction('nav:aufgabe');
      expect(dash.view).toBe('hinzufuegen');
      expect(renderer.lastHtml).toContain('<div class="seg on" data-action="tab:aufgabe">');
      expect(renderer.lastHtml).toContain('data-action="add:Abfall entsorgen"');
      await tapAction('key:v');
      await tapAction('add:input');
      expect(tasks.add).toHaveBeenCalledWith('V');
      expect(src.bring.add).not.toHaveBeenCalled();
      await tapAction('key:x');
      await tapAction('tab:einkauf');
      expect(renderer.lastHtml).toContain('<span class="text ellipsis"><span class="caret"></span></span>');
      expect(renderer.lastHtml).toContain('Oft gekauft');
      await tapAction('add:Butter');
      expect(src.bring.add).toHaveBeenCalledWith('Butter');
      expect(tasks.add).toHaveBeenCalledTimes(1);
    });

    it('«+ Hinzufügen» still opens the shopping tab; without a task list there are no tabs', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.tasks = taskSource([]);
      await dash.screen();
      await tapAction('nav:hinzufuegen');
      expect(renderer.lastHtml).toContain('<div class="seg on" data-action="tab:einkauf">');
      const plain = setup();
      await plain.dash.screen();
      await plain.tapAction('nav:hinzufuegen');
      expect(plain.renderer.lastHtml).not.toContain('class="segs"');
    });
  });

  describe('«Dringend»', () => {
    it('the runner area toggles urgent in Bring! and stays in Einkauf; the rest of the tile still ticks off', async () => {
      const { dash, src, tapAction } = setup();
      await dash.screen();
      await tapAction('nav:einkauf');
      const s = await tapAction('urgent:Milch');
      expect(src.bring.toggleUrgent).toHaveBeenCalledWith('Milch');
      expect(src.bring.complete).not.toHaveBeenCalled();
      expect(dash.view).toBe('einkauf');
      expect(s?.fullRefresh).toBe(false);
      await tapAction('done:Milch');
      expect(src.bring.complete).toHaveBeenCalledWith('Milch');
    });

    it('flashes when the toggle fails and reloads when the item is gone', async () => {
      const { dash, src, tapAction } = setup();
      await dash.screen();
      await tapAction('nav:einkauf');
      src.bring.toggleUrgent = vi.fn(async (key: string) => ({ kind: 'failed' as const, key, name: key, urgent: false }));
      expect((await tapAction('urgent:Milch'))?.fullRefresh).toBe(true);
      src.bring.toggleUrgent = vi.fn(async (key: string) => ({ kind: 'gone' as const, key, name: key, urgent: false }));
      await tapAction('urgent:Milch');
      expect(src.bring.list).toHaveBeenLastCalledWith(true);
    });

    it('shows urgent tasks first in the box, before the newest', async () => {
      const { dash, renderer, src } = setup();
      const tasks = taskSource(['Staubsaugen', 'Abfall entsorgen']);
      tasks.list = vi.fn(async () => ({
        ok: true as const,
        listName: 'Aufgaben',
        items: [
          { key: 'Staubsaugen', name: 'Staubsaugen', spec: '', urgent: true },
          { key: 'Abfall entsorgen', name: 'Abfall entsorgen', spec: '', urgent: false },
        ],
      }));
      src.tasks = tasks;
      await dash.screen();
      expect(renderer.lastHtml).toContain('class="taskbox" data-action="task:Staubsaugen"');
    });

    it('offers «Dringend» right after adding and sets the new item urgent', async () => {
      const { dash, renderer, src, tapAction } = setup();
      await dash.screen();
      await tapAction('nav:hinzufuegen');
      await tapAction('add:Butter');
      expect(renderer.lastHtml).toContain('data-action="urgent-added"');
      await tapAction('urgent-added');
      expect(src.bring.toggleUrgent).toHaveBeenCalledWith('Butter', true);
      expect(renderer.lastHtml).toContain('Butter ist dringend');
      expect(renderer.lastHtml).not.toContain('data-action="urgent-added"');
      expect(dash.view).toBe('hinzufuegen');
    });

    it('offers «Dringend» for an item already on the list, unless it is urgent already', async () => {
      const { dash, renderer, src, tapAction } = setup({ add: vi.fn(async (name: string) => ({ kind: 'duplicate' as const, name: 'Wienerli', key: 'Frankfurter', urgent: name === 'Eier' })) });
      await dash.screen();
      await tapAction('nav:hinzufuegen');
      await tapAction('add:Butter');
      expect(renderer.lastHtml).toContain('Wienerli steht schon auf der Liste');
      await tapAction('urgent-added');
      expect(src.bring.toggleUrgent).toHaveBeenCalledWith('Frankfurter', true);
      for (const k of ['e', 'i', 'e', 'r']) await tapAction(`key:${k}`);
      await tapAction('add:input');
      expect(renderer.lastHtml).toContain('Wienerli steht schon auf der Liste und ist dringend');
      expect(renderer.lastHtml).not.toContain('data-action="urgent-added"');
    });

    it('keeps the offer when setting urgent fails, and drops it on the next key', async () => {
      const { dash, renderer, src, tapAction } = setup();
      src.bring.toggleUrgent = vi.fn(async (key: string) => ({ kind: 'failed' as const, key, name: key, urgent: false }));
      await dash.screen();
      await tapAction('nav:hinzufuegen');
      await tapAction('add:Butter');
      await tapAction('urgent-added');
      expect(renderer.lastHtml).toContain('Konnte Butter nicht auf dringend setzen – bitte nochmals');
      expect(renderer.lastHtml).toContain('data-action="urgent-added"');
      await tapAction('key:a');
      expect(renderer.lastHtml).not.toContain('data-action="urgent-added"');
    });

    it('sets a new task urgent in the task list', async () => {
      const { dash, src, tapAction } = setup();
      const tasks = taskSource([]);
      tasks.add = vi.fn(async (name: string) => ({ kind: 'added' as const, name, key: name, urgent: false }));
      src.tasks = tasks;
      await dash.screen();
      await tapAction('nav:aufgabe');
      await tapAction('add:Abfall entsorgen');
      await tapAction('urgent-added');
      expect(tasks.toggleUrgent).toHaveBeenCalledWith('Abfall entsorgen', true);
      expect(src.bring.toggleUrgent).not.toHaveBeenCalled();
    });
  });

  describe('Einkauf pages', () => {
    const list = (n: number) => ({ ok: true as const, listName: 'Zuhause', items: Array.from({ length: n }, (_, i) => ({ key: `A${i}`, name: `A${i}`, spec: '', urgent: false })) });

    it('pages forward and back, starts on page 1 when opened again', async () => {
      const { dash, renderer, tapAction } = setup({ list: vi.fn(async () => list(23)) });
      await dash.screen();
      await tapAction('nav:einkauf');
      await tapAction('page:next');
      expect(renderer.lastHtml).toContain('Seite 2 von 3');
      expect(renderer.lastHtml).toContain('data-action="done:A10"');
      await tapAction('page:next');
      await tapAction('page:prev');
      expect(renderer.lastHtml).toContain('Seite 2 von 3');
      await tapAction('nav:heute');
      await tapAction('nav:einkauf');
      expect(renderer.lastHtml).toContain('Seite 1 von 3');
    });

    it('keeps the page when ticking off and steps back when the last page empties', async () => {
      let n = 21;
      const { dash, renderer, src, tapAction } = setup({ list: vi.fn(async () => list(n)) });
      src.bring.complete = vi.fn(async (key: string) => {
        n -= 1;
        return { kind: 'done' as const, key, name: key, spec: '' };
      });
      await dash.screen();
      await tapAction('nav:einkauf');
      await tapAction('page:next');
      await tapAction('page:next');
      expect(renderer.lastHtml).toContain('Seite 3 von 3');
      await tapAction('done:A20');
      expect(renderer.lastHtml).toContain('Seite 2 von 2');
      expect(renderer.lastHtml).toContain('A20 abgehakt');
    });
  });

  describe('with a duty roster', () => {
    const shift = (kind: 'work' | 'school', hhmm: string) => {
      const start = new Date(`2026-11-03T${hhmm}:00+01:00`);
      return { kind, start, end: new Date(start.getTime() + 8 * 3_600_000) };
    };
    function withRoster(today: ReturnType<typeof shift> | 'free' | null, at = '2026-11-03T07:40:00+01:00') {
      const s = setup({}, { at });
      const planned = vi.fn(async () => ({ minutes: 22, delayMinutes: 0 }));
      s.src.commutes = [
        { label: 'Zur Arbeit', icon: 'work', walkMinutes: 5, get: vi.fn(async () => ({ minutes: 18, delayMinutes: 4 })), at: planned, route: vi.fn(async () => null) },
        { label: 'Schule', icon: 'school', badge: 'LE', walkMinutes: 5, get: vi.fn(async () => ({ minutes: 12, delayMinutes: 0 })), at: planned, route: vi.fn(async () => null) },
      ];
      s.src.roster = { today: () => today, buffers: { work: 5, school: 10 } };
      return { ...s, planned };
    }

    it('long before: the usual traffic at the leave time; only the destination of the duty', async () => {
      const { dash, renderer, planned } = withRoster(shift('work', '13:30'));
      await dash.screen();
      // live 18 + 5 walk → leave 13:02 → ask HERE about 13:00 → 22 + 5 → leave 12:58
      expect(planned).toHaveBeenCalledWith(new Date('2026-11-03T13:00:00+01:00'), false);
      expect(renderer.lastHtml).toContain('<div class="commute" data-action="commute:0">');
      expect(renderer.lastHtml).toContain('<span>Arbeit 13:30</span><b>los 12:58</b><span>27 Min.</span></div>');
      expect(renderer.lastHtml).not.toContain('data-action="commute:1"');
    });

    it('from 30 minutes before leaving: live traffic; then «los sofort»; gone from the start', async () => {
      const { dash, renderer, planned, clock } = withRoster(shift('work', '13:30'), '2026-11-03T12:40:00+01:00');
      await dash.screen();
      expect(planned).not.toHaveBeenCalled();
      expect(renderer.lastHtml).toContain('<span>Arbeit 13:30</span><b>los 13:02</b><span>23 Min.</span><b class="late">+4 Stau</b>');
      clock.set('2026-11-03T13:05:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).toContain('<b>los sofort</b>');
      clock.set('2026-11-03T13:30:00+01:00');
      await dash.screen();
      expect(renderer.lastHtml).not.toContain('class="commute"');
    });

    it('school: its destination, its badge and buffer', async () => {
      const { dash, renderer } = withRoster(shift('school', '07:30'), '2026-11-03T06:00:00+01:00');
      await dash.screen();
      // live 12 + 5 → leave 07:03 → ask about 07:00 → 22 + 5 → 07:30 − 10 − 27 = 06:53
      expect(renderer.lastHtml).toContain('<div class="commute" data-action="commute:1">');
      expect(renderer.lastHtml).toMatch(/<span class="cal">LE<\/span><span>Schule 07:30<\/span><b>los 06:53<\/b>/);
    });

    it('no line on a day off; as before without a plan for the month', async () => {
      const free = withRoster('free');
      await free.dash.screen();
      expect(free.renderer.lastHtml).not.toContain('class="commute"');
      const none = withRoster(null);
      await none.dash.screen();
      expect(none.renderer.lastHtml).toContain('<span class="dest" data-action="commute:1">');
    });

    it('previews a duty in one to two hours without a roster', async () => {
      const { dash, src } = withRoster(null);
      delete src.roster;
      expect(await dash.previewHtml('heute', { shift: 'work' })).toContain('<span>Arbeit 09:00</span>');
      expect(await dash.previewHtml('heute', { shift: 'school' })).toContain('<span>Schule 09:00</span>');
    });
  });
});
