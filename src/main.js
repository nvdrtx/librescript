import { ScreenplayEditor, BLOCK_TYPES } from './editor/ScreenplayEditor.js';
import { SearchToolbar } from './search/SearchToolbar.js';
import { SAMPLE, SAMPLE_META } from './sample.js';
import { paginate, scenes, characters, locations, statistics, moveScene } from './model/analysis.js';
import { toFDX, toFountain } from './model/exporters.js';
import { SceneNavigator } from './views/navigator.js';
import { CardsView } from './views/cards.js';
import { EntityView } from './views/entities.js';
import { StatsView } from './views/stats.js';
import { TitlePageView } from './views/titlepage.js';
import { buildPrint, buildSynopsisPrint } from './views/print.js';
import { SynopsisView } from './views/synopsis.js';
import { SettingsDialog } from './views/settings.js';
import { HomeView } from './views/home.js';
import { ProjectView } from './views/project.js';
import { Guide } from './views/guide.js';
import { parsePdfLines } from './model/importPdf.js';
import { debounce, isNative, postNative, saveText, showToast } from './views/dom.js';

const STORAGE_KEY = 'librescript.draft';
const FILE_FORMAT = 'librescript';
const emptyMeta = () => ({ project: {}, synopsis: {}, titlePage: {}, characters: {}, locations: {} });

// ---- Document ---------------------------------------------------------------------------

function parseDocument(data) {
  if (Array.isArray(data)) return { blocks: data, meta: emptyMeta() }; // version 1 files
  if (!data || !Array.isArray(data.blocks)) throw new Error('Fichier Librescript invalide');
  return { blocks: data.blocks, meta: { ...emptyMeta(), ...(data.meta || {}) } };
}

const cleanBlocks = (blocks) => blocks.map((b) => {
  const out = { type: String(b.type || 'action'), text: String(b.text ?? '') };
  if (b.note) out.note = String(b.note);
  if (b.color) out.color = String(b.color);
  return out;
});

function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return parseDocument(saved);
  } catch {}
  return { blocks: SAMPLE, meta: structuredClone(SAMPLE_META) };
}

const initial = loadDraft();
let meta = initial.meta;

const editor = new ScreenplayEditor(document.getElementById('editor'), cleanBlocks(initial.blocks));
const search = new SearchToolbar(document.getElementById('search'), editor, BLOCK_TYPES);

// ---- Views ------------------------------------------------------------------------------

let currentView = 'script';

function goToBlock(index) {
  showView('script');
  requestAnimationFrame(() => editor.goToBlock(index));
}

function reorderScenes(from, to) {
  editor.applyModel(moveScene(editor.model, from, to), { keepSelection: false });
}

const sceneNav = new SceneNavigator(document.getElementById('navigator'), { onGoTo: goToBlock, onMove: reorderScenes });
const cards = new CardsView(document.getElementById('view-cards'), {
  onOpen: goToBlock,
  onMove: reorderScenes,
  onUpdate: (block, fields) => editor.updateBlock(block, fields),
});
const characterView = new EntityView(document.getElementById('view-characters'), {
  kind: 'characters',
  title: 'Personnages',
  fields: [
    { key: 'role', label: 'Rôle', placeholder: 'Protagoniste, antagoniste, secondaire…' },
    { key: 'age', label: 'Âge', placeholder: '30 ans' },
    { key: 'description', label: 'Description', multiline: true, placeholder: 'Apparence, caractère…' },
    { key: 'goal', label: 'Objectif', multiline: true, rows: 2, placeholder: 'Ce qu\'il ou elle veut' },
    { key: 'arc', label: 'Évolution', multiline: true, rows: 2, placeholder: 'Comment le personnage change' },
    { key: 'notes', label: 'Notes', multiline: true, rows: 3 },
  ],
  onOpen: goToBlock,
  onSave: (name, fields) => setMeta('characters', name, fields),
});
const locationView = new EntityView(document.getElementById('view-locations'), {
  kind: 'locations',
  title: 'Lieux',
  fields: [
    { key: 'description', label: 'Description', multiline: true, placeholder: 'À quoi ressemble ce lieu ?' },
    { key: 'address', label: 'Lieu de tournage', placeholder: 'Adresse, décor, studio…' },
    { key: 'notes', label: 'Notes', multiline: true, rows: 3 },
  ],
  onOpen: goToBlock,
  onSave: (name, fields) => setMeta('locations', name, fields),
});
const statsView = new StatsView(document.getElementById('view-stats'), { onOpen: goToBlock });
const synopsisView = new SynopsisView(document.getElementById('view-synopsis'), {
  onChange: ({ logline, short, long }) => {
    meta.synopsis = { short, long };
    meta.project = { ...(meta.project || {}), description: logline }; // the logline is the project description
    documentChanged();
  },
  onExport: () => exportAs('synopsis'),
});
const projectView = new ProjectView(document.getElementById('view-project'), {
  onChange: (p) => { meta.project = p; documentChanged(); updateTitle(); },
});
const titleView = new TitlePageView(document.getElementById('view-title'), {
  onChange: (tp) => { meta.titlePage = tp; documentChanged(); updateTitle(); },
});

function setMeta(group, name, fields) {
  meta[group][name] = { ...(meta[group][name] || {}), ...fields };
  documentChanged();
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.rail [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === name);
    b.setAttribute('aria-current', b.dataset.view === name ? 'page' : 'false');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${name}`));
  document.body.dataset.view = name;
  if (name !== 'script') search.hide();
  refreshNow();
}

document.querySelector('.rail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) showView(b.dataset.view);
});

// ---- Refresh derived views ----------------------------------------------------------------

function refreshNow() {
  const blocks = editor.model;
  const { pageOf, pages } = paginate(blocks);
  const list = scenes(blocks, pageOf);
  editor.decoratePages(pageOf);
  document.querySelector('.doc-stats').textContent =
    `${pages} p. · ${list.length} scène${list.length > 1 ? 's' : ''}`;
  switch (currentView) {
    case 'project': projectView.update(meta.project || {}, statistics(blocks), meta.titlePage?.title || ''); break;
    case 'synopsis': synopsisView.update({ logline: meta.project?.description, ...(meta.synopsis || {}) }, list); break;
    case 'script': sceneNav.update(list, pages); break;
    case 'cards': cards.update(list); break;
    case 'characters': characterView.update(characters(blocks), meta.characters, list); break;
    case 'locations': locationView.update(locations(blocks), meta.locations, list); break;
    case 'stats': statsView.update(statistics(blocks)); break;
    case 'title': titleView.update(meta.titlePage); break;
  }
}
const refresh = debounce(refreshNow, 150);

function updateTitle() {
  document.querySelector('.doc-title').textContent = projectName() || 'Sans titre';
}

// ---- Block type picker follows the caret --------------------------------------------------

const picker = document.getElementById('block-type');
picker.innerHTML = BLOCK_TYPES.map((t) => `<option value="${t.type}">${t.label}</option>`).join('');
const syncPicker = () => (picker.value = editor.model[editor.currentBlockIndex()]?.type ?? 'action');
editor.addEventListener('selection', () => {
  syncPicker();
  sceneNav.highlight(editor.currentBlockIndex());
});
picker.addEventListener('change', () => editor.setBlockType(editor.currentBlockIndex(), picker.value));

// ---- Changes: autosave + tell the native app ------------------------------------------------

let suppressDirty = false;
const saveDraftNow = () => {
  try {
    localStorage.setItem(STORAGE_KEY, serialize());
    localStorage.setItem(`${STORAGE_KEY}.modified`, String(Date.now()));
  } catch {}
};
const autosave = debounce(saveDraftNow, 400);

function documentChanged() {
  if (!suppressDirty) {
    postNative({ type: 'dirty' });
    setSaveState(isNative ? 'pending' : 'saved-browser');
  }
  autosave();
}

// Save indicator in the top bar. The macOS app reports 'saved' once the file is written.
const SAVE_LABELS = {
  pending: 'Enregistrement…',
  saved: '✓ Enregistré',
  'saved-browser': '✓ Enregistré dans le navigateur',
  error: '⚠ Non enregistré',
};
function setSaveState(state) {
  const el = document.querySelector('.save-state');
  el.textContent = SAVE_LABELS[state] || '';
  el.dataset.state = state;
}

editor.addEventListener('change', () => {
  syncPicker();
  documentChanged();
  refresh();
});

function serialize() {
  return JSON.stringify({ format: FILE_FORMAT, version: 2, blocks: cleanBlocks(editor.model), meta }, null, 2);
}

function replaceDocument({ blocks, meta: m }) {
  suppressDirty = true;
  meta = m;
  editor.model = blocks.length ? cleanBlocks(blocks) : [{ type: 'scene_heading', text: '' }];
  editor.undoStack = [];
  editor.redoStack = [];
  editor.lastSelection = null;
  editor.render();
  search.hide();
  editor.emit('change');
  suppressDirty = false;
  updateTitle();
  titleView.update(meta.titlePage);
  setSaveState(isNative ? 'saved' : 'saved-browser');
  showScreen('project');
  refreshNow();
  if (currentView === 'script') editor.goToBlock(0);
}

// ---- Home screen ------------------------------------------------------------------------------

const onProject = () => document.body.dataset.screen === 'project';

function projectName(m = meta) {
  return m?.project?.name || m?.titlePage?.title || '';
}

function showScreen(name) {
  document.body.dataset.screen = name;
  if (name === 'home') { search.hide(); document.querySelector('.toast')?.classList.remove('on'); }
}

function newProject({ name, description }) {
  replaceDocument({
    blocks: [{ type: 'scene_heading', text: '' }],
    meta: { ...emptyMeta(), project: { name, description }, titlePage: { title: name } },
  });
  showView('script');
}

// In a browser there is one local draft; the macOS app lists real files (see showHome).
function browserProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const { meta: m } = parseDocument(JSON.parse(raw));
    return [{ path: 'draft', name: projectName(m), description: m.project?.description, cover: m.project?.cover,
              modified: Number(localStorage.getItem(`${STORAGE_KEY}.modified`)) || 0 }];
  } catch { return []; }
}

const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.librescript,.json', hidden: true });
document.body.appendChild(fileInput);
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try { replaceDocument(parseDocument(JSON.parse(await file.text()))); }
  catch (e) { alert(`Impossible d'ouvrir ce fichier : ${e.message}`); }
});

const guide = new Guide();
const settings = new SettingsDialog();
document.querySelector('.rail [data-act="settings"]').addEventListener('click', () => settings.open());
const home = new HomeView(document.getElementById('home'), {
  onCreate: (p) => (isNative ? postNative({ type: 'createProject', ...p }) : newProject(p)),
  onOpenDialog: () => (isNative ? postNative({ type: 'openDialog' }) : fileInput.click()),
  onImportPdf: () => postNative({ type: 'importPdf' }),
  native: isNative,
  onOpenProject: (path) => {
    if (isNative) postNative({ type: 'openProject', path });
    else { replaceDocument(loadDraft()); }
  },
  onRemove: (path) => postNative({ type: 'removeRecent', path }),
  onDelete: (path, name) => {
    if (isNative) { postNative({ type: 'deleteProject', path }); return; }
    if (!confirm(`Supprimer « ${name} » ? Le brouillon enregistré dans ce navigateur sera effacé.`)) return;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(`${STORAGE_KEY}.modified`); } catch {}
    home.update(browserProjects(), { native: false });
  },
  onRevealFolder: () => postNative({ type: 'revealLibrary' }),
  onReveal: (path) => postNative({ type: 'revealProject', path }),
  onGuide: () => guide.open(),
  onSettings: () => settings.open(),
});

function goHome() {
  if (isNative) { postNative({ type: 'closeProject' }); return; }
  saveDraftNow();
  home.update(browserProjects(), { native: false });
  showScreen('home');
}
document.querySelector('.rail .brand').addEventListener('click', goHome);

// ---- Exports --------------------------------------------------------------------------------

const baseName = () => (meta.titlePage.title || 'Scénario').replace(/[\/\\:*?"<>|]/g, '-');

let printKind = 'script';
function preparePrint(kind = printKind) {
  printKind = kind; // WebKit fires "beforeprint" during printing: rebuild the same document
  const root = document.getElementById('print-root');
  if (kind === 'synopsis') buildSynopsisPrint(root, meta);
  else buildPrint(root, editor.model, meta.titlePage);
}
window.addEventListener('beforeprint', () => preparePrint());
window.addEventListener('afterprint', () => { printKind = 'script'; });

function exportAs(format) {
  document.querySelector('.menu').open = false;
  if (!onProject()) return;
  if (format === 'pdf' || format === 'synopsis') {
    const kind = format === 'pdf' ? 'script' : 'synopsis';
    const filename = kind === 'script' ? `${baseName()}.pdf` : `${baseName()} - Synopsis.pdf`;
    if (isNative) { postNative({ type: 'exportPDF', filename, kind }); return; }
    printKind = kind;
    preparePrint(kind);
    window.print();
  } else if (format === 'fdx') {
    saveText(toFDX(editor.model, meta.titlePage), `${baseName()}.fdx`, 'application/xml');
  } else if (format === 'fountain') {
    saveText(toFountain(editor.model, meta.titlePage), `${baseName()}.fountain`, 'text/plain');
  }
}
document.querySelector('.menu-pop').addEventListener('click', (e) => {
  const b = e.target.closest('[data-export]');
  if (b) exportAs(b.dataset.export);
});
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.menu');
  if (menu.open && !menu.contains(e.target)) menu.open = false;
});

// ---- Keyboard (in a browser; the macOS app routes these through its menu bar) ---------------

// ⌥⌘ + digit → module
const VIEWS = ['project', 'script', 'cards', 'characters', 'locations', 'stats', 'title', 'synopsis'];
if (!isNative) {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && e.altKey && /^Digit[0-7]$/.test(e.code)) { e.preventDefault(); showView(VIEWS[Number(e.code.slice(5))]); return; }
    if (mod && e.key === ',') { e.preventDefault(); settings.open(); return; }
    if (mod && key === 'f') { e.preventDefault(); showView('script'); search.activate(); }
    else if ((mod && key === 'g') || e.key === 'F3') {
      if (!search.visible) return;
      e.preventDefault();
      search.step(e.shiftKey);
    }
  });
}
document.getElementById('open-search').addEventListener('click', () => search.activate());

// ---- API for the native app's menus --------------------------------------------------------

window.librescript = {
  editor,
  search,
  serialize,
  load(json) { replaceDocument(parseDocument(JSON.parse(json))); },
  newDocument() { replaceDocument({ blocks: [{ type: 'scene_heading', text: '' }], meta: emptyMeta() }); },
  newProject,
  // Called by the macOS app with the recent projects it found on disk.
  showHome(projects, folder) {
    home.update(projects || [], { native: true, folder });
    showScreen('home');
  },
  guide() { guide.open(); },
  setSaveState,
  get projectName() { return projectName(); },
  openSettings() { settings.open(); },
  // Called by the macOS app with the PDF's text lines (see importPdf.js). Throws with a readable message.
  importPdf(pages, name) {
    const { blocks, titlePage } = parsePdfLines(pages);
    replaceDocument({ blocks, meta: { ...emptyMeta(), project: { name }, titlePage } });
    showView('script');
    const n = scenes(editor.model).length;
    const p = paginate(editor.model).pages;
    showToast(`PDF importé : ${n} scène${n > 1 ? 's' : ''}, ${p} page${p > 1 ? 's' : ''}. Vérifie la mise en forme : tout est enregistré automatiquement.`);
    return JSON.stringify({ blocks: editor.model.length, scenes: n });
  },
  createDialog() { showScreen('home'); home.openCreate(); },
  get screen() { return document.body.dataset.screen; },
  loadSample() { replaceDocument({ blocks: SAMPLE, meta: structuredClone(SAMPLE_META) }); },
  find() { if (onProject()) { showView('script'); search.activate(); } },
  findNext() { if (onProject()) { showView('script'); search.visible ? search.step(false) : search.activate(); } },
  findPrevious() { if (onProject()) { showView('script'); search.visible ? search.step(true) : search.activate(); } },
  undo() { if (onProject()) editor.undo(); },
  redo() { if (onProject()) editor.redo(); },
  showView(v) { if (onProject()) showView(v); },
  preparePrint,
  exportText(format) {
    return format === 'fdx' ? toFDX(editor.model, meta.titlePage) : toFountain(editor.model, meta.titlePage);
  },
  exportAs,
  get meta() { return meta; },
  get view() { return currentView; },
};

// Scale the page to fit its column (the page keeps its real 8.5in width so line breaks match print).
const pageWrap = document.querySelector('.page-wrap');
new ResizeObserver(() => {
  const avail = pageWrap.clientWidth - 32;
  const zoom = window.innerWidth < 700 ? 1 : Math.min(1, avail / (8.5 * 96));
  document.documentElement.style.setProperty('--page-zoom', zoom.toFixed(3));
}).observe(pageWrap);

updateTitle();
document.body.dataset.view = 'script';
refreshNow();
if (!isNative) home.update(browserProjects(), { native: false });
showScreen('home');
if (isNative) {
  document.documentElement.classList.add('native');
  postNative({ type: 'ready' });
}
