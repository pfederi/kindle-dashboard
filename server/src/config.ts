import { DEFAULT_BUFFERS, type ShiftBuffers } from './roster/shift.js';

export interface CalendarConfig {
  label: string;
  url: string;
}

export interface StationConfig {
  id: string;
  name: string;
  via: string;
  lines: string[];
  /** Minutes on foot from the front door; departures leaving sooner are out of reach. */
  walk?: number;
}

/** A birthday greeted on Heute and the night screen; `date` is «MM-DD». */
export interface BirthdayConfig {
  name: string;
  date: string;
}

/** Push notifications via ntfy when the Kindle stops calling in. */
export interface NtfyConfig {
  server: string;
  topic: string;
  /** Tolerated delay after the next expected poll before alerting. */
  graceMinutes: number;
}

/** Minutes since midnight. `start > end` means the range crosses midnight. */
export interface QuietHours {
  start: number;
  end: number;
}

/** Guest WLAN shown as a QR code on the welcome screen during a visit. */
export interface GuestWifi {
  ssid: string;
  /** '' = open network. */
  password: string;
}

/** Where a scooter ride goes; the icon stands for it in Heute when there are two. */
export interface CommuteDestination {
  to: { lat: number; lon: number };
  /** e.g. «Zur Arbeit». */
  label: string;
  icon: 'work' | 'school';
  /** Whose ride, as the calendar abbreviations show it, e.g. «LE»; '' = none. */
  badge: string;
  /** Days of the week it is shown (0 Sunday … 6 Saturday, as Date.getDay). */
  days: number[];
}

/** Scooter travel time with live traffic (HERE) from home to work and, optionally, to school. */
export interface CommuteConfig {
  apiKey: string;
  from: { lat: number; lon: number };
  /** Motorways allowed (a 125 cm³ scooter may use them). */
  highway: boolean;
  /** Minutes on foot to the scooter (e.g. to the garage), added to the ride. */
  walkMinutes: number;
  /** Work first, then school if configured. */
  destinations: CommuteDestination[];
}

/** Duty roster PDFs sent by an iOS shortcut; the duties go to the calendar and the scooter line. */
export interface RosterConfig {
  /** Bearer token of the shortcut. */
  token: string;
  /** The name heading the person's row in the plan. */
  name: string;
  /** Minutes to be there before work and school. */
  buffers: ShiftBuffers;
  /** Abbreviation of the duties in the calendar. */
  badge: string;
}

export interface BringConfig {
  email: string;
  password: string;
  list: string;
  locale: string;
  /** Bring! list for household tasks; '' = no tasks. */
  tasksList: string;
}

export interface Config {
  /** Push notification when the Kindle stops calling in; null when NTFY_TOPIC is not set. */
  ntfy: NtfyConfig | null;
  port: number;
  deviceToken: string;
  previewPassword: string;
  calendars: CalendarConfig[];
  weather: { lat: number; lon: number };
  stations: StationConfig[];
  birthdays: BirthdayConfig[];
  bring: BringConfig | null;
  /** Zurich postcode for the paper/cardboard collection dates; '' turns them off. */
  wasteZip: string;
  refreshSeconds: number;
  quietHours: QuietHours | null;
  viewResetSeconds: number;
  /** Welcome screen with a WLAN QR code during a visit; null when GUEST_WIFI_SSID is not set. */
  guestWifi: GuestWifi | null;
  /** Scooter travel time above the departures; null unless HERE_API_KEY, COMMUTE_FROM and COMMUTE_TO are set. */
  commute: CommuteConfig | null;
  /** Duty roster upload; null unless ROSTER_TOKEN is set. */
  roster: RosterConfig | null;
  /** What survives a deploy (duty rosters, battery curve): a volume in Coolify. */
  stateDir: string;
}

export const DEFAULT_STATIONS: StationConfig[] = [
  { id: '8591382', name: 'Sternen', via: 'Zürich, Milchbuck', lines: ['10'], walk: 3 },
  { id: '8503006', name: 'Oerlikon', via: 'Zürich HB', lines: ['S7', 'S16'], walk: 6 },
  { id: '8591063', name: 'Oerlikon Ost', via: 'Zürich, Milchbuck', lines: ['51'], walk: 5 },
];

export const DEFAULT_BIRTHDAYS: BirthdayConfig[] = [];

type Env = Record<string, string | undefined>;

function json<T>(env: Env, key: string, fallback: T): T {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${key} is not valid JSON`);
  }
}

function int(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${key} must be a positive integer`);
  return n;
}

function float(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return n;
}

function entries(key: string, value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${key} must be a JSON array`);
  return value.map((entry: unknown, i) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${key}[${i}] must be an object`);
    return entry as Record<string, unknown>;
  });
}

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** Errors name only the index and field: calendar URLs are secrets and must never be echoed. */
function calendars(value: unknown): CalendarConfig[] {
  return entries('CALENDARS', value).map((c, i) => {
    if (typeof c.label !== 'string' || c.label.trim() === '') throw new Error(`CALENDARS[${i}].label must be a non-empty string`);
    if (!isHttpUrl(c.url)) throw new Error(`CALENDARS[${i}].url is not a valid URL`);
    return { label: c.label, url: c.url as string };
  });
}

function stations(value: unknown): StationConfig[] {
  return entries('STATIONS', value).map((st, i) => {
    for (const field of ['id', 'name', 'via'] as const) {
      if (typeof st[field] !== 'string') throw new Error(`STATIONS[${i}].${field} must be a string`);
    }
    if (!Array.isArray(st.lines) || !st.lines.every((l) => typeof l === 'string')) {
      throw new Error(`STATIONS[${i}].lines must be an array of strings`);
    }
    if (st.walk !== undefined && !(Number.isInteger(st.walk) && (st.walk as number) >= 0 && (st.walk as number) <= 60)) {
      throw new Error(`STATIONS[${i}].walk must be whole minutes from 0 to 60`);
    }
    const station: StationConfig = { id: st.id as string, name: st.name as string, via: st.via as string, lines: st.lines as string[] };
    if (st.walk !== undefined) station.walk = st.walk as number;
    return station;
  });
}

/** Days per month in a leap year: 29 February is a valid birthday. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function birthdays(value: unknown): BirthdayConfig[] {
  return entries('BIRTHDAYS', value).map((b, i) => {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (name === '') throw new Error(`BIRTHDAYS[${i}].name must be a non-empty string`);
    const m = typeof b.date === 'string' ? /^(\d{2})-(\d{2})$/.exec(b.date) : null;
    const month = Number(m?.[1]);
    const day = Number(m?.[2]);
    if (!m || month < 1 || month > 12 || day < 1 || day > MONTH_DAYS[month - 1]!) throw new Error(`BIRTHDAYS[${i}].date must be a date like 12-01 (MM-DD)`);
    return { name, date: b.date as string };
  });
}

function wasteZip(raw: string | undefined): string {
  const zip = (raw ?? '8050').trim();
  if (zip !== '' && !/^\d{4}$/.test(zip)) throw new Error('WASTE_ZIP must be a four-digit postcode or empty');
  return zip;
}

function guestWifi(env: Env): GuestWifi | null {
  const ssid = env.GUEST_WIFI_SSID?.trim();
  if (!ssid) return null;
  // WLAN limits: SSID up to 32 bytes, WPA passphrase 8–63 characters.
  if (Buffer.byteLength(ssid) > 32) throw new Error('GUEST_WIFI_SSID must be at most 32 bytes');
  const password = env.GUEST_WIFI_PASSWORD ?? '';
  if (password !== '' && (password.length < 8 || password.length > 63)) throw new Error('GUEST_WIFI_PASSWORD must be 8–63 characters or empty (open network)');
  return { ssid, password };
}

function coords(key: string, raw: string): { lat: number; lon: number } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  const lat = Number(m?.[1]);
  const lon = Number(m?.[2]);
  if (!m || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(`${key} must look like 47.411,8.544 (latitude,longitude)`);
  return { lat, lon };
}

/** Monday first, as in «Mo-Fr». */
const WEEKDAYS = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];

/** «Mo,Di» or «Mo-Fr» (also mixed, «Mo-Mi,Fr») to days as Date.getDay counts them, sorted. */
export function weekdays(key: string, raw: string): number[] {
  const days = new Set<number>();
  for (const part of raw.split(',')) {
    const [a, b, ...rest] = part.trim().toLowerCase().split('-').map((s) => s.trim());
    const from = WEEKDAYS.indexOf(a ?? '');
    const to = b === undefined ? from : WEEKDAYS.indexOf(b);
    if (from < 0 || to < from || rest.length > 0) throw new Error(`${key} must list days like Mo,Di or Mo-Fr`);
    for (let i = from; i <= to; i++) days.add((i + 1) % 7);
  }
  return [...days].sort((x, y) => x - y);
}

/** A calendar-like abbreviation, '' when not set. */
function badge(env: Env, key: string): string {
  const v = (env[key] ?? '').trim();
  if (v !== '' && !/^[\p{L}\d]{1,4}$/u.test(v)) throw new Error(`${key} must be 1–4 letters or digits, like a calendar label`);
  return v;
}

function minutes(env: Env, key: string, fallback: number): number {
  const raw = (env[key] ?? '').trim();
  if (raw === '') return fallback;
  if (!/^\d{1,2}$/.test(raw) || Number(raw) > 60) throw new Error(`${key} must be whole minutes from 0 to 60`);
  return Number(raw);
}

function roster(env: Env): RosterConfig | null {
  const token = env.ROSTER_TOKEN?.trim();
  if (!token) return null;
  // The token alone guards the upload: long and random, like DEVICE_TOKEN.
  if (!/^[A-Za-z0-9_-]{24,}$/.test(token)) throw new Error('ROSTER_TOKEN must be at least 24 letters, digits, - or _');
  const name = env.ROSTER_NAME?.trim();
  if (!name) throw new Error('ROSTER_NAME is required when ROSTER_TOKEN is set');
  if (/\s/.test(name)) throw new Error('ROSTER_NAME must be one word, as at the start of the row in the plan');
  return {
    token,
    name,
    buffers: { work: minutes(env, 'ROSTER_BUFFER_WORK', DEFAULT_BUFFERS.work), school: minutes(env, 'ROSTER_BUFFER_SCHOOL', DEFAULT_BUFFERS.school) },
    badge: badge(env, 'ROSTER_BADGE') || badge(env, 'COMMUTE_BADGE') || name.slice(0, 2).toUpperCase(),
  };
}

function commute(env: Env): CommuteConfig | null {
  const keys = ['HERE_API_KEY', 'COMMUTE_FROM', 'COMMUTE_TO'] as const;
  const set = keys.filter((k) => env[k]?.trim());
  if (set.length === 0) return null;
  // Names only: the values are a key and home/work locations.
  if (set.length < keys.length) throw new Error(`Scooter travel time needs ${keys.filter((k) => !set.includes(k)).join(', ')} as well`);
  const highway = (env.COMMUTE_HIGHWAY ?? '1').trim();
  if (highway !== '0' && highway !== '1') throw new Error('COMMUTE_HIGHWAY must be 1 (motorways allowed) or 0');
  const walk = (env.COMMUTE_WALK_MINUTES ?? '').trim();
  if (walk !== '' && !/^\d{1,2}$/.test(walk)) throw new Error('COMMUTE_WALK_MINUTES must be whole minutes from 0 to 99');
  const school = env.COMMUTE_SCHOOL_TO?.trim();
  return {
    apiKey: env.HERE_API_KEY!.trim(),
    from: coords('COMMUTE_FROM', env.COMMUTE_FROM!),
    highway: highway === '1',
    walkMinutes: walk === '' ? 0 : Number(walk),
    destinations: [
      { to: coords('COMMUTE_TO', env.COMMUTE_TO!), label: env.COMMUTE_LABEL?.trim() || 'Zur Arbeit', icon: 'work', badge: badge(env, 'COMMUTE_BADGE'), days: [0, 1, 2, 3, 4, 5, 6] },
      ...(school
        ? [
            {
              to: coords('COMMUTE_SCHOOL_TO', school),
              label: env.COMMUTE_SCHOOL_LABEL?.trim() || 'Schule',
              icon: 'school' as const,
              badge: badge(env, 'COMMUTE_SCHOOL_BADGE'),
              days: weekdays('COMMUTE_SCHOOL_DAYS', env.COMMUTE_SCHOOL_DAYS?.trim() || 'Mo-Fr'),
            },
          ]
        : []),
    ],
  };
}

function ntfy(env: Env): NtfyConfig | null {
  const topic = env.NTFY_TOPIC?.trim();
  if (!topic) return null;
  // Anyone who knows the topic can read it on ntfy.sh, so it must be hard to guess.
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(topic)) throw new Error('NTFY_TOPIC must be 12–64 letters, digits, - or _');
  return { server: (env.NTFY_SERVER?.trim() || 'https://ntfy.sh').replace(/\/+$/, ''), topic, graceMinutes: int(env, 'OFFLINE_ALERT_MINUTES', 15) };
}

/** Default night: the night screen shows from midnight to 5:30. An empty value turns it off. */
export const DEFAULT_QUIET_HOURS = '00:00-05:30';

function quiet(raw: string | undefined): QuietHours | null {
  if (raw === undefined) raw = DEFAULT_QUIET_HOURS;
  if (raw.trim() === '') return null;
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error('QUIET_HOURS must look like 23:00-06:00');
  const [, h1, m1, h2, m2] = m.map(Number) as [number, number, number, number, number];
  return { start: h1 * 60 + m1, end: h2 * 60 + m2 };
}

export function loadConfig(env: Env): Config {
  const missing = ['DEVICE_TOKEN', 'PREVIEW_PASSWORD'].filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  let bring: BringConfig | null = null;
  if (env.BRING_EMAIL) {
    if (!env.BRING_PASSWORD) throw new Error('BRING_PASSWORD is required when BRING_EMAIL is set');
    bring = {
      email: env.BRING_EMAIL,
      password: env.BRING_PASSWORD,
      list: env.BRING_LIST ?? 'Zuhause',
      locale: env.BRING_LOCALE ?? 'de-CH',
      tasksList: (env.BRING_TASKS_LIST ?? 'Aufgaben').trim(),
    };
  }

  return {
    port: int(env, 'PORT', 3000),
    deviceToken: env.DEVICE_TOKEN as string,
    previewPassword: env.PREVIEW_PASSWORD as string,
    calendars: calendars(json<unknown>(env, 'CALENDARS', [])),
    weather: { lat: float(env, 'WEATHER_LAT', 47.411), lon: float(env, 'WEATHER_LON', 8.544) },
    stations: stations(json<unknown>(env, 'STATIONS', DEFAULT_STATIONS)),
    birthdays: birthdays(json<unknown>(env, 'BIRTHDAYS', DEFAULT_BIRTHDAYS)),
    bring,
    wasteZip: wasteZip(env.WASTE_ZIP),
    refreshSeconds: int(env, 'REFRESH_SECONDS', 120),
    quietHours: quiet(env.QUIET_HOURS),
    ntfy: ntfy(env),
    guestWifi: guestWifi(env),
    commute: commute(env),
    roster: roster(env),
    stateDir: env.STATE_DIR?.trim() || '/app/state',
    viewResetSeconds: int(env, 'VIEW_RESET_SECONDS', 120),
  };
}
