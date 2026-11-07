/**
 * Moon phase from low-precision formulas for the ecliptic longitudes of sun and moon (accurate to about
 * a degree of elongation, i.e. a couple of hours); no network needed.
 */

export interface MoonPhase {
  /** Elongation of the moon from the sun in degrees, 0–360: 0 new, 90 first quarter, 180 full, 270 last quarter. */
  elongation: number;
  /** Illuminated fraction of the disc, 0–1. */
  illumination: number;
  waxing: boolean;
  name: string;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** The moon at `at`; `elongation` overrides the computed one (previews). */
export function moonPhase(at: Date, elongation?: number): MoonPhase {
  if (elongation !== undefined) {
    const e = norm(elongation);
    return { elongation: e, illumination: (1 - Math.cos(rad(e))) / 2, waxing: e < 180, name: phaseName(e) };
  }
  const d = (at.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000; // days since J2000.0
  const sunAnomaly = rad(357.5291 + 0.98560028 * d);
  const sunLon = 280.459 + 0.98564736 * d + 1.915 * Math.sin(sunAnomaly) + 0.02 * Math.sin(2 * sunAnomaly);
  const moonAnomaly = rad(134.963 + 13.064993 * d);
  const meanElong = rad(297.85 + 12.190749 * d);
  const moonLon =
    218.316 +
    13.176396 * d +
    6.289 * Math.sin(moonAnomaly) +
    1.274 * Math.sin(2 * meanElong - moonAnomaly) +
    0.658 * Math.sin(2 * meanElong) +
    0.214 * Math.sin(2 * moonAnomaly) -
    0.186 * Math.sin(sunAnomaly);
  const e = norm(moonLon - sunLon);
  return { elongation: e, illumination: (1 - Math.cos(rad(e))) / 2, waxing: e < 180, name: phaseName(e) };
}

/** The usual names; quarters and new/full moon get about a day either side. */
export function phaseName(e: number): string {
  if (e < 12 || e >= 348) return 'Neumond';
  if (e < 78) return 'Zunehmende Sichel';
  if (e < 102) return 'Zunehmender Halbmond';
  if (e < 168) return 'Zunehmender Mond';
  if (e < 192) return 'Vollmond';
  if (e < 258) return 'Abnehmender Mond';
  if (e < 282) return 'Abnehmender Halbmond';
  return 'Abnehmende Sichel';
}

/**
 * Lit part of a moon of radius r at (cx, cy) as an SVG path, as seen from the northern hemisphere: waxing
 * lit on the right. The limb is a half circle, the terminator a half ellipse of width r·|cos e|.
 */
export function litPath(e: number, cx: number, cy: number, r: number): string {
  const k = Math.cos(rad(e));
  const waxing = norm(e) < 180;
  const rx = Math.abs(k) * r;
  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;
  // Limb from top to bottom on the lit side; back up along the terminator, bulging out (gibbous) or in (crescent).
  const limbSweep = waxing ? 1 : 0;
  const gibbous = k < 0;
  const termSweep = waxing === gibbous ? 1 : 0;
  return `M${top}A${r} ${r} 0 0 ${limbSweep} ${bottom}A${rx.toFixed(2)} ${r} 0 0 ${termSweep} ${top}Z`;
}
