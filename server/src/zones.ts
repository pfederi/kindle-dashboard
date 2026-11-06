export interface Zone {
  /** Action of a tap; '' for a zone that only reacts to a long press. */
  action: string;
  /** Action of a long press, if any. */
  hold?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Action of the smallest zone containing (x, y) that reacts to a tap (or a long press), or null. */
export function hitTest(zones: Zone[], x: number, y: number, hold = false): string | null {
  let best: Zone | null = null;
  for (const z of zones) {
    const action = hold ? z.hold : z.action;
    const inside = x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
    if (action && inside && (best === null || z.w * z.h < best.w * best.h)) best = z;
  }
  return (hold ? best?.hold : best?.action) ?? null;
}
