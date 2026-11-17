// Scene navigator: the list of scenes beside the editor.
// Click a scene to jump to it, drag to reorder; the current scene follows the caret.

import { esc, makeSortable } from './dom.js';
import { formatEighths } from '../model/analysis.js';

export class SceneNavigator {
  constructor(root, { onGoTo, onMove }) {
    this.root = root;
    this.onGoTo = onGoTo;
    this.root.innerHTML = `
      <div class="nav-head"><span>Scènes</span><span class="nav-total"></span></div>
      <input class="nav-filter" type="search" placeholder="Filtrer les scènes" aria-label="Filtrer les scènes" />
      <ol class="nav-list"></ol>`;
    this.list = root.querySelector('.nav-list');
    this.filter = root.querySelector('.nav-filter');
    this.filter.addEventListener('input', () => this.applyFilter());
    this.list.addEventListener('click', (e) => {
      const item = e.target.closest('.nav-item');
      if (item) this.onGoTo(Number(item.dataset.block));
    });
    this.list.addEventListener('keydown', (e) => {
      const item = e.target.closest('.nav-item');
      if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.onGoTo(Number(item.dataset.block)); }
    });
    makeSortable(this.list, '.nav-item', onMove);
  }

  update(sceneList, pages) {
    this.scenes = sceneList;
    this.root.querySelector('.nav-total').textContent = `${sceneList.length} · ${pages} p.`;
    this.list.innerHTML = sceneList.map((s, i) => `
      <li class="nav-item" draggable="true" tabindex="0" data-index="${i}" data-block="${s.start}"
          ${s.color ? `style="--scene-color:${esc(s.color)}"` : ''}>
        <span class="nav-num">${s.number}</span>
        <span class="nav-body">
          <span class="nav-heading">${esc(s.heading) || '<em>Sans titre</em>'}</span>
          <span class="nav-meta">p. ${s.page} · ${formatEighths(s.eighths)} p.${s.characters.length ? ' · ' + esc(s.characters.join(', ')) : ''}</span>
        </span>
      </li>`).join('') || '<li class="nav-empty">Aucune scène. Ajoute un titre de scène (⌘1).</li>';
    this.applyFilter();
    this.highlight(this.currentBlock ?? 0);
  }

  applyFilter() {
    const q = this.filter.value.trim().toLowerCase();
    this.list.querySelectorAll('.nav-item').forEach((el, i) => {
      const s = this.scenes[i];
      const hay = `${s.heading} ${s.characters.join(' ')} ${s.note}`.toLowerCase();
      el.hidden = !!q && !hay.includes(q);
    });
  }

  // Mark the scene containing block `blockIndex`.
  highlight(blockIndex) {
    this.currentBlock = blockIndex;
    if (!this.scenes) return;
    const idx = this.scenes.findLastIndex((s) => s.start <= blockIndex);
    this.list.querySelectorAll('.nav-item').forEach((el, i) => {
      const on = i === idx;
      if (on && !el.classList.contains('current')) el.scrollIntoView({ block: 'nearest' });
      el.classList.toggle('current', on);
    });
  }
}
