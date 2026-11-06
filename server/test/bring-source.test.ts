import { describe, expect, it, vi } from 'vitest';
import { BringCatalog, verbatimNames } from '../src/sources/bring/catalog.js';
import type { BringApi, BringItems } from '../src/sources/bring/client.js';
import { BringSource, disabledBring, MAX_TASK_TILES, TASK_SUGGESTIONS } from '../src/sources/bring/source.js';
import { testClock } from './helpers.js';

const none = { urgent: false, convenient: false, discounted: false };
const catalog = new BringCatalog({ Milch: 'Milch', Frankfurter: 'Wienerli', Brot: 'Brot', Eier: 'Eier' }, []);

function fakeApi(items: BringItems): BringApi & { added: [string, string][]; completed: string[][] } {
  const added: [string, string][] = [];
  const completed: string[][] = [];
  return {
    added,
    completed,
    lists: vi.fn(async () => [{ listUuid: 'l-1', name: 'Zuhause' }, { listUuid: 'l-2', name: 'Migros' }]),
    items: vi.fn(async () => items),
    add: vi.fn(async (listUuid: string, itemId: string) => {
      added.push([listUuid, itemId]);
    }),
    complete: vi.fn(async (listUuid: string, itemId: string, spec: string, uuid: string) => {
      completed.push([listUuid, itemId, spec, uuid]);
    }),
    setConditions: vi.fn(async () => {}),
  };
}

const items: BringItems = {
  purchase: [{ uuid: '1', itemId: 'Milch', specification: '2 l', conditions: none }, { uuid: '2', itemId: 'Frankfurter', specification: '', conditions: none }],
  recently: [{ uuid: '3', itemId: 'Brot', specification: '', conditions: none }, { uuid: '4', itemId: 'Milch', specification: '', conditions: none }, { uuid: '5', itemId: 'Bärlauchpesto', specification: '', conditions: none }],
};

const make = (api: BringApi, list = 'zuhause') => new BringSource(api, list, async () => catalog, testClock('2026-11-03T07:40:00+01:00'));

describe('BringSource', () => {
  it('reads the configured list (case-insensitive) with display names', async () => {
    const source = make(fakeApi(items));
    expect(await source.list()).toEqual({
      ok: true,
      listName: 'Zuhause',
      items: [{ key: 'Milch', name: 'Milch', spec: '2 l', urgent: false }, { key: 'Frankfurter', name: 'Wienerli', spec: '', urgent: false }],
    });
  });

  it('reports a missing list', async () => {
    expect(await make(fakeApi(items), 'Coop').list()).toEqual({ ok: false, message: 'Liste «Coop» nicht gefunden' });
  });

  it('reports unavailable data when the api fails and nothing is cached', async () => {
    const api = fakeApi(items);
    api.lists = async () => {
      throw new Error('down');
    };
    expect(await make(api).list()).toEqual({ ok: false, message: 'Keine Daten' });
  });

  it('adds by catalog key and refreshes the cache', async () => {
    const api = fakeApi(items);
    const source = make(api);
    await source.list();
    expect(await source.add(' eier ')).toEqual({ kind: 'added', name: 'Eier', key: 'Eier', urgent: false });
    expect(api.added).toEqual([['l-1', 'Eier']]);
    await source.list();
    expect(api.items).toHaveBeenCalledTimes(2);
  });

  it('ticks an item off with its specification and refreshes the cache', async () => {
    const api = fakeApi(items);
    const source = make(api);
    expect(await source.complete('Frankfurter')).toEqual({ kind: 'done', key: 'Frankfurter', name: 'Wienerli', spec: '' });
    expect(await source.complete('Milch')).toMatchObject({ kind: 'done', spec: '2 l' });
    expect(api.completed).toEqual([['l-1', 'Frankfurter', '', '2'], ['l-1', 'Milch', '2 l', '1']]);
    await source.list();
    expect(api.items).toHaveBeenCalledTimes(3);
  });

  it('reports an item that is no longer on the list, and api failures', async () => {
    const api = fakeApi(items);
    expect(await make(api).complete('Eier')).toEqual({ kind: 'gone', key: 'Eier', name: 'Eier', spec: '' });
    expect(api.completed).toEqual([]);
    api.complete = async () => {
      throw new Error('down');
    };
    expect(await make(api).complete('Milch')).toMatchObject({ kind: 'failed', name: 'Milch' });
  });

  it('restores a ticked-off item with its specification', async () => {
    const api = fakeApi(items);
    const source = make(api);
    expect(await source.restore('Milch', '2 l')).toBe(true);
    expect(api.add).toHaveBeenCalledWith('l-1', 'Milch', '2 l');
    api.add = async () => {
      throw new Error('down');
    };
    expect(await source.restore('Milch', '2 l')).toBe(false);
  });

  it('maps Swiss names back to keys and keeps free text', async () => {
    const api = fakeApi({ purchase: [], recently: [] });
    const source = make(api);
    await source.add('Wienerli');
    await source.add('Bärlauchpesto');
    expect(api.added).toEqual([['l-1', 'Frankfurter'], ['l-1', 'Bärlauchpesto']]);
  });

  it('does not add duplicates', async () => {
    const api = fakeApi(items);
    expect(await make(api).add('wienerli')).toEqual({ kind: 'duplicate', name: 'Wienerli', key: 'Frankfurter', urgent: false });
    expect(api.added).toEqual([]);
  });

  it('returns failed when the api rejects', async () => {
    const api = fakeApi({ purchase: [], recently: [] });
    api.add = async () => {
      throw new Error('down');
    };
    expect(await make(api).add('Milch')).toEqual({ kind: 'failed', name: 'Milch' });
  });

  it('offers at most fifteen frequent items', async () => {
    const many = { purchase: [], recently: Array.from({ length: 20 }, (_, i) => ({ uuid: `r${i}`, itemId: `Artikel ${i}`, specification: '' })) };
    expect(await make(fakeApi(many)).frequent()).toHaveLength(15);
  });

  it('suggests from catalog and own items, and lists frequent items not on the list', async () => {
    const source = make(fakeApi(items));
    expect(await source.suggestions('bär')).toEqual(['Bärlauchpesto']);
    expect(await source.suggestions('m')).toEqual([]);
    expect(await source.frequent()).toEqual(['Brot', 'Bärlauchpesto']);
  });

  it('disabledBring explains itself', async () => {
    expect(await disabledBring.list()).toEqual({ ok: false, message: 'Bring! ist nicht eingerichtet' });
    expect(await disabledBring.add('Milch')).toEqual({ kind: 'failed', name: 'Milch' });
    expect(await disabledBring.frequent()).toEqual([]);
  });
});

describe('BringSource for tasks (verbatim names)', () => {
  const taskItems: BringItems = {
    purchase: [{ uuid: 't1', itemId: 'Abfall entsorgen', specification: '', conditions: none }],
    recently: [
      { uuid: 't2', itemId: 'Velo pumpen', specification: '', conditions: none },
      { uuid: 't3', itemId: 'Abfall entsorgen', specification: '', conditions: none },
      { uuid: 't4', itemId: 'Pflanzen giessen', specification: '', conditions: none },
    ],
  };
  const tasks = (api: BringApi, fill = TASK_SUGGESTIONS) =>
    new BringSource(api, 'Aufgaben', async () => verbatimNames, testClock('2026-11-03T07:40:00+01:00'), { fill, max: MAX_TASK_TILES });
  const api = () => {
    const a = fakeApi(taskItems);
    a.lists = vi.fn(async () => [{ listUuid: 'l-1', name: 'Zuhause' }, { listUuid: 'l-9', name: 'Aufgaben' }]);
    return a;
  };

  it('stores and shows the text unchanged', async () => {
    const a = api();
    const source = tasks(a);
    expect(await source.list()).toEqual({ ok: true, listName: 'Aufgaben', items: [{ key: 'Abfall entsorgen', name: 'Abfall entsorgen', spec: '', urgent: false }] });
    expect(await source.add('  Glas & PET: Keller ')).toEqual({ kind: 'added', name: 'Glas & PET: Keller', key: 'Glas & PET: Keller', urgent: false });
    expect(a.added).toEqual([['l-9', 'Glas & PET: Keller']]);
  });

  it('reports an open task as duplicate, ignoring case', async () => {
    expect(await tasks(api()).add('abfall ENTSORGEN')).toEqual({ kind: 'duplicate', name: 'abfall ENTSORGEN', key: 'Abfall entsorgen', urgent: false });
  });

  it('fills the tiles: recently done first, then the fixed suggestions, without open ones, at most 10', async () => {
    const tiles = await tasks(api()).frequent();
    expect(tiles.slice(0, 3)).toEqual(['Velo pumpen', 'Pflanzen giessen', 'Altglas wegbringen']);
    expect(tiles).not.toContain('Abfall entsorgen');
    expect(tiles).toHaveLength(9); // 2 recent + 7 of the 9 fixed (Abfall is open, Pflanzen already in)
    expect(await tasks(api(), [...TASK_SUGGESTIONS, 'A1', 'A2', 'A3']).frequent()).toHaveLength(MAX_TASK_TILES);
  });

  it('suggests earlier tasks only, not catalog articles', async () => {
    expect(await tasks(api()).suggestions('pfl')).toEqual(['Pflanzen giessen']);
    expect(await tasks(api()).suggestions('mil')).toEqual([]);
  });
});

describe('BringSource «Dringend»', () => {
  const urgentItems: BringItems = {
    purchase: [
      { uuid: '1', itemId: 'Milch', specification: '2 l', conditions: none },
      { uuid: '2', itemId: 'Frankfurter', specification: '', conditions: { urgent: true, convenient: false, discounted: true } },
    ],
    recently: [],
  };

  it('reports which items are urgent', async () => {
    const list = await make(fakeApi(urgentItems)).list();
    expect(list.ok && list.items.map((i) => [i.name, i.urgent])).toEqual([['Milch', false], ['Wienerli', true]]);
  });

  it('toggles urgent on the entry itself and keeps the other conditions', async () => {
    const api = fakeApi(urgentItems);
    const source = make(api);
    await source.list();
    expect(await source.toggleUrgent('Milch')).toEqual({ kind: 'done', key: 'Milch', name: 'Milch', urgent: true });
    expect(api.setConditions).toHaveBeenLastCalledWith('l-1', 'Milch', '2 l', '1', { urgent: true, convenient: false, discounted: false });
    expect(await source.toggleUrgent('Frankfurter')).toEqual({ kind: 'done', key: 'Frankfurter', name: 'Wienerli', urgent: false });
    expect(api.setConditions).toHaveBeenLastCalledWith('l-1', 'Frankfurter', '', '2', { urgent: false, convenient: false, discounted: true });
    expect(api.items).toHaveBeenCalledTimes(2); // first load, then a reload for the second toggle after the first change
  });

  it('reports an item that is gone and a failed update', async () => {
    const api = fakeApi(urgentItems);
    expect(await make(api).toggleUrgent('Brot')).toEqual({ kind: 'gone', key: 'Brot', name: 'Brot', urgent: false });
    api.setConditions = vi.fn(async () => {
      throw new Error('down');
    });
    expect(await make(api).toggleUrgent('Milch')).toEqual({ kind: 'failed', key: 'Milch', name: 'Milch', urgent: false });
    expect(await disabledBring.toggleUrgent('Milch')).toMatchObject({ kind: 'failed' });
  });

  it('reports whether a duplicate is already urgent', async () => {
    expect(await make(fakeApi(urgentItems)).add('Wienerli')).toEqual({ kind: 'duplicate', name: 'Wienerli', key: 'Frankfurter', urgent: true });
  });

  it('sets urgent to a given value, without a call when it already has it', async () => {
    const api = fakeApi(urgentItems);
    const source = make(api);
    expect(await source.toggleUrgent('Frankfurter', true)).toEqual({ kind: 'done', key: 'Frankfurter', name: 'Wienerli', urgent: true });
    expect(api.setConditions).not.toHaveBeenCalled();
    expect(await source.toggleUrgent('Milch', true)).toEqual({ kind: 'done', key: 'Milch', name: 'Milch', urgent: true });
    expect(api.setConditions).toHaveBeenCalledTimes(1);
  });
});
