import { readFileSync } from 'node:fs';
import type { FetchFn } from '../../http.js';
import { TIMEOUT_MS } from '../../http.js';

export interface CatalogSection {
  items: { itemId: string; name: string }[];
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'de-CH');

/** How a Bring! list maps between item ids and the names shown and typed. */
export interface ItemNames {
  display(itemId: string): string;
  keyFor(name: string): string;
  suggest(input: string, extra: string[], limit?: number): string[];
}

/** For lists of free text (tasks): ids are the text itself, suggestions come only from earlier entries. */
export const verbatimNames: ItemNames = {
  display: (itemId) => itemId,
  keyFor: (name) => name.trim(),
  suggest(input, extra, limit = 3) {
    const q = input.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = [...new Set(extra)].filter((n) => n.toLowerCase().startsWith(q) || n.toLowerCase().includes(` ${q}`));
    return hits.sort(byName).slice(0, limit);
  },
};

export class BringCatalog implements ItemNames {
  private readonly toKey = new Map<string, string>();
  private readonly names: string[];

  constructor(private readonly articles: Record<string, string>, sections: CatalogSection[]) {
    for (const [key, name] of Object.entries(articles)) this.toKey.set(name.toLowerCase(), key);
    const names = new Set<string>(Object.values(articles));
    for (const section of sections) {
      for (const item of section.items) {
        names.add(item.name);
        if (!this.toKey.has(item.name.toLowerCase())) this.toKey.set(item.name.toLowerCase(), item.itemId);
      }
    }
    this.names = [...names].sort(byName);
  }

  display(itemId: string): string {
    return this.articles[itemId] ?? itemId;
  }

  /** Catalog key for a display name; free text is returned trimmed (Bring! files it under «Eigene Artikel»). */
  keyFor(name: string): string {
    const clean = name.trim();
    return this.toKey.get(clean.toLowerCase()) ?? clean;
  }

  suggest(input: string, extra: string[], limit = 3): string[] {
    const q = input.trim().toLowerCase();
    if (q.length < 2) return [];
    const all = [...new Set([...this.names, ...extra])];
    const starts = all.filter((n) => n.toLowerCase().startsWith(q)).sort(byName);
    const contains = all.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q)).sort(byName);
    return [...starts, ...contains].slice(0, limit);
  }
}

const DATA_DIR = new URL('../../../data/bring/', import.meta.url);

export function snapshotCatalog(): BringCatalog {
  const articles = JSON.parse(readFileSync(new URL('articles.de-CH.json', DATA_DIR), 'utf8')) as Record<string, string>;
  const catalog = JSON.parse(readFileSync(new URL('catalog.de-CH.json', DATA_DIR), 'utf8')) as {
    catalog: { sections: CatalogSection[] };
  };
  return new BringCatalog(articles, catalog.catalog.sections);
}

async function getJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`bring catalog HTTP ${res.status}`);
  return res.json();
}

export async function loadCatalog(fetchFn: FetchFn, locale: string): Promise<BringCatalog> {
  try {
    const base = 'https://web.getbring.com/locale/';
    const articles = (await getJson(fetchFn, `${base}articles.${locale}.json`)) as Record<string, string>;
    const catalog = (await getJson(fetchFn, `${base}catalog.${locale}.json`)) as { catalog?: { sections?: CatalogSection[] } };
    return new BringCatalog(articles, catalog.catalog?.sections ?? []);
  } catch (err) {
    console.warn(`[bring:catalog] using snapshot: ${err instanceof Error ? err.message : String(err)}`);
    return snapshotCatalog();
  }
}
