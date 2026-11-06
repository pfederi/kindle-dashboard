import { describe, expect, it } from 'vitest';
import { describeWmo } from '../src/sources/wmo.js';
import { fetchWeather, firstRainHour, nextHours, parseWeather, rainStartHour, weatherUrl } from '../src/sources/weather.js';
import { fakeFetch, jsonResponse, textResponse } from './helpers.js';

const hours = Array.from({ length: 24 }, (_, h) => `2026-11-03T${String(h).padStart(2, '0')}:00`);
const ch2 = hours.map((_, h) => (h >= 20 ? null : h >= 15 ? 70 : 10));
const best = hours.map((_, h) => (h >= 20 ? 80 : 0));

const sample = {
  current: { time: '2026-11-03T07:30', temperature_2m: 8.4, weather_code: 3 },
  hourly: {
    time: hours,
    precipitation_probability_meteoswiss_icon_ch2: ch2,
    precipitation_probability_best_match: best,
  },
  daily: {
    time: ['2026-11-03'],
    temperature_2m_min_meteoswiss_icon_ch2: [3.6],
    temperature_2m_min_best_match: [4.1],
    temperature_2m_max_best_match: [11.2],
  },
};

describe('weather', () => {
  it('builds the two-model url', () => {
    const url = new URL(weatherUrl(47.411, 8.544));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('models')).toBe('meteoswiss_icon_ch2,best_match');
    expect(url.searchParams.get('timezone')).toBe('Europe/Zurich');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.get('wind_speed_unit')).toBe('kn');
    expect(url.searchParams.get('daily')).toBe(
      'weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum,sunrise,sunset',
    );
    expect(url.searchParams.get('hourly')).toBe(
      'precipitation_probability,temperature_2m,precipitation,pressure_msl,wind_speed_10m,wind_gusts_10m,weather_code,is_day',
    );
    expect(url.searchParams.get('current')).toBe(
      'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl',
    );
  });

  it('prefers MeteoSwiss per value and falls back to best_match', () => {
    const w = parseWeather(sample);
    expect(w.currentTemp).toBe(8.4);
    expect(w.currentCode).toBe(3);
    expect(w.minTemp).toBe(3.6);
    expect(w.maxTemp).toBe(11.2);
    expect(w.hourlyRain[15]).toEqual({ time: new Date('2026-11-03T15:00:00+01:00'), probability: 70 });
    expect(w.hourlyRain[21]?.probability).toBe(80);
  });

  it('accepts suffixed current values and missing min/max', () => {
    const w = parseWeather({
      current: { temperature_2m_best_match: -1.2, weather_code_best_match: 71 },
      hourly: { time: [] },
      daily: { time: ['2026-11-03'] },
    });
    expect(w).toEqual({
      currentTemp: -1.2,
      currentCode: 71,
      minTemp: null,
      maxTemp: null,
      hourlyRain: [],
      daily: [{ date: '2026-11-03', code: null, min: null, max: null, rain: null, rainMm: null, sunrise: null, sunset: null }],
      now: { apparent: null, humidity: null, wind: null, gust: null, windDir: null, pressure: null },
      hourly: [],
    });
  });

  it('throws without a current temperature', () => {
    expect(() => parseWeather({ current: {} })).toThrow(/current temperature/);
  });

  it('finds the first rainy hour between now and 22:00', () => {
    const w = parseWeather(sample);
    expect(rainStartHour(w, new Date('2026-11-03T07:40:00+01:00'))).toBe(15);
    expect(rainStartHour(w, new Date('2026-11-03T15:30:00+01:00'))).toBe(15);
    expect(rainStartHour(w, new Date('2026-11-03T22:05:00+01:00'))).toBeNull();
    const dry = { ...w, hourlyRain: w.hourlyRain.map((h) => ({ ...h, probability: 49 })) };
    expect(rainStartHour(dry, new Date('2026-11-03T07:40:00+01:00'))).toBeNull();
  });

  it('takes the next hours from the current one, fewer when the forecast ends', () => {
    const w = parseWeather(sample);
    const next = nextHours(w, new Date('2026-11-03T07:40:00+01:00'), 12);
    expect(next).toHaveLength(12);
    expect(next[0]?.time).toEqual(new Date('2026-11-03T07:00:00+01:00'));
    expect(next.at(-1)?.time).toEqual(new Date('2026-11-03T18:00:00+01:00'));
    expect(nextHours(w, new Date('2026-11-03T20:10:00+01:00'), 12)).toHaveLength(4);
  });

  it('reads the daily forecast per day, preferring ICON-CH2 and falling back to best_match', () => {
    const w = parseWeather({
      ...sample,
      daily: {
        time: ['2026-11-03', '2026-11-04'],
        weather_code_meteoswiss_icon_ch2: [3, null],
        weather_code_best_match: [2, 61],
        temperature_2m_min_best_match: [4.1, 2.1],
        temperature_2m_max_best_match: [11.2, 9.4],
        precipitation_probability_max_best_match: [70, 60],
        precipitation_sum_best_match: [4.2, 0],
      },
    });
    expect(w.daily).toEqual([
      { date: '2026-11-03', code: 3, min: 4.1, max: 11.2, rain: 70, rainMm: 4.2, sunrise: null, sunset: null },
      { date: '2026-11-04', code: 61, min: 2.1, max: 9.4, rain: 60, rainMm: 0, sunrise: null, sunset: null },
    ]);
  });

  it('reads wind, pressure, humidity, hourly points and sun times for the weather screen', () => {
    const w = parseWeather({
      current: { temperature_2m: 7.1, weather_code: 3, apparent_temperature: 3.9, relative_humidity_2m: 76, wind_speed_10m: 11, wind_gusts_10m: 27.4, wind_direction_10m: 58, pressure_msl: 1023.8 },
      hourly: {
        time: ['2026-11-04T16:00'],
        temperature_2m_meteoswiss_icon_ch2: [7.0],
        precipitation_best_match: [0.4],
        precipitation_probability_best_match: [30],
        pressure_msl_meteoswiss_icon_ch2: [1023.5],
        wind_speed_10m_best_match: [11],
        wind_gusts_10m_meteoswiss_icon_ch2: [27.4],
        weather_code_best_match: [3],
        is_day: [0],
      },
      daily: { time: ['2026-11-04'], sunrise_best_match: ['2026-11-04T07:13'], sunset_meteoswiss_icon_ch2: ['2026-11-04T17:04'] },
    });
    expect(w.now).toEqual({ apparent: 3.9, humidity: 76, wind: 11, gust: 27.4, windDir: 58, pressure: 1023.8 });
    expect(w.hourly).toEqual([
      { time: new Date('2026-11-04T16:00:00+01:00'), temp: 7.0, rainMm: 0.4, probability: 30, pressure: 1023.5, wind: 11, gust: 27.4, code: 3, isDay: false },
    ]);
    expect(w.daily[0]).toMatchObject({ sunrise: '07:13', sunset: '17:04' });
  });

  it('finds the first rainy hour in a window', () => {
    const w = parseWeather(sample);
    expect(firstRainHour(w, new Date('2026-11-03T06:00:00+01:00'), new Date('2026-11-03T22:00:00+01:00'))).toBe(15);
    expect(firstRainHour(w, new Date('2026-11-03T06:00:00+01:00'), new Date('2026-11-03T15:00:00+01:00'))).toBeNull();
  });

  it('maps WMO codes to German text and icons', () => {
    expect(describeWmo(0)).toEqual({ text: 'Klar', icon: 'sun' });
    expect(describeWmo(3)).toEqual({ text: 'Bewölkt', icon: 'cloud' });
    expect(describeWmo(63)).toEqual({ text: 'Regen', icon: 'cloud-rain' });
    expect(describeWmo(95)).toEqual({ text: 'Gewitter', icon: 'cloud-lightning' });
    expect(describeWmo(null)).toEqual({ text: 'Unbekannt', icon: 'cloud' });
    expect(describeWmo(42)).toEqual({ text: 'Unbekannt', icon: 'cloud' });
  });

  it('fetches and reports HTTP errors without the url', async () => {
    const ok = fakeFetch(() => jsonResponse(sample));
    expect((await fetchWeather(ok, 47.411, 8.544)).currentTemp).toBe(8.4);
    const bad = fakeFetch(() => textResponse('nope', 503));
    await expect(fetchWeather(bad, 47.411, 8.544)).rejects.toThrow(/^open-meteo HTTP 503$/);
  });
});
