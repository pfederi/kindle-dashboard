import type { DayEntry } from '../sources/calendar.js';
import type { MainView, Notice } from '../state.js';
import { iconSvg, type UiIcon } from './icons.js';
import type { TaskItem } from './model.js';

export function Icon({ name, size }: { name: UiIcon; size: number }) {
  return <span class="icon" dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }} />;
}

/** Feedback banner: black with a check mark for success, outlined otherwise; optional «Rückgängig» or «Dringend» button. */
export function NoticeBar({ notice, undo, urgent }: { notice: Notice; undo?: boolean; urgent?: boolean }) {
  return (
    <div class={notice.ok ? 'notice ok' : 'notice'}>
      {notice.ok && <Icon name="check" size={40} />}
      <span class="ellipsis">{notice.text}</span>
      {undo && (
        <span class="undo" data-action="undo">
          Rückgängig
        </span>
      )}
      {urgent && (
        <span class="undo" data-action="urgent-added">
          <Icon name="run" size={40} /> Dringend
        </span>
      )}
    </div>
  );
}

const TABS: { view: MainView; label: string }[] = [
  { view: 'heute', label: 'Heute' },
  { view: 'woche', label: 'Woche' },
  { view: 'einkauf', label: 'Einkauf' },
];

export function Tabs({ active }: { active: MainView }) {
  return (
    <div class="tabs">
      {TABS.map((t) => (
        <div class={t.view === active ? 'tab on' : 'tab'} data-action={`nav:${t.view}`}>
          {t.label}
        </div>
      ))}
      <div class="tab" data-action="refresh">
        <Icon name="refresh" size={40} />
      </div>
    </div>
  );
}

/** Marks a list whose titles are hidden because of guest mode. */
export function GuestMark() {
  return (
    <span class="guest">
      <Icon name="lock" size={30} />
    </span>
  );
}

/** Low battery in the header: an empty battery and the level, in black so it stands out from «Stand». */
export function BatteryMark({ level }: { level: number }) {
  return (
    <span class="batt">
      <Icon name="battery-low" size={40} /> {level} %
    </span>
  );
}

/** «A», «A & B», «A, B & C». */
function names(list: string[]): string {
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`;
}

/** Big greeting with a cake, shown all day on a birthday; `compact` where space is short. */
export function BirthdayBanner({ birthdays, compact }: { birthdays: string[]; compact?: boolean }) {
  const cls = ['bday', compact ? 'sm' : '', birthdays.length > 1 ? 'many' : ''].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      <Icon name="cake" size={compact ? 46 : 80} />
      <span class="serif">Happy Birthday {names(birthdays)}!</span>
    </div>
  );
}

/** Event rows the birthday banner takes away (compact: one). */
export const BIRTHDAY_ROWS = 2;

/** Agenda rows the task box takes. */
export const TASK_ROWS = 1;

/** The newest open task in a box; tapping it ticks it off. Further tasks as «+ N». */
export function TaskBox({ tasks }: { tasks: TaskItem[] }) {
  const first = tasks[0];
  if (!first) return null;
  return (
    <div class="taskbox" data-action={`task:${first.key}`}>
      <Icon name="circle" size={38} />
      <span class="t ellipsis">{first.name}</span>
      {tasks.length > 1 && <span class="more-inline">+ {tasks.length - 1}</span>}
    </div>
  );
}

/** Opens «Hinzufügen» on the tab «Aufgabe»; the padding enlarges the tap area beyond the pill. */
export function AddTaskButton() {
  return (
    <span class="addtask" data-action="nav:aufgabe">
      <span class="pill">
        <Icon name="plus" size={28} /> Aufgabe
      </span>
    </span>
  );
}

export function LineBadge({ line, small }: { line: string; small?: boolean }) {
  const cls = ['line', line.startsWith('S') ? 'rail' : '', small ? 'sm' : ''].filter(Boolean).join(' ');
  return <span class={cls}>{line}</span>;
}

/**
 * Shows at most `max` rows; when there are more, the last row becomes «+ N weitere». With a
 * single row that row shows the first entry with «+ N» at its end.
 */
export function EventList({ entries, max }: { entries: DayEntry[]; max: number }) {
  const shown = entries.length > max ? entries.slice(0, Math.max(1, max - 1)) : entries;
  const rest = entries.length - shown.length;
  const inline = rest > 0 && max <= 1;
  return (
    <div class="events">
      {shown.map((e) => (
        <div class={e.past ? 'ev past' : 'ev'}>
          <span class="time">{e.label}</span>
          {e.waste ? (
            <span class="cal waste">
              <Icon name={e.waste} size={40} />
            </span>
          ) : (
            <span class="cal">{e.calendar}</span>
          )}
          {e.hidden ? <span class="ev-title hidden" /> : <span class="ev-title ellipsis">{e.title}</span>}
          {inline && <span class="more-inline">+ {rest}</span>}
        </div>
      ))}
      {rest > 0 && !inline && <div class="more">+ {rest} weitere</div>}
    </div>
  );
}
