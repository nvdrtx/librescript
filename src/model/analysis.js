// Pure functions that derive everything the side views need from the block list:
// scenes, characters, locations, page layout and statistics. No DOM here.

// ---- Page layout (US Letter, Courier 12pt = 10 chars/inch, 6 lines/inch) ----------------

export const LINES_PER_PAGE = 54; // 9in of text between 1in top/bottom margins

// Width in characters and blank lines before, per block type.
// These match the indents in styles.css (page text width = 6in = 60 chars).
export const LAYOUT = {
  scene_heading: { width: 60, before: 1 },
  action: { width: 60, before: 1 },
  character: { width: 38, before: 1 },
  parenthetical: { width: 25, before: 0 },
  dialogue: { width: 35, before: 0 },
  transition: { width: 60, before: 1 },
};

// Word-wrap like the browser does for monospace text.
export function wrapLines(text, width) {
  if (!text) return 1;
  let lines = 0;
  for (const para of text.split('\n')) {
    let len = 0;
    lines++;
    for (const word of para.split(' ')) {
      const w = word.length;
      if (len === 0) {
        len = w;
      } else if (len + 1 + w <= width) {
        len += 1 + w;
      } else {
        lines++;
        len = w;
      }
      while (len > width) { lines++; len -= width; }
    }
  }
  return lines;
}

// Returns, for every block, the page it starts on, plus the total page count.
// A block that does not fit moves to the next page; headings and character cues
// are kept with the block that follows them.
export function paginate(blocks) {
  const pageOf = new Array(blocks.length);
  let page = 1;
  let used = 0;
  const height = (b) => wrapLines(b.text, (LAYOUT[b.type] || LAYOUT.action).width);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const lay = LAYOUT[b.type] || LAYOUT.action;
    const h = height(b);
    let need = (used === 0 ? 0 : lay.before) + h;
    // Keep with next: heading / character / parenthetical need room for the next block's first line.
    const next = blocks[i + 1];
    if (['scene_heading', 'character', 'parenthetical'].includes(b.type) && next) {
      need += (LAYOUT[next.type] || LAYOUT.action).before + 1;
    }
    if (used > 0 && used + need > LINES_PER_PAGE) {
      page++;
      used = 0;
    }
    pageOf[i] = page;
    used += (used === 0 ? 0 : lay.before) + h;
    while (used > LINES_PER_PAGE) { page++; used -= LINES_PER_PAGE; } // very long block
  }
  const lastBlockLines = used;
  return { pageOf, pages: blocks.length ? page : 0, lastPageFill: lastBlockLines / LINES_PER_PAGE };
}

// ---- Names ---------------------------------------------------------------------------

// "ANNA (V.O.)" / "Anna (CONT'D)" / "ANNA (SUITE)" → "ANNA"
export function characterName(cue) {
  let name = (cue || '').trim().toUpperCase();
  let prev;
  do { prev = name; name = name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\^$/, '').trim(); } while (name !== prev);
  return name;
}

const PLACE_PREFIX = /^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.|EXT\.|INT\b|EXT\b)\s*/i;

// "INT. CABIN — CONTINUOUS" → { intExt: 'INT', location: 'CABIN', time: 'CONTINUOUS' }
export function parseHeading(text) {
  const t = (text || '').trim();
  const m = t.match(PLACE_PREFIX);
  let intExt = '';
  let rest = t;
  if (m) {
    const p = m[1].toUpperCase().replace(/\s|\./g, '');
    intExt = p.includes('/') ? 'INT/EXT' : p === 'I/E' ? 'INT/EXT' : p.startsWith('INT') ? 'INT' : 'EXT';
    rest = t.slice(m[0].length);
  }
  const parts = rest.split(/\s+[—–-]\s+/);
  const time = parts.length > 1 ? parts.pop().trim().toUpperCase() : '';
  const location = parts.join(' — ').trim().toUpperCase();
  return { intExt, location, time };
}

// ---- Scenes ----------------------------------------------------------------------------

const WORDS = (s) => (s.match(/[\p{L}\p{N}'’-]+/gu) || []).length;

export function scenes(blocks, pageOf = paginate(blocks).pageOf) {
  const out = [];
  let cur = null;
  blocks.forEach((b, i) => {
    if (b.type === 'scene_heading') {
      if (cur) cur.end = i;
      cur = {
        number: out.length + 1,
        start: i,
        end: blocks.length,
        heading: b.text,
        ...parseHeading(b.text),
        note: b.note || '',
        color: b.color || '',
        page: pageOf[i],
        characters: [],
        summary: '',
        words: 0,
      };
      out.push(cur);
      return;
    }
    if (!cur) return;
    if (b.type === 'character') {
      const n = characterName(b.text);
      if (n && !cur.characters.includes(n)) cur.characters.push(n);
    }
    if (b.type === 'action' && !cur.summary && b.text.trim()) cur.summary = b.text.trim();
    cur.words += WORDS(b.text);
  });
  // Length in pages (eighths, like a production breakdown).
  for (const s of out) {
    const lines = blocks.slice(s.start, s.end).reduce(
      (n, b, k) => n + (k ? (LAYOUT[b.type] || LAYOUT.action).before : 0) + wrapLines(b.text, (LAYOUT[b.type] || LAYOUT.action).width), 0);
    s.lines = lines;
    s.eighths = Math.max(1, Math.round((lines / LINES_PER_PAGE) * 8));
  }
  return out;
}

export function formatEighths(e) {
  const whole = Math.floor(e / 8);
  const rest = e % 8;
  if (!rest) return `${whole}`;
  return whole ? `${whole} ${rest}/8` : `${rest}/8`;
}

// Moves scene `from` so it lands at position `to` (both 0-based scene indices).
// Blocks before the first scene heading stay where they are.
export function moveScene(blocks, from, to) {
  const list = scenes(blocks);
  if (from === to || !list[from] || !list[to]) return blocks;
  const head = blocks.slice(0, list[0].start);
  const chunks = list.map((s) => blocks.slice(s.start, s.end));
  const [moved] = chunks.splice(from, 1);
  chunks.splice(to, 0, moved);
  return [...head, ...chunks.flat()];
}

// ---- Characters & locations -------------------------------------------------------------

export function characters(blocks) {
  const map = new Map();
  const sceneList = scenes(blocks);
  const sceneAt = (i) => sceneList.findLast((s) => s.start <= i);
  let speaker = null;
  blocks.forEach((b, i) => {
    if (b.type === 'character') {
      const name = characterName(b.text);
      if (!name) { speaker = null; return; }
      if (!map.has(name)) map.set(name, { name, cues: 0, words: 0, scenes: [], firstBlock: i });
      const c = map.get(name);
      c.cues++;
      const s = sceneAt(i);
      if (s && !c.scenes.includes(s.number)) c.scenes.push(s.number);
      speaker = c;
    } else if (b.type === 'dialogue' && speaker) {
      speaker.words += WORDS(b.text);
    } else if (b.type !== 'parenthetical') {
      speaker = null;
    }
  });
  const list = [...map.values()];
  for (const c of list) c.seconds = Math.round(c.words / 2.5); // ~150 words per minute
  return list.sort((a, b) => b.cues - a.cues || a.name.localeCompare(b.name));
}

export function locations(blocks) {
  const map = new Map();
  for (const s of scenes(blocks)) {
    if (!s.location) continue;
    if (!map.has(s.location)) map.set(s.location, { name: s.location, scenes: [], intExt: new Set(), times: new Set(), eighths: 0, firstBlock: s.start });
    const l = map.get(s.location);
    l.scenes.push(s.number);
    if (s.intExt) l.intExt.add(s.intExt);
    if (s.time) l.times.add(s.time);
    l.eighths += s.eighths;
  }
  return [...map.values()]
    .map((l) => ({ ...l, intExt: [...l.intExt], times: [...l.times] }))
    .sort((a, b) => b.scenes.length - a.scenes.length || a.name.localeCompare(b.name));
}

// ---- Statistics ------------------------------------------------------------------------

export function statistics(blocks) {
  const { pages, lastPageFill } = paginate(blocks);
  const sceneList = scenes(blocks);
  const chars = characters(blocks);
  const words = blocks.reduce((n, b) => n + WORDS(b.text), 0);
  const dialogueWords = blocks.filter((b) => b.type === 'dialogue').reduce((n, b) => n + WORDS(b.text), 0);
  const count = (pred) => sceneList.filter(pred).length;
  // One page ≈ one minute of screen time.
  const exactPages = pages ? pages - 1 + lastPageFill : 0;
  return {
    pages,
    minutes: Math.round(exactPages),
    scenes: sceneList.length,
    words,
    dialogueShare: words ? dialogueWords / words : 0,
    characters: chars,
    locations: locations(blocks),
    interior: count((s) => s.intExt === 'INT'),
    exterior: count((s) => s.intExt === 'EXT'),
    mixed: count((s) => s.intExt === 'INT/EXT'),
    day: count((s) => /JOUR|DAY|MATIN|MORNING|AUBE|DAWN|MIDI|NOON|APRÈS-MIDI|AFTERNOON/.test(s.time)),
    night: count((s) => /NUIT|NIGHT|SOIR|EVENING|DUSK|CRÉPUSCULE/.test(s.time)),
    sceneList,
  };
}

export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, '0')}` : `${s} s`;
}
