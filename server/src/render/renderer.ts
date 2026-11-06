import { type Browser, chromium } from 'playwright';
import type { Zone } from '../zones.js';
import { toGray16 } from './quantize.js';
import { LAYOUT, SCALE, SCREEN } from './screen.js';

export { LAYOUT, SCALE, SCREEN, toGray16 };

export interface Renderer {
  render(html: string): Promise<{ png: Buffer; zones: Zone[] }>;
  close(): Promise<void>;
}

export class PlaywrightRenderer implements Renderer {
  private constructor(private browser: Browser) {}

  static async launch(): Promise<PlaywrightRenderer> {
    return new PlaywrightRenderer(await chromium.launch());
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser.isConnected()) this.browser = await chromium.launch();
    return this.browser;
  }

  async render(html: string): Promise<{ png: Buffer; zones: Zone[] }> {
    const browser = await this.ensureBrowser();
    const page = await browser.newPage({ viewport: { ...LAYOUT }, deviceScaleFactor: SCALE });
    try {
      // Pages are self-contained (fonts as data URLs); block every network request as a second
      // line of defence should text from a data source ever end up as markup.
      await page.route(
        (url) => url.protocol !== 'data:' && url.protocol !== 'about:',
        (route) => route.abort(),
      );
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const zones = await page.$$eval('[data-action],[data-hold]', (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const { action, hold } = (el as HTMLElement).dataset;
          return { action: action ?? '', ...(hold ? { hold } : {}), x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      const shot = await page.screenshot({ type: 'png' });
      // Zones in device px, the coordinates the Kindle sends with a tap.
      const scaled = zones.map((z) => ({ ...z, x: z.x * SCALE, y: z.y * SCALE, w: z.w * SCALE, h: z.h * SCALE }));
      return { png: await toGray16(shot), zones: scaled.filter((z) => (z.action !== '' || z.hold) && z.w > 0 && z.h > 0) };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
