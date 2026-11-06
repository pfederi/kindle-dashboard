import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CSS } from './styles.js';

const require = createRequire(import.meta.url);

const FONTS: [family: string, weight: number, file: string][] = [
  ['Inter', 400, '@fontsource/inter/files/inter-latin-400-normal.woff2'],
  ['Inter', 700, '@fontsource/inter/files/inter-latin-700-normal.woff2'],
  ['Source Serif 4', 700, '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2'],
];

let fontCss: string | null = null;

function fontFaces(): string {
  fontCss ??= FONTS.map(([family, weight, file]) => {
    const data = readFileSync(require.resolve(file)).toString('base64');
    return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`;
  }).join('\n');
  return fontCss;
}

export function page(markup: string): string {
  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8"><style>${fontFaces()}\n${CSS}</style></head><body>${markup}</body></html>`;
}
