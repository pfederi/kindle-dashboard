/**
 * Renders the README screenshots in docs/screenshots from demo data, through the real Dashboard
 * and Chromium renderer: `npm run screenshots`. Nothing here talks to the network, except for the
 * base map of «Arbeitsweg» when HERE_API_KEY is set (without it the route is drawn on white).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Dashboard, PreviewOptions } from '../src/dashboard.js';
import { PlaywrightRenderer } from '../src/render/renderer.js';
import { TASK_SUGGESTIONS } from '../src/sources/bring/source.js';
import { fetchMap } from '../src/sources/commute-route.js';
import type { ViewName } from '../src/state.js';
import { arbeitswegHtml } from '../src/views/arbeitsweg.js';
import { einkaufHtml } from '../src/views/einkauf.js';
import { hinzufuegenHtml } from '../src/views/hinzufuegen.js';
import { BIRTHDAY_EVENTS, commuteDetail, dashboard, EVENTS, FREQUENT, SHOPPING, VISIT_EVENTS } from './demo.js';

const OUT = new URL('../../docs/screenshots/', import.meta.url);

const renderer = await PlaywrightRenderer.launch();
try {
  mkdirSync(OUT, { recursive: true });
  const save = (name: string, png: Buffer) => {
    writeFileSync(new URL(`${name}.png`, OUT), png);
    console.log(`docs/screenshots/${name}.png`);
  };
  const shot = async (d: Dashboard, name: string, view: ViewName, opts: PreviewOptions = {}) => save(name, await d.previewPng(view, opts));

  const morning = dashboard(renderer, '2026-11-03T07:40:00+01:00');
  await shot(morning, 'heute', 'heute');
  await shot(morning, 'wetter', 'wetter');
  await shot(morning, 'woche', 'woche');
  await shot(morning, 'haltestelle', 'station', { station: 2 });
  await shot(morning, 'nacht', 'heute', { night: true });
  await shot(dashboard(renderer, '2026-11-03T19:40:00+01:00'), 'heute-abend', 'heute');
  await shot(dashboard(renderer, '2026-11-03T18:15:00+01:00', VISIT_EVENTS), 'gast', 'heute');
  await shot(dashboard(renderer, '2026-11-03T07:40:00+01:00', BIRTHDAY_EVENTS, [{ name: 'Anna', date: '11-03' }]), 'geburtstag', 'heute');
  await shot(dashboard(renderer, '2026-11-03T07:40:00+01:00', EVENTS, [], ['Staubsaugen', 'Pflanzen giessen', 'Abfall entsorgen']), 'aufgaben', 'heute'); // oldest first, as Bring! lists them

  const apiKey = process.env.HERE_API_KEY?.trim();
  const map = apiKey ? await fetchMap((u, init) => fetch(u, init), apiKey, commuteDetail().view) : null;
  save('arbeitsweg', (await renderer.render(arbeitswegHtml({ now: new Date('2026-11-03T07:40:00+01:00'), label: 'Zur Arbeit', walk: 3, detail: commuteDetail(map) }))).png);

  // Einkauf and Hinzufügen right after a tap, with their feedback banner.
  const items = SHOPPING.ok ? SHOPPING.items : [];
  // A longer list than Heute's, so the pager shows.
  const more = ['Butter', 'Käse', 'Tomaten', 'Bananen', 'Joghurt', 'Reis', 'Pasta', 'Zwiebeln'].map((n) => ({ key: n, name: n, spec: '', urgent: false }));
  save('einkauf', (await renderer.render(einkaufHtml({ shopping: { ...SHOPPING, items: [...items, ...more] }, status: { text: 'Butter abgehakt', ok: true }, undo: true }))).png);
  save(
    'hinzufuegen',
    (await renderer.render(hinzufuegenHtml({ input: '', suggestions: [], frequent: FREQUENT, added: ['tomaten'], status: { text: 'Tomaten erfasst', ok: true }, mode: 'einkauf', tabs: true, urgentOffer: true }))).png,
  );
  save(
    'hinzufuegen-aufgabe',
    (
      await renderer.render(
        hinzufuegenHtml({ input: '', suggestions: [], frequent: TASK_SUGGESTIONS, added: ['abfall entsorgen'], status: { text: 'Abfall entsorgen erfasst', ok: true }, mode: 'aufgabe', tabs: true }),
      )
    ).png,
  );
} finally {
  await renderer.close();
}
