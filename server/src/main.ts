import { buildApp } from './app.js';
import { TtlCache } from './cache.js';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { Dashboard } from './dashboard.js';
import { startOfWeek } from './format.js';
import { BatteryMonitor, KindleMonitor, ntfySender } from './monitor.js';
import { refreshSeconds } from './state.js';
import { PlaywrightRenderer } from './render/renderer.js';
import { closeAll } from './shutdown.js';
import { type BringCatalog, loadCatalog, verbatimNames } from './sources/bring/catalog.js';
import { BringClient } from './sources/bring/client.js';
import { BringSource, disabledBring, MAX_TASK_TILES, type ShoppingSource, TASK_SUGGESTIONS } from './sources/bring/source.js';
import { CalendarSource } from './sources/calendar.js';
import { TransitSource } from './sources/transit.js';
import { fetchLakeTemp } from './sources/lake.js';
import { fetchWaste } from './sources/waste.js';
import { fetchWeather } from './sources/weather.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const clock = systemClock;
  const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

  const weatherCache = new TtlCache(30 * 60_000, () => fetchWeather(fetchFn, config.weather.lat, config.weather.lon), clock, 'weather');
  const lakeCache = new TtlCache(3 * 3_600_000, () => fetchLakeTemp(fetchFn, clock()), clock, 'lake');
  const wasteZip = config.wasteZip;
  const wasteCache = wasteZip ? new TtlCache(6 * 3_600_000, () => fetchWaste(fetchFn, wasteZip, startOfWeek(clock())), clock, 'waste') : null;

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

  const renderer = await PlaywrightRenderer.launch();
  const dashboard = new Dashboard({
    sources: {
      weather: { get: async (force) => (await weatherCache.get(force))?.value ?? null },
      lake: { get: async (force) => (await lakeCache.get(force))?.value ?? null },
      waste: wasteCache ? { pickups: async (force) => (await wasteCache.get(force))?.value ?? null } : undefined,
      calendar: new CalendarSource(config.calendars, fetchFn, clock),
      transit: new TransitSource(config.stations, fetchFn, clock),
      bring,
      tasks,
    },
    renderer,
    clock,
    refreshSeconds: config.refreshSeconds,
    quietHours: config.quietHours,
    viewResetSeconds: config.viewResetSeconds,
    birthdays: config.birthdays,
    onDelivered: monitor ? (seconds) => void monitor.seen(seconds) : undefined,
  });

  const app = buildApp({
    dashboard,
    deviceToken: config.deviceToken,
    previewPassword: config.previewPassword,
    stations: config.stations.map((s) => s.name),
    onBattery: (b) => {
      dashboard.reportBattery(b);
      void batteryMonitor?.report(b);
    },
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
