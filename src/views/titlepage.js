// Title page: a form on the left, a live preview of the printed page on the right.

import { esc } from './dom.js';
import { titlePageLines } from '../model/exporters.js';

const FIELDS = [
  { key: 'title', label: 'Titre', placeholder: 'Le Vent du large' },
  { key: 'subtitle', label: 'Sous-titre / épisode', placeholder: 'Épisode 1 — « Départ »' },
  { key: 'credit', label: 'Mention', placeholder: 'Écrit par' },
  { key: 'author', label: 'Auteur(s)', placeholder: 'Prénom Nom' },
  { key: 'source', label: 'D\'après', placeholder: 'D\'après le roman de…' },
  { key: 'draft', label: 'Version', placeholder: 'Première version' },
  { key: 'date', label: 'Date', placeholder: '17 novembre 2026' },
  { key: 'contact', label: 'Contact', placeholder: 'Agent, téléphone, adresse…', multiline: true },
];

export class TitlePageView {
  constructor(root, { onChange }) {
    this.root = root;
    root.innerHTML = `
      <div class="view-head"><h2>Page de titre</h2><p class="hint">Elle est ajoutée en première page des exports PDF, Final Draft et Fountain.</p></div>
      <div class="tp-layout">
        <form class="tp-form">${FIELDS.map((f) => `
          <label><span>${f.label}</span>${f.multiline
            ? `<textarea name="${f.key}" rows="3" placeholder="${esc(f.placeholder)}"></textarea>`
            : `<input name="${f.key}" placeholder="${esc(f.placeholder)}" />`}</label>`).join('')}
        </form>
        <div class="tp-preview" aria-label="Aperçu"><div class="tp-paper"></div></div>
      </div>`;
    this.form = root.querySelector('form');
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('input', () => {
      const data = Object.fromEntries(new FormData(this.form));
      this.preview(data);
      onChange(data);
    });
  }

  update(tp) {
    if (this.root.contains(document.activeElement)) return;
    for (const f of FIELDS) this.form.elements[f.key].value = tp[f.key] || '';
    this.preview(tp);
  }

  preview(tp) {
    const { center, bottom } = titlePageLines(tp);
    this.root.querySelector('.tp-paper').innerHTML = `
      <div class="tp-center">${center.map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('') || '<p class="muted">Titre</p>'}</div>
      <div class="tp-bottom">${bottom.map((l) => `<p>${esc(l).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
  }
}
