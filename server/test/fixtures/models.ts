import type { DayEntry } from '../../src/sources/calendar.js';
import type { BoardModel, HeuteModel } from '../../src/views/model.js';

export const NOW = new Date('2026-11-03T07:40:00+01:00');
const at = (hhmm: string, day = '03') => new Date(`2026-11-${day}T${hhmm}:00+01:00`);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export const entry = (label: string, calendar: string, title: string, past = false): DayEntry => ({
  label, calendar, title, past, allDay: label === 'ganzt.', sortTime: 0,
});

export function heuteModel(overrides: Partial<HeuteModel> = {}): HeuteModel {
  return {
    now: NOW,
    weather: {
      currentTemp: 8.4,
      currentCode: 3,
      minTemp: 3.6,
      maxTemp: 11.2,
      // today: 10 % until 14:00, 70 % from 15:00; tomorrow: 60 % from 10 to 13 Uhr
      hourlyRain: [
        ...Array.from({ length: 24 }, (_, h) => ({ time: at(hh(h)), probability: h >= 15 ? 70 : 10 })),
        ...Array.from({ length: 24 }, (_, h) => ({ time: at(hh(h), '04'), probability: h >= 10 && h <= 13 ? 60 : 10 })),
      ],
      daily: [
        { date: '2026-11-03', code: 3, min: 3.6, max: 11.2, rain: 70, rainMm: 4.2, sunrise: '07:13', sunset: '17:04' },
        { date: '2026-11-04', code: 61, min: 2.1, max: 9.4, rain: 60, rainMm: 0.4, sunrise: '07:15', sunset: '17:03' },
        { date: '2026-11-05', code: 0, min: 1.0, max: 12.6, rain: 0, sunrise: '07:16', sunset: '17:01' },
      ],
      now: { apparent: 5.2, humidity: 82, wind: 12, gust: 30, windDir: 225, pressure: 1018.4 },
      // pressure rises 0.5 hPa per hour; 2 mm of rain at 16 and 17 Uhr
      hourly: Array.from({ length: 48 }, (_, i) => ({
        time: at(hh(i % 24), i < 24 ? '03' : '04'),
        temp: 4 + 7 * Math.sin(((i - 9) / 24) * 2 * Math.PI),
        rainMm: i === 16 || i === 17 ? 2 : 0,
        probability: i >= 15 && i < 24 ? 70 : 10,
        pressure: 1014.9 + i * 0.5,
        // wind picks up in the afternoon: 6 km/h at night, 18 at 15 Uhr; gusts twice as strong
        wind: 12 + 6 * Math.sin(((i - 9) / 24) * 2 * Math.PI),
        gust: 2 * (12 + 6 * Math.sin(((i - 9) / 24) * 2 * Math.PI)),
        // clear by day, cloudy at night, rain from 15 to 23 Uhr
        code: i % 24 >= 15 && i % 24 <= 23 ? 61 : i % 24 >= 7 && i % 24 < 17 ? 0 : 3,
        isDay: i % 24 >= 7 && i % 24 < 17,
      })),
    },
    lakeTemp: 13.3,
    events: [
      entry('07:00', 'PF', 'Joggen', true),
      entry('09:00', 'AB', 'Zahnarzt Lena'),
      entry('12:15', 'PF', 'Lunch mit Marco'),
      entry('18:30', 'FAM', 'Elternabend Schule'),
    ],
    boards: [
      { name: 'Sternen', lines: ['10'], departures: [{ line: '10', planned: at('07:43'), delayMin: 0, to: 'Zürich, Bahnhofplatz/HB', inbound: true }, { line: '10', planned: at('07:53'), delayMin: 0, to: 'Zürich, Bahnhofplatz/HB', inbound: true }] },
      { name: 'Oerlikon', lines: ['S7'], departures: [{ line: 'S7', planned: at('08:06'), delayMin: 2, to: 'Zürich, Bahnhofplatz/HB', inbound: true }] },
      { name: 'Hallenstadion', lines: ['11', '14'], departures: [{ line: '14', planned: at('07:42'), delayMin: 0, to: 'Zürich, Bahnhofplatz/HB', inbound: true }, { line: '11', planned: at('07:47'), delayMin: 0, to: 'Zürich, Bahnhofplatz/HB', inbound: true }] },
    ],
    shopping: { ok: true, listName: 'Zuhause', items: [{ key: 'Milch', name: 'Milch', spec: '2 l' }, { key: 'Brot', name: 'Brot', spec: '' }, { key: 'Eier', name: 'Eier', spec: '6 Stk.' }] },
    ...overrides,
  };
}

/** Boards as on the device: four departures each and a walk, so the leave-by line shows. */
export function fullBoards(): BoardModel[] {
  const deps = (line: string, first: string) =>
    Array.from({ length: 4 }, (_, i) => ({ line, planned: new Date(at(first).getTime() + i * 8 * 60_000), delayMin: i === 1 ? 2 : 0, to: 'Zürich, Bahnhofplatz/HB', inbound: true }));
  return [
    { name: 'Sternen', lines: ['10'], walk: 4, departures: deps('10', '07:43') },
    { name: 'Oerlikon', lines: ['S7'], walk: 6, departures: deps('S7', '07:49') },
    { name: 'Hallenstadion', lines: ['11', '14'], walk: 7, departures: deps('14', '07:42') },
  ];
}

/** The fixture's weather without any rain: Heute shows «Kein Regen bis …» instead of the rain strip. */
export function dryWeather(): NonNullable<HeuteModel['weather']> {
  const w = heuteModel().weather!;
  return { ...w, hourlyRain: w.hourlyRain.map((h) => ({ ...h, probability: 0 })), hourly: w.hourly.map((h) => ({ ...h, probability: 0, rainMm: 0 })) };
}
