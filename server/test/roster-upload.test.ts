import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PdfPage } from '../src/roster/pdf.js';
import { RosterStore } from '../src/roster/store.js';
import { receiveRoster } from '../src/roster/upload.js';
import { testClock } from './helpers.js';

const november = JSON.parse(readFileSync(new URL('./fixtures/roster-page.json', import.meta.url), 'utf8')) as PdfPage;
const PDF = new TextEncoder().encode('%PDF-1.7 …');

function setup(dir = mkdtempSync(join(tmpdir(), 'roster-')), mounted = true) {
  const store = new RosterStore(dir, () => mounted);
  const notify = vi.fn(async () => {});
  const extract = vi.fn(async () => november);
  const clock = testClock('2026-11-11T20:00:00+01:00');
  return { store, notify, extract, upload: (bytes = PDF, name = 'Delta') => receiveRoster(bytes, { name, store, clock, notify, extract }) };
}

describe('receiveRoster', () => {
  it('reads, keeps and answers with the summary, also by push', async () => {
    const { store, notify, upload } = setup();
    const reply = await upload();
    expect(reply).toEqual({ status: 200, text: 'November 2026: 10× Arbeit, 9× Schule, 11× frei. Nächster Dienst: Fr 13.11. Arbeit 13:30–22:30' });
    expect(store.day(new Date('2026-11-13T09:00:00+01:00'))).toEqual({ kind: 'work', start: '13:30', end: '22:30' });
    expect(notify).toHaveBeenCalledWith({ title: 'Dienstplan', message: reply.text, tags: 'calendar', priority: 'default' });
    expect(store.lastError).toBeNull();
  });

  it('warns, in the reply and by push, when the plan would not survive the next deploy', async () => {
    const { notify, upload } = setup(undefined, false);
    const reply = await upload();
    expect(reply.status).toBe(200);
    expect(reply.text).toMatch(/^November 2026: 10× Arbeit.* Achtung: Ablage ist kein Volume, der Plan geht beim nächsten Deploy verloren\.$/);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dienstplan', message: reply.text, tags: 'warning' }));
  });

  it('refuses a file that is not a PDF without reading it', async () => {
    const { extract, notify, store, upload } = setup();
    expect(await upload(new TextEncoder().encode('GIF89a'))).toEqual({ status: 422, text: 'Dienstplan nicht erkannt: Die Datei ist kein PDF' });
    expect(extract).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dienstplan nicht erkannt', tags: 'warning' }));
    expect(store.lastError?.text).toBe('Dienstplan nicht erkannt: Die Datei ist kein PDF');
  });

  it('says why a plan cannot be read, and keeps the plan it had', async () => {
    const { store, upload, extract } = setup();
    await upload();
    expect(await upload(PDF, 'Nobody')).toEqual({ status: 422, text: 'Dienstplan nicht erkannt: Name «Nobody» nicht gefunden' });
    expect(store.day(new Date('2026-11-13T09:00:00+01:00'))).toEqual({ kind: 'work', start: '13:30', end: '22:30' });
    extract.mockRejectedValueOnce(new Error('Invalid PDF structure'));
    expect(await upload()).toEqual({ status: 422, text: 'Dienstplan nicht erkannt: PDF nicht lesbar' });
  });

  it('reports a store it cannot write to', async () => {
    const { upload, notify } = setup(join(tmpdir(), 'roster-missing-dir', 'nope'));
    expect(await upload()).toEqual({ status: 500, text: 'Dienstplan nicht gespeichert: Ablage nicht beschreibbar' });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Dienstplan nicht gespeichert', tags: 'warning' }));
  });
});
