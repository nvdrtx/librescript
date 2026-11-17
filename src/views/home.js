// Home screen: actions + a quote on the left, recent projects as cards on the right.

import { esc } from './dom.js';

const QUOTES = [
  ['Le cinéma, c\'est l\'écriture moderne dont l\'encre est la lumière.', 'Jean Cocteau'],
  ['Écrire, c\'est aussi ne pas parler. C\'est se taire.', 'Marguerite Duras'],
  ['Il faut toujours écrire comme si c\'était la première fois.', 'Proverbe d\'atelier'],
];

// Stable colour per project name, for covers without an image.
export function coverHue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function coverHTML(name, cover) {
  if (cover) return `<img src="${esc(cover)}" alt="" />`;
  const hue = coverHue(name || '?');
  return `<div class="cover-placeholder" style="--h:${hue}"><span>${esc(name || 'Sans titre')}</span></div>`;
}

const formatDate = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

export class HomeView {
  constructor(root, { onCreate, onOpenDialog, onImportPdf, onOpenProject, onRemove, onReveal, onDelete, onRevealFolder, onGuide, onSettings, native }) {
    this.root = root;
    const [quote, author] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    root.innerHTML = `
      <aside class="home-side">
        <div class="home-brand"><span class="brand">L</span> Librescript</div>
        <blockquote class="home-quote">
          <p>${esc(quote)}</p>
          <cite>${esc(author)}</cite>
        </blockquote>
        <nav class="home-actions">
          <button data-act="create"><span class="ico">＋</span>Créer une histoire</button>
          <button data-act="open"><span class="ico">▭</span>Ouvrir une histoire</button>
          ${native ? '<button data-act="import"><span class="ico">⇣</span>Importer un PDF</button>' : ''}
          <button data-act="guide"><span class="ico">?</span>Guide de l'utilisateur</button>
        </nav>
        <nav class="home-actions home-settings">
          <button data-act="settings"><span class="ico">⚙</span>Réglages · thème</button>
        </nav>
      </aside>
      <main class="home-main">
        <div class="home-float">
          <button data-act="create" title="Créer une histoire (⌘N)" aria-label="Créer une histoire">＋</button>
          <button data-act="open" title="Ouvrir une histoire (⌘O)" aria-label="Ouvrir une histoire">▭</button>
        </div>
        <h2 class="home-title">Mes histoires</h2>
        <p class="home-folder"></p>
        <div class="project-grid"></div>
      </main>
      <dialog class="create-dialog">
        <form method="dialog">
          <h3>Nouvelle histoire</h3>
          <label><span>Nom</span><input name="name" required placeholder="Le Vent du large" autocomplete="off" /></label>
          <label><span>Description</span><textarea name="description" rows="3" placeholder="De quoi parle cette histoire ?"></textarea></label>
          <div class="dialog-actions">
            <button value="cancel" formnovalidate>Annuler</button>
            <button value="ok" class="primary">Créer</button>
          </div>
        </form>
      </dialog>`;

    this.grid = root.querySelector('.project-grid');
    this.dialog = root.querySelector('.create-dialog');

    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'create') this.openCreate();
      else if (act === 'open') onOpenDialog();
      else if (act === 'guide') onGuide();
      else if (act === 'import') onImportPdf();
      else if (act === 'settings') onSettings();
      else if (act === 'folder') onRevealFolder();
      const card = e.target.closest('.project-card');
      if (!card) return;
      const path = card.dataset.path;
      if (e.target.closest('.card-delete')) onDelete(path, card.querySelector('h3').textContent);
      else if (e.target.closest('.card-remove')) onRemove(path);
      else if (e.target.closest('.card-reveal')) onReveal(path);
      else onOpenProject(path);
    });
    this.grid.addEventListener('keydown', (e) => {
      const card = e.target.closest('.project-card');
      if (card && e.key === 'Enter') onOpenProject(card.dataset.path);
    });
    this.dialog.addEventListener('close', () => {
      if (this.dialog.returnValue !== 'ok') return;
      const data = Object.fromEntries(new FormData(this.dialog.querySelector('form')));
      onCreate({ name: data.name.trim(), description: data.description.trim() });
    });
  }

  openCreate() {
    this.dialog.querySelector('form').reset();
    this.dialog.showModal();
    this.dialog.querySelector('input').focus();
  }

  // projects: [{ path, name, description, cover, modified, missing?, library? }]
  update(projects, { native, folder }) {
    this.root.querySelector('.home-folder').innerHTML = native && folder
      ? `Enregistrées automatiquement dans <button data-act="folder" class="linklike" title="Afficher dans le Finder">${esc(folder.replace(/^\/Users\/[^/]+/, '~'))}</button>`
      : 'Enregistrées automatiquement dans ce navigateur.';
    this.grid.innerHTML = projects.map((p) => `
      <article class="project-card${p.missing ? ' missing' : ''}" tabindex="0" data-path="${esc(p.path)}" title="${esc(p.path)}">
        <div class="project-cover">${coverHTML(p.name, p.cover)}</div>
        <div class="project-info">
          <h3>${esc(p.name || 'Sans titre')}</h3>
          <p class="project-desc">${esc(p.description || '')}</p>
          <p class="project-date">${p.missing ? 'Fichier introuvable' : esc(formatDate(p.modified))}</p>
          <div class="project-tools">
            ${native ? '<button class="card-reveal" title="Afficher dans le Finder" aria-label="Afficher dans le Finder">⌕</button>' : ''}
            ${native && !p.library ? '<button class="card-remove" title="Retirer de la liste (le fichier est conservé)" aria-label="Retirer de la liste">✕</button>' : ''}
            ${!p.missing ? '<button class="card-delete" title="Supprimer l\'histoire" aria-label="Supprimer l\'histoire">🗑</button>' : ''}
            <span class="project-kind" title="${native ? 'Fichier sur ce Mac' : 'Brouillon du navigateur'}">${native ? '💻' : '🌐'}</span>
          </div>
        </div>
      </article>`).join('')
      || `<div class="home-empty">
            <p>Aucune histoire pour l'instant.</p>
            <button data-act="create" class="primary">Créer une histoire</button>
          </div>`;
  }
}
