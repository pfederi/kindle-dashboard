import type { FetchFn } from '../http.js';
import { TIMEOUT_MS } from '../http.js';

export interface HourlyRain {
  time: Date;
  probability: number;
}

export interface DailyWeather {
  /** YYYY-MM-DD in Zurich */
  date: string;
  code: number | null;
  min: number | null;
  max: number | null;
  /** Highest hourly rain probability of the day in % */
  rain: number | null;
  /** Precipitation sum of the day in mm */
  rainMm?: number | null;
  /** Local «HH:MM» */
  sunrise: string | null;
  sunset: string | null;
}

/** Current conditions for the weather screen. */
export interface WeatherNow {
  apparent: number | null;
  /** % */
  humidity: number | null;
  /** knots */
  wind: number | null;
  gust: number | null;
  /** Degrees the wind comes from, 0 = north */
  windDir: number | null;
  /** hPa at sea level */
  pressure: number | null;
}

export interface HourlyPoint {
  time: Date;
  temp: number | null;
  /** mm in this hour */
  rainMm: number | null;
  probability: number | null;
  pressure: number | null;
  /** knots */
  wind: number | null;
  gust: number | null;
  code?: number | null;
  /** false at night (between sunset and sunrise) */
  isDay?: boolean | null;
}

export interface Weather {
  currentTemp: number;
  currentCode: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  hourlyRain: HourlyRain[];
  /** Today first, then the following days. */
  daily: DailyWeather[];
  now: WeatherNow;
  hourly: HourlyPoint[];
}

const MODELS = ['meteoswiss_icon_ch2', 'best_match'] as const;

export function weatherUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'Europe/Zurich',
    models: MODELS.join(','),
    wind_speed_unit: 'kn',
    // A week for the Woche view; the rain strip also needs tomorrow in the evening.
    forecast_days: '7',
    current: 'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl',
    hourly: 'precipitation_probability,temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_gusts_10m,weather_code,is_day',
    daily: 'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,sunrise,sunset',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

type Block = Record<string, unknown>;

function asBlock(v: unknown): Block {
  return v !== null && typeof v === 'object' ? (v as Block) : {};
}

/** First numeric value for `name`: unsuffixed (single model), then per model in priority order. */
function scalar(block: Block, name: string): number | null {
  for (const key of [name, ...MODELS.map((m) => `${name}_${m}`)]) {
    const v = block[key];
    if (typeof v === 'number') return v;
  }
  return null;
}

function seriesValue(block: Block, name: string, i: number): number | null {
  for (const key of [...MODELS.map((m) => `${name}_${m}`), name]) {
    const arr = block[key];
    const v = Array.isArray(arr) ? arr[i] : undefined;
    if (typeof v === 'number') return v;
  }
  return null;
}

/** «HH:MM» of a local ISO time like «2026-11-04T07:13». */
function seriesClock(block: Block, name: string, i: number): string | null {
  for (const key of [...MODELS.map((m) => `${name}_${m}`), name]) {
    const arr = block[key];
    const v = Array.isArray(arr) ? arr[i] : undefined;
    if (typeof v === 'string' && /T\d{2}:\d{2}/.test(v)) return v.slice(11, 16);
  }
  return null;
}

export function parseWeather(json: unknown): Weather {
  const root = asBlock(json);
  const current = asBlock(root.current);
  const hourly = asBlock(root.hourly);
  const daily = asBlock(root.daily);

  const currentTemp = scalar(current, 'temperature_2m');
  if (currentTemp === null) throw new Error('open-meteo: no current temperature');

  const times = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const hourlyRain: HourlyRain[] = [];
  const hourlyPoints: HourlyPoint[] = [];
  times.forEach((t, i) => {
    if (typeof t !== 'string') return;
    // Open-Meteo returns local times without offset; TZ=Europe/Zurich makes `new Date` interpret them correctly.
    const time = new Date(t);
    const p = seriesValue(hourly, 'precipitation_probability', i);
    if (p !== null) hourlyRain.push({ time, probability: p });
    hourlyPoints.push({
      time,
      temp: seriesValue(hourly, 'temperature_2m', i),
      rainMm: seriesValue(hourly, 'precipitation', i),
      probability: p,
      pressure: seriesValue(hourly, 'pressure_msl', i),
      wind: seriesValue(hourly, 'wind_speed_10m', i),
      gust: seriesValue(hourly, 'wind_gusts_10m', i),
      code: seriesValue(hourly, 'weather_code', i),
      isDay: (() => {
        const d = seriesValue(hourly, 'is_day', i);
        return d === null ? null : d === 1;
      })(),
    });
  });

  const dates = Array.isArray(daily.time) ? (daily.time as unknown[]) : [];
  const days: DailyWeather[] = [];
  dates.forEach((d, i) => {
    if (typeof d !== 'string') return;
    days.push({
      date: d,
      code: seriesValue(daily, 'weather_code', i),
      min: seriesValue(daily, 'temperature_2m_min', i),
      max: seriesValue(daily, 'temperature_2m_max', i),
      rain: seriesValue(daily, 'precipitation_probability_max', i),
      rainMm: seriesValue(daily, 'precipitation_sum', i),
      sunrise: seriesClock(daily, 'sunrise', i),
      sunset: seriesClock(daily, 'sunset', i),
    });
  });

  return {
    currentTemp,
    currentCode: scalar(current, 'weather_code'),
    minTemp: seriesValue(daily, 'temperature_2m_min', 0),
    maxTemp: seriesValue(daily, 'temperature_2m_max', 0),
    hourlyRain,
    daily: days,
    now: {
      apparent: scalar(current, 'apparent_temperature'),
      humidity: scalar(current, 'relative_humidity_2m'),
      wind: scalar(current, 'wind_speed_10m'),
      gust: scalar(current, 'wind_gusts_10m'),
      windDir: scalar(current, 'wind_direction_10m'),
      pressure: scalar(current, 'pressure_msl'),
    },
    hourly: hourlyPoints,
  };
}

/** Hour (0–23) of the first hour in [from, to) with ≥ 50 % rain probability. */
export function firstRainHour(w: Weather, from: Date, to: Date): number | null {
  const hit = w.hourlyRain.find((h) => h.time >= from && h.time < to && h.probability >= 50);
  return hit ? hit.time.getHours() : null;
}

/** Hour (0–23) of the first hour from the current hour until 22:00 with ≥ 50 % rain probability. */
export function rainStartHour(w: Weather, now: Date): number | null {
  const windowEnd = new Date(now);
  windowEnd.setHours(22, 0, 0, 0);
  if (now >= windowEnd) return null;
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  return firstRainHour(w, hourStart, windowEnd);
}

/** Rain probability for `n` hours starting with the current hour (fewer if the forecast ends). */
export function nextHours(w: Weather, now: Date, n: number): HourlyRain[] {
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  const end = hourStart.getTime() + n * 3_600_000;
  return w.hourlyRain.filter((h) => h.time >= hourStart && h.time.getTime() < end);
}

export async function fetchWeather(fetchFn: FetchFn, lat: number, lon: number): Promise<Weather> {
  const res = await fetchFn(weatherUrl(lat, lon), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  return parseWeather(await res.json());
}
