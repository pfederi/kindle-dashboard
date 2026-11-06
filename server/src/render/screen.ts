/** Kindle 7th generation (WP63GW): 600 x 800 px at 167 ppi. The PNG is sent at this size. */
export const SCREEN = { width: 600, height: 800 } as const;

/** Views are laid out in CSS px at this size and drawn scaled down to SCREEN, so text is rasterised at the target size. */
export const LAYOUT = { width: 1072, height: Math.round((SCREEN.height * 1072) / SCREEN.width) } as const;

/** Device px per layout px. */
export const SCALE = SCREEN.width / LAYOUT.width;
