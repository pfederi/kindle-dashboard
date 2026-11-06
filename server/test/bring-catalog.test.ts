import { describe, expect, it, vi } from 'vitest';
import { BringCatalog, loadCatalog, snapshotCatalog } from '../src/sources/bring/catalog.js';
import { fakeFetch, jsonResponse, textResponse } from './helpers.js';

const articles = { Milch: 'Milch', Frankfurter: 'Wienerli', Mineralwasser: 'Mineralwasser', Minze: 'Minze', Hummus: 'Hummus' };
const sections = [{ items: [{ itemId: 'Milch', name: 'Milch' }, { itemId: 'Frankfurter', name: 'Wienerli' }, { itemId: 'Zitronen', name: 'Zitronen' }] }];
const cat = new BringCatalog(articles, sections);

describe('BringCatalog', () => {
  it('maps keys to Swiss display names and back', () => {
    expect(cat.display('Frankfurter')).toBe('Wienerli');
    expect(cat.display('Selbstgemacht')).toBe('Selbstgemacht');
    expect(cat.keyFor('wienerli')).toBe('Frankfurter');
    expect(cat.keyFor(' Zitronen ')).toBe('Zitronen');
    expect(cat.keyFor('Bärlauchpesto')).toBe('Bärlauchpesto');
  });

  it('suggests prefix matches first, then substring matches, from 2 characters', () => {
    expect(cat.suggest('m', [])).toEqual([]);
    expect(cat.suggest('Mi', [])).toEqual(['Milch', 'Mineralwasser', 'Minze']);
    expect(cat.suggest('mus', [])).toEqual(['Hummus']);
    expect(cat.suggest('bär', ['Bärlauchpesto'])).toEqual(['Bärlauchpesto']);
    expect(cat.suggest('mi', ['Milch'], 2)).toEqual(['Milch', 'Mineralwasser']);
  });

  it('loads the bundled snapshot', () => {
    const snap = snapshotCatalog();
    expect(snap.display('Frankfurter')).toBe('Wienerli');
    expect(snap.suggest('Mil', []).length).toBeGreaterThan(0);
  });

  it('loads from the web and falls back to the snapshot on failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = fakeFetch((c) =>
      c.url.endsWith('articles.de-CH.json') ? jsonResponse({ Rüebli: 'Rüebli' }) : jsonResponse({ catalog: { sections: [] } }),
    );
    expect((await loadCatalog(ok, 'de-CH')).suggest('Rü', [])).toEqual(['Rüebli']);
    expect(ok.calls.map((c) => c.url)).toEqual([
      'https://web.getbring.com/locale/articles.de-CH.json',
      'https://web.getbring.com/locale/catalog.de-CH.json',
    ]);
    const down = fakeFetch(() => textResponse('down', 503));
    expect((await loadCatalog(down, 'de-CH')).display('Frankfurter')).toBe('Wienerli');
  });
});
