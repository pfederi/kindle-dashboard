import { TtlCache } from '../../cache.js';
import type { Clock } from '../../clock.js';
import type { ItemNames } from './catalog.js';
import type { BringApi, BringItem, BringItems } from './client.js';

export interface ShoppingItem {
  /** Bring! itemId; identifies the item when it is ticked off. */
  key: string;
  name: string;
  spec: string;
  /** Marked «Dringend» in Bring!. */
  urgent: boolean;
}

export type ShoppingData = { ok: true; listName: string; items: ShoppingItem[] } | { ok: false; message: string };

export interface AddResult {
  kind: 'added' | 'duplicate' | 'failed';
  name: string;
  /** The item on the list (for «Dringend» right after adding); absent when it failed. */
  key?: string;
  /** Whether that item is marked «Dringend» (a duplicate may already be). */
  urgent?: boolean;
}

/** `gone`: the item is no longer on the list (ticked off elsewhere). */
export interface CompleteResult {
  kind: 'done' | 'gone' | 'failed';
  key: string;
  name: string;
  spec: string;
}

/** `urgent` is the state after the toggle (unchanged when it failed). */
export interface UrgentResult {
  kind: 'done' | 'gone' | 'failed';
  key: string;
  name: string;
  urgent: boolean;
}

export interface ShoppingSource {
  list(force?: boolean): Promise<ShoppingData>;
  add(name: string): Promise<AddResult>;
  /** Ticks an item off the list. */
  complete(key: string): Promise<CompleteResult>;
  /** Puts a ticked-off item back on the list (Rückgängig); false on failure. */
  restore(key: string, spec: string): Promise<boolean>;
  suggestions(input: string): Promise<string[]>;
  frequent(): Promise<string[]>;
  /** Switches «Dringend» of an item on the list (or sets it to `to`), keeping its other purchase conditions. */
  toggleUrgent(key: string, to?: boolean): Promise<UrgentResult>;
}

/** Items marked «Dringend» first, keeping the order within both groups. */
export function urgentFirst<T extends { urgent: boolean }>(items: T[]): T[] {
  return [...items.filter((i) => i.urgent), ...items.filter((i) => !i.urgent)];
}

class ListNotFound extends Error {}

/** Five rows of three tiles in Hinzufügen. */
export const MAX_FREQUENT = 15;

/** Tiles in «Hinzufügen» → «Aufgabe»: five rows of two. */
export const MAX_TASK_TILES = 10;

/** Fill for the task tiles after the recently done ones. */
export const TASK_SUGGESTIONS = [
  'Abfall entsorgen',
  'Pflanzen giessen',
  'Altglas wegbringen',
  'Karton bündeln',
  'Papier bündeln',
  'Waschmaschine leeren',
  'Geschirrspüler ausräumen',
  'Betten frisch beziehen',
  'Staubsaugen',
];

export interface BringSourceOptions {
  /** Appended to the recently used names in `frequent()` (tasks). */
  fill?: string[];
  /** Maximum number of tiles; default MAX_FREQUENT. */
  max?: number;
}

export class BringSource implements ShoppingSource {
  private list_: { listUuid: string; name: string } | null = null;
  private notFound = false;
  private readonly cache: TtlCache<BringItems>;

  constructor(
    private readonly api: BringApi,
    private readonly listName: string,
    private readonly catalog: () => Promise<ItemNames>,
    clock: Clock,
    private readonly opts: BringSourceOptions = {},
  ) {
    this.cache = new TtlCache(2 * 60_000, async () => this.api.items((await this.resolveList()).listUuid), clock, `bring:items:${listName}`);
  }

  private async resolveList(): Promise<{ listUuid: string; name: string }> {
    if (this.list_) return this.list_;
    const lists = await this.api.lists();
    const found = lists.find((l) => l.name.toLowerCase() === this.listName.toLowerCase());
    if (!found) {
      this.notFound = true;
      throw new ListNotFound(`list not found`);
    }
    this.notFound = false;
    this.list_ = found;
    return found;
  }

  async list(force = false): Promise<ShoppingData> {
    const cached = await this.cache.get(force);
    if (!cached) {
      return { ok: false, message: this.notFound ? `Liste «${this.listName}» nicht gefunden` : 'Keine Daten' };
    }
    const catalog = await this.catalog();
    return {
      ok: true,
      listName: this.list_?.name ?? this.listName,
      items: cached.value.purchase.map((i) => ({ key: i.itemId, name: catalog.display(i.itemId), spec: i.specification, urgent: i.conditions.urgent })),
    };
  }

  async add(name: string): Promise<AddResult> {
    const catalog = await this.catalog();
    const key = catalog.keyFor(name);
    const display = catalog.display(key);
    try {
      const current = await this.cache.get();
      const onList = current?.value.purchase.find((i) => catalog.display(i.itemId).toLowerCase() === display.toLowerCase());
      if (onList) return { kind: 'duplicate', name: display, key: onList.itemId, urgent: onList.conditions.urgent };
      await this.api.add((await this.resolveList()).listUuid, key);
      this.cache.invalidate();
      return { kind: 'added', name: display, key, urgent: false };
    } catch (err) {
      console.warn(`[bring] add failed: ${err instanceof Error ? err.message : String(err)}`);
      return { kind: 'failed', name: display };
    }
  }

  async complete(key: string): Promise<CompleteResult> {
    const name = (await this.catalog()).display(key);
    try {
      const item = (await this.cache.get())?.value.purchase.find((i) => i.itemId === key);
      if (!item) return { kind: 'gone', key, name, spec: '' };
      await this.api.complete((await this.resolveList()).listUuid, key, item.specification, item.uuid);
      this.cache.invalidate();
      return { kind: 'done', key, name, spec: item.specification };
    } catch (err) {
      console.warn(`[bring] complete failed: ${err instanceof Error ? err.message : String(err)}`);
      return { kind: 'failed', key, name, spec: '' };
    }
  }

  async toggleUrgent(key: string, to?: boolean): Promise<UrgentResult> {
    const name = (await this.catalog()).display(key);
    let item: BringItem | undefined;
    try {
      item = (await this.cache.get())?.value.purchase.find((i) => i.itemId === key);
      if (!item) return { kind: 'gone', key, name, urgent: false };
      const urgent = to ?? !item.conditions.urgent;
      if (urgent === item.conditions.urgent) return { kind: 'done', key, name, urgent };
      await this.api.setConditions((await this.resolveList()).listUuid, key, item.specification, item.uuid, { ...item.conditions, urgent });
      this.cache.invalidate();
      return { kind: 'done', key, name, urgent };
    } catch (err) {
      console.warn(`[bring] urgent failed: ${err instanceof Error ? err.message : String(err)}`);
      return { kind: 'failed', key, name, urgent: item?.conditions.urgent ?? false };
    }
  }

  async restore(key: string, spec: string): Promise<boolean> {
    try {
      await this.api.add((await this.resolveList()).listUuid, key, spec);
      this.cache.invalidate();
      return true;
    } catch (err) {
      console.warn(`[bring] restore failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async names(): Promise<{ purchase: string[]; recently: string[] }> {
    const cached = await this.cache.get();
    const catalog = await this.catalog();
    return {
      purchase: (cached?.value.purchase ?? []).map((i) => catalog.display(i.itemId)),
      recently: (cached?.value.recently ?? []).map((i) => catalog.display(i.itemId)),
    };
  }

  async suggestions(input: string): Promise<string[]> {
    const { purchase, recently } = await this.names();
    return (await this.catalog()).suggest(input, [...purchase, ...recently]);
  }

  async frequent(): Promise<string[]> {
    const { purchase, recently } = await this.names();
    const onList = new Set(purchase.map((n) => n.toLowerCase()));
    const seen = new Set<string>();
    const out: string[] = [];
    const max = this.opts.max ?? MAX_FREQUENT;
    for (const name of [...recently, ...(this.opts.fill ?? [])]) {
      const k = name.toLowerCase();
      if (onList.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
      if (out.length === max) break;
    }
    return out;
  }
}

export const disabledBring: ShoppingSource = {
  list: async () => ({ ok: false, message: 'Bring! ist nicht eingerichtet' }),
  add: async (name) => ({ kind: 'failed', name: name.trim() }),
  complete: async (key) => ({ kind: 'failed', key, name: key, spec: '' }),
  restore: async () => false,
  suggestions: async () => [],
  frequent: async () => [],
  toggleUrgent: async (key) => ({ kind: 'failed', key, name: key, urgent: false }),
};
