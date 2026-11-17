// Cards view: one index card per scene, with a note and a colour. Drag to reorder.

import { esc, makeSortable } from './dom.js';
import { formatEighths } from '../model/analysis.js';

export const CARD_COLORS = ['', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];

export class CardsView {
  constructor(root, { onOpen, onMove, onUpdate }) {
    this.root = root;
    root.innerHTML = `
      <div class="view-head">
        <h2>Fiches</h2>
        <p class="hint">Glisse une fiche pour déplacer la scène. Double-clique pour l'ouvrir dans le scénario.</p>
      </div>
      <div class="cards-grid"></div>`;
    this.grid = root.querySelector('.cards-grid');
    makeSortable(this.grid, '.card', onMove);
    this.grid.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.card');
      if (card && !e.target.closest('textarea, button')) onOpen(Number(card.dataset.block));
    });
    this.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (btn) onUpdate(Number(btn.closest('.card').dataset.block), { color: btn.dataset.color });
      const open = e.target.closest('.card-open');
      if (open) onOpen(Number(open.closest('.card').dataset.block));
    });
    this.grid.addEventListener('change', (e) => {
      if (e.target.matches('.card-note')) onUpdate(Number(e.target.closest('.card').dataset.block), { note: e.target.value });
    });
  }

  update(sceneList) {
    // Don't rebuild while someone is typing a note.
    if (this.root.contains(document.activeElement) && document.activeElement.matches('textarea')) return;
    this.grid.innerHTML = sceneList.map((s, i) => `
      <article class="card" draggable="true" data-index="${i}" data-block="${s.start}" ${s.color ? `style="--scene-color:${esc(s.color)}"` : ''}>
        <header>
          <span class="card-num">${s.number}</span>
          <span class="card-heading">${esc(s.heading) || '<em>Sans titre</em>'}</span>
          <button class="card-open" title="Ouvrir dans le scénario" aria-label="Ouvrir la scène ${s.number}">↗</button>
        </header>
        <p class="card-summary">${esc(s.summary) || '<em>Pas encore d\'action.</em>'}</p>
        <textarea class="card-note" rows="3" placeholder="Note de scène…" aria-label="Note de la scène ${s.number}">${esc(s.note)}</textarea>
        <footer>
          <span class="card-meta">p. ${s.page} · ${formatEighths(s.eighths)} p.${s.characters.length ? ' · ' + esc(s.characters.join(', ')) : ''}</span>
          <span class="card-colors">${CARD_COLORS.map((c) => `<button data-color="${c}" class="swatch${c === s.color ? ' on' : ''}" style="--c:${c || 'transparent'}" aria-label="${c ? 'Couleur ' + c : 'Sans couleur'}"></button>`).join('')}</span>
        </footer>
      </article>`).join('') || '<p class="empty">Aucune scène pour l\'instant.</p>';
  }
}
