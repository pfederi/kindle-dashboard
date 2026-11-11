import { describe, expect, it } from 'vitest';
import { loadConfig, weekdays } from '../src/config.js';

const base = { DEVICE_TOKEN: 'tok', PREVIEW_PASSWORD: 'pw' };

describe('loadConfig', () => {
  it('requires DEVICE_TOKEN and PREVIEW_PASSWORD', () => {
    expect(() => loadConfig({})).toThrow(/DEVICE_TOKEN, PREVIEW_PASSWORD/);
  });

  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.port).toBe(3000);
    expect(c.weather).toEqual({ lat: 47.411, lon: 8.544 });
    expect(c.calendars).toEqual([]);
    expect(c.stations.map((s) => s.name)).toEqual(['Sternen', 'Oerlikon', 'Oerlikon Ost']);
    expect(c.stations[1]).toEqual({ id: '8503006', name: 'Oerlikon', via: 'Zürich HB', lines: ['S7', 'S16'], walk: 6 });
    expect(c.stations.map((s) => s.walk)).toEqual([3, 6, 5]);
    expect(c.bring).toBeNull();
    expect(c.refreshSeconds).toBe(120);
    expect(c.quietHours).toEqual({ start: 0, end: 330 }); // 00:00-05:30
    expect(c.ntfy).toBeNull();
    expect(c.viewResetSeconds).toBe(120);
    expect(c.wasteZip).toBe('8050');
  });

  it('has no birthdays by default, takes BIRTHDAYS and validates it', () => {
    expect(loadConfig(base).birthdays).toEqual([]);
    expect(loadConfig({ ...base, BIRTHDAYS: '[{"name":" Lena ","date":"02-29"}]' }).birthdays).toEqual([{ name: 'Lena', date: '02-29' }]);
    expect(loadConfig({ ...base, BIRTHDAYS: '[]' }).birthdays).toEqual([]);
    expect(() => loadConfig({ ...base, BIRTHDAYS: '[{"name":"","date":"01-01"}]' })).toThrow('BIRTHDAYS[0].name must be a non-empty string');
    for (const date of ['1-1', '13-01', '00-10', '04-31', '02-30', '2026-01-01', 5]) {
      expect(() => loadConfig({ ...base, BIRTHDAYS: JSON.stringify([{ name: 'X', date }]) })).toThrow('BIRTHDAYS[0].date must be a date like 12-01 (MM-DD)');
    }
  });

  it('names the task list in Bring!, Aufgaben by default, empty turns it off', () => {
    const bring = { ...base, BRING_EMAIL: 'a@b.ch', BRING_PASSWORD: 'x' };
    expect(loadConfig(bring).bring?.tasksList).toBe('Aufgaben');
    expect(loadConfig({ ...bring, BRING_TASKS_LIST: ' Ämtli ' }).bring?.tasksList).toBe('Ämtli');
    expect(loadConfig({ ...bring, BRING_TASKS_LIST: '' }).bring?.tasksList).toBe('');
  });

  it('turns the night off with an empty QUIET_HOURS', () => {
    expect(loadConfig({ ...base, QUIET_HOURS: '' }).quietHours).toBeNull();
  });

  it('reads walking minutes per station and validates them', () => {
    const st = (walk: unknown) => JSON.stringify([{ id: '1', name: 'A', via: 'B', lines: [], walk }]);
    expect(loadConfig({ ...base, STATIONS: st(3) }).stations[0]!.walk).toBe(3);
    expect(loadConfig({ ...base, STATIONS: JSON.stringify([{ id: '1', name: 'A', via: 'B', lines: [] }]) }).stations[0]).not.toHaveProperty('walk');
    expect(() => loadConfig({ ...base, STATIONS: st(-1) })).toThrow(/STATIONS\[0\]\.walk/);
    expect(() => loadConfig({ ...base, STATIONS: st('5') })).toThrow(/STATIONS\[0\]\.walk/);
  });

  it('sets up the scooter travel time only with key, start and destination, and checks them', () => {
    expect(loadConfig(base).commute).toBeNull();
    const env = { ...base, HERE_API_KEY: ' k3y ', COMMUTE_FROM: '47.411, 8.544', COMMUTE_TO: '47.378,8.54' };
    expect(loadConfig(env).commute).toEqual({
      apiKey: 'k3y',
      from: { lat: 47.411, lon: 8.544 },
      highway: true,
      walkMinutes: 0,
      destinations: [{ to: { lat: 47.378, lon: 8.54 }, label: 'Zur Arbeit', icon: 'work', badge: '', days: [0, 1, 2, 3, 4, 5, 6] }],
    });
    expect(loadConfig({ ...env, COMMUTE_HIGHWAY: '0', COMMUTE_LABEL: 'Zum Geschäft', COMMUTE_WALK_MINUTES: '5' }).commute).toMatchObject({
      highway: false,
      walkMinutes: 5,
      destinations: [{ label: 'Zum Geschäft' }],
    });
    // A school from the same start, with whose ride it is as a calendar abbreviation.
    expect(loadConfig({ ...env, COMMUTE_SCHOOL_TO: '47.39,8.51', COMMUTE_SCHOOL_BADGE: 'AB' }).commute?.destinations[1]).toEqual({
      to: { lat: 47.39, lon: 8.51 },
      label: 'Schule',
      icon: 'school',
      badge: 'AB',
      days: [1, 2, 3, 4, 5],
    });
    expect(loadConfig({ ...env, COMMUTE_SCHOOL_TO: '47.39,8.51', COMMUTE_SCHOOL_DAYS: 'Mo, Di' }).commute?.destinations[1]?.days).toEqual([1, 2]);
    expect(() => loadConfig({ ...env, COMMUTE_SCHOOL_TO: '47.39,8.51', COMMUTE_SCHOOL_DAYS: 'Montag' })).toThrow(/COMMUTE_SCHOOL_DAYS must list days like Mo,Di or Mo-Fr/);
    expect(loadConfig({ ...env, COMMUTE_SCHOOL_TO: '47.39,8.51', COMMUTE_SCHOOL_LABEL: 'Gymi' }).commute?.destinations[1]?.label).toBe('Gymi');
    expect(() => loadConfig({ ...env, COMMUTE_SCHOOL_TO: 'Schulhaus' })).toThrow(/COMMUTE_SCHOOL_TO must look like/);
    expect(() => loadConfig({ ...env, COMMUTE_BADGE: 'zu lang' })).toThrow(/COMMUTE_BADGE must be 1–4/);
    expect(() => loadConfig({ ...env, COMMUTE_WALK_MINUTES: '5 Min' })).toThrow(/COMMUTE_WALK_MINUTES/);
    expect(() => loadConfig({ ...base, HERE_API_KEY: 'k3y' })).toThrow(/COMMUTE_FROM, COMMUTE_TO/);
    expect(() => loadConfig({ ...env, COMMUTE_TO: 'Bahnhofstrasse 1' })).toThrow(/COMMUTE_TO must look like/);
    expect(() => loadConfig({ ...env, COMMUTE_FROM: '95,8' })).toThrow(/COMMUTE_FROM/);
    expect(() => loadConfig({ ...env, COMMUTE_HIGHWAY: 'ja' })).toThrow(/COMMUTE_HIGHWAY/);
  });

  it('reads school days as weekday abbreviations, lists and ranges, as Date.getDay counts them', () => {
    expect(weekdays('X', 'Mo,Di')).toEqual([1, 2]);
    expect(weekdays('X', 'Mo-Fr')).toEqual([1, 2, 3, 4, 5]);
    expect(weekdays('X', 'mo - mi, FR')).toEqual([1, 2, 3, 5]);
    expect(weekdays('X', 'Sa,So,Sa')).toEqual([0, 6]);
    for (const bad of ['', 'Fr-Mo', 'Mo-Di-Mi', 'Mon']) expect(() => weekdays('X', bad)).toThrow(/X must list days/);
  });

  it('reads the guest WLAN, open networks too, and checks its limits', () => {
    expect(loadConfig(base).guestWifi).toBeNull();
    expect(loadConfig({ ...base, GUEST_WIFI_SSID: ' Gast-Netz ', GUEST_WIFI_PASSWORD: 'sonnenblume42' }).guestWifi).toEqual({ ssid: 'Gast-Netz', password: 'sonnenblume42' });
    expect(loadConfig({ ...base, GUEST_WIFI_SSID: 'Gast-Netz' }).guestWifi).toEqual({ ssid: 'Gast-Netz', password: '' });
    expect(() => loadConfig({ ...base, GUEST_WIFI_SSID: 'Gast-Netz', GUEST_WIFI_PASSWORD: 'kurz' })).toThrow(/GUEST_WIFI_PASSWORD/);
    expect(() => loadConfig({ ...base, GUEST_WIFI_SSID: 'x'.repeat(33) })).toThrow(/GUEST_WIFI_SSID/);
  });

  it('sets up ntfy alerts with a hard-to-guess topic', () => {
    expect(loadConfig({ ...base, NTFY_TOPIC: 'kindle-x7Gq2pLm9vRt' }).ntfy).toEqual({ server: 'https://ntfy.sh', topic: 'kindle-x7Gq2pLm9vRt', graceMinutes: 15 });
    expect(loadConfig({ ...base, NTFY_TOPIC: 'kindle-x7Gq2pLm9vRt', NTFY_SERVER: 'https://ntfy.example.ch/', OFFLINE_ALERT_MINUTES: '30' }).ntfy).toEqual({
      server: 'https://ntfy.example.ch',
      topic: 'kindle-x7Gq2pLm9vRt',
      graceMinutes: 30,
    });
    expect(() => loadConfig({ ...base, NTFY_TOPIC: 'kindle' })).toThrow(/NTFY_TOPIC/);
  });

  it('takes WASTE_ZIP, allows turning it off and rejects other values', () => {
    expect(loadConfig({ ...base, WASTE_ZIP: '8003' }).wasteZip).toBe('8003');
    expect(loadConfig({ ...base, WASTE_ZIP: '' }).wasteZip).toBe('');
    expect(() => loadConfig({ ...base, WASTE_ZIP: 'Zürich' })).toThrow(/WASTE_ZIP/);
  });

  it('parses JSON lists, bring and quiet hours', () => {
    const c = loadConfig({
      ...base,
      PORT: '8080',
      CALENDARS: '[{"label":"PF","url":"https://example.test/a.ics"}]',
      STATIONS: '[{"id":"1","name":"A","via":"B","lines":["7"]}]',
      BRING_EMAIL: 'a@b.ch',
      BRING_PASSWORD: 'secret',
      BRING_LIST: 'Zuhause',
      QUIET_HOURS: '23:00-06:00',
      REFRESH_SECONDS: '300',
      VIEW_RESET_SECONDS: '60',
    });
    expect(c.port).toBe(8080);
    expect(c.calendars).toEqual([{ label: 'PF', url: 'https://example.test/a.ics' }]);
    expect(c.stations).toEqual([{ id: '1', name: 'A', via: 'B', lines: ['7'] }]);
    expect(c.bring).toEqual({ email: 'a@b.ch', password: 'secret', list: 'Zuhause', locale: 'de-CH', tasksList: 'Aufgaben' });
    expect(c.quietHours).toEqual({ start: 23 * 60, end: 6 * 60 });
    expect(c.refreshSeconds).toBe(300);
    expect(c.viewResetSeconds).toBe(60);
  });

  it('rejects malformed values without echoing secrets', () => {
    expect(() => loadConfig({ ...base, CALENDARS: 'not json https://secret' })).toThrow(/^CALENDARS is not valid JSON$/);
    expect(() => loadConfig({ ...base, QUIET_HOURS: '23-6' })).toThrow(/QUIET_HOURS/);
    expect(() => loadConfig({ ...base, BRING_EMAIL: 'a@b.ch' })).toThrow(/BRING_PASSWORD/);
  });

  it('validates CALENDARS entries without echoing the URL', () => {
    const cal = (v: unknown) => () => loadConfig({ ...base, CALENDARS: JSON.stringify(v) });
    expect(cal({ label: 'PF', url: 'https://x.test/a.ics' })).toThrow(/^CALENDARS must be a JSON array$/);
    expect(cal([{ label: 'PF', url: 'calendar.google.com/secret/basic.ics' }])).toThrow(/^CALENDARS\[0\]\.url is not a valid URL$/);
    expect(cal([{ label: 'PF', url: 'https://x.test/a.ics' }, { label: 'AB', url: 'webcal://x.test/secret' }])).toThrow(
      /^CALENDARS\[1\]\.url is not a valid URL$/,
    );
    expect(cal([{ label: 'PF' }])).toThrow(/^CALENDARS\[0\]\.url is not a valid URL$/);
    expect(cal([{ label: ' ', url: 'https://x.test/a.ics' }])).toThrow(/^CALENDARS\[0\]\.label must be a non-empty string$/);
    expect(cal(['https://x.test/a.ics'])).toThrow(/^CALENDARS\[0\] must be an object$/);
  });

  it('validates STATIONS entries, naming only index and field', () => {
    const st = (v: unknown) => () => loadConfig({ ...base, STATIONS: JSON.stringify(v) });
    const ok = { id: '1', name: 'A', via: 'B', lines: ['7'] };
    expect(st(ok)).toThrow(/^STATIONS must be a JSON array$/);
    expect(st([ok, { id: '2', name: 'B', via: 'C' }])).toThrow(/^STATIONS\[1\]\.lines must be an array of strings$/);
    expect(st([{ ...ok, lines: [7] }])).toThrow(/^STATIONS\[0\]\.lines must be an array of strings$/);
    expect(st([{ ...ok, id: 8591281 }])).toThrow(/^STATIONS\[0\]\.id must be a string$/);
    expect(st([{ ...ok, name: undefined }])).toThrow(/^STATIONS\[0\]\.name must be a string$/);
    expect(st([{ ...ok, via: null }])).toThrow(/^STATIONS\[0\]\.via must be a string$/);
    expect(st([null])).toThrow(/^STATIONS\[0\] must be an object$/);
    expect(loadConfig({ ...base, STATIONS: JSON.stringify([{ ...ok, lines: [] }]) }).stations[0]?.lines).toEqual([]);
  });

  it('turns the roster on with token and name; buffers, badge and directory have defaults', () => {
    expect(loadConfig(base).roster).toBeNull();
    const token = 'r'.repeat(24);
    expect(loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: ' Robin ' }).roster).toEqual({ token, name: 'Robin', buffers: { work: 5, school: 10 }, badge: 'RO' });
    expect(loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: 'Robin', COMMUTE_BADGE: 'LE' }).roster?.badge).toBe('LE');
    expect(
      loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: 'Robin', ROSTER_BADGE: 'RB', ROSTER_BUFFER_WORK: '0', ROSTER_BUFFER_SCHOOL: '15' }).roster,
    ).toMatchObject({ badge: 'RB', buffers: { work: 0, school: 15 } });
  });

  it('keeps state (roster, battery curve) in STATE_DIR, /app/state by default', () => {
    expect(loadConfig(base).stateDir).toBe('/app/state');
    expect(loadConfig({ ...base, STATE_DIR: ' ./state ' }).stateDir).toBe('./state');
  });

  it('refuses a short token, a missing or two-word name and odd buffers', () => {
    const token = 'r'.repeat(24);
    expect(() => loadConfig({ ...base, ROSTER_TOKEN: 'kurz', ROSTER_NAME: 'Robin' })).toThrow(/ROSTER_TOKEN must be at least 24/);
    expect(() => loadConfig({ ...base, ROSTER_TOKEN: token })).toThrow(/ROSTER_NAME is required/);
    expect(() => loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: 'Robin Muster' })).toThrow(/ROSTER_NAME must be one word/);
    expect(() => loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: 'Robin', ROSTER_BUFFER_WORK: '61' })).toThrow(/ROSTER_BUFFER_WORK must be whole minutes from 0 to 60/);
    expect(() => loadConfig({ ...base, ROSTER_TOKEN: token, ROSTER_NAME: 'Robin', ROSTER_BADGE: 'zu lang' })).toThrow(/ROSTER_BADGE must be 1–4 letters/);
  });
});
