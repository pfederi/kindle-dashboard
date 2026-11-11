import { XMLParser } from 'fast-xml-parser';
import type { StationConfig } from '../config.js';
import type { Departure } from './transit.js';

/** Official Swiss OJP 2.0 endpoint (opentransportdata.swiss); needs a bearer token. */
export const OJP_URL = 'https://api.opentransportdata.swiss/ojp20';

/** Enough journeys to fill the station screen in both directions. */
const RESULTS = 40;

export function ojpStopEventRequest(stopId: string, now: Date): string {
  const ts = now.toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${ts}</siri:RequestTimestamp>
      <siri:RequestorRef>kindle-dashboard</siri:RequestorRef>
      <OJPStopEventRequest>
        <siri:RequestTimestamp>${ts}</siri:RequestTimestamp>
        <Location>
          <PlaceRef>
            <StopPlaceRef>${stopId}</StopPlaceRef>
          </PlaceRef>
          <DepArrTime>${ts}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>${RESULTS}</NumberOfResults>
          <StopEventType>departure</StopEventType>
          <IncludePreviousCalls>false</IncludePreviousCalls>
          <IncludeOnwardCalls>true</IncludeOnwardCalls>
          <IncludeRealtimeData>true</IncludeRealtimeData>
        </Params>
      </OJPStopEventRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

// Namespace prefixes are dropped; values stay strings (line «50» must not become a number).
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'StopEventResult' || name === 'OnwardCall',
});

type Node = Record<string, unknown>;
const node = (v: unknown): Node => (v !== null && typeof v === 'object' ? (v as Node) : {});
const text = (v: unknown): string => (typeof v === 'string' ? v : typeof node(v).Text === 'string' ? (node(v).Text as string) : '');

export function parseStopEvents(xml: string, station: StationConfig): { name: string | null; departures: Departure[] } {
  const delivery = node(node(node(node(parser.parse(xml)).OJP).OJPResponse).ServiceDelivery).OJPStopEventDelivery;
  if (delivery === undefined) throw new Error('OJP response without a stop event delivery');
  if (node(delivery).ErrorCondition !== undefined) throw new Error('OJP stop event error');

  const results = (node(delivery).StopEventResult as Node[] | undefined) ?? [];
  let name: string | null = null;
  const departures: Departure[] = [];
  for (const result of results) {
    const event = node(result.StopEvent);
    const thisCall = node(node(event.ThisCall).CallAtStop);
    const service = node(event.Service);
    const stopName = text(thisCall.StopPointName);
    if (name === null && stopName !== '') name = stopName;

    const line = text(service.PublishedServiceName) || text(service.PublicCode);
    if (station.lines.length > 0 && !station.lines.includes(line)) continue;

    const departure = node(thisCall.ServiceDeparture);
    const planned = new Date(String(departure.TimetabledTime));
    if (Number.isNaN(planned.getTime())) continue;
    const estimated = new Date(String(departure.EstimatedTime));
    const delayMin = Number.isNaN(estimated.getTime()) ? 0 : Math.round((estimated.getTime() - planned.getTime()) / 60_000);

    const onward = (event.OnwardCall as Node[] | undefined) ?? [];
    const inbound = onward.some((o) => text(node(o.CallAtStop).StopPointName) === station.via);
    departures.push({ line, planned, delayMin, to: text(service.DestinationText), inbound });
  }
  return { name, departures };
}
