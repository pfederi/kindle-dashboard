import { describe, expect, it } from 'vitest';
import { departsAt, leaveAt, lineName, parseStationboard, parseStationName, reachable, shortStop, stationboardUrl, TransitSource, upcoming } from '../src/sources/transit.js';
import { fakeFetch, jsonResponse, testClock, textResponse } from './helpers.js';

const hallenstadion = { id: '8591281', name: 'Hallenstadion', via: 'Zürich, Milchbuck', lines: ['11', '14'] };
const ts = (iso: string) => new Date(iso).getTime() / 1000;
const journey = (category: string, number: string, iso: string, delay: number | null, stops: string[]) => ({
  category,
  number,
  to: stops.at(-1),
  stop: { departure: iso, departureTimestamp: ts(iso), delay },
  passList: [{ station: { name: null } }, ...stops.map((name) => ({ station: { name } }))],
});

const board = {
  station: { id: '8591281', name: 'Zürich, Messe/Hallenstadion' },
  stationboard: [
    journey('T', '11', '2026-11-03T07:42:00+01:00', 0, ['Zürich, Auzelg']),
    journey('T', '14', '2026-11-03T07:43:00+01:00', 2, ['Zürich, Milchbuck', 'Zürich, Bahnhofplatz/HB']),
    journey('T', '11', '2026-11-03T07:47:00+01:00', null, ['Zürich, Milchbuck', 'Zürich, Rehalp']),
    journey('B', '10', '2026-11-03T07:48:00+01:00', 0, ['Zürich, Milchbuck', 'Zürich, Central']),
  ],
};

describe('transit', () => {
  it('names S-Bahn lines with category, others by number', () => {
    expect(lineName('S', '10')).toBe('S10');
    expect(lineName('T', '14')).toBe('14');
    expect(lineName('B', '10')).toBe('10');
  });

  it('keeps both directions of the configured lines with their terminus, inbound when passing the via stop', () => {
    const deps = parseStationboard(board, hallenstadion);
    expect(deps).toEqual([
      { line: '11', planned: new Date('2026-11-03T07:42:00+01:00'), delayMin: 0, to: 'Zürich, Auzelg', inbound: false },
      { line: '14', planned: new Date('2026-11-03T07:43:00+01:00'), delayMin: 2, to: 'Zürich, Bahnhofplatz/HB', inbound: true },
      { line: '11', planned: new Date('2026-11-03T07:47:00+01:00'), delayMin: 0, to: 'Zürich, Rehalp', inbound: true },
    ]);
  });

  it('knows which departures can still be caught on foot and when to leave', () => {
    const dep = (hm: string, delayMin = 0) => ({ line: '11', planned: new Date(`2026-11-03T${hm}:00+01:00`), delayMin, to: '', inbound: true });
    const now = new Date('2026-11-03T07:40:00+01:00');
    expect(departsAt(dep('07:50', 6))).toEqual(new Date('2026-11-03T07:56:00+01:00'));
    expect(reachable(dep('07:43'), now, 4)).toBe(false);
    expect(reachable(dep('07:44'), now, 4)).toBe(true); // just in time
    expect(reachable(dep('07:42', 3), now, 4)).toBe(true); // the delay helps
    expect(leaveAt([dep('07:43'), dep('07:49')], now, 4)).toEqual(new Date('2026-11-03T07:45:00+01:00'));
    expect(leaveAt([dep('07:43')], now, 4)).toBeNull();
    expect(leaveAt([dep('07:49')], now, 0)).toBeNull(); // no walking time configured
  });

  it('reads the official stop name', () => {
    expect(parseStationName(board)).toBe('Zürich, Messe/Hallenstadion');
    expect(parseStationName({})).toBeNull();
  });

  it('shortens stop names by the city', () => {
    expect(shortStop('Zürich, Bahnhofplatz/HB')).toBe('Bahnhofplatz/HB');
    expect(shortStop('Zürich HB')).toBe('HB');
    expect(shortStop('Uetliberg')).toBe('Uetliberg');
  });

  it('accepts all lines when none are configured and tolerates junk', () => {
    expect(parseStationboard(board, { ...hallenstadion, lines: [] })).toHaveLength(4);
    expect(parseStationboard({}, hallenstadion)).toEqual([]);
    expect(parseStationboard({ stationboard: [{}] }, hallenstadion)).toEqual([]);
  });

  it('drops departed journeys (including delay) and limits to n', () => {
    const deps = parseStationboard(board, { ...hallenstadion, lines: [] });
    const now = new Date('2026-11-03T07:44:30+01:00');
    expect(upcoming(deps, now).map((d) => d.line)).toEqual(['14', '11', '10']); // the 9 at 07:42 has left
    expect(upcoming(deps, new Date('2026-11-03T07:45:30+01:00'), 1).map((d) => d.line)).toEqual(['11']);
  });

  it('fetches every station, isolating failures', async () => {
    const fetchFn = fakeFetch((c) => (c.url.includes('8591281') ? jsonResponse(board) : textResponse('err', 500)));
    const source = new TransitSource(
      [hallenstadion, { id: '8591382', name: 'Sternen', via: 'Zürich, Milchbuck', lines: ['10'] }],
      fetchFn,
      testClock('2026-11-03T07:40:00+01:00'),
    );
    const boards = await source.boards();
    expect(boards.map((b) => [b.station.name, b.officialName, b.departures?.length ?? null, b.fetchedAt?.toISOString() ?? null])).toEqual([
      ['Hallenstadion', 'Zürich, Messe/Hallenstadion', 3, '2026-11-03T06:40:00.000Z'],
      ['Sternen', null, null, null],
    ]);
    expect(fetchFn.calls[0]?.url).toBe(stationboardUrl('8591281'));
    expect(stationboardUrl('8591281')).toBe('https://transport.opendata.ch/v1/stationboard?id=8591281&limit=40');
  });
});
