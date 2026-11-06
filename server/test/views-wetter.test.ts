import { describe, expect, it } from 'vitest';
import { compassSector, smoothPath, trendText, wetterMarkup } from '../src/views/wetter.js';
import { heuteModel, NOW } from './fixtures/models.js';

describe('Wetter view', () => {
  const html = wetterMarkup({ now: NOW, weather: heuteModel().weather, lakeTemp: 13.3 });

  it('shows now with feels-like, humidity and sun times, and a close button', () => {
    expect(html).toContain('<div class="title serif">Wetter</div>');
    expect(html).toContain('Schliessen');
    expect(html).toContain('<div class="temp serif">8°</div>');
    expect(html).toContain('gefühlt 5° · Feuchte 82 %');
    expect(html).toMatch(/lucide-sunrise.*07:13.*lucide-sunset.*17:04 · .*lucide-waves.* See 13°/s);
    expect(html).not.toContain('class="tabs"');
  });

  it('draws 24 hours of temperature with max and min, rain in mm and every third hour', () => {
    expect(html).toContain('<svg class="chart" width="988" height="288"');
    expect(html).toMatch(/<path d="M[^"]+ C[^"]+" fill="none" stroke="#000"/);
    expect(html).toContain('>11°</text>'); // max at 15 Uhr
    expect(html).toContain('>-3°</text>'); // min at 3 Uhr (next day)
    const chart = html.slice(html.indexOf('<svg class="chart"'), html.indexOf('</svg>', html.indexOf('<svg class="chart"')));
    expect(chart.match(/<rect[^>]*fill="#000"/g)).toHaveLength(2); // 2 mm at 16 and 17 Uhr
    const hours = [...html.matchAll(/class="ax">(\d+)<\/text>/g)].map((m) => m[1]);
    // edge to edge: 7 Uhr today at the left, 7 Uhr tomorrow at the right
    expect(hours).toEqual(['7', '10', '13', '16', '19', '22', '1', '4', '7']);
    expect(html).toContain('<text x="0.0" y="284" text-anchor="start" class="ax">7</text>');
    expect(html).toContain('<text x="988.0" y="284" text-anchor="end" class="ax">7</text>');
  });

  it('shows a weather icon every 3 hours above the chart, the moon at night', () => {
    const row = html.slice(html.indexOf('<div class="hicons">'), html.indexOf('<svg class="chart"'));
    const icons = [...row.matchAll(/lucide-([a-z-]+)/g)].map((m) => m[1]);
    // from 07 Uhr: 7, 10, 13 clear by day; 16, 19, 22 rain; 1, 4 cloudy at night; 7 Uhr clear again
    expect(icons).toEqual(['sun', 'sun', 'sun', 'cloud-rain', 'cloud-rain', 'cloud-rain', 'cloud', 'cloud', 'sun']);
    expect(row).toContain('style="left:0.0px"'); // the first and last icon align with the edges
    expect(row).toContain('style="left:948.0px"');
  });

  it('uses the moon for clear nights', () => {
    const w = heuteModel().weather!;
    const night = { ...w, hourly: w.hourly.map((h) => ({ ...h, code: 0, isDay: false })) };
    const out = wetterMarkup({ now: NOW, weather: night, lakeTemp: null });
    const row = out.slice(out.indexOf('<div class="hicons">'), out.indexOf('<svg class="chart"'));
    expect(row.match(/lucide-moon/g)).toHaveLength(9);
  });

  it('draws the wind speed over the gusts in its own band and labels the maximum', () => {
    const chart = html.slice(html.indexOf('<svg class="chart"'), html.indexOf('</svg>', html.indexOf('<svg class="chart"')));
    expect(chart).toMatch(/<path d="M[^"]+ Z" fill="#ececec"><\/path><path d="M[^"]+" fill="none" stroke="#000" stroke-width="4"/);
    expect(chart).toContain('>18 kn</text>'); // 15 Uhr
  });

  it('shows the lake temperature only when known', () => {
    expect(wetterMarkup({ now: NOW, weather: heuteModel().weather, lakeTemp: null })).not.toContain('See ');
  });

  it('points the wind arrow where the wind blows to, with speed, gusts and origin', () => {
    expect(html).toContain('transform="rotate(45.0)"'); // from SW (225°) towards NE
    expect(html).toContain('12 kn');
    expect(html).toContain('Böen 30 · aus SW');
  });

  it('shows the barometer with needle, reference needle and rising trend', () => {
    expect(html).toContain('1018 hPa');
    expect(html).toContain('↗ steigend · +1,5 hPa in 3 h'); // 1018.4 now vs 1016.9 at 4 Uhr
    expect(html).toMatch(/stroke="#555" stroke-width="3"/);
    for (const zone of ['Sturm', 'Regen', 'Veränderlich', 'Schön', 'Trocken']) expect(html).toContain(`>${zone}</text>`);
  });

  it('shows per day when it rains (24 hourly bars, black from 50 %) and the sum from 1 mm', () => {
    const strips = [...html.matchAll(/<svg class="dayrain"/g)].map((m) => m.index!);
    expect(strips).toHaveLength(4); // the head with the hour labels and three days
    const head = html.slice(strips[0], html.indexOf('</svg>', strips[0]));
    expect([...head.matchAll(/class="rh">(\w+)<\/text>/g)].map((m) => m[1])).toEqual(['3', '6', '9', '12', '15', '18', '21']);
    expect(html).toContain('<span class="rh-label">Regen</span>');
    const today = html.slice(strips[1], html.indexOf('</svg>', strips[1]));
    expect(today.match(/fill="#000"/g)).toHaveLength(9); // 15–23 Uhr at 70 %
    expect(today.match(/fill="#999"/g)).toHaveLength(15); // the other hours at 10 %
    expect(html).toContain('<span class="mm">4 mm</span>');
    expect(html).toContain('<span class="mm"></span>'); // 0.4 mm tomorrow: below 1 mm
  });

  it('lists the days with min and max as numbers, today as «Heute»', () => {
    expect(html.match(/class="wday"/g)).toHaveLength(3);
    expect(html).toContain('<span class="lo">4°</span><span class="hi">11°</span>');
    expect(html).not.toContain('class="range"');
    expect(html).toContain('<span class="dn">Heute</span>');
    expect(html).toContain('<span class="dn">Mi</span>');
  });

  it('says when there is no weather', () => {
    expect(wetterMarkup({ now: NOW, weather: null, lakeTemp: null })).toContain('Wetter: keine Daten');
  });
});

describe('Wetter helpers', () => {
  it('names compass sectors in German', () => {
    expect([0, 44, 90, 135, 180, 225, 270, 315, 359].map(compassSector)).toEqual(['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW', 'N']);
  });

  it('describes the pressure trend over 3 hours', () => {
    expect(trendText(1018, 1017.5)).toBe('→ gleichbleibend');
    expect(trendText(1015, 1018.2)).toBe('↘ fallend · −3,2 hPa in 3 h');
  });

  it('draws a smooth path through all points', () => {
    expect(smoothPath([[0, 0], [10, 10], [20, 0]])).toMatch(/^M0\.0,0\.0 C.* 10\.0,10\.0 C.* 20\.0,0\.0$/);
    expect(smoothPath([])).toBe('');
  });
});
