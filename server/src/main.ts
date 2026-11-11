import { join } from 'node:path';
import { buildApp } from './app.js';
import { TtlCache } from './cache.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { type CommuteSource, Dashboard } from './dashboard.js';
import { startOfWeek } from './format.js';
import { BatteryMonitor, KindleMonitor, ntfySender } from './monitor.js';
import { refreshSeconds } from './state.js';
import { sourceHealth } from './health.js';
import { BatteryFile, DeviceStatus } from './status.js';
import { statusHtml } from './views/status.js';
import { PlaywrightRenderer } from './render/renderer.js';
import { closeAll } from './shutdown.js';
import { type BringCatalog, loadCatalog, verbatimNames } from './sources/bring/catalog.js';
import { BringClient } from './sources/bring/client.js';
import { BringSource, disabledBring, MAX_TASK_TILES, type ShoppingSource, TASK_SUGGESTIONS } from './sources/bring/source.js';
import { CalendarSource } from './sources/calendar.js';
import { withRoster } from './roster/calendar.js';
import { RosterStore } from './roster/store.js';
import { receiveRoster } from './roster/upload.js';
import { TransitSource } from './sources/transit.js';
import { fetchLakeTemp } from './sources/lake.js';
import { fetchAboveFog } from './sources/uetliberg.js';
import { type Commute, fetchCommute, trip } from './sources/commute.js';
import { CommuteRouteSource } from './sources/commute-route.js';
import { fetchWaste } from './sources/waste.js';
import { fetchWeather } from './sources/weather.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const clock = systemClock;
  const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

  const weatherCache = new TtlCache(30 * 60_000, () => fetchWeather(fetchFn, config.weather.lat, config.weather.lon), clock, 'weather');
  const lakeCache = new TtlCache(3 * 3_600_000, () => fetchLakeTemp(fetchFn, clock()), clock, 'lake');
  // MeteoSwiss measures every 10 minutes.
  const uetlibergCache = new TtlCache(10 * 60_000, () => fetchAboveFog(fetchFn), clock, 'uetliberg');
  const wasteZip = config.wasteZip;
  const wasteCache = wasteZip ? new TtlCache(6 * 3_600_000, () => fetchWaste(fetchFn, wasteZip, startOfWeek(clock())), clock, 'waste') : null;

  // Per destination: the scooter travel time with traffic, 5 minutes, only fetched while Heute is shown (not
  // at night); route and map for «Arbeitsweg» only when the screen is opened, reused for 2 minutes.
  const commuteConfig = config.commute;
  const commutes = commuteConfig?.destinations.map((d, i): CommuteSource => {
    const t = trip(commuteConfig, d);
    const name = i === 0 ? 'commute' : `commute:${d.icon}`;
    const travel = new TtlCache(5 * 60_000, () => fetchCommute(fetchFn, t), clock, name);
    const routeSource = new CommuteRouteSource(fetchFn, t);
    const route = new TtlCache(2 * 60_000, () => routeSource.load(), clock, `${name}:route`);
    // The ride at a planned departure (before a duty): one query per departure, kept 15 minutes.
    let planned: { at: number; cache: TtlCache<Commute> } | null = null;
    return {
      label: d.label,
      icon: d.icon,
      badge: d.badge,
      days: d.days,
      walkMinutes: commuteConfig.walkMinutes,
      get: async (force) => (await travel.get(force))?.value ?? null,
      at: async (departure, force) => {
        if (planned?.at !== departure.getTime()) {
          planned = { at: departure.getTime(), cache: new TtlCache(15 * 60_000, () => fetchCommute(fetchFn, t, departure), clock, `${name}:planned`) };
        }
        return (await planned.cache.get(force))?.value ?? null;
      },
      route: async (force) => (await route.get(force))?.value ?? null,
    };
  });

  let bring = disabledBring;
  let tasks: ShoppingSource | undefined;
  if (config.bring) {
    const locale = config.bring.locale;
    const catalogCache = new TtlCache<BringCatalog>(24 * 3_600_000, () => loadCatalog(fetchFn, locale), clock, 'bring:catalog');
    const catalog = async () => (await catalogCache.get())?.value ?? (await loadCatalog(fetchFn, locale));
    const client = new BringClient(config.bring, fetchFn, clock);
    bring = new BringSource(client, config.bring.list, catalog, clock);
    if (config.bring.tasksList) {
      tasks = new BringSource(client, config.bring.tasksList, async () => verbatimNames, clock, { fill: TASK_SUGGESTIONS, max: MAX_TASK_TILES });
    }
  }

  // Push notifications when the Kindle stops calling in or its battery runs low (optional, NTFY_TOPIC).
  const notify = config.ntfy ? ntfySender(config.ntfy, fetchFn) : null;
  const batteryMonitor = notify ? new BatteryMonitor(notify) : null;
  const monitor = config.ntfy && notify
    ? new KindleMonitor(
        notify,
        clock,
        config.ntfy.graceMinutes * 60_000,
        refreshSeconds(clock(), config.refreshSeconds, config.quietHours),
      )
    : null;
  const monitorTimer = monitor ? setInterval(() => void monitor.check(), 60_000) : null;
  monitorTimer?.unref();

  // Duty roster from the iOS shortcut (optional, ROSTER_TOKEN): calendar entries and the leave time.
  const rosterConfig = config.roster;
  const rosterStore = rosterConfig ? new RosterStore(config.stateDir) : null;
  rosterStore?.load();
  if (rosterStore && !rosterStore.persistent()) console.warn(`[roster] ${config.stateDir} is not a volume: uploaded plans are lost on the next deploy`);
  const calendarSource = new CalendarSource(config.calendars, fetchFn, clock);

  // The battery curve lives on the state volume too, so a deploy does not wipe it.
  const status = new DeviceStatus(clock, new BatteryFile(join(config.stateDir, 'battery.json')));
  const renderer = await PlaywrightRenderer.launch();
  const dashboard = new Dashboard({
    sources: {
      weather: { get: async (force) => (await weatherCache.get(force))?.value ?? null },
      lake: { get: async (force) => (await lakeCache.get(force))?.value ?? null },
      uetliberg: { get: async (force) => (await uetlibergCache.get(force))?.value ?? null },
      waste: wasteCache ? { pickups: async (force) => (await wasteCache.get(force))?.value ?? null } : undefined,
      calendar: rosterStore && rosterConfig ? withRoster(calendarSource, rosterStore, rosterConfig.badge) : calendarSource,
      transit: new TransitSource(config.stations, fetchFn, clock, config.opentransportdataKey),
      bring,
      tasks,
      commutes,
      roster: rosterStore && rosterConfig ? { today: (now) => rosterStore.today(now), buffers: rosterConfig.buffers } : undefined,
    },
    renderer,
    clock,
    refreshSeconds: config.refreshSeconds,
    quietHours: config.quietHours,
    viewResetSeconds: config.viewResetSeconds,
    birthdays: config.birthdays,
    guestWifi: config.guestWifi,
    onDelivered: (seconds) => {
      status.delivered(seconds);
      void monitor?.seen(seconds);
    },
  });

  const app = buildApp({
    dashboard,
    deviceToken: config.deviceToken,
    previewPassword: config.previewPassword,
    stations: config.stations.map((s) => s.name),
    commutes: commuteConfig?.destinations.map((d) => d.label),
    roster:
      rosterStore && rosterConfig
        ? { token: rosterConfig.token, receive: (pdf) => receiveRoster(pdf, { name: rosterConfig.name, store: rosterStore, clock, notify: notify ?? undefined }) }
        : undefined,
    onBattery: (b) => {
      // Every change of the level, so the log shows how fast the battery drains (Coolify adds the time).
      if (status.battery(b)) console.log(`[battery] ${b.level} %${b.charging ? ' lädt' : ''}`);
      dashboard.reportBattery(b);
      void batteryMonitor?.report(b);
    },
    statusHtml: () =>
      statusHtml({ now: clock(), startedAt: status.startedAt, lastSeen: status.lastSeen, nextDue: status.nextDue, battery: status.history(), sources: sourceHealth.list(), roster: rosterStore ? { months: rosterStore.list(), lastError: rosterStore.lastError, persistent: rosterStore.persistent() } : undefined }),
    logger: true,
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (monitorTimer) clearInterval(monitorTimer);
    const code = await closeAll([() => app.close(), () => renderer.close()], (m) => console.error(m));
    process.exit(code);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (err) {
    await renderer.close();
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
