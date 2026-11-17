// SearchToolbar — the find/replace bar, modeled on Story Architect's Ui::SearchToolbar.
// Its controls mirror that widget's signals and getters:
//   searchText / findTextRequested   → query field (live search as you type)
//   findPrevious/NextRequested       → ↑ / ↓ buttons, Shift+Enter / Enter
//   isCaseSensitive                  → "Aa" toggle
//   searchInType / setPopupStringList→ "Search in" dropdown (whole text or one block type)
//   replaceText / replaceOnePressed / replaceAllPressed → replace row
//   closePressed                     → × button and Esc
//   setReadOnly                      → hides the replace row
// It is a thin view; all logic lives in SearchManager.

import { SearchManager } from './SearchManager.js';

export class SearchToolbar {
  constructor(host, editor, blockTypes) {
    this.editor = editor;
    this.manager = new SearchManager(editor);
    this.el = host;
    this.el.innerHTML = `
      <div class="search-row">
        <input class="q" type="search" placeholder="Rechercher — ou #12 pour aller à la scène 12" aria-label="Rechercher" />
        <span class="count" aria-live="polite"></span>
        <button class="prev" title="Résultat précédent (Maj+Entrée)" aria-label="Résultat précédent">↑</button>
        <button class="next" title="Résultat suivant (Entrée)" aria-label="Résultat suivant">↓</button>
        <button class="case" title="Ignorer la casse" aria-pressed="false">Aa</button>
        <select class="scope" aria-label="Rechercher dans">
          <option value="">Tout le texte</option>
          ${blockTypes.map((t) => `<option value="${t.type}">${t.label}</option>`).join('')}
        </select>
        <button class="close" title="Fermer (Échap)" aria-label="Fermer la recherche">×</button>
      </div>
      <div class="replace-row">
        <input class="r" type="text" placeholder="Remplacer par" aria-label="Remplacer par" />
        <button class="one">Remplacer</button>
        <button class="all">Tout remplacer</button>
      </div>`;
    this.$ = (s) => this.el.querySelector(s);
    this.hide();
    this.wire();
  }

  wire() {
    const q = this.$('.q');
    q.addEventListener('input', () => {
      this.manager.setQuery(q.value);
      // Live search from the start of the current selection, like findTextRequested.
      const sel = this.editor.selection();
      if (sel) this.editor.select(sel.start, sel.start);
      this.manager.find(false);
      this.refresh();
      q.focus();
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey);
      }
    });
    this.$('.prev').addEventListener('click', () => this.step(true));
    this.$('.next').addEventListener('click', () => this.step(false));
    this.$('.case').addEventListener('click', () => {
      const on = !this.manager.caseSensitive;
      this.manager.setCaseSensitive(on);
      const b = this.$('.case');
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Respecter la casse' : 'Ignorer la casse';
      this.refresh();
    });
    this.$('.scope').addEventListener('change', (e) => {
      this.manager.setSearchInType(e.target.value);
      this.refresh();
    });
    this.$('.r').addEventListener('input', (e) => this.manager.setReplacement(e.target.value));
    this.$('.r').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.manager.replaceOne(); this.refresh(); }
    });
    this.$('.one').addEventListener('click', () => { this.manager.replaceOne(); this.refresh(); });
    this.$('.all').addEventListener('click', () => {
      const n = this.manager.replaceAll();
      this.refresh(n ? `${n} remplacé${n > 1 ? 's' : ''}` : null);
    });
    this.$('.close').addEventListener('click', () => this.hide());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); }
    });
    this.editor.addEventListener('change', () => this.visible && this.refresh());
    this.editor.addEventListener('selection', () => this.visible && this.refresh());
  }

  step(backward) {
    this.manager.find(backward);
    this.refresh();
  }

  // Cmd/Ctrl+F: open, prefill with the selected word, select the field (activateSearhToolbar).
  activate() {
    const sel = this.editor.selection();
    if (sel && sel.start.block === sel.end.block && sel.start.offset !== sel.end.offset) {
      const text = this.editor.blocks()[sel.start.block].text.slice(sel.start.offset, sel.end.offset);
      this.$('.q').value = text;
      this.manager.setQuery(text);
    }
    this.visible = true;
    this.el.hidden = false;
    this.$('.q').focus();
    this.$('.q').select();
    this.refresh();
  }

  hide() {
    this.visible = false;
    this.el.hidden = true;
    this.paint([]);
  }

  setReadOnly(flag) {
    this.manager.setReadOnly(flag);
    this.$('.replace-row').hidden = flag;
  }

  refresh(message) {
    this.paint(this.manager.allMatches());
    this.refreshCount(message);
  }

  refreshCount(message) {
    const q = this.manager.query;
    const c = this.$('.count');
    if (!q) { c.textContent = ''; return; }
    if (message) { c.textContent = message; return; }
    if (q.startsWith('#')) { c.textContent = 'scène'; return; }
    const { total, current } = this.manager.status();
    c.textContent = total ? `${current || '–'} / ${total}` : 'Aucun résultat';
    c.classList.toggle('empty', total === 0);
  }

  // Highlight every match without touching the DOM (CSS Custom Highlight API).
  paint(matches) {
    if (!globalThis.CSS?.highlights) return;
    CSS.highlights.delete('search-match');
    CSS.highlights.delete('search-current');
    if (matches.length === 0) return;
    CSS.highlights.set('search-match', new Highlight(...this.editor.rangesFor(matches)));
    // The current match stays visible even while focus is in the search field.
    const { current } = this.manager.status();
    if (current) CSS.highlights.set('search-current', new Highlight(...this.editor.rangesFor([matches[current - 1]])));
  }
}
