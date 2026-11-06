export type IconName =
  | 'sun'
  | 'cloud-sun'
  | 'cloud'
  | 'cloud-fog'
  | 'cloud-drizzle'
  | 'cloud-rain'
  | 'cloud-snow'
  | 'cloud-lightning'
  | 'moon'
  | 'cloud-moon';

export interface WmoInfo {
  text: string;
  icon: IconName;
}

const TABLE: Record<number, WmoInfo> = {
  0: { text: 'Klar', icon: 'sun' },
  1: { text: 'Überwiegend klar', icon: 'sun' },
  2: { text: 'Teilweise bewölkt', icon: 'cloud-sun' },
  3: { text: 'Bewölkt', icon: 'cloud' },
  45: { text: 'Nebel', icon: 'cloud-fog' },
  48: { text: 'Nebel mit Reif', icon: 'cloud-fog' },
  51: { text: 'Leichter Niesel', icon: 'cloud-drizzle' },
  53: { text: 'Niesel', icon: 'cloud-drizzle' },
  55: { text: 'Starker Niesel', icon: 'cloud-drizzle' },
  56: { text: 'Gefrierender Niesel', icon: 'cloud-drizzle' },
  57: { text: 'Gefrierender Niesel', icon: 'cloud-drizzle' },
  61: { text: 'Leichter Regen', icon: 'cloud-rain' },
  63: { text: 'Regen', icon: 'cloud-rain' },
  65: { text: 'Starker Regen', icon: 'cloud-rain' },
  66: { text: 'Gefrierender Regen', icon: 'cloud-rain' },
  67: { text: 'Gefrierender Regen', icon: 'cloud-rain' },
  71: { text: 'Leichter Schneefall', icon: 'cloud-snow' },
  73: { text: 'Schneefall', icon: 'cloud-snow' },
  75: { text: 'Starker Schneefall', icon: 'cloud-snow' },
  77: { text: 'Schneegriesel', icon: 'cloud-snow' },
  80: { text: 'Regenschauer', icon: 'cloud-rain' },
  81: { text: 'Regenschauer', icon: 'cloud-rain' },
  82: { text: 'Starke Regenschauer', icon: 'cloud-rain' },
  85: { text: 'Schneeschauer', icon: 'cloud-snow' },
  86: { text: 'Starke Schneeschauer', icon: 'cloud-snow' },
  95: { text: 'Gewitter', icon: 'cloud-lightning' },
  96: { text: 'Gewitter mit Hagel', icon: 'cloud-lightning' },
  99: { text: 'Gewitter mit Hagel', icon: 'cloud-lightning' },
};

export function describeWmo(code: number | null): WmoInfo {
  return (code !== null ? TABLE[code] : undefined) ?? { text: 'Unbekannt', icon: 'cloud' };
}

/** Night variant of a weather icon: the moon instead of the sun. */
export function atNight(icon: IconName): IconName {
  return icon === 'sun' ? 'moon' : icon === 'cloud-sun' ? 'cloud-moon' : icon;
}
