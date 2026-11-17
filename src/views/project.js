// "Projet" module: name, description and cover image shown on the home screen.

import { esc } from './dom.js';
import { coverHTML } from './home.js';

// Downscale an image file to a JPEG data URL (keeps .librescript files small).
export function fileToCover(file, maxW = 600, maxH = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible'));
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export class ProjectView {
  constructor(root, { onChange }) {
    this.root = root;
    this.onChange = onChange;
    root.innerHTML = `
      <div class="view-head"><h2>Projet</h2><p class="hint">Ces informations apparaissent sur la carte de l'histoire, à l'accueil.</p></div>
      <div class="project-layout">
        <div class="project-cover-edit">
          <div class="project-cover big"></div>
          <div class="cover-buttons">
            <label class="button">Choisir une image…<input type="file" accept="image/*" hidden /></label>
            <button class="cover-clear">Retirer</button>
          </div>
        </div>
        <form class="tp-form project-form">
          <label><span>Nom de l'histoire</span><input name="name" placeholder="Nom" /></label>
          <label><span>Description</span><textarea name="description" rows="4" placeholder="Une phrase qui résume l'histoire (logline)…"></textarea></label>
          <label><span>Genre</span><input name="genre" placeholder="Drame, documentaire, comédie…" /></label>
          <label><span>Format</span><input name="format" placeholder="Long métrage, court métrage, série…" /></label>
          <dl class="facts project-facts"></dl>
        </form>
      </div>`;
    this.form = root.querySelector('form');
    this.form.addEventListener('submit', (e) => e.preventDefault());
    this.form.addEventListener('input', () => {
      this.project = { ...this.project, ...Object.fromEntries(new FormData(this.form)) };
      this.paintCover();
      onChange(this.project);
    });
    root.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        this.project = { ...this.project, cover: await fileToCover(file) };
        this.paintCover();
        onChange(this.project);
      } catch (err) {
        alert(`Impossible d'utiliser cette image : ${err.message}`);
      }
    });
    root.querySelector('.cover-clear').addEventListener('click', () => {
      this.project = { ...this.project, cover: '' };
      this.paintCover();
      onChange(this.project);
    });
  }

  update(project, stats, fallbackName = '') {
    this.project = { ...project };
    this.fallbackName = fallbackName;
    this.form.elements.name.placeholder = fallbackName || 'Nom';
    if (!this.root.contains(document.activeElement)) {
      for (const k of ['name', 'description', 'genre', 'format']) this.form.elements[k].value = project[k] || '';
    }
    this.paintCover();
    const facts = [['Pages', stats.pages], ['Scènes', stats.scenes], ['Durée', `${stats.minutes} min`], ['Personnages', stats.characters.length]];
    this.root.querySelector('.project-facts').innerHTML =
      facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  paintCover() {
    this.root.querySelector('.project-cover.big').innerHTML = coverHTML(this.project.name || this.fallbackName, this.project.cover);
    this.root.querySelector('.cover-clear').hidden = !this.project.cover;
  }
}
