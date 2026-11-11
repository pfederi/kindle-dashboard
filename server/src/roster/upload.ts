import type { Clock } from '../clock.js';
import type { Notice } from '../monitor.js';
import { parseRoster, type Roster, RosterError } from './parse.js';
import { extractPdf, type PdfPage } from './pdf.js';
import type { RosterStore } from './store.js';
import { summarize } from './summary.js';

export interface RosterReply {
  status: 200 | 422 | 500;
  /** Shown by the shortcut and sent by push. */
  text: string;
}

export interface RosterUpload {
  name: string;
  store: Pick<RosterStore, 'save' | 'lastError'>;
  clock: Clock;
  notify?: (n: Notice) => Promise<void>;
  /** For tests. */
  extract?: (bytes: Uint8Array) => Promise<PdfPage>;
}

/** A plan from the shortcut: read it, keep it, and say what came out, in the reply and by push. */
export async function receiveRoster(pdf: Uint8Array, u: RosterUpload): Promise<RosterReply> {
  const now = u.clock();
  // ntfy titles go into headers and must be ASCII.
  const fail = async (status: 422 | 500, text: string, title = 'Dienstplan nicht erkannt'): Promise<RosterReply> => {
    u.store.lastError = { at: now, text };
    await u.notify?.({ title, message: text, tags: 'warning', priority: 'default' });
    return { status, text };
  };
  if (Buffer.from(pdf.subarray(0, 5)).toString('latin1') !== '%PDF-') return fail(422, 'Dienstplan nicht erkannt: Die Datei ist kein PDF');
  let page: PdfPage;
  try {
    page = await (u.extract ?? extractPdf)(pdf);
  } catch {
    return fail(422, 'Dienstplan nicht erkannt: PDF nicht lesbar');
  }
  let roster: Roster;
  try {
    roster = parseRoster(page, u.name);
  } catch (err) {
    if (err instanceof RosterError) return fail(422, `Dienstplan nicht erkannt: ${err.message}`);
    throw err;
  }
  try {
    u.store.save(roster, now);
  } catch (err) {
    console.warn(`[roster] save failed: ${err instanceof Error ? err.message : String(err)}`);
    return fail(500, 'Dienstplan nicht gespeichert: Ablage nicht beschreibbar', 'Dienstplan nicht gespeichert');
  }
  u.store.lastError = null;
  const text = summarize(roster, now);
  await u.notify?.({ title: 'Dienstplan', message: text, tags: 'calendar', priority: 'default' });
  return { status: 200, text };
}
