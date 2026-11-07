import {
  BatteryLow,
  Briefcase,
  Cake,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Delete,
  Egg,
  Lock,
  Motorbike,
  Moon,
  Newspaper,
  PartyPopper,
  Package,
  Plus,
  RefreshCw,
  School,
  ShoppingCart,
  Sun,
  Sunrise,
  Sunset,
  TreePine,
  Umbrella,
  Waves,
  X,
} from 'lucide-static';
import type { IconName } from '../sources/wmo.js';

/** «run» from Tabler Icons 3.50 (MIT License, Copyright (c) 2020-2026 Paweł Kuna); Lucide has no runner. */
const Run =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-run">' +
  '<path d="M11.007 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M4 17l5 1l.75 -1.5" /><path d="M15 21v-4l-4 -3l1 -6" /><path d="M7 12v-3l5 -1l3 3l3 1" /></svg>';

/** Swiss flag for 1 August: white cross on a dark square (red is a dark grey on e-ink anyway). */
const Swiss =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-swiss"><rect x="2" y="2" width="20" height="20" rx="3" fill="currentColor" stroke="none"/><path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#fff" stroke="none"/></svg>';

export type UiIcon = IconName | 'umbrella' | 'waves' | 'cart' | 'plus' | 'delete' | 'x' | 'check' | 'refresh' | 'paper' | 'cardboard' | 'sunrise' | 'sunset' | 'lock' | 'cake' | 'circle' | 'run' | 'battery-low' | 'scooter' | 'party' | 'egg' | 'swiss' | 'tree' | 'chevron-left' | 'chevron-right' | 'briefcase' | 'school';

const SVGS: Record<UiIcon, string> = {
  sun: Sun,
  'cloud-sun': CloudSun,
  cloud: Cloud,
  'cloud-fog': CloudFog,
  'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain,
  'cloud-snow': CloudSnow,
  'cloud-lightning': CloudLightning,
  moon: Moon,
  'cloud-moon': CloudMoon,
  umbrella: Umbrella,
  waves: Waves,
  cart: ShoppingCart,
  plus: Plus,
  delete: Delete,
  x: X,
  check: Check,
  refresh: RefreshCw,
  paper: Newspaper,
  cardboard: Package,
  sunrise: Sunrise,
  sunset: Sunset,
  lock: Lock,
  cake: Cake,
  circle: Circle,
  run: Run,
  'battery-low': BatteryLow,
  scooter: Motorbike,
  party: PartyPopper,
  egg: Egg,
  swiss: Swiss,
  tree: TreePine,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  briefcase: Briefcase,
  school: School,
};

/** Lucide SVG resized, with a heavier stroke for e-ink. */
export function iconSvg(name: UiIcon, size: number): string {
  return SVGS[name]
    .replace(/\s+/g, ' ')
    .replace('width="24"', `width="${size}"`)
    .replace('height="24"', `height="${size}"`)
    .replace('stroke-width="2"', 'stroke-width="2.5"')
    .trim();
}
