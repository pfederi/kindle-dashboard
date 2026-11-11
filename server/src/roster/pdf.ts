import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** A word on the page in PDF points from the bottom left; y is the baseline. */
export interface PdfWord {
  text: string;
  x: number;
  y: number;
  w: number;
}

/** A filled area (its bounding box) with its colour as #rrggbb. */
export interface PdfRect {
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfPage {
  words: PdfWord[];
  rects: PdfRect[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` after `n`, as PDF's «cm» composes: points go through `n` first. */
const compose = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0]! + m[2] * n[1]!,
  m[1] * n[0]! + m[3] * n[1]!,
  m[0] * n[2]! + m[2] * n[3]!,
  m[1] * n[2]! + m[3] * n[3]!,
  m[0] * n[4]! + m[2] * n[5]! + m[4],
  m[1] * n[4]! + m[3] * n[5]! + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Words and filled areas of the first page, both in page coordinates. pdfjs already places text in
 * page space; for paths it reports boxes before the current matrix, so save/restore/cm are tracked here.
 */
export async function extractPdf(bytes: Uint8Array): Promise<PdfPage> {
  // A copy: pdfjs rejects Node Buffers and may detach what it is given.
  const task = getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const words: PdfWord[] = [];
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      words.push({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], w: item.width });
    }
    const ops = await page.getOperatorList();
    const rects: PdfRect[] = [];
    let ctm: Matrix = IDENTITY;
    let fill: string | null = null;
    const stack: { ctm: Matrix; fill: string | null }[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push({ ctm, fill });
      else if (fn === OPS.restore) ({ ctm, fill } = stack.pop() ?? { ctm: IDENTITY, fill: null });
      else if (fn === OPS.transform) ctm = compose(ctm, args as number[]);
      else if (fn === OPS.setFillRGBColor) fill = String(args[0]).toLowerCase();
      else if (fn === OPS.constructPath && fill && (args[0] === OPS.fill || args[0] === OPS.eoFill)) {
        const [minX, minY, maxX, maxY] = args[2] as number[];
        const [ax, ay] = apply(ctm, minX!, minY!);
        const [bx, by] = apply(ctm, maxX!, maxY!);
        rects.push({ color: fill, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
      }
    }
    return { words, rects };
  } finally {
    await task.destroy();
  }
}
