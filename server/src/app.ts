import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { PreviewOptions, Screen } from './dashboard.js';
import type { Battery } from './monitor.js';
import { SCREEN } from './render/screen.js';
import type { ViewName } from './state.js';
import { HOLIDAYS, type HolidayId } from './holidays.js';
import { nachtPreviewHtml } from './views/nacht.js';

export interface DashboardLike {
  screen(): Promise<Screen>;
  tap(x: number, y: number, hold?: boolean): Promise<Screen | null>;
  previewHtml(view: ViewName, opts?: PreviewOptions): Promise<string>;
  previewPng(view: ViewName, opts?: PreviewOptions): Promise<Buffer>;
}

const VIEWS: ViewName[] = ['heute', 'woche', 'einkauf', 'hinzufuegen', 'wetter', 'station', 'arbeitsweg'];

/** Links to every view as HTML (layout size) and as the PNG the Kindle gets. */
function previewIndex(stations: string[], commutes: string[]): string {
  const entries: [string, string, string][] = [
    ['Heute', 'heute', ''],
    ['Heute am Abend (ab 19 Uhr)', 'heute', 'abend=1'],
    ['Heute in der Nacht', 'heute', 'nacht=1'],
    ['Heute mit Gästen', 'heute', 'gast=1'],
    ['Heute mit fast leerem Akku', 'heute', 'akku=1'],
    ['Heute am Strom (lädt)', 'heute', 'laden=1'],
    ['Heute bei Nebel, Uetliberg sonnig', 'heute', 'nebel=1'],
    ...(commutes.length > 1 ? [['Heute mit Schule (an jedem Tag)', 'heute', 'schule=1'] as [string, string, string]] : []),
    ...(commutes.length > 0 ? [['Heute mit Dienst (Arbeit)', 'heute', 'dienst=arbeit'] as [string, string, string]] : []),
    ...(commutes.length > 1 ? [['Heute mit Dienst (Schule)', 'heute', 'dienst=schule'] as [string, string, string]] : []),
    ['Woche', 'woche', ''],
    ['Woche mit Gästen', 'woche', 'gast=1'],
    ['Einkauf', 'einkauf', ''],
    ['Hinzufügen', 'hinzufuegen', ''],
    ['Wetter', 'wetter', ''],
    ...(commutes.length > 0 ? commutes : ['Zur Arbeit']).flatMap((label, i): [string, string, string][] => [
      [`Arbeitsweg ${label}`, 'arbeitsweg', `ziel=${i}`],
      [`Arbeitsweg ${label} mit Stau (nachgestellt)`, 'arbeitsweg', `ziel=${i}&amp;stau=1`],
    ]),
    ...stations.map((name, i): [string, string, string] => [`Haltestelle ${name}`, 'station', `station=${i}`]),
  ];
  const status = '<li><a href="/preview/status">Status: Kindle, Akku, Datenquellen</a></li><li><a href="/preview/nacht">Nachtbildschirm: Mondphasen und Feiertage</a></li>';
  const rows = status + entries.map(([label, view, q]) => {
    const href = `/preview/${view}${q ? `?${q}` : ''}`;
    const png = `/preview/${view}?${q ? `${q}&amp;` : ''}png=1`;
    return `<li><a href="${href}">${label}</a> · <a href="${png}">PNG wie auf dem Kindle</a></li>`;
  }).join('');
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard-Vorschau</title><style>body{font:18px/1.6 system-ui,sans-serif;margin:24px;max-width:640px}</style></head><body><h1>Dashboard-Vorschau</h1><ul>${rows}</ul></body></html>`;
}

/** Failed preview logins tolerated within PREVIEW_LOCK_MS before the preview locks for that long. */
export const PREVIEW_MAX_FAILURES = 20;
export const PREVIEW_LOCK_MS = 15 * 60_000;

/** No scripts, no external resources: preview pages only need inline styles, data fonts and inline SVG. */
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; frame-ancestors 'none'";

/** Largest roster PDF taken (a month's plan has about 250 kB). */
export const ROSTER_MAX_BYTES = 2 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** X-Battery (0–100) and X-Charging (1) from the Kindle; null when absent (clients before 2026-11-06) or invalid. */
export function batteryFrom(req: FastifyRequest): Battery | null {
  const level = req.headers['x-battery'];
  if (typeof level !== 'string' || !/^\d{1,3}$/.test(level) || Number(level) > 100) return null;
  return { level: Number(level), charging: req.headers['x-charging'] === '1' };
}

function sendScreen(reply: FastifyReply, s: Screen): FastifyReply {
  reply.header('Content-Type', 'image/png').header('ETag', s.etag).header('X-Refresh-Seconds', String(s.refreshSeconds)).header('Cache-Control', 'no-store');
  if (s.fullRefresh) reply.header('X-Full-Refresh', '1');
  return reply.send(s.png);
}

export function buildApp(opts: {
  dashboard: DashboardLike;
  deviceToken: string;
  previewPassword: string;
  /** Station names for the preview index. */
  stations?: string[];
  /** Commute destinations («Zur Arbeit», «Schule») for the preview index. */
  commutes?: string[];
  /** Called with the battery state the Kindle sends along with a screen request. */
  onBattery?: (b: Battery) => void;
  /** The status page under /preview/status. */
  statusHtml?: () => string;
  /** Duty roster upload from the iOS shortcut; absent = no route. */
  roster?: { token: string; receive(pdf: Buffer): Promise<{ status: number; text: string }> };
  logger?: boolean;
  /** For tests. */
  now?: () => number;
}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false });
  const now = opts.now ?? Date.now;

  app.addHook('onSend', async (req, reply) => {
    reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (req.url.startsWith('/preview')) {
      // Previews show calendar entries and the shopping list: never cache them anywhere.
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Security-Policy', PREVIEW_CSP);
    }
  });

  const bearerAuth = (expected: string) => async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, expected)) return reply.code(401).send();
  };
  const deviceAuth = bearerAuth(opts.deviceToken);

  // Global, not per client: behind the proxy every request comes from the same address. A lockout
  // also locks out the owner for a while, which is acceptable for a preview.
  let failures: number[] = [];
  const previewAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    failures = failures.filter((t) => now() - t < PREVIEW_LOCK_MS);
    if (failures.length >= PREVIEW_MAX_FAILURES) {
      return reply.code(429).header('Retry-After', String(Math.ceil((failures[0]! + PREVIEW_LOCK_MS - now()) / 1000))).send();
    }
    const header = req.headers.authorization ?? '';
    const decoded = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
    const sep = decoded.indexOf(':');
    const ok = sep > 0 && safeEqual(decoded.slice(0, sep), 'admin') && safeEqual(decoded.slice(sep + 1), opts.previewPassword);
    if (!ok) {
      // A request without credentials is the browser asking for the login dialog, not a guess.
      if (header !== '') failures.push(now());
      return reply.code(401).header('WWW-Authenticate', 'Basic realm="kindle-dashboard"').send();
    }
  };

  app.setErrorHandler((err: unknown, req, reply) => {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, '<url>');
    const code = (err as { statusCode?: unknown } | null)?.statusCode;
    const clientError = typeof code === 'number' && code >= 400 && code <= 499;
    if (clientError) {
      req.log.warn({ msg });
      return reply.code(code).send({ error: 'bad request' });
    }
    req.log.error({ msg });
    return reply.code(500).send({ error: 'internal error' });
  });

  app.get('/healthz', async () => 'ok');

  app.get('/screen.png', { onRequest: deviceAuth }, async (req, reply) => {
    const battery = batteryFrom(req);
    if (battery) opts.onBattery?.(battery);
    return sendScreen(reply, await opts.dashboard.screen());
  });

  app.post<{ Body: { x: number; y: number; hold?: boolean } }>(
    '/tap',
    {
      onRequest: deviceAuth,
      schema: {
        body: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'integer', minimum: 0, maximum: SCREEN.width - 1 },
            y: { type: 'integer', minimum: 0, maximum: SCREEN.height - 1 },
            // A long press (since client 2026-11-05); older clients only send taps.
            hold: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const s = await opts.dashboard.tap(req.body.x, req.body.y, req.body.hold === true);
      return s ? sendScreen(reply, s) : reply.code(204).send();
    },
  );

  if (opts.roster) {
    const roster = opts.roster;
    // The shortcut sends the file as it is; some versions of Shortcuts call it octet-stream.
    app.addContentTypeParser(['application/pdf', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: ROSTER_MAX_BYTES }, (_req, body, done) => done(null, body));
    app.post('/dienstplan', { onRequest: bearerAuth(roster.token), bodyLimit: ROSTER_MAX_BYTES }, async (req, reply) => {
      // Text and JSON have parsers of their own and arrive here as string or object.
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send();
      const r = await roster.receive(req.body);
      return reply.code(r.status).header('Content-Type', 'text/plain; charset=utf-8').send(r.text);
    });
  }

  app.get('/preview', { onRequest: previewAuth }, async (_req, reply) => reply.header('Content-Type', 'text/html; charset=utf-8').send(previewIndex(opts.stations ?? [], opts.commutes ?? [])));

  app.get('/preview/status', { onRequest: previewAuth }, async (_req, reply) => {
    if (!opts.statusHtml) return reply.code(404).send();
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(opts.statusHtml());
  });

  app.get('/preview/nacht', { onRequest: previewAuth }, async (_req, reply) =>
    reply.header('Content-Type', 'text/html; charset=utf-8').send(nachtPreviewHtml(Object.entries(HOLIDAYS).map(([id, h]) => ({ id, text: h.text })))),
  );

  app.get<{
    Params: { view: string };
    Querystring: { png?: string; station?: string; abend?: string; nacht?: string; gast?: string; akku?: string; laden?: string; nebel?: string; mond?: string; feiertag?: string; stau?: string; ziel?: string; schule?: string; dienst?: string };
  }>(
    '/preview/:view',
    { onRequest: previewAuth },
    async (req, reply) => {
      const view = req.params.view as ViewName;
      if (!VIEWS.includes(view)) return reply.code(404).send();
      const station = req.query.station;
      if (station !== undefined && !/^\d{1,2}$/.test(station)) return reply.code(400).send();
      const ziel = req.query.ziel;
      if (ziel !== undefined && !/^\d$/.test(ziel)) return reply.code(400).send();
      const { mond, feiertag } = req.query;
      if (mond !== undefined && !(/^\d{1,3}$/.test(mond) && Number(mond) < 360)) return reply.code(400).send();
      if (feiertag !== undefined && !Object.hasOwn(HOLIDAYS, feiertag)) return reply.code(400).send();
      const dienst = req.query.dienst;
      if (dienst !== undefined && dienst !== 'arbeit' && dienst !== 'schule') return reply.code(400).send();
      const previewOpts: PreviewOptions = {
        station: station === undefined ? undefined : Number(station),
        evening: req.query.abend === '1',
        night: req.query.nacht === '1',
        guest: req.query.gast === '1',
        lowBattery: req.query.akku === '1',
        charging: req.query.laden === '1',
        moon: mond === undefined ? undefined : Number(mond),
        holiday: feiertag as HolidayId | undefined,
        jam: req.query.stau === '1',
        commute: ziel === undefined ? undefined : Number(ziel),
        school: req.query.schule === '1',
        fog: req.query.nebel === '1',
        shift: dienst === 'arbeit' ? 'work' : dienst === 'schule' ? 'school' : undefined,
      };
      if (req.query.png === '1') return reply.header('Content-Type', 'image/png').send(await opts.dashboard.previewPng(view, previewOpts));
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(await opts.dashboard.previewHtml(view, previewOpts));
    },
  );

  return app;
}
