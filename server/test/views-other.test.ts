import { describe, expect, it } from 'vitest';
import { addDays, startOfWeek } from '../src/format.js';
import { einkaufMarkup } from '../src/views/einkauf.js';
import { hinzufuegenMarkup } from '../src/views/hinzufuegen.js';
import { stationMarkup } from '../src/views/station.js';
import { eventCaps, wocheMarkup } from '../src/views/woche.js';
import { entry, NOW } from './fixtures/models.js';

describe('Woche view', () => {
  const monday = startOfWeek(NOW);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), entries: [] as ReturnType<typeof entry>[] }));
  days[1]!.entries = [entry('09:00', 'AB', 'Zahnarzt Lena'), entry('12:15', 'PF', 'Lunch')];
  days[2]!.entries = [1, 2, 3, 4, 5].map((n) => entry(`0${n}:00`, 'FAM', `T${n}`));
  const html = wocheMarkup({ now: NOW, days });

  it('shows the week range title and 7 day rows', () => {
    expect(html).toContain('Nächste 7 Tage');
    expect(html).toContain('2.–8. November');
    expect(html.match(/class="day( today)?"/g)).toHaveLength(7);
    expect(html).toContain('class="day today">Di 3</div>');
  });

  it('shows the weather of a day under its name', () => {
    const withWeather = wocheMarkup({ now: NOW, days: [{ date: NOW, entries: [], weather: { date: '2026-11-03', code: 61, min: 2.1, max: 9.4, rain: 60 } }] });
    expect(withWeather).toMatch(/class="day today">Di 3<div class="dw"><span class="icon"><svg[^>]*lucide-cloud-rain.*<span>9°\/2°<\/span><\/div><\/div>/);
    expect(html).not.toContain('class="dw"');
  });

  it('shows dashes for empty days and all events while the week fits', () => {
    expect(html.match(/class="dash">—</g)).toHaveLength(5);
    for (const n of [1, 2, 3, 4, 5]) expect(html).toContain(`>T${n}<`);
    expect(html).not.toContain('weitere');
  });

  it('summarises busy days only towards the bottom of the week', () => {
    const weather = { date: '2026-11-03', code: 61, min: 2, max: 9, rain: 60 };
    const busy = (n: number) => Array.from({ length: n }, (_, j) => entry('10:00', 'FAM', `T${j}`));
    const week = (counts: number[]) => counts.map((n, i) => ({ date: addDays(monday, i), weather, entries: busy(n) }));
    // a busy start keeps all its events, the end of the week gets squeezed
    expect(eventCaps(week([6, 6, 6, 6, 6, 6, 6]))).toEqual([6, 6, 2, 2, 2, 2, 1]);
    // an empty week leaves room for a very busy day
    expect(eventCaps(week([0, 0, 0, 9, 0, 0, 0]))).toEqual([1, 1, 1, 9, 1, 1, 1]);
    // too much even for one day: the rest of the week still gets a line each
    expect(eventCaps(week([30, 2, 2, 2, 2, 2, 2]))).toEqual([10, 2, 2, 2, 1, 1, 1]);
    expect(wocheMarkup({ now: NOW, days: week([6, 6, 6, 6, 6, 6, 6]) })).toContain('+ 5 weitere');
  });

  it('has a close button back to Heute, in Woche and Einkauf', () => {
    expect(html).toContain('<div class="close" data-action="nav:heute">');
    expect(html).toContain('Schliessen');
    expect(einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [] } })).toContain('<div class="close" data-action="nav:heute">');
  });

  it('marks Woche tab active and handles missing data', () => {
    expect(html).toContain('<div class="tab on" data-action="nav:woche">Woche</div>');
    expect(wocheMarkup({ now: NOW, days: null })).toContain('Termine: keine Daten');
  });

  it('matches the snapshot', () => {
    expect(html).toMatchSnapshot();
  });
});

describe('Woche range title', () => {
  const title = (d: Date) => {
    const monday = startOfWeek(d);
    return wocheMarkup({ now: d, days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(monday, i), entries: [] })) });
  };
  it('spans two months', () => {
    expect(title(new Date('2026-12-02T10:00:00+01:00'))).toContain('30. November – 6. Dezember');
  });
  it('spans two years', () => {
    expect(title(new Date('2026-12-30T10:00:00+01:00'))).toContain('28. Dezember – 3. Januar');
  });
});

describe('Einkauf view', () => {
  const milch = { key: 'Milch', name: 'Milch', spec: '2 l', urgent: false };
  const brot = { key: 'Brot', name: 'Brot', spec: '', urgent: false };

  it('puts urgent items first, black, and gives every tile its own «Dringend» area with the runner', () => {
    const wc = { key: 'WC-Papier', name: 'WC-Papier', spec: '', urgent: true };
    const html = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [milch, wc, brot] } });
    expect(html.indexOf('done:WC-Papier')).toBeLessThan(html.indexOf('done:Milch'));
    expect(html.indexOf('done:Milch')).toBeLessThan(html.indexOf('done:Brot'));
    expect(html).toContain('<div class="item urgent" data-action="done:WC-Papier">');
    expect(html).toContain('<div class="item" data-action="done:Milch">');
    expect(html).toMatch(/<span class="urge" data-action="urgent:Milch"><span class="icon"><svg[^>]*class="icon-run"/);
    expect(html.match(/class="urge"/g)).toHaveLength(3);
  });

  it('lists items as tappable tiles with specs and an add button', () => {
    const html = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [milch, brot] } });
    expect(html).toContain('Einkaufsliste');
    expect(html).toContain('Bring! · Liste «Zuhause» · 2 Artikel');
    expect(html).toContain('<div class="item" data-action="done:Milch"><div class="ellipsis">Milch</div><small class="ellipsis">2 l</small><span class="tick">');
    expect(html).toContain('data-action="urgent:Milch"');
    expect(html).toContain('data-action="done:Brot"');
    expect(html).toContain('class="btn wide" data-action="nav:hinzufuegen"');
    expect(html).toContain('<div class="tab on" data-action="nav:einkauf">Einkauf</div>');
    expect(html).not.toContain('class="notice');
  });

  it('pages through long lists, ten items a page', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ key: `A${i}`, name: `A${i}`, spec: '', urgent: false }));
    const first = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items } });
    expect(first.match(/class="item"/g)).toHaveLength(10);
    expect(first).toContain('data-action="done:A0"');
    expect(first).not.toContain('weitere');
    expect(first).toContain('<div class="pg off"><span class="icon">');
    expect(first).toContain('<div class="pgn">Seite 1 von 3</div>');
    expect(first).toContain('data-action="page:next"');
    expect(first).not.toContain('data-action="page:prev"');
    const last = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items }, page: 2 });
    expect(last.match(/class="item"/g)).toHaveLength(3);
    expect(last).toContain('data-action="done:A20"');
    expect(last).toContain('Seite 3 von 3');
    expect(last).toContain('data-action="page:prev"');
    expect(last).not.toContain('data-action="page:next"');
    expect(einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: items.slice(0, 10) } })).not.toContain('class="pager"');
    expect(einkaufMarkup({ shopping: { ok: false, message: 'Liste «Coop» nicht gefunden' } })).toContain('Liste «Coop» nicht gefunden');
    expect(einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [] } })).toContain('Die Liste ist leer');
  });

  it('confirms a ticked-off item with an undo button', () => {
    const html = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [brot] }, status: { text: 'Milch abgehakt', ok: true }, undo: true });
    expect(html).toContain('<div class="notice ok">');
    expect(html).toContain('<span class="ellipsis">Milch abgehakt</span>');
    expect(html).toContain('<span class="undo" data-action="undo">Rückgängig</span>');
  });

  it('shows failures outlined and without undo', () => {
    const html = einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [milch] }, status: { text: 'Konnte Milch nicht abhaken – bitte nochmals', ok: false }, undo: false });
    expect(html).toContain('<div class="notice">');
    expect(html).toContain('Konnte Milch nicht abhaken – bitte nochmals');
    expect(html).not.toContain('data-action="undo"');
  });

  it('matches the snapshot', () => {
    expect(einkaufMarkup({ shopping: { ok: true, listName: 'Zuhause', items: [milch] }, status: { text: 'Brot abgehakt', ok: true }, undo: true })).toMatchSnapshot();
  });
});

describe('Hinzufügen view', () => {
  const html = hinzufuegenMarkup({
    input: 'Mi',
    suggestions: ['Milch', 'Mineralwasser'],
    frequent: ['Butter', 'Joghurt', 'Käse'],
    status: null,
  });

  it('shows input, close and backspace', () => {
    expect(html).toContain('Hinzufügen');
    expect(html).toContain('data-action="close"');
    expect(html).toContain('<span class="text ellipsis">Mi<span class="caret"></span></span>');
    expect(html.match(/data-action="key:backspace"/g)).toHaveLength(2);
  });

  it('offers «Dringend» in the notice after adding', () => {
    const out = hinzufuegenMarkup({ input: '', suggestions: [], frequent: [], status: { text: 'Milch erfasst', ok: true }, urgentOffer: true });
    expect(out).toMatch(/Milch erfasst<\/span><span class="undo" data-action="urgent-added"><span class="icon"><svg[^>]*class="icon-run".*?<\/span> Dringend<\/span>/);
    expect(hinzufuegenMarkup({ input: '', suggestions: [], frequent: [], status: { text: 'Milch erfasst', ok: true } })).not.toContain('urgent-added');
  });

  it('shows the tabs instead of the title when tasks exist, and the task mode', () => {
    expect(html).not.toContain('class="segs"');
    const task = hinzufuegenMarkup({ input: 'Al', suggestions: ['Altglas wegbringen', 'Abfall entsorgen', 'X'], frequent: ['Abfall entsorgen', 'Staubsaugen'], status: null, mode: 'aufgabe', tabs: true });
    expect(task).toContain('<div class="seg" data-action="tab:einkauf">Einkauf</div><div class="seg on" data-action="tab:aufgabe">Aufgabe</div>');
    expect(task).not.toContain('<div class="title serif">Hinzufügen</div>');
    expect(task).toContain('Häufig');
    expect(task).toContain('<div class="tiles two">');
    expect(task.match(/class="s"/g)).toHaveLength(2); // two suggestion slots
    expect(task).not.toContain('data-action="add:X"');
    const shop = hinzufuegenMarkup({ input: '', suggestions: [], frequent: [], status: null, mode: 'einkauf', tabs: true });
    expect(shop).toContain('<div class="seg on" data-action="tab:einkauf">');
    expect(shop).toContain('Oft gekauft');
    expect(hinzufuegenMarkup({ input: '', suggestions: [], frequent: [], status: null, mode: 'aufgabe', tabs: true })).toContain('Tippe eine Aufgabe ein');
    const missing = hinzufuegenMarkup({ input: '', suggestions: [], frequent: ['Staubsaugen'], status: null, mode: 'aufgabe', tabs: true, unavailable: 'Liste «Aufgaben» nicht gefunden' });
    expect(missing).toContain('<div class="empty">Liste «Aufgaben» nicht gefunden</div>');
    expect(missing).not.toContain('data-action="add:Staubsaugen"');
  });

  it('offers three suggestion slots and frequent tiles', () => {
    expect(html).toContain('data-action="add:Milch"');
    expect(html).toContain('data-action="add:Mineralwasser"');
    expect(html.match(/class="s blank"/g)).toHaveLength(1);
    expect(html).toContain('Oft gekauft');
    expect(html).toContain('data-action="add:Käse"');
  });

  it('renders a QWERTZ keyboard with umlauts, space and enter', () => {
    for (const k of ['q', 'z', 'ü', 'ö', 'ä', 'y', 'm']) expect(html).toContain(`data-action="key:${k}"`);
    expect(html).toContain('data-action="key:space"');
    expect(html).toContain('data-action="add:input"');
    expect(html.indexOf('key:q')).toBeLessThan(html.indexOf('key:w'));
    expect(html.indexOf('key:z')).toBeLessThan(html.indexOf('key:u'));
  });

  it('has no tab bar and no banner while typing', () => {
    expect(html).not.toContain('class="tabs"');
    expect(html).not.toContain('class="notice');
  });

  it('after an add shows the banner instead of the suggestions and checks the added tiles', () => {
    const added = hinzufuegenMarkup({
      input: '',
      suggestions: [],
      frequent: ['Butter', 'Joghurt', 'Käse'],
      added: ['käse'],
      status: { text: 'Käse erfasst', ok: true },
    });
    expect(added).toContain('<div class="notice ok">');
    expect(added).toContain('<span class="ellipsis">Käse erfasst</span>');
    expect(added).not.toContain('class="sugg"');
    expect(added).toContain('<div class="tile on">');
    expect(added).not.toContain('data-action="add:Käse"');
    expect(added).toContain('data-action="add:Butter"');
    // tiles keep their order; the checked one stays in its slot
    expect(added.indexOf('add:Butter')).toBeLessThan(added.indexOf('add:Joghurt'));
    expect(added.indexOf('add:Joghurt')).toBeLessThan(added.indexOf('tile on'));
  });

  it('keeps a failure visible next to the kept input', () => {
    const failed = hinzufuegenMarkup({ input: 'X', suggestions: [], frequent: [], status: { text: 'Konnte X nicht erfassen – bitte nochmals', ok: false } });
    expect(failed).toContain('<div class="notice">');
    expect(failed).toContain('X<span class="caret">');
  });

  it('shows a hint instead of an empty frequent section', () => {
    expect(hinzufuegenMarkup({ input: '', suggestions: [], frequent: [], status: null })).toContain('Tippe einen Artikel ein');
  });

  it('matches the snapshot', () => {
    expect(
      hinzufuegenMarkup({ input: '', suggestions: [], frequent: ['Butter', 'Joghurt', 'Käse'], added: ['joghurt'], status: { text: 'Joghurt erfasst', ok: true } }),
    ).toMatchSnapshot();
  });
});

describe('Station view', () => {
  const at = (hm: string) => new Date(`2026-11-03T${hm}:00+01:00`);
  const html = stationMarkup({
    name: 'Sternen',
    inbound: [{ line: '10', planned: at('07:43'), delayMin: 0, to: 'Zürich, Central', inbound: true }],
    outbound: [],
    outboundTo: null,
  });

  it('shows the station, a close button and both directions with the terminus', () => {
    expect(html).toContain('<div class="title serif">Sternen</div>');
    expect(html).toContain('data-action="close"');
    expect(html).toContain('Schliessen');
    expect(html).toMatch(/<span class="time">07:43<\/span><span class="line">10<\/span><span class="to ellipsis">Central<\/span>/);
    expect(html).toContain('← Gegenrichtung');
    expect(html).toContain('keine Abfahrten');
    expect(html).not.toContain('class="tabs"');
  });

  it('inverts the time of late departures', () => {
    const late = stationMarkup({
      name: 'Sternen',
      inbound: [{ line: '10', planned: at('07:43'), delayMin: 7, to: 'Zürich, Central', inbound: true }],
      outbound: [],
      outboundTo: null,
    });
    expect(late).toContain('<span class="time"><span class="late">07:43</span></span>');
  });

  it('greys unreachable departures and shows when to leave towards town', () => {
    const out = stationMarkup({
      name: 'Sternen',
      now: at('07:40'),
      walk: 4,
      inbound: [
        { line: '10', planned: at('07:42'), delayMin: 0, to: 'Zürich, Central', inbound: true },
        { line: '10', planned: at('07:48'), delayMin: 0, to: 'Zürich, Central', inbound: true },
      ],
      outbound: [],
      outboundTo: null,
    });
    expect(out).toContain('→ Richtung Stadt · los um 07:44');
    expect(out).toContain('<div class="st-dep gone">');
  });

  it('says when there is no data', () => {
    expect(stationMarkup({ name: 'Oerlikon', inbound: null, outbound: null, outboundTo: null }).match(/keine Daten/g)).toHaveLength(2);
  });
});
