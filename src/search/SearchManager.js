// SearchManager — find / replace logic for the screenplay editor.
//
// Modeled on Story Architect's BusinessLayer::SearchManager (libcorelib.dylib):
//   find(backward)      → routes "#<n>" queries to findNumber(), everything else to findText()
//   findText(backward)  → continues from the current selection, honours case sensitivity and
//                         the "search in" paragraph-type filter, skips hidden blocks, wraps around
//   findNumber()        → jumps to the first scene whose number starts with <n>
//   replace one         → replaces the selection if it is the current match, then finds the next one
//   replace all         → replaces every match inside a single undo step
//
// It is DOM-free: it talks to the editor through a small adapter so it can be tested on its own.
//
// Editor adapter contract:
//   blocks()                      → [{ type, text, visible?, sceneNumber? }]
//   selection()                   → { start: Pos, end: Pos } | null    where Pos = { block, offset }
//   select(start, end)            → select a range and scroll it into view
//   replaceRange(start, end, str) → replace text in a single block
//   transaction(fn)               → run fn as one undoable edit (optional)

export const SEARCH_IN_ALL = null;

export class SearchManager {
  constructor(editor) {
    this.editor = editor;
    this.query = '';
    this.replacement = '';
    this.caseSensitive = false;
    this.searchInType = SEARCH_IN_ALL; // null = whole text, otherwise a block type
    this.readOnly = false;
  }

  setQuery(query) { this.query = query ?? ''; }
  setReplacement(text) { this.replacement = text ?? ''; }
  setCaseSensitive(flag) { this.caseSensitive = !!flag; }
  setSearchInType(type) { this.searchInType = type || SEARCH_IN_ALL; }
  setReadOnly(flag) { this.readOnly = !!flag; }

  // Entry point used by the toolbar (Implementation::find(bool)).
  find(backward = false) {
    if (!this.query) return null;
    if (this.query.startsWith('#')) return this.findNumber();
    return this.findText(backward);
  }

  findNext() { return this.find(false); }
  findPrevious() { return this.find(true); }

  // Implementation::findText(bool)
  findText(backward = false) {
    const matches = this.allMatches();
    if (matches.length === 0) return null;

    const sel = this.editor.selection();
    // Start from the selection: after it when going forward, before it when going back.
    // If nothing is selected, use the caret (start === end).
    let anchor = { block: 0, offset: 0 };
    if (sel) anchor = backward ? sel.start : sel.end;

    let match;
    if (backward) {
      match = [...matches].reverse().find((m) => comparePos(m.end, anchor) <= 0 && !sameRange(m, sel));
      match ??= matches[matches.length - 1]; // wrap to the end
    } else {
      match = matches.find((m) => comparePos(m.start, anchor) >= 0 && !sameRange(m, sel));
      match ??= matches[0]; // wrap to the start
    }

    this.editor.select(match.start, match.end);
    return match;
  }

  // Implementation::findNumber(): "#12" → first scene whose number starts with "12".
  findNumber() {
    const wanted = this.query.slice(1).trim();
    if (!wanted) return null;
    const blocks = this.editor.blocks();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.sceneNumber == null || b.visible === false) continue;
      if (String(b.sceneNumber).startsWith(wanted)) {
        const pos = { block: i, offset: 0 };
        this.editor.select(pos, pos);
        return { start: pos, end: pos, block: i };
      }
    }
    return null;
  }

  // Every match in document order, after the case and "search in" filters.
  allMatches() {
    if (!this.query || this.query.startsWith('#')) return [];
    const needle = this.caseSensitive ? this.query : this.query.toLocaleLowerCase();
    const out = [];
    this.editor.blocks().forEach((b, i) => {
      if (b.visible === false) return;
      if (this.searchInType && b.type !== this.searchInType) return;
      const hay = this.caseSensitive ? b.text : b.text.toLocaleLowerCase();
      let from = 0;
      while (needle.length > 0) {
        const at = hay.indexOf(needle, from);
        if (at === -1) break;
        out.push({ start: { block: i, offset: at }, end: { block: i, offset: at + needle.length } });
        from = at + needle.length;
      }
    });
    return out;
  }

  // "3 / 12"-style counter for the toolbar.
  status() {
    const matches = this.allMatches();
    const sel = this.editor.selection();
    const index = matches.findIndex((m) => sameRange(m, sel));
    return { total: matches.length, current: index + 1 };
  }

  // Toolbar "Replace": replace the selection only if it is the current match, then go to the next one.
  replaceOne() {
    if (this.readOnly || !this.query || this.query.startsWith('#')) return false;
    const sel = this.editor.selection();
    const isMatch = sel && this.allMatches().some((m) => sameRange(m, sel));
    if (!isMatch) {
      this.findText(false);
      return false;
    }
    const run = () => this.editor.replaceRange(sel.start, sel.end, this.replacement);
    if (this.editor.transaction) this.editor.transaction(run);
    else run();
    const after = { block: sel.start.block, offset: sel.start.offset + this.replacement.length };
    this.editor.select(after, after);
    this.findText(false);
    return true;
  }

  // Toolbar "Replace all": one undo step, from the end backwards so offsets stay valid.
  replaceAll() {
    if (this.readOnly || !this.query || this.query.startsWith('#')) return 0;
    const matches = this.allMatches();
    if (matches.length === 0) return 0;
    const run = () => {
      for (let i = matches.length - 1; i >= 0; i--) {
        this.editor.replaceRange(matches[i].start, matches[i].end, this.replacement);
      }
    };
    if (this.editor.transaction) this.editor.transaction(run);
    else run();
    return matches.length;
  }
}

export function comparePos(a, b) {
  return a.block - b.block || a.offset - b.offset;
}

function sameRange(m, sel) {
  return !!sel && comparePos(m.start, sel.start) === 0 && comparePos(m.end, sel.end) === 0;
}
