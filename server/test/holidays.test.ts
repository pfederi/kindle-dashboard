import { describe, expect, it } from 'vitest';
import { easterSunday, holidayOn } from '../src/holidays.js';

const at = (iso: string) => new Date(`${iso}T12:00:00+01:00`);

describe('holidays', () => {
  it('computes Easter Sunday', () => {
    expect([2024, 2025, 2026, 2027, 2038].map(easterSunday)).toEqual(['03-31', '04-20', '04-05', '03-28', '04-25']);
  });

  it('greets only New Year, Easter Sunday and Monday, 1 August and 24–26 December', () => {
    const greeted = (iso: string) => holidayOn(at(iso))?.text ?? null;
    expect(greeted('2027-01-01')).toBe('Frohes neues Jahr!');
    expect([greeted('2026-04-05'), greeted('2026-04-06'), greeted('2026-04-03')]).toEqual(['Frohe Ostern!', 'Frohe Ostern!', null]);
    expect(greeted('2026-08-01')).toBe('Schönen 1. August!');
    expect(['12-23', '12-24', '12-25', '12-26', '12-27', '12-31'].map((d) => greeted(`2026-${d}`))).toEqual([null, 'Frohe Weihnachten!', 'Frohe Weihnachten!', 'Frohe Weihnachten!', null, null]);
  });
});
