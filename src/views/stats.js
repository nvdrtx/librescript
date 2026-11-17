// Statistics view: totals, speaking time per character, locations and a scene table.

import { esc } from './dom.js';
import { formatDuration, formatEighths } from '../model/analysis.js';

export class StatsView {
  constructor(root, { onOpen }) {
    this.root = root;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-block]');
      if (b) onOpen(Number(b.dataset.block));
    });
  }

  update(st) {
    const tile = (label, value, sub = '') =>
      `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`;
    const maxCues = Math.max(1, ...st.characters.map((c) => c.seconds));
    const maxLoc = Math.max(1, ...st.locations.map((l) => l.scenes.length));
    const pct = (n) => `${Math.round(n * 100)} %`;
    const split = (a, b, la, lb) => {
      const t = a + b || 1;
      return `<div class="split" role="img" aria-label="${la} ${a}, ${lb} ${b}">
        <span style="flex:${a}" class="split-a"></span><span style="flex:${b}" class="split-b"></span></div>
        <div class="split-legend"><span><i class="split-a"></i>${la} ${a} (${pct(a / t)})</span><span><i class="split-b"></i>${lb} ${b} (${pct(b / t)})</span></div>`;
    };

    this.root.innerHTML = `
      <div class="view-head"><h2>Statistiques</h2><p class="hint">Estimation : 1 page ≈ 1 minute à l'écran, ~150 mots de dialogue par minute.</p></div>
      <div class="tiles">
        ${tile('Pages', st.pages)}
        ${tile('Durée estimée', `${st.minutes} min`)}
        ${tile('Scènes', st.scenes)}
        ${tile('Personnages parlants', st.characters.length)}
        ${tile('Lieux', st.locations.length)}
        ${tile('Mots', st.words.toLocaleString('fr-FR'), `${pct(st.dialogueShare)} en dialogue`)}
      </div>

      <div class="stats-grid">
        <section class="panel">
          <h3>Temps de parole</h3>
          ${st.characters.length ? `<ul class="bars">${st.characters.map((c) => `
            <li><span class="bar-label">${esc(c.name)}</span>
              <span class="bar-track"><span class="bar" style="width:${(c.seconds / maxCues) * 100}%"></span></span>
              <span class="bar-value">${formatDuration(c.seconds)} · ${c.cues} rép.</span></li>`).join('')}</ul>` : '<p class="empty">Aucun dialogue.</p>'}
        </section>

        <section class="panel">
          <h3>Lieux</h3>
          ${st.locations.length ? `<ul class="bars">${st.locations.map((l) => `
            <li><span class="bar-label">${esc(l.name)}</span>
              <span class="bar-track"><span class="bar alt" style="width:${(l.scenes.length / maxLoc) * 100}%"></span></span>
              <span class="bar-value">${l.scenes.length} sc.</span></li>`).join('')}</ul>` : '<p class="empty">Aucun lieu.</p>'}
          <h3>Intérieur / extérieur</h3>
          ${split(st.interior, st.exterior, 'INT', 'EXT')}
          ${st.mixed ? `<p class="hint">${st.mixed} scène(s) INT/EXT</p>` : ''}
          <h3>Jour / nuit</h3>
          ${split(st.day, st.night, 'Jour', 'Nuit')}
        </section>
      </div>

      <section class="panel">
        <h3>Scènes</h3>
        <div class="table-wrap"><table class="scene-table">
          <thead><tr><th>#</th><th>Titre</th><th>Page</th><th>Longueur</th><th>Personnages</th></tr></thead>
          <tbody>${st.sceneList.map((s) => `
            <tr data-block="${s.start}" tabindex="0"><td>${s.number}</td><td>${esc(s.heading)}</td><td>${s.page}</td>
              <td>${formatEighths(s.eighths)}</td><td>${esc(s.characters.join(', '))}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  }
}
