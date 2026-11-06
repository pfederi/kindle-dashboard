import { render } from 'preact-render-to-string';
import { Icon, NoticeBar } from './components.js';
import type { HinzufuegenModel } from './model.js';
import { MAX_FREQUENT, MAX_TASK_TILES } from '../sources/bring/source.js';
import { page } from './page.js';

const ROWS = ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnm'];

function Hinzufuegen({ m }: { m: HinzufuegenModel }) {
  const task = m.mode === 'aufgabe';
  // Tasks are longer than articles: two suggestion slots and two tile columns.
  const slots = (task ? [0, 1] : [0, 1, 2]).map((i) => m.suggestions[i] ?? null);
  const added = new Set(m.added ?? []);
  return (
    <div class="screen view-hinzufuegen">
      <div class="main">
        <div class="topbar">
          {m.tabs ? (
            <div class="segs">
              <div class={task ? 'seg' : 'seg on'} data-action="tab:einkauf">
                Einkauf
              </div>
              <div class={task ? 'seg on' : 'seg'} data-action="tab:aufgabe">
                Aufgabe
              </div>
            </div>
          ) : (
            <div class="title serif">Hinzufügen</div>
          )}
          <div class="close" data-action="close">
            <Icon name="x" size={34} /> Fertig
          </div>
        </div>
        <div class="rule" />
        <div class="input">
          <span class="text ellipsis">
            {m.input}
            <span class="caret" />
          </span>
          <span class="bs" data-action="key:backspace">
            <Icon name="delete" size={50} />
          </span>
        </div>
        {/* The feedback takes the place of the suggestions until the next key press clears it. */}
        {m.status ? (
          <NoticeBar notice={m.status} urgent={m.urgentOffer} />
        ) : (
          <div class="sugg">
            {slots.map((s) =>
              s === null ? (
                <div class="s blank" />
              ) : (
                <div class="s" data-action={`add:${s}`}>
                  <span class="ellipsis">{s}</span>
                </div>
              ),
            )}
          </div>
        )}
        <div class="section-title" style="margin-top:22px">
          {task ? 'Häufig' : 'Oft gekauft'}
        </div>
        {m.unavailable ? (
          <div class="empty">{m.unavailable}</div>
        ) : m.frequent.length === 0 ? (
          <div class="empty">{task ? 'Tippe eine Aufgabe ein' : 'Tippe einen Artikel ein'}</div>
        ) : (
          <div class={task ? 'tiles two' : 'tiles'}>
            {m.frequent.slice(0, task ? MAX_TASK_TILES : MAX_FREQUENT).map((f) =>
              added.has(f.toLowerCase()) ? (
                <div class="tile on">
                  <Icon name="check" size={34} />
                  <span class="ellipsis">{f}</span>
                </div>
              ) : (
                <div class="tile" data-action={`add:${f}`}>
                  <span class="ellipsis">{f}</span>
                </div>
              ),
            )}
          </div>
        )}
        <div class="kb">
          {ROWS.map((row, r) => (
            <div class="row">
              {[...row].map((k) => (
                <div class="key" data-action={`key:${k}`}>
                  {k.toUpperCase()}
                </div>
              ))}
              {r === 2 && (
                <div class="key mid" data-action="key:backspace">
                  <Icon name="delete" size={44} />
                </div>
              )}
            </div>
          ))}
          <div class="row">
            <div class="key wide" data-action="key:space">
              Leerschlag
            </div>
            <div class="key enter" data-action="add:input">
              ↵ Erfassen
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function hinzufuegenMarkup(m: HinzufuegenModel): string {
  return render(<Hinzufuegen m={m} />);
}

export function hinzufuegenHtml(m: HinzufuegenModel): string {
  return page(hinzufuegenMarkup(m));
}
