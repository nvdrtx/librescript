// Rebuilds screenplay blocks from the text lines of a PDF.
//
// Input (from PDFKit in the macOS app): pages = [{ width, height, lines: [{ x, y, w, h, text }] }]
// with x/y in points, y measured from the top of the page.
//
// Screenplays encode the element type in the indentation (US standard, 12pt Courier):
//   action / scene heading  at the left margin            (1.5in from the page edge)
//   dialogue                ≈ 1in   right of that margin
//   parenthetical           ≈ 1.6in right of that margin
//   character cue           ≈ 2.2in right of that margin
//   transition              right-aligned, ends with ":"
// Everything is measured relative to the detected action margin, so other layouts work too.

const HEADING = /^(?:\d+[A-Z]?\.?\s+)?((?:INT|EXT|EST|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E)[ .].*?)(?:\s+\d+[A-Z]?\.?)?$/i;
const TRANSITION_WORDS = /^(FADE|FONDU|CUT|COUPE|ENCHAÎN|ENCHAIN|DISSOLVE|SMASH|MATCH|NOIR|BLACK|FERMETURE|OUVERTURE)/;
const SCENE_NUMBER = /^\d+[A-Z]{0,2}\.?$/;
const PAGE_NUMBER = /^(?:page\s+)?\d+\s*\.?$/i;
const MORE = /^\((?:MORE|SUITE|PLUS|À SUIVRE)\)$/i;
const CONTD = /\s*\((?:CONT'?D|CONT\.|CONTINUED|SUITE|CONT’D)\)\s*$/i;

const isUpper = (t) => /\p{L}/u.test(t) && t === t.toLocaleUpperCase('fr-FR');
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
// Most frequent value after rounding to `step` points.
const mode = (xs, step = 4) => {
  const counts = new Map();
  for (const x of xs) { const k = Math.round(x / step) * step; counts.set(k, (counts.get(k) || 0) + 1); }
  let best = null, n = 0;
  for (const [k, c] of counts) if (c > n || (c === n && k < best)) { best = k; n = c; }
  return best ?? 0;
};

// ---- Title page ------------------------------------------------------------------------

function looksLikeTitlePage(page) {
  const lines = page.lines.filter((l) => l.text.trim());
  if (!lines.length || lines.length > 30) return false;
  if (lines.some((l) => HEADING.test(l.text.trim()))) return false;
  // Title pages are mostly empty: a centred block, then a big gap before the bottom details.
  const ys = lines.map((l) => l.y).sort((a, b) => a - b);
  const bigGap = ys.some((y, i) => i > 0 && y - ys[i - 1] > 150)
    || (ys[0] > page.height * 0.25 && ys[ys.length - 1] < page.height * 0.75); // only a centred block
  const mid = page.width / 2;
  const centred = lines.filter((l) => Math.abs(l.x + l.w / 2 - mid) < 30).length;
  return bigGap && centred >= 1;
}

export function parseTitlePage(page) {
  const lines = page.lines.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
  const mid = page.width / 2;
  const centered = lines.filter((l) => Math.abs(l.x + l.w / 2 - mid) < 40);
  const other = lines.filter((l) => !centered.includes(l));
  const tp = {};
  const rest = [];
  centered.forEach((l, i) => {
    if (i === 0) { tp.title = l.text; return; }
    if (/^(written by|écrit par|ecrit par|scénario de|scenario de|un film de|by|par)\b/i.test(l.text)) {
      tp.credit = l.text;
      return;
    }
    if (tp.credit && !tp.author) { tp.author = l.text; return; }
    if (/^(d'après|d’après|based on|adapté)/i.test(l.text)) { tp.source = l.text; return; }
    if (!tp.credit) rest.push(l.text);
    else tp.source = tp.source ? `${tp.source}\n${l.text}` : l.text;
  });
  if (rest.length) tp.subtitle = rest.join(' ');
  const contact = [];
  for (const l of other) {
    if (!tp.date && /\d{4}|\d{1,2}[\/.]\d{1,2}/.test(l.text) && l.text.length < 40) tp.date = l.text;
    else if (!tp.draft && /(version|draft|brouillon|révision|revision)/i.test(l.text)) tp.draft = l.text;
    else contact.push(l.text);
  }
  if (contact.length) tp.contact = contact.join('\n');
  return tp;
}

// ---- Body ----------------------------------------------------------------------------------

function classify(line, base, rightEdge, prevType) {
  const t = line.text.trim();
  const ind = line.x - base;
  const heading = t.match(HEADING);
  if (heading && ind < 72) return { type: 'scene_heading', text: heading[1].trim() };
  if (isUpper(t) && (/:$/.test(t) && ind > 150 || (TRANSITION_WORDS.test(t) && /:$|\.$/.test(t)))) {
    return { type: 'transition', text: t };
  }
  if (isUpper(t) && line.x + line.w > rightEdge - 6 && ind > 250 && t.length < 30) return { type: 'transition', text: t };
  if (ind >= 130 && ind < 300 && isUpper(t.replace(/\(.*?\)/g, '')) && t.length <= 50) return { type: 'character', text: t };
  if (t.startsWith('(') && ind >= 70 && ind < 200) return { type: 'parenthetical', text: t };
  if (prevType === 'parenthetical-open' && ind >= 70 && ind < 200) return { type: 'parenthetical', text: t };
  if (ind >= 40 && ind < 160) return { type: 'dialogue', text: t };
  return { type: 'action', text: t };
}

export function parsePdfLines(pages) {
  if (!pages?.length) throw new Error('Le PDF est vide.');
  const textLines = pages.flatMap((p) => p.lines).filter((l) => l.text.trim());
  if (textLines.length === 0) {
    throw new Error('Ce PDF ne contient pas de texte (c\'est peut-être un scan). Il faudrait d\'abord le passer à la reconnaissance de texte (OCR).');
  }

  let titlePage = {};
  let bodyPages = pages;
  if (pages.length > 1 && looksLikeTitlePage(pages[0])) {
    titlePage = parseTitlePage(pages[0]);
    bodyPages = pages.slice(1);
  }

  // Action margin = most common left edge of lines that are not headings/cues.
  const bodyLines = bodyPages.flatMap((p) => p.lines).filter((l) => l.text.trim() && !PAGE_NUMBER.test(l.text.trim()));
  // Candidates: left edges used by ≥15 % of lines, no further than ~2in from the page edge
  // (headings are ignored: scene numbers push them left). Fallback: the standard 1.5in.
  const xs = bodyLines.filter((l) => !HEADING.test(l.text.trim())).map((l) => Math.round(l.x / 4) * 4);
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  const candidates = [...counts].filter(([x, n]) => x <= 150 && n >= xs.length * 0.15).map(([x]) => x);
  const base = candidates.length ? Math.min(...candidates) : (xs.length ? Math.min(108, mode(xs)) : 108);
  const rightEdge = Math.max(...bodyLines.filter((l) => Math.abs(l.x - base) < 6).map((l) => l.x + l.w), base + 300);
  const steps = [];
  for (const p of bodyPages) {
    const ys = p.lines.filter((l) => l.text.trim()).map((l) => l.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > 2) steps.push(ys[i] - ys[i - 1]);
  }
  const step = Math.min(...steps.filter((s) => s >= 8).concat([median(steps) || 12])) || 12;

  const blocks = [];
  let prev = null; // { type, y, page }
  let parenOpen = false;
  bodyPages.forEach((page, pi) => {
    const lines = page.lines
      .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
      .filter((l) => l.text)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    // Header/footer page numbers: a bare number in the top or bottom inch.
    // Scene numbers: a bare number in the left or right margin, beside the heading.
    const content = lines.filter((l) =>
      !(PAGE_NUMBER.test(l.text) && (l.y < 72 || l.y > page.height - 72))
      && !(SCENE_NUMBER.test(l.text) && (l.x < base - 10 || l.x > rightEdge - 50))
      && !MORE.test(l.text));

    for (const line of content) {
      let { type, text } = classify(line, base, rightEdge, parenOpen ? 'parenthetical-open' : prev?.type);
      const newPage = !prev || prev.page !== pi;
      const gap = newPage ? Infinity : line.y - prev.y;
      const last = blocks[blocks.length - 1];

      // "ANNA (CONT'D)" right after a page break continues the same speech.
      if (type === 'character' && newPage && last?.type === 'dialogue') {
        const before = [...blocks].reverse().find((b) => b.type === 'character');
        if (before && before.text.replace(CONTD, '').trim() === text.replace(CONTD, '').trim()) {
          prev = { type: 'character-cont', y: line.y, page: pi };
          continue;
        }
      }
      if (prev?.type === 'character-cont' && type === 'dialogue' && last?.type === 'dialogue') {
        last.text += ' ' + text;
        prev = { type, y: line.y, page: pi };
        continue;
      }

      const continues = last && last.type === type && gap <= step * 1.5 &&
        ['action', 'dialogue', 'parenthetical', 'scene_heading'].includes(type) &&
        !(type === 'parenthetical' && !parenOpen);
      if (continues) {
        last.text += (last.text.endsWith('-') ? '' : ' ') + text;
      } else {
        blocks.push({ type, text });
      }
      if (type === 'parenthetical') parenOpen = !/\)\s*$/.test(blocks[blocks.length - 1].text);
      else parenOpen = false;
      prev = { type, y: line.y, page: pi };
    }
  });

  if (!blocks.length) throw new Error('Aucun texte de scénario trouvé dans ce PDF.');
  return { blocks, titlePage };
}
