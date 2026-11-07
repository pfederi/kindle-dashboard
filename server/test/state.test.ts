import { describe, expect, it } from 'vitest';
import { applyKey, initialState, KEYS, maybeReset, navigate, parseAction, refreshSeconds, takeFullRefresh } from '../src/state.js';

describe('parseAction', () => {
  it('parses all action strings', () => {
    expect(parseAction('nav:woche')).toEqual({ type: 'nav', view: 'woche' });
    expect(parseAction('nav:hinzufuegen')).toEqual({ type: 'nav', view: 'hinzufuegen' });
    expect(parseAction('refresh')).toEqual({ type: 'refresh' });
    expect(parseAction('key:ä')).toEqual({ type: 'key', key: 'ä' });
    expect(parseAction('key:space')).toEqual({ type: 'key', key: 'space' });
    expect(parseAction('add:input')).toEqual({ type: 'add-input' });
    expect(parseAction('add:Crème: fraîche')).toEqual({ type: 'add', name: 'Crème: fraîche' });
    expect(parseAction('close')).toEqual({ type: 'close' });
    expect(parseAction('done:Milch')).toEqual({ type: 'done', key: 'Milch' });
    expect(parseAction('done:Crème: fraîche')).toEqual({ type: 'done', key: 'Crème: fraîche' });
    expect(parseAction('undo')).toEqual({ type: 'undo' });
    expect(parseAction('guest')).toEqual({ type: 'guest' });
    expect(parseAction('nav:aufgabe')).toEqual({ type: 'nav', view: 'hinzufuegen', mode: 'aufgabe' });
    expect(parseAction('task:Glas & PET: Keller')).toEqual({ type: 'task', key: 'Glas & PET: Keller' });
    expect(parseAction('task:')).toBeNull();
    expect(parseAction('tab:aufgabe')).toEqual({ type: 'tab', mode: 'aufgabe' });
    expect(parseAction('tab:einkauf')).toEqual({ type: 'tab', mode: 'einkauf' });
    expect(parseAction('tab:x')).toBeNull();
    expect(parseAction('urgent:Glas & PET: Keller')).toEqual({ type: 'urgent', key: 'Glas & PET: Keller' });
    expect(parseAction('urgent:')).toBeNull();
    expect(parseAction('urgent-added')).toEqual({ type: 'urgent-added' });
    expect(parseAction('page:next')).toEqual({ type: 'page', delta: 1 });
    expect(parseAction('page:prev')).toEqual({ type: 'page', delta: -1 });
    expect(parseAction('page:x')).toBeNull();
    expect(parseAction('station:2')).toEqual({ type: 'station', index: 2 });
    expect(parseAction('weather')).toEqual({ type: 'nav', view: 'wetter' });
    expect(parseAction('commute')).toEqual({ type: 'nav', view: 'arbeitsweg' });
  });
  it('rejects unknown actions', () => {
    expect(parseAction('nav:nirgends')).toBeNull();
    expect(parseAction('key:%')).toBeNull();
    expect(parseAction('add:')).toBeNull();
    expect(parseAction('done:')).toBeNull();
    expect(parseAction('station:x')).toBeNull();
    expect(parseAction('station:')).toBeNull();
    expect(parseAction('nav:station')).toBeNull();
    expect(parseAction('boom')).toBeNull();
  });
  it('knows the keyboard keys', () => {
    expect(KEYS).toContain('ü');
    expect(KEYS).toContain('backspace');
    expect(KEYS).toHaveLength(26 + 3 + 2);
  });
});

describe('applyKey', () => {
  it('capitalises the first letter of each word', () => {
    let s = '';
    for (const k of ['m', 'i', 'l', 'c', 'h', 'space', 'b', 'i', 'o']) s = applyKey(s, k);
    expect(s).toBe('Milch Bio');
  });
  it('ignores leading and double spaces, supports backspace and the 40 char limit', () => {
    expect(applyKey('', 'space')).toBe('');
    expect(applyKey('A ', 'space')).toBe('A ');
    expect(applyKey('Ab', 'backspace')).toBe('A');
    expect(applyKey('', 'backspace')).toBe('');
    expect(applyKey('x'.repeat(40), 'a')).toBe('x'.repeat(40));
    expect(applyKey('', 'ö')).toBe('Ö');
  });
});

describe('navigation and reset', () => {
  it('remembers where to return from hinzufuegen and requests a full refresh on enter/leave', () => {
    let s = navigate(initialState(0), 'einkauf');
    expect(s.fullRefreshPending).toBe(false);
    s = navigate({ ...s, input: 'Mi', status: { text: 'x', ok: true } }, 'hinzufuegen');
    expect(s).toMatchObject({ view: 'hinzufuegen', returnView: 'einkauf', input: '', status: null, fullRefreshPending: true });
    s = navigate({ ...s, fullRefreshPending: false }, s.returnView);
    expect(s).toMatchObject({ view: 'einkauf', fullRefreshPending: true });
  });
  it('clears banners, the undo item and the frozen tiles when the view changes, not before', () => {
    const busy = {
      ...navigate(initialState(0), 'einkauf'),
      status: { text: 'Milch abgehakt', ok: true },
      done: { key: 'Milch', name: 'Milch', spec: '' },
      added: ['milch'],
      tiles: ['Milch'],
    };
    expect(navigate(busy, 'einkauf')).toMatchObject({ status: busy.status, done: busy.done, added: ['milch'], tiles: ['Milch'] });
    expect(navigate(busy, 'heute')).toMatchObject({ status: null, done: null, added: [], tiles: null });
  });
  it('treats the station view as an overlay: returns to its tab with full refreshes', () => {
    let s = navigate({ ...initialState(0), input: 'Mi' }, 'station');
    expect(s).toMatchObject({ view: 'station', returnView: 'heute', input: 'Mi', fullRefreshPending: true });
    s = navigate({ ...s, fullRefreshPending: false }, s.returnView);
    expect(s).toMatchObject({ view: 'heute', fullRefreshPending: true });
  });
  it('resets to heute after inactivity and clears input', () => {
    const s = { ...navigate(initialState(0), 'hinzufuegen'), input: 'Mi', lastInteraction: 1000 };
    expect(maybeReset(s, 1000 + 119_000, 120_000)).toBe(s);
    expect(maybeReset(s, 1000 + 120_000, 120_000)).toMatchObject({ view: 'heute', input: '', status: null, fullRefreshPending: true });
  });
});

describe('refresh policy', () => {
  it('forces a full refresh hourly or when pending', () => {
    const s0 = initialState(0);
    const a = takeFullRefresh(s0, 10_000);
    expect(a.full).toBe(false);
    const b = takeFullRefresh(s0, 3_600_000);
    expect(b.full).toBe(true);
    expect(b.state.lastFullRefresh).toBe(3_600_000);
    const c = takeFullRefresh({ ...s0, fullRefreshPending: true }, 5);
    expect(c).toMatchObject({ full: true, state: { fullRefreshPending: false } });
  });
  it('sleeps until the end of quiet hours', () => {
    const quiet = { start: 23 * 60, end: 6 * 60 };
    expect(refreshSeconds(new Date('2026-11-03T12:00:00+01:00'), 120, quiet)).toBe(120);
    expect(refreshSeconds(new Date('2026-11-03T23:30:00+01:00'), 120, quiet)).toBe(6.5 * 3600);
    expect(refreshSeconds(new Date('2026-11-04T05:59:00+01:00'), 120, quiet)).toBe(60);
    expect(refreshSeconds(new Date('2026-11-03T23:30:00+01:00'), 120, null)).toBe(120);
    expect(refreshSeconds(new Date('2026-11-03T13:30:00+01:00'), 120, { start: 13 * 60, end: 14 * 60 })).toBe(1800);
  });
});

it('opens Hinzufügen in the requested tab, Einkauf by default', () => {
  const s = initialState(0);
  expect(s.addMode).toBe('einkauf');
  expect(navigate(s, 'hinzufuegen', 'aufgabe').addMode).toBe('aufgabe');
  expect(navigate(navigate(s, 'hinzufuegen', 'aufgabe'), 'heute').addMode).toBe('aufgabe');
  expect(navigate(navigate(navigate(s, 'hinzufuegen', 'aufgabe'), 'heute'), 'hinzufuegen').addMode).toBe('einkauf');
});
