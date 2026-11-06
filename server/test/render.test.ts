import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LAYOUT, PlaywrightRenderer, SCALE, SCREEN, toGray16 } from '../src/render/renderer.js';
import { einkaufHtml } from '../src/views/einkauf.js';
import { heuteHtml } from '../src/views/heute.js';
import { addDays, startOfWeek } from '../src/format.js';
import { hinzufuegenHtml } from '../src/views/hinzufuegen.js';
import { nachtHtml } from '../src/views/nacht.js';
import { TASK_SUGGESTIONS } from '../src/sources/bring/source.js';
import { wetterHtml } from '../src/views/wetter.js';
import { wocheHtml } from '../src/views/woche.js';
import { dryWeather, entry, fullBoards, heuteModel, NOW } from './fixtures/models.js';

let renderer: PlaywrightRenderer;
let browser: Browser;

beforeAll(async () => {
  renderer = await PlaywrightRenderer.launch();
  browser = await chromium.launch();
});
afterAll(async () => {
  await renderer.close();
  await browser.close();
});

async function boxes(html: string, selectors: string[]): Promise<Record<string, { top: number; bottom: number }>> {
  const page = await browser.newPage({ viewport: { ...LAYOUT } });
  await page.setContent(html);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const out = await page.evaluate((sels) => {
    const r: Record<string, { top: number; bottom: number }> = {};
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) {
        const b = el.getBoundingClientRect();
        r[s] = { top: b.top, bottom: b.bottom };
      }
    }
    return r;
  }, selectors);
  await page.close();
  return out;
}

describe('toGray16', () => {
  it('produces a 1-channel PNG with at most 16 levels', async () => {
    const rgb = await sharp({ create: { width: 64, height: 1, channels: 3, background: '#808080' } })
      .composite([{ input: Buffer.from('<svg width="64" height="1"><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="64" height="1" fill="url(#g)"/></svg>') }])
      .png()
      .toBuffer();
    const out = await toGray16(rgb);
    // metadata reports the stored channel count; raw() would expand gray to 3 channels
    expect((await sharp(out).metadata()).channels).toBe(1);
    const { data } = await sharp(out).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    expect(new Set(data).size).toBeLessThanOrEqual(16);
    expect([...data].every((v) => v % 17 === 0)).toBe(true);
  });
});

describe('PlaywrightRenderer', () => {
  it('never lets a rendered page reach the network', async () => {
    const { createServer } = await import('node:http');
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end('x');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      await renderer.render(`<html><body><img src="http://127.0.0.1:${port}/probe.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/x.css"></body></html>`);
    } finally {
      server.close();
    }
    expect(hits).toBe(0);
  });

  it('renders 600x800 grayscale and returns zones in device px for every data-action', async () => {
    const { png, zones } = await renderer.render(heuteHtml(heuteModel()));
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.channels]).toEqual([SCREEN.width, SCREEN.height, 1]);
    const actions = zones.map((z) => z.action).sort();
    // nav:woche twice: the agenda and the tab; nav:einkauf twice: the shopping widget and the tab
    expect(actions).toEqual(['nav:einkauf', 'nav:einkauf', 'nav:heute', 'nav:hinzufuegen', 'nav:woche', 'nav:woche', 'refresh', 'station:0', 'station:1', 'station:2', 'weather']);
    // A long press on the agenda toggles guest mode.
    expect(zones.filter((z) => z.hold).map((z) => [z.action, z.hold])).toEqual([['nav:woche', 'guest']]);
    const tab = zones.find((z) => z.action === 'nav:heute');
    expect(tab).toMatchObject({ x: 0 });
    expect(tab!.y + tab!.h).toBeCloseTo(SCREEN.height, 0);
    expect(Math.round(tab!.h / SCALE)).toBeGreaterThanOrEqual(124);
  });

  it('Heute never overflows: transit, widget and tabs stay visible with many long entries', async () => {
    const long = 'Sehr langer Termin mit ausführlicher Beschreibung und noch mehr Text';
    const m = heuteModel({
      events: Array.from({ length: 10 }, (_, i) => entry(`1${i}:00`, 'FAM', `${long} ${i}`)),
      shopping: { ok: true, listName: 'Zuhause', items: Array.from({ length: 30 }, (_, i) => ({ key: `A${i}`, name: `Artikel mit langem Namen ${i}`, spec: '' })) },
    });
    // With four departures per stop (as on the device) the agenda is at its smallest.
    const full = { ...m, boards: fullBoards() };
    const evening = { ...full, evening: true, events: m.events!.slice(0, 4), tomorrow: m.events!.slice(4) };
    const tasks = [{ key: 'A', name: 'Abfall entsorgen und dann noch den Karton bündeln, der im Keller steht' }, { key: 'B', name: 'B' }];
    // A dry day has no rain strip and one more agenda row; five full rows of events must fit.
    const five = Array.from({ length: 5 }, (_, i) => entry(`1${i}:00`, 'FAM', `Termin ${i}`));
    const dry = [{ ...full, weather: dryWeather() }, { ...full, weather: dryWeather(), events: five }, { ...evening, weather: dryWeather() }];
    const combos = [full, evening, ...dry].flatMap((x) => [x, { ...x, tasks }, { ...x, tasks, birthdays: ['Marianne'] }, { ...x, birthdays: ['Marianne'] }]);
    for (const model of [m, { ...full, birthdays: ['Marianne', 'Simone'] }, ...combos]) {
      const b = await boxes(heuteHtml(model), ['.agenda', '.agenda > :last-child', '.transit', '.widget', '.tabs', '.ov .col:last-child .dep:last-child']);
      // .agenda clips its overflow: the last row must lie inside it.
      expect(b['.agenda > :last-child']!.bottom).toBeLessThanOrEqual(b['.agenda']!.bottom);
      expect(b['.transit']!.bottom).toBeLessThanOrEqual(b['.widget']!.top);
      expect(b['.ov .col:last-child .dep:last-child']!.bottom).toBeLessThanOrEqual(b['.widget']!.top);
      expect(b['.widget']!.bottom).toBeLessThanOrEqual(b['.tabs']!.top + 0.5);
    }
    const t = await boxes(heuteHtml({ ...full, tasks }), ['.taskbox', '.taskbox .more-inline', '.addtask']);
    expect(t['.taskbox']!.bottom - t['.taskbox']!.top).toBe(56);
    const inverted = await browser.newPage({ viewport: { ...LAYOUT } });
    await inverted.setContent(heuteHtml({ ...full, tasks }));
    const colors = await inverted.evaluate(() => {
      const st = getComputedStyle(document.querySelector('.taskbox')!);
      return [st.backgroundColor, st.color, getComputedStyle(document.querySelector('.taskbox .more-inline')!).color];
    });
    await inverted.close();
    expect(colors).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']); // white on black
    expect(t['.taskbox .more-inline']!.bottom).toBeLessThanOrEqual(t['.taskbox']!.bottom); // «+ 1» stays on the line
    expect(t['.addtask']!.bottom - t['.addtask']!.top).toBeGreaterThanOrEqual(80);
    // The enlarged tap area of «+ Aufgabe» must not reach into the task box, by day or in the evening.
    for (const model of [{ ...full, tasks }, { ...evening, tasks }, { ...full, tasks, birthdays: ['Marianne'] }]) {
      const { zones } = await renderer.render(heuteHtml(model));
      const box = zones.find((z) => z.action.startsWith('task:'))!;
      const add = zones.find((z) => z.action === 'nav:aufgabe')!;
      expect(add.y).toBeGreaterThanOrEqual(box.y + box.h);
    }
    const b = await boxes(heuteHtml(m), ['.transit', '.widget', '.tabs', '.ov .col:last-child .dep:last-child']);
    expect(b['.transit']!.bottom).toBeLessThanOrEqual(b['.widget']!.top);
    expect(b['.ov .col:last-child .dep:last-child']!.bottom).toBeLessThanOrEqual(b['.widget']!.top);
    expect(b['.widget']!.bottom).toBeLessThanOrEqual(b['.tabs']!.top + 0.5);
    expect(b['.tabs']!.bottom).toBeCloseTo(LAYOUT.height, 0);
  });

  it('draws «+ Hinzufügen» on Heute outlined and transparent, black text and plus; Einkauf keeps the black button', async () => {
    const page = await browser.newPage({ viewport: { ...LAYOUT } });
    const style = () => {
      const el = document.querySelector('[data-action="nav:hinzufuegen"]')!;
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, color: c.color, border: `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}`, h: el.getBoundingClientRect().height, icon: getComputedStyle(el.querySelector('svg')!).stroke };
    };
    await page.setContent(heuteHtml(heuteModel()));
    expect(await page.evaluate(style)).toEqual({ bg: 'rgba(0, 0, 0, 0)', color: 'rgb(0, 0, 0)', border: '4px solid rgb(0, 0, 0)', h: 96, icon: 'rgb(0, 0, 0)' });
    await page.setContent(einkaufHtml({ shopping: { ok: true, listName: 'Zuhause', items: [] } }));
    expect(await page.evaluate(style)).toMatchObject({ bg: 'rgb(0, 0, 0)', color: 'rgb(255, 255, 255)' });
    await page.close();
  });

  it('Einkauf tiles keep a «Dringend» area of at least 80 x 100 px, separate from ticking off, also with long names', async () => {
    const items = [
      { key: 'R', name: 'Rindsplätzli Minute vom Metzger', spec: '4 Stück, dünn geschnitten', urgent: true },
      { key: 'M', name: 'Milch', spec: '', urgent: false },
    ];
    const { zones } = await renderer.render(einkaufHtml({ shopping: { ok: true, listName: 'Zuhause', items } }));
    for (const key of ['R', 'M']) {
      const tile = zones.find((z) => z.action === `done:${key}`)!;
      const urge = zones.find((z) => z.action === `urgent:${key}`)!;
      expect(urge.w / SCALE).toBeGreaterThanOrEqual(80);
      expect(urge.h / SCALE).toBeGreaterThanOrEqual(100);
      // inside the tile at its right edge, so the smaller zone wins there and the rest ticks off
      expect(tile.x + tile.w - (urge.x + urge.w)).toBeLessThanOrEqual(4 * SCALE + 0.01); // only the tile's border to its right
      expect(urge.x).toBeGreaterThan(tile.x + tile.w / 2);
    }
    const page = await browser.newPage({ viewport: { ...LAYOUT } });
    await page.setContent(einkaufHtml({ shopping: { ok: true, listName: 'Zuhause', items } }));
    const overlap = await page.evaluate(() => {
      const tile = document.querySelector('.item.urgent')!;
      const text = tile.querySelector('.ellipsis')!.getBoundingClientRect();
      const tick = tile.querySelector('.tick')!.getBoundingClientRect();
      return { textRight: text.right, tickLeft: tick.left, bg: getComputedStyle(tile).backgroundColor };
    });
    await page.close();
    expect(overlap.textRight).toBeLessThanOrEqual(overlap.tickLeft);
    expect(overlap.bg).toBe('rgb(0, 0, 0)');
  });

  it('Einkauf fits a full page, the add button and the pager above the tabs, also with the notice', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ key: `A${i}`, name: `Artikel mit langem Namen ${i}`, spec: i % 2 ? '' : '2 Stück', urgent: i === 3 }));
    for (const status of [null, { text: 'Milch abgehakt', ok: true }]) {
      const b = await boxes(einkaufHtml({ shopping: { ok: true, listName: 'Zuhause', items }, status, undo: status !== null, page: 1 }), ['.items-grid', '.btn.wide', '.pager', '.tabs']);
      expect(b['.items-grid']!.bottom).toBeLessThanOrEqual(b['.btn.wide']!.top);
      expect(b['.btn.wide']!.bottom).toBeLessThanOrEqual(b['.pager']!.top);
      expect(b['.pager']!.bottom).toBeLessThanOrEqual(b['.tabs']!.top);
    }
    const { zones } = await renderer.render(einkaufHtml({ shopping: { ok: true, listName: 'Zuhause', items }, page: 1 }));
    for (const a of ['page:prev', 'page:next']) expect(zones.find((z) => z.action === a)!.h / SCALE).toBeGreaterThanOrEqual(80);
  });

  it('the shopping widget on Heute opens Einkauf, except its add button', async () => {
    const { zones } = await renderer.render(heuteHtml(heuteModel()));
    const list = zones.find((z) => z.action === 'nav:einkauf' && z.y < zones.find((t) => t.action === 'nav:heute')!.y)!;
    const add = zones.find((z) => z.action === 'nav:hinzufuegen')!;
    expect(list.h / SCALE).toBeGreaterThanOrEqual(80);
    expect(list.x + list.w).toBeLessThanOrEqual(add.x); // side by side, no overlap
  });

  it('the night screen fits a birthday greeting and its events above the tabs', async () => {
    const long = 'Sehr langer Termin mit ausführlicher Beschreibung und noch mehr Text';
    const html = nachtHtml({
      now: NOW,
      day: NOW,
      weather: heuteModel().weather,
      birthdays: ['Marianne', 'Simone'],
      entries: Array.from({ length: 10 }, (_, i) => entry(`1${i}:00`, 'FAM', `${long} ${i}`)),
    });
    expect(html.match(/class="ev"/g)).toHaveLength(4); // the night has room: still 4 events and «+ 6 weitere»
    const b = await boxes(html, ['.bday', '.bday .serif', '.nevents', '.nevents .more', '.tabs']);
    expect(b['.bday .serif']!.bottom - b['.bday .serif']!.top).toBe(96); // one line
    // .nevents clips its overflow: the last row must lie inside it.
    expect(b['.nevents .more']!.bottom).toBeLessThanOrEqual(b['.nevents']!.bottom);
    expect(b['.nevents']!.bottom).toBeLessThanOrEqual(b['.tabs']!.top);
  });

  it('Hinzufügen → Aufgabe fits the fixed task suggestions on two columns without ellipsis', async () => {
    const page = await browser.newPage({ viewport: { ...LAYOUT } });
    await page.setContent(hinzufuegenHtml({ input: '', suggestions: [], frequent: TASK_SUGGESTIONS, status: null, mode: 'aufgabe', tabs: true }));
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const r = await page.evaluate(() => ({
      cut: [...document.querySelectorAll('.tiles .tile .ellipsis')].filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
      tabs: [...document.querySelectorAll('.segs .seg')].map((el) => el.getBoundingClientRect().height),
      tilesBottom: Math.max(...[...document.querySelectorAll('.tiles .tile')].map((el) => el.getBoundingClientRect().bottom)),
      kbTop: document.querySelector('.kb')!.getBoundingClientRect().top,
    }));
    await page.close();
    expect(r.cut).toEqual([]);
    for (const h of r.tabs) expect(h).toBeGreaterThanOrEqual(80);
    expect(r.tilesBottom).toBeLessThan(r.kbTop);
  });

  it('Woche meets the minimum font sizes and fits a full week above the tabs', async () => {
    const monday = startOfWeek(NOW);
    const long = 'Sehr langer Termin mit ausführlicher Beschreibung';
    const days = Array.from({ length: 7 }, (_, i) => ({
      date: addDays(monday, i),
      entries: Array.from({ length: 5 }, (_, j) => entry(j === 0 ? 'ganzt.' : `1${j}:00`, 'FAM', `${long} ${j}`)),
    }));
    const page = await browser.newPage({ viewport: { ...LAYOUT } });
    await page.setContent(wocheHtml({ now: NOW, days }));
    const m = await page.evaluate(async () => {
      await document.fonts.ready;
      const px = (sel: string) => parseFloat(getComputedStyle(document.querySelector(sel)!).fontSize);
      const lastRow = [...document.querySelectorAll('.week .entries')].at(-1)!.getBoundingClientRect();
      return { ev: px('.week .ev'), cal: px('.week .ev .cal'), more: px('.week .more'), lastBottom: lastRow.bottom, tabsTop: document.querySelector('.tabs')!.getBoundingClientRect().top };
    });
    await page.close();
    expect(m.ev).toBeGreaterThanOrEqual(36);
    expect(m.cal).toBeGreaterThanOrEqual(28);
    expect(m.more).toBeGreaterThanOrEqual(28);
    expect(m.lastBottom).toBeLessThanOrEqual(m.tabsTop);
  });

  it('Wetter fits the screen without squeezing its charts', async () => {
    const page = await browser.newPage({ viewport: { ...LAYOUT } });
    await page.setContent(wetterHtml({ now: NOW, lakeTemp: 13.3, weather: { ...heuteModel().weather!, daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${3 + i}`, code: 61, min: -12, max: 14, rain: 80, sunrise: '07:13', sunset: '17:04' })) } }));
    const m = await page.evaluate(async () => {
      await document.fonts.ready;
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return { chartW: r('.chart').width, chartH: r('.chart').height, gaugeH: r('.gauge').height, last: [...document.querySelectorAll('.wday')].at(-1)!.getBoundingClientRect().bottom };
    });
    await page.close();
    expect(m).toMatchObject({ chartW: 988, chartH: 288, gaugeH: 190 });
    expect(m.last).toBeLessThanOrEqual(LAYOUT.height - 20);
  });

  it('Hinzufügen fits keys of at least 80x90 layout px on screen', async () => {
    const { zones } = await renderer.render(
      hinzufuegenHtml({ input: 'Mi', suggestions: ['Milch', 'Mineralwasser', 'Minze'], frequent: Array.from({ length: 15 }, (_, i) => `Artikel ${i}`), status: { text: 'Tomaten erfasst', ok: true } }),
    );
    const keys = zones.filter((z) => z.action.startsWith('key:'));
    // 29 letters + backspace in the input field and on the keyboard + space
    expect(keys.length).toBe(29 + 2 + 1);
    for (const k of keys) {
      expect(Math.round(k.w / SCALE)).toBeGreaterThanOrEqual(80);
      expect(Math.round(k.h / SCALE)).toBeGreaterThanOrEqual(90);
      expect(k.y + k.h).toBeLessThanOrEqual(SCREEN.height);
    }
    // fifteen tiles, all above the keyboard, which sits at the bottom edge
    const tiles = zones.filter((z) => z.action.startsWith('add:Artikel'));
    expect(tiles).toHaveLength(15);
    const kbTop = Math.min(...keys.filter((k) => k.action.startsWith('key:') && k.action !== 'key:backspace').map((k) => k.y));
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBeLessThan(kbTop);
    const kbBottom = Math.max(...zones.filter((z) => z.action === 'key:space').map((z) => z.y + z.h));
    expect(SCREEN.height - kbBottom).toBeLessThan(25);
  });
});
