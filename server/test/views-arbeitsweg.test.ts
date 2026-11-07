import { describe, expect, it } from 'vitest';
import type { CommuteDetail, CommuteRoute, Stretch } from '../src/sources/commute-route.js';
import { altVia, arbeitswegMarkup, jamStreet } from '../src/views/arbeitsweg.js';

const NOW = new Date('2026-11-03T07:40:00+01:00');
const WORK = [{ label: 'Zur Arbeit', icon: 'work' as const, badge: '' }];
const BOTH = [...WORK, { label: 'Schule', icon: 'school' as const, badge: 'LE' }];
const stretch = (name: string, length: number, ratio: number, lat = 47.4): Stretch => ({
  points: [
    [lat, 8.54],
    [lat - 0.01, 8.53],
  ],
  ratio,
  name,
  length,
});
const main: CommuteRoute = {
  minutes: 24,
  delayMinutes: 7,
  stretches: [stretch('Schaffhauserstrasse', 1300, 1), stretch('Bucheggstrasse', 1100, 0.6, 47.39), stretch('Rosengartenstrasse', 450, 0.3, 47.38), stretch('Hardbrücke', 1200, 0.4, 47.37)],
};
const alt: CommuteRoute = { minutes: 19, delayMinutes: 0, stretches: [stretch('Schaffhauserstrasse', 1300, 1), stretch('Aemtlerstrasse', 900, 1, 47.37), stretch('Wehntalerstrasse', 400, 1, 47.36)] };
const detail = (routes: CommuteRoute[], image: string | null = 'data:image/png;base64,AQ=='): CommuteDetail => ({ routes, view: { lat: 47.38, lon: 8.53, zoom: 14 }, image });

describe('Arbeitsweg view', () => {
  it('shows the label, a close button, the ride door to door and when it arrives', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 3, detail: detail([main, alt]) });
    expect(html).toContain('<div class="title serif">Zur Arbeit</div>');
    expect(html).toContain('data-action="close"');
    expect(html).toContain('<div class="aw-time"><b>27 Min.</b> an 08:07</div>');
    expect(html).toContain('Alternative via Aemtlerstrasse: 22 Min.');
  });

  it('names the street with the longest jam next to the delay', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: detail([main]) });
    expect(html).toContain('<b class="late">+7 Min. Stau</b> Hardbrücke');
    expect(jamStreet(main)).toBe('Hardbrücke');
    // No jam, only slow-moving: the longest slow stretch.
    expect(jamStreet({ ...main, stretches: [stretch('A', 100, 0.7), stretch('B', 300, 0.6), stretch('C', 900, 0.9)] })).toBe('B');
    expect(jamStreet({ ...main, stretches: [stretch('C', 900, 0.9)] })).toBeNull();
  });

  it('says the traffic is as usual below the delay threshold', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: detail([{ ...main, delayMinutes: 2 }]) });
    expect(html).toContain('Verkehr wie üblich');
    expect(html).not.toContain('class="late"');
  });

  it('draws the route on the base map: jams thick, slow-moving dashed, the alternative dotted', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: detail([main, alt]) });
    expect(html).toContain('<img src="data:image/png;base64,AQ=="');
    expect(html.match(/<polyline class="aw-jam"/g)).toHaveLength(2);
    expect(html.match(/<polyline class="aw-slow"/g)).toHaveLength(1);
    expect(html.match(/<polyline class="aw-alt"/g)).toHaveLength(1);
    expect(html).toContain('class="aw-from"');
    expect(html).toContain('class="aw-to"');
    // The alternative is drawn first, under the route.
    expect(html.indexOf('aw-alt')).toBeLessThan(html.indexOf('aw-route'));
    expect(html).toContain('Alternative</span>');
  });

  it('draws on white without a base map, and leaves the alternative out of the legend without one', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: detail([main], null) });
    expect(html).not.toContain('<img');
    expect(html).toContain('class="aw-route"');
    expect(html).not.toContain('Alternative');
  });

  it('says when there is no data', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: null });
    expect(html).toContain('keine Verkehrsdaten');
    expect(html).not.toContain('<svg viewBox="0 0 1106');
  });

  it('shows work and school as tabs, the shown one black, with the abbreviation of whose ride it is', () => {
    const html = arbeitswegMarkup({ now: NOW, tabs: BOTH, active: 1, walk: 0, detail: detail([main]) });
    expect(html).not.toContain('class="title');
    expect(html).toMatch(/<div class="seg" data-action="commute:0">.*Zur Arbeit<\/div>/);
    expect(html).toMatch(/<div class="seg on" data-action="commute:1"><span class="cal">LE<\/span>.*Schule<\/div>/);
    // One destination: its label is the title.
    expect(arbeitswegMarkup({ now: NOW, tabs: WORK, active: 0, walk: 0, detail: null })).toContain('<div class="title serif">Zur Arbeit</div>');
  });

  it('picks what sets the alternative apart', () => {
    expect(altVia(main, alt)).toBe('Aemtlerstrasse');
    expect(altVia(main, main)).toBeNull();
  });
});
