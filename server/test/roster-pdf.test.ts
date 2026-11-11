import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractPdf } from '../src/roster/pdf.js';
import { parseRoster } from '../src/roster/parse.js';
import { tinyPdf } from './fixtures/tiny-pdf.js';

describe('extractPdf', () => {
  it('reads words and filled areas in the same coordinates, through a flipped and scaled matrix (like the Excel export)', async () => {
    const page = await extractPdf(tinyPdf('q 0.5 0 0 -0.5 0 100 cm 0 0.69 0.94 rg 20 40 60 20 re f Q BT /F1 10 Tf 15 75 Td (07:30) Tj ET'));
    expect(page.words).toEqual([{ text: '07:30', x: 15, y: 75, w: expect.closeTo(25.02, 1) }]);
    expect(page.rects).toEqual([{ color: '#00b0f0', x0: 10, y0: 70, x1: 40, y1: 80 }]);
  });

  it('forgets matrix and colour after Q, skips stroked paths and blank text', async () => {
    const page = await extractPdf(tinyPdf('q 2 0 0 2 0 0 cm 0 0 1 rg Q 1 0 0 rg 0 0 10 10 re f 5 5 10 10 re S BT /F1 10 Tf 0 50 Td ( ) Tj ET'));
    expect(page.rects).toEqual([{ color: '#ff0000', x0: 0, y0: 0, x1: 10, y1: 10 }]);
    expect(page.words).toEqual([]);
  });

  it('takes a Node Buffer, as Fastify delivers it', async () => {
    const page = await extractPdf(Buffer.from(tinyPdf('BT /F1 10 Tf 15 75 Td (K) Tj ET')));
    expect(page.words.map((w) => w.text)).toEqual(['K']);
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(extractPdf(new TextEncoder().encode('hallo'))).rejects.toThrow();
  });

  // Local check against a real plan: ROSTER_SAMPLE_PDF=… ROSTER_SAMPLE_NAME=… npm test -- roster-pdf
  it.skipIf(!process.env.ROSTER_SAMPLE_PDF)('reads a real plan', async () => {
    const page = await extractPdf(readFileSync(process.env.ROSTER_SAMPLE_PDF!));
    const roster = parseRoster(page, process.env.ROSTER_SAMPLE_NAME ?? '');
    expect(Object.values(roster.days).some((d) => d.kind !== 'free')).toBe(true);
  });
});
