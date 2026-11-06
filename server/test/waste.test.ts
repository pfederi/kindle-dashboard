import { describe, expect, it } from 'vitest';
import { fetchWaste, parseWaste, pickupEntries, wasteUrl } from '../src/sources/waste.js';
import { fakeFetch, jsonResponse, textResponse } from './helpers.js';

const response = {
  _metadata: { total_count: 4, row_count: 4 },
  result: [
    { date: '2026-11-06', waste_type: 'cardboard', zip: 8050, area: '8050', station: '', region: 'zurich', description: '' },
    { date: '2026-11-10', waste_type: 'paper', zip: 8050, area: '8050', station: '', region: 'zurich', description: '' },
    { date: '2026-11-09', waste_type: 'waste', zip: 8050, area: '8050', station: '', region: 'zurich', description: '' },
    { date: 'bald', waste_type: 'paper' },
  ],
};

describe('waste', () => {
  it('asks OpenERZ for paper and cardboard by zip with repeated types', () => {
    expect(wasteUrl('8050', new Date('2026-11-02T00:00:00+01:00'), new Date('2026-11-23T00:00:00+01:00'))).toBe(
      'https://openerz.metaodi.ch/api/calendar.json?zip=8050&types=paper&types=cardboard&start=2026-11-02&end=2026-11-23',
    );
  });

  it('keeps paper and cardboard with valid dates only', () => {
    expect(parseWaste(response)).toEqual([
      { date: '2026-11-06', type: 'cardboard' },
      { date: '2026-11-10', type: 'paper' },
    ]);
    expect(() => parseWaste({ statusCode: 400 })).toThrow(/unexpected response/);
  });

  it('fetches three weeks and reports HTTP errors', async () => {
    const ok = fakeFetch(() => jsonResponse(response));
    expect(await fetchWaste(ok, '8050', new Date('2026-11-02T00:00:00+01:00'))).toHaveLength(2);
    expect(ok.calls[0]?.url).toContain('start=2026-11-02&end=2026-11-23');
    const bad = fakeFetch(() => textResponse('nope', 500));
    await expect(fetchWaste(bad, '8050', new Date())).rejects.toThrow(/openerz HTTP 500/);
  });

  it('turns the pickups of a day into all-day entries with their kind', () => {
    const pickups = parseWaste(response);
    const day = new Date('2026-11-06T18:30:00+01:00');
    expect(pickupEntries(pickups, day)).toEqual([
      { calendar: '', title: 'Karton', label: 'ganzt.', allDay: true, past: false, sortTime: day.getTime(), waste: 'cardboard' },
    ]);
    expect(pickupEntries(pickups, new Date('2026-11-10T08:00:00+01:00'), 'morgen')[0]).toMatchObject({ title: 'Papier', label: 'morgen', waste: 'paper' });
    expect(pickupEntries(pickups, new Date('2026-11-07T08:00:00+01:00'))).toEqual([]);
  });
});
