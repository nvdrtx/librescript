export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Small notification at the bottom of the window.
let toastTimer;
export function showToast(message, ms = 4000) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { className: 'toast', role: 'status' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

export const debounce = (fn, ms) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

// Native-app bridge (WKWebView) — no-op in a plain browser.
const native = globalThis.webkit?.messageHandlers?.librescript ?? null;
export const isNative = !!native;
export const postNative = (msg) => { try { native?.postMessage(msg); } catch {} };

// Save text to a file: native save panel in the app, download in a browser.
export function saveText(text, filename, mime) {
  if (isNative) { postNative({ type: 'export', text, filename }); return; }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Drag-to-reorder for a list of elements carrying data-index. Calls onMove(from, to).
export function makeSortable(container, selector, onMove) {
  let from = null;
  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(selector);
    if (!item) return;
    from = Number(item.dataset.index);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  container.addEventListener('dragend', (e) => {
    e.target.closest(selector)?.classList.remove('dragging');
    container.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    from = null;
  });
  container.addEventListener('dragover', (e) => {
    const item = e.target.closest(selector);
    if (from === null || !item) return;
    e.preventDefault();
    container.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    item.classList.add(Number(item.dataset.index) > from ? 'drop-after' : 'drop-before');
  });
  container.addEventListener('drop', (e) => {
    const item = e.target.closest(selector);
    if (from === null || !item) return;
    e.preventDefault();
    const to = Number(item.dataset.index);
    if (to !== from) onMove(from, to);
  });
}
