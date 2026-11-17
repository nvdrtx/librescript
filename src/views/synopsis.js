// Synopsis module: logline (= project description), short synopsis, full synopsis,
// and a step outline (séquencier) generated from the scenes.

import { esc } from './dom.js';

const words = (s) => (String(s || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;

// Plain-text step outline: "1. EXT. PORT — AUBE\n   note or first action line".
export function stepOutline(sceneList) {
  return sceneList.map((s) => {
    const body = s.note || s.summary;
    return `${s.number}. ${s.heading}${body ? `\n${body}` : ''}`;
  }).join('\n\n');
}

export class SynopsisView {
  constructor(root, { onChange, onExport }) {
    this.root = root;
    root.innerHTML = `
      <div class="view-head">
        <h2>Synopsis</h2>
        <p class="hint">Écris l'histoire en prose avant (ou après) le scénario.</p>
        <span class="spacer"></span>
        <button class="syn-export">Exporter le synopsis en PDF…</button>
      </div>
      <div class="syn-layout">
        <form class="syn-form">
          <label>
            <span class="syn-label">Logline <small>une phrase · aussi affichée sur la carte de l'accueil</small></span>
            <textarea name="logline" rows="2" placeholder="Quand [événement], [personnage] doit [objectif] avant que [enjeu]."></textarea>
            <span class="syn-count" data-for="logline"></span>
          </label>
          <label>
            <span class="syn-label">Synopsis court <small>un paragraphe, pour pitcher</small></span>
            <textarea name="short" rows="5" placeholder="Le début, le milieu et la fin en quelques lignes."></textarea>
            <span class="syn-count" data-for="short"></span>
          </label>
          <label class="syn-long">
            <span class="syn-label">Synopsis développé <small>l'histoire complète, au présent</small></span>
            <textarea name="long" rows="18" placeholder="Raconte toute l'histoire, scène par scène ou par actes…"></textarea>
            <span class="syn-count" data-for="long"></span>
          </label>
        </form>
        <aside class="panel syn-outline">
          <div class="syn-outline-head">
            <h3>Séquencier</h3>
            <button class="syn-insert" title="Ajoute ce séquencier à la fin du synopsis développé">Copier dans le synopsis</button>
          </div>
          <p class="hint">Construit à partir des scènes : leur note (module Fiches) ou, à défaut, leur première action.</p>
          <ol class="syn-steps"></ol>
        </aside>
      </div>`;
    this.form = root.querySelector('form');
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('input', () => {
      this.counts();
      onChange(this.values());
    });
    root.querySelector('.syn-export').addEventListener('click', onExport);
    root.querySelector('.syn-insert').addEventListener('click', () => {
      const ta = this.form.elements.long;
      const outline = stepOutline(this.scenes || []);
      if (!outline) return;
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${outline}` : outline;
      this.counts();
      onChange(this.values());
      ta.focus();
      ta.scrollTop = ta.scrollHeight;
    });
  }

  values() {
    const f = this.form.elements;
    return { logline: f.logline.value, short: f.short.value, long: f.long.value };
  }

  update({ logline, short, long }, sceneList) {
    this.scenes = sceneList;
    if (!this.root.contains(document.activeElement) || !document.activeElement.matches('textarea')) {
      const f = this.form.elements;
      f.logline.value = logline || '';
      f.short.value = short || '';
      f.long.value = long || '';
    }
    this.counts();
    this.root.querySelector('.syn-steps').innerHTML = sceneList.map((s) => `
      <li><b>${esc(s.heading) || '<em>Sans titre</em>'}</b>
        <span>${esc(s.note || s.summary) || '<em>—</em>'}</span></li>`).join('')
      || '<li class="empty">Aucune scène pour l\'instant.</li>';
  }

  counts() {
    const f = this.form.elements;
    const set = (k, txt) => (this.root.querySelector(`.syn-count[data-for="${k}"]`).textContent = txt);
    const n = (k) => words(f[k].value);
    set('logline', `${f.logline.value.length} caractères · ${n('logline')} mots`);
    set('short', `${n('short')} mots`);
    const w = n('long');
    set('long', `${w} mots · ≈ ${Math.max(w ? 1 : 0, Math.round(w / 300))} page${w > 450 ? 's' : ''}`);
  }
}
