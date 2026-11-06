import qrcode from 'qrcode-generator';
import type { GuestWifi } from '../config.js';
import { SCALE } from '../render/screen.js';

/** Special characters of the WIFI: payload are escaped with a backslash. */
const escape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');

/** The payload phones understand to join a network (ZXing «WIFI:» format). */
export function wifiPayload(w: GuestWifi): string {
  return w.password === '' ? `WIFI:T:nopass;S:${escape(w.ssid)};;` : `WIFI:T:WPA;S:${escape(w.ssid)};P:${escape(w.password)};;`;
}

/** UTF-8 bytes as a string of char codes 0–255: the library encodes one byte per character. */
const utf8 = (s: string) => String.fromCharCode(...new TextEncoder().encode(s));

/**
 * QR code as an SVG about `screenPx` device pixels wide with a 4-module quiet zone. Each module is a
 * whole number of device pixels and drawn with crisp edges, so e-ink gets clean squares; error
 * correction M survives some ghosting.
 */
export function qrSvg(text: string, screenPx: number): string {
  const qr = qrcode(0, 'M');
  qr.addData(utf8(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const total = n + 8;
  const size = (total * Math.max(1, Math.floor(screenPx / total))) / SCALE;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
