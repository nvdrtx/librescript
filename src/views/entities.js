// Characters and Locations views: a list built from the script on the left,
// an editable profile + where they appear on the right.

import { esc } from './dom.js';
import { formatDuration as formatDurationSafe } from '../model/analysis.js';

export class EntityView {
  /**
   * kind: 'characters' | 'locations'
   * fields: [{ key, label, multiline }]
   */
  constructor(root, { kind, title, fields, onOpen, onSave }) {
    this.kind = kind;
    this.fields = fields;
    this.onOpen = onOpen;
    this.onSave = onSave;
    this.root = root;
    root.innerHTML = `
      <div class="view-head"><h2>${title}</h2><p class="hint"></p></div>
      <div class="entity-layout">
        <ul class="entity-list" role="listbox" aria-label="${title}"></ul>
        <div class="entity-detail"></div>
      </div>`;
    this.listEl = root.querySelector('.entity-list');
    this.detailEl = root.querySelector('.entity-detail');
    this.listEl.addEventListener('click', (e) => {
      const li = e.target.closest('[data-name]');
      if (li) { this.selected = li.dataset.name; this.render(); }
    });
    this.detailEl.addEventListener('change', (e) => {
      const f = e.target.dataset.field;
      if (f && this.selected) this.onSave(this.selected, { [f]: e.target.value });
    });
    this.detailEl.addEventListener('click', (e) => {
      const s = e.target.closest('[data-scene-block]');
      if (s) this.onOpen(Number(s.dataset.sceneBlock));
    });
  }

  update(items, meta, sceneList) {
    this.items = items;
    this.meta = meta;
    this.scenes = sceneList;
    if (this.root.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    this.render();
  }

  render() {
    const items = this.items || [];
    if (!items.some((i) => i.name === this.selected)) this.selected = items[0]?.name;
    this.root.querySelector('.hint').textContent = items.length
      ? `${items.length} ${this.kind === 'characters' ? 'personnage' : 'lieu'}${items.length > 1 ? 's' : ''} trouvé${items.length > 1 ? 's' : ''} dans le scénario.`
      : '';
    this.listEl.innerHTML = items.map((it) => {
      const m = this.meta[it.name] || {};
      const sub = this.kind === 'characters'
        ? `${it.cues} réplique${it.cues > 1 ? 's' : ''} · ${it.scenes.length} sc.`
        : `${it.scenes.length} scène${it.scenes.length > 1 ? 's' : ''}${it.intExt.length ? ' · ' + it.intExt.join(', ') : ''}`;
      return `<li data-name="${esc(it.name)}" role="option" aria-selected="${it.name === this.selected}" class="${it.name === this.selected ? 'on' : ''}">
        <span class="avatar">${esc(it.name.slice(0, 1))}</span>
        <span><b>${esc(it.name)}</b><small>${esc(m.role || sub)}</small></span>
      </li>`;
    }).join('') || `<li class="empty">${this.kind === 'characters'
      ? 'Aucun personnage. Ajoute un bloc « Personnage » (⌘3) dans le scénario.'
      : 'Aucun lieu. Les lieux viennent des titres de scène, ex. « INT. CUISINE — JOUR ».'}</li>`;

    const it = items.find((i) => i.name === this.selected);
    if (!it) { this.detailEl.innerHTML = ''; return; }
    const m = this.meta[it.name] || {};
    const facts = this.kind === 'characters'
      ? [['Répliques', it.cues], ['Mots dits', it.words], ['Temps de parole', formatDurationSafe(it.seconds)], ['Scènes', it.scenes.length]]
      : [['Scènes', it.scenes.length], ['Durée écran', `${(it.eighths / 8).toFixed(1)} p.`], ['INT / EXT', it.intExt.join(', ') || '—'], ['Moments', it.times.join(', ') || '—']];
    const sceneLinks = it.scenes.map((n) => {
      const s = this.scenes[n - 1];
      return s ? `<li><button data-scene-block="${s.start}"><b>${n}</b> ${esc(s.heading)}</button></li>` : '';
    }).join('');
    this.detailEl.innerHTML = `
      <h3>${esc(it.name)}</h3>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="fields">
        ${this.fields.map((f) => `<label><span>${f.label}</span>${f.multiline
          ? `<textarea data-field="${f.key}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(m[f.key] || '')}</textarea>`
          : `<input data-field="${f.key}" value="${esc(m[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" />`}</label>`).join('')}
      </div>
      <h4>Apparaît dans</h4>
      <ul class="scene-links">${sceneLinks}</ul>`;
  }
}
