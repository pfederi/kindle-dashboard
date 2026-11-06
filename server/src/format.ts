const TZ = 'Europe/Zurich';

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function formatLongDate(d: Date): string {
  return d.toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
}

export function formatWeekday(d: Date): string {
  return d.toLocaleDateString('de-CH', { weekday: 'short', timeZone: TZ }).replace('.', '');
}

/** Calendar date in Zurich as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Local midnight. Relies on the process running with TZ=Europe/Zurich. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday 00:00 of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
}
