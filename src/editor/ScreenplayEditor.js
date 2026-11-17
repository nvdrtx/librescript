// ScreenplayEditor — a minimal block-based screenplay editor.
// The block list is the source of truth; the DOM is re-rendered from it.
// It also implements the adapter that SearchManager expects.

export const BLOCK_TYPES = [
  { type: 'scene_heading', label: 'Titre de scène' },
  { type: 'action', label: 'Action' },
  { type: 'character', label: 'Personnage' },
  { type: 'parenthetical', label: 'Didascalie' },
  { type: 'dialogue', label: 'Dialogue' },
  { type: 'transition', label: 'Transition' },
];

// Which block comes after Enter, like most screenplay editors.
const NEXT_TYPE = {
  scene_heading: 'action',
  action: 'action',
  character: 'dialogue',
  parenthetical: 'dialogue',
  dialogue: 'character',
  transition: 'scene_heading',
};

export class ScreenplayEditor extends EventTarget {
  constructor(root, blocks) {
    super();
    this.root = root;
    this.model = blocks.map((b) => ({ type: b.type, text: b.text }));
    this.undoStack = [];
    this.redoStack = [];
    this.typingSnapshotTimer = null;

    root.contentEditable = 'true';
    root.spellcheck = true;
    root.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    root.addEventListener('input', () => this.onInput());
    root.addEventListener('keydown', (e) => this.onKeyDown(e));
    root.addEventListener('paste', (e) => this.onPaste(e));
    document.addEventListener('selectionchange', () => {
      if (root.contains(document.getSelection()?.anchorNode)) this.emit('selection');
    });
    this.render();
  }

  // ---- SearchManager adapter -------------------------------------------------

  blocks() {
    let scene = 0;
    return this.model.map((b) => ({
      ...b,
      visible: true,
      sceneNumber: b.type === 'scene_heading' ? ++scene : null,
    }));
  }

  selection() {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return this.lastSelection ?? null;
    const range = sel.getRangeAt(0);
    if (!this.root.contains(range.startContainer)) return this.lastSelection ?? null;
    const start = this.domToPos(range.startContainer, range.startOffset);
    const end = this.domToPos(range.endContainer, range.endOffset);
    if (!start || !end) return null;
    this.lastSelection = { start, end };
    return this.lastSelection;
  }

  select(start, end) {
    this.lastSelection = { start, end };
    const a = this.posToDom(start);
    const b = this.posToDom(end);
    if (!a || !b) return;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this.root.children[start.block]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.emit('selection');
  }

  replaceRange(start, end, text) {
    if (start.block !== end.block) throw new Error('replaceRange spans one block only');
    const b = this.model[start.block];
    b.text = b.text.slice(0, start.offset) + text + b.text.slice(end.offset);
    if (!this.inTransaction) {
      this.render();
      this.emit('change');
    }
  }

  transaction(fn) {
    this.pushUndo();
    this.inTransaction = true;
    try { fn(); } finally { this.inTransaction = false; }
    this.render();
    this.emit('change');
  }

  // Replace the whole block list as one undoable step (scene reordering, notes…).
  applyModel(blocks, { keepSelection = true } = {}) {
    this.pushUndo();
    const sel = keepSelection ? this.selection() : null;
    this.model = blocks.map((b) => ({ ...b }));
    this.render();
    if (sel && this.model[sel.start.block]) this.select(sel.start, sel.start);
    this.emit('change');
  }

  // Change extra fields of one block (e.g. a scene note) without touching its text.
  updateBlock(index, fields) {
    if (!this.model[index]) return;
    this.pushUndo();
    Object.assign(this.model[index], fields);
    this.emit('change');
  }

  // Page-break marks: pageOf[i] is the page block i starts on.
  decoratePages(pageOf) {
    [...this.root.children].forEach((el, i) => {
      const p = pageOf[i];
      if (i > 0 && p !== pageOf[i - 1]) el.dataset.page = p;
      else delete el.dataset.page;
    });
  }

  // Put the caret at the start of a block and bring it into view.
  goToBlock(index) {
    const pos = { block: index, offset: 0 };
    this.root.focus({ preventScroll: true });
    this.select(pos, pos);
  }

  // ---- Editing ---------------------------------------------------------------

  setBlockType(index, type) {
    if (!this.model[index]) return;
    this.pushUndo();
    const sel = this.selection();
    this.model[index].type = type;
    this.render();
    if (sel) this.select(sel.start, sel.end);
    this.emit('change');
  }

  currentBlockIndex() {
    return this.selection()?.start.block ?? 0;
  }

  onBeforeInput(e) {
    // Plain typing goes through the browser; snapshot it for undo in short bursts.
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      e.inputType === 'historyUndo' ? this.undo() : this.redo();
      return;
    }
    if (!this.typingSnapshotTimer) this.pushUndo();
    clearTimeout(this.typingSnapshotTimer);
    this.typingSnapshotTimer = setTimeout(() => (this.typingSnapshotTimer = null), 800);
  }

  onInput() {
    // Read the DOM back into the model. Blocks only ever hold plain text.
    const children = [...this.root.children];
    if (children.length !== this.model.length) {
      // The browser merged or split blocks (e.g. select-all + delete): rebuild from the DOM.
      this.model = children.map((el, i) => ({
        ...(this.model[i]?.type === el.dataset.type ? this.model[i] : {}), // keep scene notes/colours
        type: el.dataset.type || 'action',
        text: el.textContent,
      }));
      if (this.model.length === 0) this.model = [{ type: 'action', text: '' }];
      const sel = this.selection();
      this.render();
      if (sel) this.select(sel.start, sel.start);
    } else {
      children.forEach((el, i) => (this.model[i].text = el.textContent));
    }
    this.emit('change');
  }

  onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.splitBlock();
      return;
    }
    if (e.key === 'Backspace') {
      const sel = this.selection();
      if (sel && sel.start.block === sel.end.block && sel.start.offset === 0 && sel.end.offset === 0 && sel.start.block > 0) {
        e.preventDefault();
        this.mergeWithPrevious(sel.start.block);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = this.currentBlockIndex();
      const order = BLOCK_TYPES.map((t) => t.type);
      const cur = order.indexOf(this.model[i].type);
      const next = order[(cur + (e.shiftKey ? order.length - 1 : 1)) % order.length];
      this.setBlockType(i, next);
    }
  }

  onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    const sel = this.selection();
    if (!sel) return;
    this.pushUndo();
    this.deleteSelection(sel);
    const lines = text.split('\n');
    const at = sel.start;
    const b = this.model[at.block];
    const tail = b.text.slice(at.offset);
    b.text = b.text.slice(0, at.offset) + lines[0];
    const extra = lines.slice(1).map((t) => ({ type: 'action', text: t }));
    this.model.splice(at.block + 1, 0, ...extra);
    const last = this.model[at.block + extra.length];
    const caret = { block: at.block + extra.length, offset: last.text.length };
    last.text += tail;
    this.render();
    this.select(caret, caret);
    this.emit('change');
  }

  splitBlock() {
    const sel = this.selection();
    if (!sel) return;
    this.pushUndo();
    this.deleteSelection(sel);
    const { block, offset } = sel.start;
    const b = this.model[block];
    const tail = b.text.slice(offset);
    b.text = b.text.slice(0, offset);
    this.model.splice(block + 1, 0, { type: NEXT_TYPE[b.type] || 'action', text: tail });
    this.render();
    const caret = { block: block + 1, offset: 0 };
    this.select(caret, caret);
    this.emit('change');
  }

  mergeWithPrevious(index) {
    this.pushUndo();
    const prev = this.model[index - 1];
    const caret = { block: index - 1, offset: prev.text.length };
    prev.text += this.model[index].text;
    this.model.splice(index, 1);
    this.render();
    this.select(caret, caret);
    this.emit('change');
  }

  deleteSelection({ start, end }) {
    if (start.block === end.block && start.offset === end.offset) return;
    const first = this.model[start.block];
    const last = this.model[end.block];
    first.text = first.text.slice(0, start.offset) + last.text.slice(end.offset);
    this.model.splice(start.block + 1, end.block - start.block);
  }

  // ---- Undo ------------------------------------------------------------------

  snapshot() {
    return { model: this.model.map((b) => ({ ...b })), selection: this.selection() };
  }

  pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  restore(state) {
    this.model = state.model;
    this.render();
    if (state.selection) this.select(state.selection.start, state.selection.end);
    this.emit('change');
  }

  undo() {
    const state = this.undoStack.pop();
    if (!state) return;
    this.redoStack.push(this.snapshot());
    this.restore(state);
  }

  redo() {
    const state = this.redoStack.pop();
    if (!state) return;
    this.undoStack.push(this.snapshot());
    this.restore(state);
  }

  // ---- DOM mapping -----------------------------------------------------------

  render() {
    const frag = document.createDocumentFragment();
    let scene = 0;
    for (const b of this.model) {
      const el = document.createElement('div');
      el.className = `block ${b.type}`;
      el.dataset.type = b.type;
      if (b.type === 'scene_heading') el.dataset.scene = ++scene;
      el.textContent = b.text;
      if (!b.text) el.appendChild(document.createElement('br'));
      frag.appendChild(el);
    }
    this.root.replaceChildren(frag);
  }

  domToPos(node, offset) {
    let blockEl = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (blockEl && blockEl.parentElement !== this.root) blockEl = blockEl.parentElement;
    if (node === this.root) {
      const i = Math.min(offset, this.root.children.length - 1);
      return { block: Math.max(0, i), offset: 0 };
    }
    if (!blockEl) return null;
    const block = [...this.root.children].indexOf(blockEl);
    const range = document.createRange();
    range.selectNodeContents(blockEl);
    range.setEnd(node, offset);
    return { block, offset: range.toString().length };
  }

  posToDom({ block, offset }) {
    const el = this.root.children[block];
    if (!el) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let n;
    while ((n = walker.nextNode())) {
      if (remaining <= n.length) return { node: n, offset: remaining };
      remaining -= n.length;
    }
    return { node: el, offset: el.childNodes.length && !el.firstChild.length ? 0 : el.childNodes.length };
  }

  // Range objects for a list of matches (used to paint highlights).
  rangesFor(matches) {
    return matches.map((m) => {
      const a = this.posToDom(m.start);
      const b = this.posToDom(m.end);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r;
    });
  }

  emit(name) {
    this.dispatchEvent(new Event(name));
  }
}
