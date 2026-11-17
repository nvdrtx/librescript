// Appearance settings: colour theme, accent colour, light script page.
// Saved in localStorage and, in the macOS app, in the app's preferences (so they survive
// everything and the native title bar can follow the theme).

import { isNative, postNative } from './dom.js';

export const THEMES = [
  { id: 'auto', name: 'Automatique', hint: 'Suit le mode clair / sombre de macOS', dark: null, sw: ['#e9e7e2', '#1b1b1d', '#2f6fde'] },
  { id: 'classique-clair', name: 'Classique clair', dark: false, sw: ['#e9e7e2', '#ffffff', '#2f6fde'] },
  { id: 'classique-sombre', name: 'Classique sombre', dark: true, sw: ['#1b1b1d', '#262628', '#6ea0ff'] },
  { id: 'sepia', name: 'Sépia', hint: 'Papier chaud, reposant', dark: false, sw: ['#e8dcc6', '#fbf5e9', '#a0522d'] },
  { id: 'nuit', name: 'Nuit', hint: 'Bleu profond', dark: true, sw: ['#0f1522', '#1a2336', '#7aa2ff'] },
  { id: 'foret', name: 'Forêt', hint: 'Vert sombre', dark: true, sw: ['#141a16', '#1f2922', '#5fbf85'] },
  { id: 'contraste', name: 'Contraste élevé', hint: 'Lisibilité maximale', dark: false, sw: ['#ffffff', '#000000', '#0040c0'] },
];

export const ACCENTS = [
  { id: '', name: 'Celle du thème' },
  { id: '#2f6fde', name: 'Bleu' },
  { id: '#7c5cff', name: 'Violet' },
  { id: '#d6457a', name: 'Rose' },
  { id: '#d9473b', name: 'Rouge' },
  { id: '#e08a2e', name: 'Orange' },
  { id: '#2e9e6a', name: 'Vert' },
  { id: '#1a9bb0', name: 'Turquoise' },
];

const KEY = 'librescript.prefs';
const DEFAULTS = { theme: 'auto', accent: '', paperLight: false };

export function loadPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  // The macOS app injects its stored preferences before the page loads.
  const nativePrefs = globalThis.__librescriptPrefs || {};
  return { ...DEFAULTS, ...saved, ...nativePrefs };
}

export function applyPrefs(p) {
  const root = document.documentElement;
  root.dataset.theme = THEMES.some((t) => t.id === p.theme) ? p.theme : 'auto';
  if (p.accent) root.style.setProperty('--accent', p.accent);
  else root.style.removeProperty('--accent');
  root.classList.toggle('paper-light', !!p.paperLight);
}

function savePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  const theme = THEMES.find((t) => t.id === p.theme);
  postNative({ type: 'prefs', prefs: p, appearance: theme?.dark == null ? 'auto' : theme.dark ? 'dark' : 'light' });
}

export class SettingsDialog {
  constructor() {
    this.prefs = loadPrefs();
    applyPrefs(this.prefs);
    if (isNative) savePrefs(this.prefs); // sync the title bar on launch

    this.dialog = document.createElement('dialog');
    this.dialog.className = 'settings-dialog';
    this.dialog.innerHTML = `
      <form method="dialog">
        <h2>Réglages</h2>
        <h3>Thème</h3>
        <div class="theme-grid" role="radiogroup" aria-label="Thème">
          ${THEMES.map((t) => `
            <label class="theme-card" title="${t.hint || ''}">
              <input type="radio" name="theme" value="${t.id}" />
              <span class="theme-preview" style="--a:${t.sw[0]};--b:${t.sw[1]};--c:${t.sw[2]}">
                <i class="tp-rail"></i><i class="tp-page"></i><i class="tp-dot"></i>
              </span>
              <span class="theme-name">${t.name}</span>
            </label>`).join('')}
        </div>
        <h3>Couleur d'accent</h3>
        <div class="accent-row" role="radiogroup" aria-label="Couleur d'accent">
          ${ACCENTS.map((a) => `
            <label class="accent-swatch" title="${a.name}">
              <input type="radio" name="accent" value="${a.id}" aria-label="${a.name}" />
              <span style="--c:${a.id || 'transparent'}" class="${a.id ? '' : 'theme-default'}"></span>
            </label>`).join('')}
        </div>
        <h3>Page de scénario</h3>
        <label class="check"><input type="checkbox" name="paperLight" />
          Garder la page claire (blanche) même avec un thème sombre</label>
        <div class="dialog-actions"><button class="primary">Terminé</button></div>
      </form>`;
    document.body.appendChild(this.dialog);
    const form = this.dialog.querySelector('form');
    form.addEventListener('change', () => {
      this.prefs = {
        theme: form.elements.theme.value,
        accent: form.elements.accent.value,
        paperLight: form.elements.paperLight.checked,
      };
      applyPrefs(this.prefs);
      savePrefs(this.prefs);
    });
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
  }

  open() {
    const f = this.dialog.querySelector('form').elements;
    f.theme.value = this.prefs.theme;
    for (const r of this.dialog.querySelectorAll('input[name=accent]')) r.checked = r.value === (this.prefs.accent || '');
    f.paperLight.checked = !!this.prefs.paperLight;
    if (!this.dialog.open) this.dialog.showModal();
  }
}
