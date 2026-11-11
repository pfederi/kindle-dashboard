import { formatTime, formatWeekday } from '../format.js';
import { monthLabel, type Roster } from './parse.js';
import { SHIFT_LABEL, shiftOn } from './shift.js';

const dayMonth = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

/** «November 2026: 10× Arbeit, 9× Schule, 11× frei. Nächster Dienst: Fr 13.11. Arbeit 13:30–22:30» */
export function summarize(roster: Roster, now: Date): string {
  const [year, month] = roster.month.split('-').map(Number) as [number, number];
  const days = Object.entries(roster.days)
    .map(([d, day]) => ({ date: new Date(year, month - 1, Number(d)), day }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const count = (kind: string) => days.filter((d) => d.day.kind === kind).length;
  const head = `${monthLabel(roster.month)}: ${count('work')}× Arbeit, ${count('school')}× Schule, ${count('free')}× frei.`;
  const next = days.map((d) => shiftOn(d.day, d.date)).find((s) => s !== null && s.start >= now);
  if (!next) return head;
  return `${head} Nächster Dienst: ${formatWeekday(next.start)} ${dayMonth(next.start)} ${SHIFT_LABEL[next.kind]} ${formatTime(next.start)}–${formatTime(next.end)}`;
}
