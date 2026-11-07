/** Demo data for the README screenshots and the reel: a household on Tuesday, 3 November 2026. */
import { DEFAULT_STATIONS, type BirthdayConfig } from '../src/config.js';
import { Dashboard, type Sources } from '../src/dashboard.js';
import type { Renderer } from '../src/render/renderer.js';
import { type ShoppingData, type ShoppingSource, TASK_SUGGESTIONS } from '../src/sources/bring/source.js';
import type { CalendarEvent } from '../src/sources/calendar.js';
import { type CommuteDetail, type CommuteRoute, fitView, type LatLon, MAP_PX } from '../src/sources/commute-route.js';
import type { Departure, StationBoard } from '../src/sources/transit.js';
import type { Pickup } from '../src/sources/waste.js';
import { heuteModel } from '../test/fixtures/models.js';

const at = (day: number, hhmm: string) => new Date(`2026-11-${String(day).padStart(2, '0')}T${hhmm}:00+01:00`);
const ev = (calendar: string, title: string, day: number, start: string, end: string, allDay = false): CalendarEvent => ({
  calendar,
  title,
  start: at(day, start),
  end: allDay ? at(day + 1, '00:00') : at(day, end),
  allDay,
});

export const EVENTS: CalendarEvent[] = [
  ev('LE', 'Zahnarzt Lena', 3, '09:00', '09:45'),
  ev('MA', 'Lunch mit Marco', 3, '12:15', '13:30'),
  ev('FAM', 'Elternabend Schule', 3, '19:00', '21:00'),
  ev('MA', 'Velo in den Service', 4, '08:00', '08:30'),
  ev('MA', 'Kino', 4, '20:00', '22:30'),
  ev('FAM', 'Turnen Lena', 5, '17:30', '18:30'),
  ev('FAM', 'Ausflug Uetliberg', 8, '00:00', '00:00', true),
];
/** For the guest screenshot: a visit tonight instead of the parents' evening. */
export const VISIT_EVENTS = [...EVENTS.filter((e) => e.title !== 'Elternabend Schule'), ev('FAM', 'Besuch Müllers', 3, '18:00', '23:00')];
/** The banner takes two of the four rows: a quieter day for the birthday screenshot. */
export const BIRTHDAY_EVENTS = EVENTS.filter((e) => e.title === 'Lunch mit Marco' || e.start >= at(4, '00:00'));

const PICKUPS: Pickup[] = [
  { date: '2026-11-04', type: 'paper' },
  { date: '2026-11-06', type: 'cardboard' },
  { date: '2026-11-17', type: 'cardboard' },
];

export const SHOPPING: ShoppingData = {
  ok: true,
  listName: 'Zuhause',
  items: [
    { key: 'Kombucha', name: 'Kombucha', spec: '', urgent: false },
    { key: 'Milch', name: 'Milch', spec: '2 l', urgent: false },
    { key: 'Brot', name: 'Brot', spec: '', urgent: false },
    { key: 'Eier', name: 'Eier', spec: '6 Stk.', urgent: false },
    { key: 'Äpfel', name: 'Äpfel', spec: '', urgent: false },
    { key: 'Kaffee', name: 'Kaffee', spec: '', urgent: true },
  ],
};

export const FREQUENT = ['Milch', 'Brot', 'Eier', 'Butter', 'Käse', 'Tomaten', 'Bananen', 'Joghurt', 'Kaffee', 'Äpfel', 'Reis', 'Pasta', 'Zwiebeln', 'Rüebli', 'Salat'];

/** Seven days of weather: the fixture's three, continued. */
function weather() {
  const w = heuteModel().weather!;
  const more = [
    { date: '2026-11-06', code: 2, min: 5.0, max: 12.1, rain: 10 },
    { date: '2026-11-07', code: 61, min: 6.2, max: 13.0, rain: 70, rainMm: 3.1 },
    { date: '2026-11-08', code: 80, min: 7.0, max: 14.2, rain: 60, rainMm: 1.2 },
    { date: '2026-11-09', code: 3, min: 8.1, max: 15.0, rain: 20 },
  ];
  return { ...w, daily: [...w.daily, ...more.map((d) => ({ sunrise: '07:20', sunset: '16:58', ...d }))] };
}

/** Departures every `every` minutes from `first` on, with occasional delays. */
function departures(now: Date, line: string, to: string, inbound: boolean, first: number, every: number, delays: Record<number, number> = {}): Departure[] {
  return Array.from({ length: 10 }, (_, i) => ({
    line,
    planned: new Date(now.getTime() + (first + i * every) * 60_000),
    delayMin: delays[i] ?? 0,
    to,
    inbound,
  }));
}

function boards(now: Date): StationBoard[] {
  const [sternen, oerlikon, oerlikonOst] = DEFAULT_STATIONS as [(typeof DEFAULT_STATIONS)[number], (typeof DEFAULT_STATIONS)[number], (typeof DEFAULT_STATIONS)[number]];
  return [
    {
      station: sternen,
      officialName: 'Zürich, Sternen Oerlikon',
      fetchedAt: now,
      departures: [...departures(now, '10', 'Zürich, Central', true, 2, 7.5, { 1: 1 }), ...departures(now, '10', 'Zürich, Glattpark', false, 4, 7.5)],
    },
    {
      station: oerlikon,
      officialName: 'Zürich Oerlikon',
      fetchedAt: now,
      departures: [...departures(now, 'S7', 'Zürich HB', true, 9, 10, { 0: 2 }), ...departures(now, 'S7', 'Winterthur', false, 6, 10)],
    },
    {
      station: oerlikonOst,
      officialName: 'Zürich Oerlikon, Bahnhof Ost',
      fetchedAt: now,
      departures: [
        ...departures(now, '51', 'Zürich Altstetten, Bahnhof N', true, 2, 4, { 1: 6, 4: 1 }),
        ...departures(now, '51', 'Zürich, Seebach', false, 1, 4, { 1: 1 }),
      ],
    },
  ].map((b) => ({ ...b, departures: b.departures.sort((x, y) => x.planned.getTime() - y.planned.getTime()) }));
}

/** A task list as on the device: open tasks newest first, the fixed suggestions as tiles. */
function taskList(open: string[]): ShoppingSource {
  return {
    list: async () => ({ ok: true, listName: 'Aufgaben', items: open.map((n) => ({ key: n, name: n, spec: '', urgent: false })) }),
    add: async (name) => ({ kind: 'added', name }),
    complete: async (key) => ({ kind: 'done', key, name: key, spec: '' }),
    restore: async () => true,
    suggestions: async () => [],
    frequent: async () => TASK_SUGGESTIONS,
    toggleUrgent: async (key) => ({ kind: 'done', key, name: key, urgent: true }),
  };
}

/** Every screen has a task list, as configured at home; only the task screenshot has open tasks. */
export function dashboard(renderer: Renderer, iso: string, events = EVENTS, birthdays: BirthdayConfig[] = [], tasks: string[] = [], shopping: ShoppingData = SHOPPING): Dashboard {
  const now = new Date(iso);
  const w = weather();
  const sources: Sources = {
    weather: { get: async () => w },
    lake: { get: async () => 13.3 },
    waste: { pickups: async () => PICKUPS },
    calendar: { events: async (from, to) => events.filter((e) => e.end > from && e.start < to) },
    transit: { boards: async () => boards(now) },
    tasks: taskList(tasks),
    bring: {
      list: async () => shopping,
      add: async (name) => ({ kind: 'added', name }),
      complete: async (key) => ({ kind: 'done', key, name: key, spec: '' }),
      restore: async () => true,
      suggestions: async () => [],
      frequent: async () => FREQUENT,
      toggleUrgent: async (key) => ({ kind: 'done', key, name: key, urgent: true }),
    },
  };
  return new Dashboard({ sources, renderer, clock: () => now, refreshSeconds: 120, quietHours: { start: 0, end: 330 }, viewResetSeconds: 120, birthdays });
}

/** Street, metres, simplified geometry: Oerlikon to Binz by scooter, as HERE routes it. */
type Way = [name: string, metres: number, points: LatLon[]];
const VIA_OERLIKON: Way[] = [
  ['Nansenstrasse', 184, [[47.4107, 8.5446], [47.4112, 8.5469]]],
  ['Dörflistrasse', 345, [[47.4112, 8.5469], [47.409, 8.5501]]],
  ['', 65, [[47.409, 8.5501], [47.4088, 8.5502], [47.4086, 8.5498]]],
  ['Tramstrasse', 281, [[47.4086, 8.5498], [47.4093, 8.5467], [47.4092, 8.5464]]],
  ['Schaffhauserstrasse', 1322, [[47.4092, 8.5464], [47.4079, 8.5468], [47.4062, 8.5483], [47.4048, 8.5483], [47.4039, 8.548], [47.4012, 8.545], [47.3999, 8.5429], [47.3991, 8.5423]]],
  ['Bucheggstrasse', 1176, [[47.3991, 8.5423], [47.398, 8.5338], [47.3962, 8.5274]]],
  ['Rosengartenstrasse', 445, [[47.3962, 8.5274], [47.3955, 8.5262], [47.3929, 8.5244]]],
];
const VIA_SEEBAHN: Way[] = [
  ['Hardbrücke', 1274, [[47.3929, 8.5244], [47.3908, 8.5227], [47.3833, 8.5153]]],
  ['Hardplatz', 159, [[47.3833, 8.5153], [47.3828, 8.5143], [47.3829, 8.5139], [47.3831, 8.5139]]],
  ['Hohlstrasse', 648, [[47.3831, 8.5139], [47.3829, 8.5152], [47.382, 8.5161], [47.38, 8.5207]]],
  ['Seebahnstrasse', 1180, [[47.38, 8.5207], [47.3776, 8.5187], [47.3769, 8.5184], [47.3759, 8.5184], [47.3739, 8.5194], [47.3711, 8.5236]]],
  ['Schimmelstrasse', 254, [[47.3711, 8.5236], [47.3708, 8.5243], [47.3695, 8.5259]]],
  ['Manessestrasse', 613, [[47.3695, 8.5259], [47.3689, 8.5248], [47.3679, 8.5237], [47.365, 8.5213]]],
];
const VIA_AEMTLER: Way[] = [
  ['Hardbrücke', 1375, [[47.3929, 8.5244], [47.391, 8.5229], [47.3825, 8.5146]]],
  ['Hardstrasse', 562, [[47.3825, 8.5146], [47.3786, 8.5107], [47.3784, 8.5103]]],
  ['Albisriederstrasse', 208, [[47.3784, 8.5103], [47.3783, 8.5099], [47.3778, 8.5078]]],
  ['Aemtlerstrasse', 1050, [[47.3778, 8.5078], [47.3739, 8.5135], [47.3707, 8.5168]]],
  ['Birmensdorferstrasse', 144, [[47.3707, 8.5168], [47.3704, 8.5183], [47.3702, 8.5185]]],
  ['Kehlhofstrasse', 209, [[47.3702, 8.5185], [47.3685, 8.5197]]],
  ['Steinstrasse', 359, [[47.3685, 8.5197], [47.3672, 8.5199], [47.3657, 8.5215]]],
  ['Manessestrasse', 90, [[47.3657, 8.5215], [47.3654, 8.5216], [47.365, 8.5213]]],
];
const TO_BINZ: Way[] = [['Uetlibergstrasse', 410, [[47.365, 8.5213], [47.3624, 8.5187], [47.3627, 8.5179]]]];

/** The morning rush: a jam from the Rosengartenstrasse over the Hardbrücke, slow on the Bucheggstrasse. */
const RUSH: Record<string, number> = { Bucheggstrasse: 0.6, Rosengartenstrasse: 0.3, 'Hardbrücke': 0.35 };

function route(minutes: number, delayMinutes: number, ways: Way[], traffic: Record<string, number> = {}): CommuteRoute {
  return { minutes, delayMinutes, stretches: ways.map(([name, length, points]) => ({ name, length, points, ratio: traffic[name] ?? 1 })) };
}

/** «Arbeitsweg» at rush hour; `image` is the base map, if one was fetched. */
export function commuteDetail(image: string | null = null): CommuteDetail {
  const routes = [route(25, 7, [...VIA_OERLIKON, ...VIA_SEEBAHN, ...TO_BINZ], RUSH), route(19, 0, [...VIA_OERLIKON, ...VIA_AEMTLER, ...TO_BINZ])];
  return { routes, view: fitView(routes.flatMap((r) => r.stretches.flatMap((s) => s.points)), MAP_PX.width, MAP_PX.height), image };
}
