import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OJP_URL, ojpStopEventRequest, parseStopEvents } from '../src/sources/ojp.js';
import { TransitSource } from '../src/sources/transit.js';
import { fakeFetch, jsonResponse, testClock, textResponse } from './helpers.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const tram = fixture('ojp-tram.xml');
const rail = fixture('ojp-rail.xml');

const sternen = { id: '8591382', name: 'Sternen', via: 'Zürich, Regensbergbrücke', lines: [], walk: 3 };
const oerlikon = { id: '8503006', name: 'Oerlikon', via: 'Zürich HB', lines: [], walk: 6 };

const delivery = (inner: string) =>
  `<?xml version="1.0"?><OJP xmlns:siri="http://www.siri.org.uk/siri" xmlns="http://www.vdv.de/ojp" version="2.0"><OJPResponse><siri:ServiceDelivery><OJPStopEventDelivery>${inner}</OJPStopEventDelivery></siri:ServiceDelivery></OJPResponse></OJP>`;

describe('ojp', () => {
  it('reads line, terminus, planned time and delay (in minutes) from a StopEvent', () => {
    const { departures } = parseStopEvents(tram, sternen);
    expect(departures.map((d) => d.line)).toEqual(['50', '61', '10']);
    expect(departures[0]).toEqual({
      line: '50',
      planned: new Date('2026-11-11T17:58:42Z'),
      delayMin: 27,
      to: 'Frankental',
      inbound: true,
    });
    expect(departures[2]!.delayMin).toBe(0);
  });

  it('takes the official stop name from the call at the stop', () => {
    expect(parseStopEvents(tram, sternen).name).toBe('Zürich, Sternen Oerlikon');
  });

  it('keeps only the configured lines', () => {
    const { departures } = parseStopEvents(tram, { ...sternen, lines: ['10'] });
    expect(departures.map((d) => d.line)).toEqual(['10']);
  });

  it('marks a departure inbound only when it passes the via stop after the station', () => {
    const { departures } = parseStopEvents(rail, oerlikon);
    expect(departures.map((d) => [d.line, d.inbound, d.delayMin])).toEqual([
      ['S2', false, 3],
      ['S6', true, 2],
      ['S16', false, 0],
      ['S7', false, 1],
    ]);
  });

  it('returns no departures for a delivery without events, and fails on an error condition', () => {
    expect(parseStopEvents(delivery(''), sternen)).toEqual({ name: null, departures: [] });
    expect(() => parseStopEvents(delivery('<siri:ErrorCondition><siri:OtherError/></siri:ErrorCondition>'), sternen)).toThrow(/error/i);
    expect(() => parseStopEvents('<html>Bad gateway</html>', sternen)).toThrow();
  });

  it('asks for departures with onward calls at the stop', () => {
    const xml = ojpStopEventRequest('8591382', new Date('2026-11-11T18:00:00Z'));
    expect(xml).toContain('<StopPlaceRef>8591382</StopPlaceRef>');
    expect(xml).toContain('<IncludeOnwardCalls>true</IncludeOnwardCalls>');
    expect(xml).toContain('2026-11-11T18:00:00.000Z');
  });
});

describe('TransitSource with an opentransportdata key', () => {
  const clock = testClock('2026-11-11T18:00:00Z');

  it('posts an OJP request with the bearer token and returns the parsed board', async () => {
    const fetchFn = fakeFetch(() => textResponse(tram));
    const [board] = await new TransitSource([sternen], fetchFn, clock, 'secret-key').boards();
    const call = fetchFn.calls[0]!;
    expect(call.url).toBe(OJP_URL);
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBe('Bearer secret-key');
    expect(call.body).toContain('<StopPlaceRef>8591382</StopPlaceRef>');
    expect(board!.officialName).toBe('Zürich, Sternen Oerlikon');
    expect(board!.departures).toHaveLength(3);
  });

  it('treats an HTTP error as a failed load without leaking the key', async () => {
    const fetchFn = fakeFetch(() => textResponse('forbidden', 403));
    const [board] = await new TransitSource([sternen], fetchFn, clock, 'secret-key').boards();
    expect(board!.departures).toBeNull();
  });

  it('keeps using transport.opendata.ch when no key is set', async () => {
    const fetchFn = fakeFetch(() => jsonResponse({ stationboard: [] }));
    await new TransitSource([sternen], fetchFn, clock).boards();
    expect(fetchFn.calls[0]!.url).toContain('transport.opendata.ch');
  });
});
