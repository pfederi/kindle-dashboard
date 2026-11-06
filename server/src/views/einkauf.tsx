import { render } from 'preact-render-to-string';
import { Icon, NoticeBar, Tabs } from './components.js';
import type { EinkaufModel } from './model.js';
import { page } from './page.js';
import { urgentFirst } from '../sources/bring/source.js';

/** Five rows of two: with the notice, the add button and the pager they fit above the tabs (render test). */
export const ITEMS_PER_PAGE = 10;

export function pageCount(items: number): number {
  return Math.max(1, Math.ceil(items / ITEMS_PER_PAGE));
}

/** «‹ Zurück · Seite 1 von 3 · Weiter ›»; a button without a page to go to is grey and not tappable. */
function Pager({ page, pages }: { page: number; pages: number }) {
  const prev = page > 0;
  const next = page < pages - 1;
  return (
    <div class="pager">
      <div class={prev ? 'pg' : 'pg off'} data-action={prev ? 'page:prev' : undefined}>
        <Icon name="chevron-left" size={40} /> Zurück
      </div>
      <div class="pgn">{`Seite ${page + 1} von ${pages}`}</div>
      <div class={next ? 'pg' : 'pg off'} data-action={next ? 'page:next' : undefined}>
        Weiter <Icon name="chevron-right" size={40} />
      </div>
    </div>
  );
}

function Einkauf({ m }: { m: EinkaufModel }) {
  const s = m.shopping;
  // «Dringend» first, otherwise in Bring!'s order.
  const items = s.ok ? urgentFirst(s.items) : [];
  const pages = pageCount(items.length);
  const page = Math.min(m.page ?? 0, pages - 1);
  const shown = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
  return (
    <div class="screen view-einkauf">
      <div class="main">
        <div class="topbar">
          <div class="title serif">Einkaufsliste</div>
          <div class="close" data-action="nav:heute">
            <Icon name="x" size={34} /> Schliessen
          </div>
        </div>
        <div class="meta">{s.ok ? `Bring! · Liste «${s.listName}» · ${s.items.length} Artikel` : s.message}</div>
        <div class="rule" />
        {m.status && <NoticeBar notice={m.status} undo={m.undo} />}
        {s.ok && s.items.length === 0 && <div class="empty">Die Liste ist leer</div>}
        {shown.length > 0 && (
          <div class="items-grid">
            {shown.map((i) => (
              <div class={i.urgent ? 'item urgent' : 'item'} data-action={`done:${i.key}`}>
                <div class="ellipsis">{i.name}</div>
                {i.spec && <small class="ellipsis">{i.spec}</small>}
                <span class="tick">
                  <Icon name="check" size={30} />
                </span>
                {/* Its own, smaller tap area: switches «Dringend» instead of ticking off. */}
                <span class="urge" data-action={`urgent:${i.key}`}>
                  <Icon name="run" size={44} />
                </span>
              </div>
            ))}
          </div>
        )}
        <div class="btn wide" data-action="nav:hinzufuegen">
          <Icon name="plus" size={44} /> Hinzufügen
        </div>
        {pages > 1 && <Pager page={page} pages={pages} />}
      </div>
      <Tabs active="einkauf" />
    </div>
  );
}

export function einkaufMarkup(m: EinkaufModel): string {
  return render(<Einkauf m={m} />);
}

export function einkaufHtml(m: EinkaufModel): string {
  return page(einkaufMarkup(m));
}
