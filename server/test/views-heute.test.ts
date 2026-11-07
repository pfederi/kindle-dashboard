import { describe, expect, it } from 'vitest';
import { heuteHtml, heuteMarkup } from '../src/views/heute.js';
import { CSS } from '../src/views/styles.js';
import { dryWeather, entry, heuteModel } from './fixtures/models.js';

describe('Heute view', () => {
  const html = heuteMarkup(heuteModel());

  it('shows date, stand, weather with min and rain hint', () => {
    expect(html).toContain('Dienstag, 3. November');
    expect(html).toContain('Stand 07:40');
    expect(html).toContain('>8°<');
    expect(html).toContain('Bewölkt');
    expect(html).toContain('Max 11°');
    expect(html).toContain('Min 4°');
    expect(html).toContain('Schirm mitnehmen');
    expect(html).toContain('ab 15 Uhr Regen');
  });

  it('puts max, min and lake temperature on their own line', () => {
    expect(html).toMatch(/<div><b>Max 11°<\/b> · <b>Min 4°<\/b> · <span>.*See 13°<\/span><\/div>/);
  });

  it('greets a birthday above the events and leaves room for fewer of them', () => {
    const many = Array.from({ length: 8 }, (_, i) => entry(`1${i}:00`, 'FAM', `T${i}`));
    const out = heuteMarkup(heuteModel({ birthdays: ['Anna'], events: many }));
    expect(out).toMatch(/<div class="bday"><span class="icon"><svg class="lucide lucide-cake".*?<\/span><span class="serif">Happy Birthday Anna!<\/span><\/div><div class="section-title">/);
    // 4 rows, 2 for the banner: one event and «+ 7 weitere»
    expect(out.match(/class="ev"/g)).toHaveLength(1);
    expect(out).toContain('+ 7 weitere');
    expect(heuteMarkup(heuteModel({ birthdays: ['Marianne', 'Simone'] }))).toContain('<div class="bday many">');
    expect(heuteMarkup(heuteModel({ birthdays: ['Marianne', 'Simone'] }))).toContain('Happy Birthday Marianne &amp; Simone!');
    expect(heuteMarkup(heuteModel({ birthdays: ['A', 'B', 'C'] }))).toContain('Happy Birthday A, B &amp; C!');
    expect(html).not.toContain('bday');
  });

  it('greets a birthday in the evening too, above tonight, and still shows an event of tomorrow', () => {
    const tonight = Array.from({ length: 4 }, (_, i) => entry(`2${i}:00`, 'FAM', `Abend${i}`));
    const tomorrow = Array.from({ length: 4 }, (_, i) => entry(`0${i + 7}:00`, 'PF', `Morgen${i}`));
    const out = heuteMarkup(heuteModel({ evening: true, birthdays: ['Anna'], events: tonight, tomorrow }));
    expect(out.indexOf('Happy Birthday Anna!')).toBeLessThan(out.indexOf('Heute Abend'));
    expect(out).toContain('<div class="bday sm">');
    expect(out).toContain('Abend0');
    expect(out).toContain('Morgen0');
  });

  describe('tasks', () => {
    const tasks = [
      { key: 'Glas & PET: Keller', name: 'Glas & PET: Keller' },
      { key: 'Pflanzen giessen', name: 'Pflanzen giessen' },
      { key: 'Staubsaugen', name: 'Staubsaugen' },
    ];
    const many = Array.from({ length: 8 }, (_, i) => entry(`1${i}:00`, 'FAM', `T${i}`));

    it('shows the newest task in a box above the events, «+ N» for the others, and takes one row', () => {
      const out = heuteMarkup(heuteModel({ tasks, events: many }));
      expect(out).toMatch(/<div class="taskbox" data-action="task:Glas &amp; PET: Keller">.*lucide-circle.*Glas &amp; PET: Keller<\/span><span class="more-inline">\+ 2<\/span><\/div><div class="section-title">/);
      expect(out.match(/class="ev"/g)).toHaveLength(2); // 3 rows: 2 events and «+ 6 weitere»
      expect(out).toContain('+ 6 weitere');
    });

    it('has «+ Aufgabe» in the first section title whenever tasks are configured', () => {
      const button = '<span class="addtask" data-action="nav:aufgabe">';
      expect(heuteMarkup(heuteModel({ tasks: [] }))).toContain(button);
      expect(heuteMarkup(heuteModel({ tasks: null }))).toContain(button);
      expect(heuteMarkup(heuteModel({ tasks: null }))).not.toContain('taskbox');
      expect(heuteMarkup(heuteModel())).not.toContain(button);
      const evening = heuteMarkup(heuteModel({ evening: true, tasks: [], events: [entry('20:00', 'FAM', 'Konzert')], tomorrow: [] }));
      expect(evening.match(/data-action="nav:aufgabe"/g)).toHaveLength(1);
      expect(evening.indexOf('nav:aufgabe')).toBeLessThan(evening.indexOf('Morgen'));
    });

    it('in the evening with a birthday and a task shows a single section', () => {
      const tonight = [entry('20:00', 'FAM', 'Konzert'), entry('21:00', 'FAM', 'Bar')];
      const out = heuteMarkup(heuteModel({ evening: true, birthdays: ['Anna'], tasks, events: tonight, tomorrow: [entry('08:00', 'PF', 'Arzt')] }));
      expect(out).toContain('Heute Abend');
      expect(out).not.toContain('Morgen');
      const none = heuteMarkup(heuteModel({ evening: true, birthdays: ['Anna'], tasks, events: [], tomorrow: [entry('08:00', 'PF', 'Arzt')] }));
      expect(none).toContain('Morgen');
      expect(none).toContain('Arzt');
    });
  });

  it('lists urgent items first in the widget, bold, after the runner; then the newest', () => {
    const shopping = {
      ok: true as const,
      listName: 'Zuhause',
      items: [
        { key: 'Milch', name: 'Milch', spec: '', urgent: false },
        { key: 'WC', name: 'WC-Papier', spec: '', urgent: true },
        { key: 'Brot', name: 'Brot', spec: '', urgent: false },
        { key: 'Pommes', name: 'Pommes Frites', spec: '', urgent: true },
      ],
    };
    const out = heuteMarkup(heuteModel({ shopping }));
    expect(out).toMatch(/<div class="items ellipsis"><span class="icon"><svg[^>]*class="icon-run".*?<\/span><b>Pommes Frites, WC-Papier<\/b>, Brot, Milch<\/div>/);
    expect(heuteMarkup(heuteModel())).not.toContain('icon-run');
  });

  it('draws hidden titles as bars and marks the guest mode with a lock', () => {
    const out = heuteMarkup(heuteModel({ guest: true, events: [{ ...entry('09:00', 'PF', ''), hidden: true }, entry('18:00', 'FAM', 'Besuch Müllers')] }));
    expect(out).toContain('<span class="time">09:00</span><span class="cal">PF</span><span class="ev-title hidden"></span>');
    expect(out).toContain('Besuch Müllers');
    expect(out).toMatch(/Termine heute<span class="guest">/);
    expect(html).not.toContain('class="guest"');
  });

  it('drops missing parts without stray separators', () => {
    const base = heuteModel();
    const out = heuteMarkup(heuteModel({ lakeTemp: null, weather: { ...base.weather!, maxTemp: null } }));
    expect(out).toContain('<div><b>Min 4°</b></div>');
    expect(out).not.toContain('See ');
    const none = heuteMarkup(heuteModel({ lakeTemp: undefined, weather: { ...base.weather!, maxTemp: null, minTemp: null } }));
    expect(none).not.toContain('Min ');
    expect(none).not.toMatch(/<div>\s*<\/div>/);
  });

  it('draws a rain strip for the next 12 hours, black from 50 %, with every third hour', () => {
    // fixture: 10 % until 14:00, 70 % from 15:00; now 07:40
    expect(html.match(/<div class="h">/g)).toHaveLength(12);
    expect(html.match(/class="bar wet"/g)).toHaveLength(4); // 15–18 Uhr
    expect(html).toContain('<div class="bar" style="height:6px"></div>');
    expect(html).toContain('<div class="bar wet" style="height:42px"></div>');
    const labels = [...html.matchAll(/<div class="hr">(\d*)<\/div>/g)].map((m) => m[1]);
    expect(labels).toEqual(['7', '', '', '10', '', '', '13', '', '', '16', '', '']);
  });

  it('says "Kein Regen bis …" instead of a strip when it stays dry', () => {
    const base = heuteModel();
    const dry = { ...base.weather!, hourlyRain: base.weather!.hourlyRain.map((h) => ({ ...h, probability: 10 })) };
    const out = heuteMarkup(heuteModel({ weather: dry }));
    expect(out).toContain('<div>Kein Regen bis 19 Uhr</div>'); // 07:40 + 12 h
    expect(out).not.toContain('class="rain"');
    expect(out).not.toContain('Schirm mitnehmen');
  });

  it('in the evening shows tomorrow\'s weather with its rain from 6 Uhr', () => {
    const out = heuteMarkup(heuteModel({ now: new Date('2026-11-03T19:30:00+01:00'), evening: true, events: [], tomorrow: [] }));
    expect(out).toContain('<div class="tlabel">morgen</div><div class="temp serif">9°</div>');
    expect(out).toContain('<b>Min 2°</b>');
    expect(out).not.toContain('Max ');
    expect(out).toContain('ab 10 Uhr Regen');
    const labels = [...out.matchAll(/<div class="hr">(\d*)<\/div>/g)].map((m) => m[1]).filter(Boolean);
    expect(labels).toEqual(['6', '9', '12', '15']);
  });

  it('in the evening lists tonight\'s remaining events, then tomorrow, and links to Woche', () => {
    const out = heuteMarkup(
      heuteModel({
        now: new Date('2026-11-03T19:30:00+01:00'),
        evening: true,
        events: [entry('19:00', 'FAM', 'Konzert')],
        tomorrow: [entry('ganzt.', 'PF', 'Ferien'), entry('08:00', 'AB', 'Zahnarzt')],
      }),
    );
    expect(out).toContain('<div class="agenda evening" data-action="nav:woche" data-hold="guest">');
    expect(out.indexOf('Heute Abend')).toBeLessThan(out.indexOf('Konzert'));
    expect(out.indexOf('Konzert')).toBeLessThan(out.indexOf('<div class="section-title next"><span>Morgen</span></div>'));
    expect(out).toContain('Zahnarzt');
    expect(out).not.toContain('Termine heute');
  });

  it('in the evening without events tonight shows only tomorrow, and says when tomorrow is empty', () => {
    const out = heuteMarkup(heuteModel({ now: new Date('2026-11-03T21:00:00+01:00'), evening: true, events: [], tomorrow: [] }));
    expect(out).not.toContain('Heute Abend');
    expect(out).toContain('<div class="section-title"><span>Morgen</span></div>');
    expect(out).toContain('Keine Termine morgen');
  });

  it('caps tomorrow so tonight and tomorrow fit together', () => {
    const tomorrow = Array.from({ length: 6 }, (_, i) => entry(`0${i + 1}:00`, 'AB', `Morgen ${i}`));
    const out = heuteMarkup(heuteModel({ evening: true, events: [entry('19:00', 'FAM', 'A'), entry('20:00', 'FAM', 'B')], tomorrow }));
    // 4 rows: 2 tonight, 1 for the title, 1 for tomorrow: its first entry with «+ 5» at the end
    expect(out).toContain('B</span>');
    expect(out).toMatch(/Morgen 0<\/span><span class="more-inline">\+ 5<\/span>/);
    expect(out).not.toContain('Morgen 1');
    expect(out).not.toContain('weitere');
  });

  it('says "Regen ab jetzt" when it rains this hour', () => {
    const m = heuteModel({ now: new Date('2026-11-03T15:20:00+01:00') });
    expect(heuteMarkup(m)).toContain('Regen ab jetzt');
  });

  it('lists today\'s events with calendar labels and greys past ones', () => {
    expect(html).toContain('Termine heute');
    expect(html).toMatch(/class="ev past"><span class="time">07:00<\/span><span class="cal">PF<\/span>/);
    expect(html).toContain('Zahnarzt Lena');
  });

  it('shows waste collections with their icon instead of a calendar label', () => {
    const out = heuteMarkup(
      heuteModel({
        events: [
          { calendar: '', title: 'Karton', label: 'ganzt.', allDay: true, past: false, sortTime: 0, waste: 'cardboard' },
          { calendar: '', title: 'Papier', label: 'morgen', allDay: true, past: false, sortTime: 0, waste: 'paper' },
        ],
      }),
    );
    expect(out).toMatch(/<span class="time">ganzt\.<\/span><span class="cal waste"><span class="icon"><svg[^>]*lucide-package/);
    expect(out).toMatch(/<span class="time">morgen<\/span><span class="cal waste"><span class="icon"><svg[^>]*lucide-newspaper/);
    expect(out).toContain('<span class="ev-title ellipsis">Papier</span>');
  });

  it('caps events at 4 rows with "+ N weitere"', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`1${i}:00`, 'PF', `Termin ${i}`));
    const out = heuteMarkup(heuteModel({ events: many }));
    expect(out.match(/class="ev"/g)).toHaveLength(3);
    expect(out).toContain('+ 7 weitere');
    expect(heuteMarkup(heuteModel({ events: many.slice(0, 4) })).match(/class="ev"/g)).toHaveLength(4);
  });

  it('uses the room of the rain strip for one more row on a dry day', () => {
    const many = Array.from({ length: 10 }, (_, i) => entry(`1${i}:00`, 'PF', `Termin ${i}`));
    const out = heuteMarkup(heuteModel({ events: many, weather: dryWeather() }));
    expect(out).not.toContain('class="rain"');
    expect(out.match(/class="ev"/g)).toHaveLength(4);
    expect(out).toContain('+ 6 weitere');
    const none = heuteMarkup(heuteModel({ events: many, weather: null }));
    expect(none.match(/class="ev"/g)).toHaveLength(4);
  });

  it('shows three departure columns towards "Stadt" with badges and delays', () => {
    expect(html.match(/→ Stadt/g)).toHaveLength(3);
    expect(html).toContain('<span class="line rail">S7</span>');
    expect(html).toContain('<span class="t">08:06</span><span class="delay">+2</span>');
    expect(html).toContain('<span class="line sm">14</span><span class="t">07:42</span>');
    expect(html).not.toContain('<span class="line sm">10</span>');
  });

  it('shows the Bring widget with count, items and the add button', () => {
    expect(html).toContain('Einkaufsliste · 3');
    expect(html).toContain('Eier, Brot, Milch'); // newest (last from Bring!) first
    expect(html).toContain('data-action="nav:hinzufuegen"');
  });

  it('renders tabs with Heute active', () => {
    expect(html).toContain('<div class="tab on" data-action="nav:heute">Heute</div>');
    expect(html).toContain('data-action="nav:woche"');
    expect(html).toContain('data-action="nav:einkauf"');
    expect(html).toContain('data-action="refresh"');
  });

  it('degrades gracefully without data', () => {
    const out = heuteMarkup(
      heuteModel({
        weather: null,
        events: null,
        boards: [{ name: 'Oerlikon', lines: ['S7'], departures: null }, { name: 'Sternen', lines: ['10'], departures: [] }],
        shopping: { ok: false, message: 'Keine Daten' },
      }),
    );
    expect(out).toContain('Wetter: keine Daten');
    expect(out).toContain('Termine: keine Daten');
    expect(out).toContain('<div class="none">keine Daten</div>');
    expect(out).toContain('keine Abfahrten');
    expect(out).toContain('Keine Daten');
    expect(heuteMarkup(heuteModel({ events: [] }))).toContain('Keine Termine heute');
  });

  it('wraps markup in a full document with fonts', () => {
    const doc = heuteHtml(heuteModel());
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain("font-family:'Inter'");
    expect(doc).toContain('data:font/woff2;base64,');
  });

  it('uses ev-title for event titles, not the page-heading class', () => {
    expect(html).toContain('class="ev-title ellipsis"');
    expect(html).not.toContain('class="title');
  });

  it('uses only palette colours in the CSS', () => {
    const allowed = new Set(['#000', '#fff', '#555', '#999', '#ececec']);
    const found = (CSS.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).map((c) => c.toLowerCase());
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((c) => !allowed.has(c))).toEqual([]);
  });

  it('greys departures out of reach on foot and says when to leave for the next one', () => {
    const at = (hm: string) => new Date(`2026-11-03T${hm}:00+01:00`);
    const dep = (hm: string, delayMin = 0) => ({ line: '10', planned: at(hm), delayMin, to: 'Zürich, Central', inbound: true });
    const out = heuteMarkup(heuteModel({ boards: [{ name: 'Sternen', lines: ['10'], walk: 4, departures: [dep('07:43'), dep('07:49'), dep('07:55')] }] }));
    expect(out).toContain('<div class="dir"><span>→ Stadt</span><b>los 07:45</b></div>');
    expect(out).toContain('<div class="dep gone"><span class="t">07:43</span></div>');
    expect(out).toContain('<div class="dep"><span class="t">07:49</span></div>');
    const noWalk = heuteMarkup(heuteModel({ boards: [{ name: 'Sternen', lines: ['10'], departures: [dep('07:43')] }] }));
    expect(noWalk).toContain('<div class="dir"><span>→ Stadt</span></div>');
    expect(noWalk).not.toContain('gone');
  });

  it('inverts the time of departures delayed by 5 minutes or more', () => {
    const at = (hm: string) => new Date(`2026-11-03T${hm}:00+01:00`);
    const out = heuteMarkup(
      heuteModel({
        boards: [
          {
            name: 'Sternen',
            lines: ['10'],
            departures: [
              { line: '10', planned: at('07:43'), delayMin: 4, to: 'Zürich, Central', inbound: true },
              { line: '10', planned: at('07:53'), delayMin: 5, to: 'Zürich, Central', inbound: true },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('<span class="t">07:43</span><span class="delay">+4</span>');
    expect(out).toContain('<span class="t late">07:53</span><span class="delay">+5</span>');
  });

  it('renders at most 4 departures per board', () => {
    const deps = Array.from({ length: 6 }, (_, i) => ({ line: '10', planned: new Date(`2026-11-03T08:0${i}:00+01:00`), delayMin: 0, to: 'Zürich, Central', inbound: true }));
    const out = heuteMarkup(heuteModel({ boards: [{ name: 'Sternen', lines: ['10'], departures: deps }] }));
    expect(out.match(/class="dep"/g)).toHaveLength(4);
  });

  it('matches the snapshot', () => {
    expect(html).toMatchSnapshot();
  });

  it('shows the scooter travel time above the departures, a delay from 3 minutes, and no line without configuration', () => {
    const line = (travel: { minutes: number; delayMinutes: number } | null) => heuteMarkup(heuteModel({ commute: { label: 'Zur Arbeit', travel } }));
    expect(line({ minutes: 18, delayMinutes: 4 })).toMatch(/<div class="rule"><\/div><div class="commute">.*Zur Arbeit<\/span><b>18 Min\.<\/b><span>an 07:58<\/span><b class="late">\+4 Min\. Stau<\/b><\/div><div class="ov">/);
    expect(line({ minutes: 15, delayMinutes: 2 })).not.toContain('Stau');
    expect(line(null)).toContain('keine Verkehrsdaten');
    expect(html).not.toContain('class="commute"');
  });
});
