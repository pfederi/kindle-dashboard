/**
 * A short Instagram reel (1080 × 1920, 30 fps) of the dashboard on a wall, with a finger tapping through
 * the views: `npm run reel` → dist/kindle-dashboard-reel.mp4. Screens are rendered from the demo data at
 * layout resolution (1072 px wide, 16 gray levels) so the text stays sharp. Needs ffmpeg on the PATH.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { LAYOUT } from '../src/render/screen.js';
import { toGray16 } from '../src/render/quantize.js';
import type { Renderer } from '../src/render/renderer.js';
import type { ShoppingData } from '../src/sources/bring/source.js';
import { einkaufHtml } from '../src/views/einkauf.js';
import { hinzufuegenHtml } from '../src/views/hinzufuegen.js';
import { page as wrap } from '../src/views/page.js';
import { BIRTHDAY_EVENTS, dashboard, EVENTS, FREQUENT, SHOPPING } from './demo.js';

const OUT_DIR = new URL('../../dist/', import.meta.url);
const OUT = new URL('kindle-dashboard-reel.mp4', OUT_DIR);
const FPS = 30;
const W = 1080;
const H = 1920;

// Stage geometry: the Kindle nearly fills the width; its screen shows the layout at 860 px.
const DEVICE = { x: 50, y: 400, w: 980, h: 1356 };
const SCREEN = { x: DEVICE.x + 60, y: DEVICE.y + 80, w: 860, h: Math.round((860 * LAYOUT.height) / LAYOUT.width) };
const toStage = (p: { x: number; y: number }) => ({ x: SCREEN.x + (p.x * SCREEN.w) / LAYOUT.width, y: SCREEN.y + (p.y * SCREEN.h) / LAYOUT.height });

// --- Screens -------------------------------------------------------------------------------------

const noRender: Renderer = { render: async () => Promise.reject(new Error('not used')), close: async () => {} };
const MORNING = '2026-11-03T07:40:00+01:00';
const day = dashboard(noRender, MORNING);
const more = ['Butter', 'Käse', 'Tomaten', 'Bananen'].map((n) => ({ key: n, name: n, spec: '', urgent: false }));
const items = SHOPPING.ok ? SHOPPING.items : [];
const shopping = (kaffeeUrgent: boolean): ShoppingData => ({
  ok: true,
  listName: 'Zuhause',
  items: [...items.map((i) => ({ ...i, urgent: i.key === 'Kaffee' && kaffeeUrgent })), ...more],
});

const SCREENS: Record<string, () => Promise<string>> = {
  heute: () => day.previewHtml('heute'),
  wetter: () => day.previewHtml('wetter'),
  station: () => day.previewHtml('station', { station: 2 }),
  woche: () => day.previewHtml('woche'),
  einkauf: async () => einkaufHtml({ shopping: shopping(false) }),
  dringend: async () => einkaufHtml({ shopping: shopping(true) }),
  hinzufuegen: async () => hinzufuegenHtml({ input: '', suggestions: [], frequent: FREQUENT, status: null, mode: 'einkauf', tabs: true }),
  erfasst: async () =>
    hinzufuegenHtml({ input: '', suggestions: [], frequent: FREQUENT, added: ['tomaten'], status: { text: 'Tomaten erfasst', ok: true }, mode: 'einkauf', tabs: true, urgentOffer: true }),
  aufgaben: () => dashboard(noRender, MORNING, EVENTS, [], ['Staubsaugen', 'Pflanzen giessen', 'Abfall entsorgen']).previewHtml('heute'),
  geburtstag: () => dashboard(noRender, MORNING, BIRTHDAY_EVENTS, [{ name: 'Anna', date: '11-03' }]).previewHtml('heute'),
  nacht: () => day.previewHtml('heute', { night: true }),
};

/** What gets tapped on which screen (center of the element, in layout px). */
const TARGETS: Record<string, string> = {
  'heute:weather': '.wxblock .wx',
  'heute:station': '[data-action="station:2"] .dep',
  'heute:agenda': '.agenda .events .ev:nth-child(2) .ev-title',
  'wetter:close': '.close',
  'station:close': '.close',
  'woche:einkauf': '.tabs [data-action="nav:einkauf"]',
  'einkauf:urgent': '[data-action="urgent:Kaffee"]',
  'dringend:add': '.btn.wide',
  'hinzufuegen:tomaten': '[data-action="add:Tomaten"]',
  'erfasst:close': '.close',
};

async function renderScreens(p: Page): Promise<{ images: Record<string, string>; targets: Record<string, { x: number; y: number }> }> {
  const images: Record<string, string> = {};
  const targets: Record<string, { x: number; y: number }> = {};
  for (const [name, html] of Object.entries(SCREENS)) {
    await p.setContent(await html(), { waitUntil: 'load' });
    await p.evaluate(async () => {
      await document.fonts.ready;
    });
    images[name] = `data:image/png;base64,${(await toGray16(await p.screenshot({ type: 'png' }))).toString('base64')}`;
    for (const [key, sel] of Object.entries(TARGETS).filter(([k]) => k.startsWith(`${name}:`))) {
      const r = await p.locator(sel).first().boundingBox();
      if (!r) throw new Error(`no target ${key} (${sel})`);
      targets[key] = toStage({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    }
  }
  return { images, targets };
}

// --- Timeline ------------------------------------------------------------------------------------

interface Switch {
  t: number;
  screen: string;
  /** Full e-ink refresh: black, then white, then the new image. */
  flash: boolean;
}
interface Tap {
  t: number;
  x: number;
  y: number;
}
interface Caption {
  t: number;
  text: string;
}

const CAPTIONS: Record<string, string> = {
  heute: 'Der Tag auf einen Blick',
  wetter: 'Wetter für die nächsten 24 Stunden',
  station: 'Abfahrten mit Losgeh-Zeit',
  woche: 'Die nächsten sieben Tage',
  einkauf: 'Die Einkaufsliste aus Bring!',
  dringend: 'Dringend – mit einem Tipp',
  hinzufuegen: 'Erfassen direkt am Kindle',
  erfasst: 'Erfasst – auch gleich dringend',
  aufgaben: 'Aufgaben, bis sie erledigt sind',
  geburtstag: 'Geburtstage gross im Bild',
  nacht: 'Nachts ganz ruhig',
};

function timeline(targets: Record<string, { x: number; y: number }>) {
  const switches: Switch[] = [{ t: 0, screen: 'heute', flash: false }];
  const taps: Tap[] = [];
  const captions: Caption[] = [{ t: 0.2, text: CAPTIONS.heute! }];
  let t = 2.6;
  let current = 'heute';
  const show = (screen: string, flash: boolean, at: number, hold: number) => {
    switches.push({ t: at, screen, flash });
    captions.push({ t: at + (flash ? 0.2 : 0.05), text: CAPTIONS[screen]! });
    current = screen;
    t = at + hold;
  };
  const tap = (target: string, next: string, flash = true, hold = 2.4) => {
    const p = targets[`${current}:${target}`];
    if (!p) throw new Error(`no target ${current}:${target}`);
    const press = t + 0.8;
    taps.push({ t: press, ...p });
    show(next, flash, press + 0.25, hold);
  };
  tap('weather', 'wetter', true, 2.8);
  tap('close', 'heute', true, 1.6);
  tap('station', 'station', true, 2.6);
  tap('close', 'heute', true, 1.6);
  tap('agenda', 'woche', true, 2.6);
  tap('einkauf', 'einkauf', true, 2.2);
  tap('urgent', 'dringend', false, 2.4);
  tap('add', 'hinzufuegen', true, 2.0);
  tap('tomaten', 'erfasst', false, 2.4);
  tap('close', 'aufgaben', true, 3.0);
  show('geburtstag', true, t, 2.8);
  show('nacht', true, t, 3.0);
  return { switches, taps, captions, duration: t };
}

// --- Stage ---------------------------------------------------------------------------------------

/**
 * How a tap is shown: «hand» = the 3D hand of Microsoft Fluent Emoji (MIT, see assets/) moving in;
 * «pointer» = Lucide's pointing hand; «dot» = a touch dot only.
 */
const TOUCH = (process.env.REEL_TOUCH ?? 'hand') as 'hand' | 'pointer' | 'dot';
/** The 256 px emoji shown at 370 px; its fingertip is at (100, 22) in the image. */
const EMOJI = { src: `data:image/png;base64,${readFileSync(new URL('assets/fluent-backhand-index-pointing-up.png', import.meta.url)).toString('base64')}`, size: 370, tip: { x: 100, y: 22 } };
const EMOJI_HAND = `<img id="handImg" src="${EMOJI.src}" style="position:absolute;left:0;top:0;width:${EMOJI.size}px;height:${EMOJI.size}px;
  transform-origin:${(EMOJI.tip.x * EMOJI.size) / 256}px ${(EMOJI.tip.y * EMOJI.size) / 256}px;filter:drop-shadow(14px 22px 18px rgba(40,25,10,.35));display:none">`;

/** Lucide «pointer», white with a black outline; its fingertip (8, 2) is moved to (0, 0). */
const POINTER_PATHS = [
  'M22 14a8 8 0 0 1-8 8',
  'M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
  'M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1',
  'M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10',
  'M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
];
const POINTER_SCALE = 11;
const HAND = `
<svg id="hand" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">
  <defs><filter id="drop" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="10" dy="16" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter></defs>
  <g id="handG" filter="url(#drop)">
    <g transform="scale(${POINTER_SCALE}) translate(-8 -2)" stroke-linecap="round" stroke-linejoin="round">
      <path fill="#fff" stroke="none" d="M6 14V4a2 2 0 0 1 4 0v4.5a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v1a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L6 14Z"/>
      ${POINTER_PATHS.map((d) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="4.2"/>`).join('')}
      ${POINTER_PATHS.map((d) => `<path d="${d}" fill="none" stroke="#111" stroke-width="1.9"/>`).join('')}
    </g>
  </g>
</svg>`;

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.4 0 0 0 0 0.35 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E\")";

function stage(images: Record<string, string>): string {
  const imgs = Object.entries(images)
    .map(([name, src]) => `<img data-s="${name}" src="${src}">`)
    .join('');
  return wrap(`
<style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#ddd7ce}
  #wall{position:absolute;inset:0;background:${NOISE},radial-gradient(ellipse at 28% 18%,#f6f3ee 0%,#e6e0d7 55%,#d3ccc1 100%)}
  #cap{position:absolute;left:70px;right:70px;top:130px;height:230px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:'Source Serif 4';font-weight:700;font-size:66px;line-height:1.1;color:#1f1d1a;text-wrap:balance}
  #device{position:absolute;left:${DEVICE.x}px;top:${DEVICE.y}px;width:${DEVICE.w}px;height:${DEVICE.h}px;border-radius:48px;
    background:linear-gradient(155deg,#2c2c2c 0%,#151515 45%,#0c0c0c 100%);
    box-shadow:0 60px 100px rgba(50,35,20,.38),0 14px 28px rgba(0,0,0,.28),inset 0 2px 1px rgba(255,255,255,.10),inset 0 -2px 1px rgba(0,0,0,.6)}
  #screen{position:absolute;left:${SCREEN.x}px;top:${SCREEN.y}px;width:${SCREEN.w}px;height:${SCREEN.h}px;background:#ebeae4;overflow:hidden}
  #screen img{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply;visibility:hidden}
  #glass{position:absolute;left:${SCREEN.x}px;top:${SCREEN.y}px;width:${SCREEN.w}px;height:${SCREEN.h}px;box-shadow:inset 0 3px 8px rgba(0,0,0,.35);
    background:linear-gradient(125deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 35%)}
  #flash{position:absolute;inset:0;opacity:0}
  #ripple{position:absolute;border-radius:50%;box-sizing:border-box;opacity:0;
    ${TOUCH === 'dot' ? 'background:rgba(60,60,60,.42);border:6px solid rgba(255,255,255,.85);box-shadow:0 6px 18px rgba(0,0,0,.25)' : 'background:rgba(0,0,0,.16);border:5px solid rgba(0,0,0,.45)'}}
  #brand{position:absolute;left:0;right:0;top:${DEVICE.y + DEVICE.h + 52}px;text-align:center;font-family:Inter;font-weight:700;font-size:34px;letter-spacing:.08em;text-transform:uppercase;color:#6b645a}
</style>
<div id="wall"></div>
<div id="cap"><span id="capText"></span></div>
<div id="device"></div>
<div id="screen">${imgs}<div id="flash"></div></div>
<div id="glass"></div>
<div id="ripple"></div>
<div id="brand">Kindle-Dashboard</div>
${TOUCH === 'pointer' ? HAND : TOUCH === 'hand' ? EMOJI_HAND : ''}`);
}

interface Frame {
  screen: string;
  flash: { color: string; opacity: number };
  caption: { text: string; opacity: number };
  hand: { x: number; y: number; visible: boolean; scale: number };
  ripple: { x: number; y: number; r: number; opacity: number };
  /** Offset of the emoji's fingertip within its image, in stage px. */
  emoji: { ox: number; oy: number };
}

const ease = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function frameAt(t: number, tl: ReturnType<typeof timeline>): Frame {
  // Screen and e-ink flash.
  let screen = 'heute';
  let flash = { color: '#111', opacity: 0 };
  for (const s of tl.switches) {
    if (t < s.t) break;
    const since = t - s.t;
    if (s.flash && since < 0.1) flash = { color: '#141414', opacity: 1 };
    else if (s.flash && since < 0.18) flash = { color: '#ebeae4', opacity: 1 };
    else flash = { color: '#111', opacity: 0 };
    screen = s.screen; // hidden by the flash while it lasts
  }
  // Caption fades in after each change.
  let caption = { text: '', opacity: 0 };
  for (const c of tl.captions) if (t >= c.t) caption = { text: c.text, opacity: ease((t - c.t) / 0.35) };
  // Finger: in from the lower right, press, out again; the ripple starts at the press.
  let hand = { x: 0, y: 0, visible: false, scale: 1 };
  let ripple = { x: 0, y: 0, r: 0, opacity: 0 };
  for (const p of tl.taps) {
    const d = t - p.t;
    if (d < -0.75 || d > 0.8) continue;
    const away = { x: p.x + 420, y: H + 260 };
    const hover = { x: p.x + 26, y: p.y + 70 };
    if (d < -0.15) {
      const k = ease((d + 0.75) / 0.6);
      hand = { x: lerp(away.x, hover.x, k), y: lerp(away.y, hover.y, k), visible: true, scale: 1 };
    } else if (d < 0) {
      const k = ease((d + 0.15) / 0.15);
      hand = { x: lerp(hover.x, p.x, k), y: lerp(hover.y, p.y, k), visible: true, scale: lerp(1, 0.97, k) };
    } else if (d < 0.14) {
      hand = { x: p.x, y: p.y, visible: true, scale: 0.97 };
    } else {
      const k = ease((d - 0.14) / 0.66);
      hand = { x: lerp(p.x, away.x, k), y: lerp(p.y, away.y, k), visible: true, scale: 1 };
    }
    if (TOUCH === 'dot') {
      if (d >= -0.12 && d < 0.3) ripple = { x: p.x, y: p.y, r: d < 0 ? lerp(30, 46, ease((d + 0.12) / 0.12)) : 46, opacity: 1 };
      else if (d >= 0.3 && d < 0.55) ripple = { x: p.x, y: p.y, r: lerp(46, 60, (d - 0.3) / 0.25), opacity: 1 - (d - 0.3) / 0.25 };
    } else if (d >= 0 && d < 0.5) ripple = { x: p.x, y: p.y, r: lerp(18, 78, ease(d / 0.5)), opacity: 1 - d / 0.5 };
  }
  return { screen, flash, caption, hand, ripple, emoji: { ox: (EMOJI.tip.x * EMOJI.size) / 256, oy: (EMOJI.tip.y * EMOJI.size) / 256 } };
}

async function apply(p: Page, f: Frame): Promise<void> {
  await p.evaluate((f) => {
    for (const img of document.querySelectorAll<HTMLImageElement>('#screen img')) img.style.visibility = img.dataset.s === f.screen ? 'visible' : 'hidden';
    const flash = document.getElementById('flash')!;
    flash.style.background = f.flash.color;
    flash.style.opacity = String(f.flash.opacity);
    const cap = document.getElementById('capText')!;
    cap.textContent = f.caption.text;
    cap.style.opacity = String(f.caption.opacity);
    const img = document.getElementById('handImg');
    if (img) {
      const s = f.emoji;
      img.style.display = f.hand.visible ? '' : 'none';
      img.style.transform = `translate(${f.hand.x - s.ox}px, ${f.hand.y - s.oy}px) rotate(-8deg) scale(${f.hand.scale})`;
    }
    const hand = document.getElementById('handG');
    if (hand) {
      hand.setAttribute('transform', `translate(${f.hand.x} ${f.hand.y}) rotate(-10) scale(${f.hand.scale})`);
      hand.style.display = f.hand.visible ? '' : 'none';
    }
    const r = document.getElementById('ripple')!;
    r.style.left = `${f.ripple.x - f.ripple.r}px`;
    r.style.top = `${f.ripple.y - f.ripple.r}px`;
    r.style.width = r.style.height = `${2 * f.ripple.r}px`;
    r.style.opacity = String(f.ripple.opacity);
  }, f);
}

// --- Run -----------------------------------------------------------------------------------------

const browser = await chromium.launch();
try {
  const screensPage = await browser.newPage({ viewport: { ...LAYOUT }, deviceScaleFactor: 1 });
  const { images, targets } = await renderScreens(screensPage);
  await screensPage.close();
  const tl = timeline(targets);

  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.setContent(stage(images), { waitUntil: 'load' });
  await p.evaluate(async () => {
    await document.fonts.ready;
  });

  // REEL_PREVIEW=dir: a few stills at the given seconds instead of the video.
  const preview = process.env.REEL_PREVIEW;
  if (preview) {
    mkdirSync(preview, { recursive: true });
    for (const s of (process.env.REEL_AT ?? '1').split(',').map(Number)) {
      await apply(p, frameAt(s, tl));
      await p.screenshot({ path: `${preview}/reel-${s.toFixed(2)}.png` });
    }
    console.log(`taps at ${tl.taps.map((x) => x.t.toFixed(2)).join(', ')}; ${tl.duration.toFixed(1)} s`);
    process.exit(0);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT.pathname],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)))));
  const frames = Math.ceil(tl.duration * FPS);
  for (let i = 0; i < frames; i++) {
    await apply(p, frameAt(i / FPS, tl));
    const png = await p.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (i % (FPS * 5) === 0) console.log(`${Math.round(i / FPS)} s / ${Math.round(tl.duration)} s`);
  }
  ffmpeg.stdin.end();
  await done;
  console.log(OUT.pathname);
} finally {
  await browser.close();
}
