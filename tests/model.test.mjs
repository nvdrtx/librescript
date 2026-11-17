// Logic tests, no browser needed. Run with:  ./run-tests.sh
import {
  wrapLines, paginate, LINES_PER_PAGE, characterName, parseHeading, scenes, moveScene,
  characters, locations, statistics, formatEighths,
} from '../src/model/analysis.js';
import { toFDX, toFountain } from '../src/model/exporters.js';
import { SearchManager } from '../src/search/SearchManager.js';
import { parsePdfLines, parseTitlePage } from '../src/model/importPdf.js';

const results = [];
const test = (name, fn) => { try { fn(); results.push([true, name]); } catch (e) { results.push([false, `${name} — ${e.message}`]); } };
const eq = (a, b) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`attendu ${B}, obtenu ${A}`); };
const ok = (v, msg = 'faux') => { if (!v) throw new Error(msg); };

const B = (type, text, extra = {}) => ({ type, text, ...extra });
const doc = [
  B('action', 'FONDU D\'OUVERTURE :'),
  B('scene_heading', 'EXT. PORT — AUBE', { note: 'ouverture', color: '#3498db' }),
  B('action', 'Brume sur l\'eau.'),
  B('character', 'ANNA'),
  B('dialogue', 'Le vent tourne.'),
  B('character', 'LUKAS (V.O.)'),
  B('parenthetical', '(bas)'),
  B('dialogue', 'Avant la tempête ?'),
  B('scene_heading', 'INT. CABINE — NUIT'),
  B('character', 'Anna (suite)'),
  B('dialogue', 'Si le vent tient, on touche l\'île au crépuscule.'),
  B('scene_heading', 'INT./EXT. PORT - SOIR'),
  B('action', 'Silence.'),
];

// ---- Layout ----
test('wrapLines coupe aux espaces', () => {
  eq(wrapLines('', 10), 1);
  eq(wrapLines('aaaa bbbb', 10), 1);
  eq(wrapLines('aaaa bbbb cc', 10), 2);
  eq(wrapLines('a'.repeat(25), 10), 3);
  eq(wrapLines('un\ndeux', 60), 2);
});
test('paginate : petit document = 1 page', () => {
  const p = paginate(doc);
  eq(p.pages, 1);
  ok(p.pageOf.every((n) => n === 1));
});
test('paginate : 54 lignes par page', () => {
  const many = Array.from({ length: 60 }, (_, i) => B('action', `Ligne ${i}`)); // 1 + 59×2 lignes
  const p = paginate(many);
  eq(p.pageOf[0], 1);
  eq(p.pageOf[26], 1); // avant le bloc 26 : 1 + 25×2 = 51 lignes, +2 = 53
  eq(p.pageOf[27], 2); // 53 + 2 = 55 > 54
  eq(p.pages, 3);
});
test('paginate : un titre de scène ne reste pas seul en bas de page', () => {
  const filler = Array.from({ length: 26 }, () => B('action', 'x')); // 51 lignes
  const p = paginate([...filler, B('scene_heading', 'INT. A — JOUR'), B('action', 'y')]);
  eq(p.pageOf[26], 2);
});

// ---- Names ----
test('characterName retire les extensions', () => {
  eq(characterName('anna (v.o.)'), 'ANNA');
  eq(characterName("LUKAS (CONT'D) (O.S.)"), 'LUKAS');
  eq(characterName('  Marc  '), 'MARC');
});
test('parseHeading', () => {
  eq(parseHeading('INT. CABINE — NUIT'), { intExt: 'INT', location: 'CABINE', time: 'NUIT' });
  eq(parseHeading('EXT. PLEINE MER - JOUR'), { intExt: 'EXT', location: 'PLEINE MER', time: 'JOUR' });
  eq(parseHeading('INT./EXT. VOITURE — SOIR').intExt, 'INT/EXT');
  eq(parseHeading('MONTAGE').location, 'MONTAGE');
});

// ---- Scenes ----
test('scenes : numéros, personnages, note, résumé', () => {
  const s = scenes(doc);
  eq(s.length, 3);
  eq(s.map((x) => x.number), [1, 2, 3]);
  eq(s[0].characters, ['ANNA', 'LUKAS']);
  eq(s[0].note, 'ouverture');
  eq(s[0].summary, 'Brume sur l\'eau.');
  eq([s[0].start, s[0].end], [1, 8]);
  eq(s[2].end, doc.length);
});
test('formatEighths', () => {
  eq(formatEighths(1), '1/8');
  eq(formatEighths(8), '1');
  eq(formatEighths(11), '1 3/8');
});
test('moveScene déplace des scènes entières, garde le préambule', () => {
  const moved = moveScene(doc, 0, 2);
  eq(moved[0].text, 'FONDU D\'OUVERTURE :');
  eq(scenes(moved).map((s) => s.heading), ['INT. CABINE — NUIT', 'INT./EXT. PORT - SOIR', 'EXT. PORT — AUBE']);
  eq(moved.length, doc.length);
  eq(moveScene(doc, 2, 0)[1].text, 'INT./EXT. PORT - SOIR');
  eq(moveScene(doc, 1, 1), doc);
});

// ---- Characters / locations / stats ----
test('characters : répliques, mots, scènes', () => {
  const c = characters(doc);
  eq(c.map((x) => x.name), ['ANNA', 'LUKAS']);
  eq(c[0].cues, 2);
  eq(c[0].scenes, [1, 2]);
  eq(c[0].words, 3 + 9);
  eq(c[1].words, 3); // la didascalie ne compte pas
});
test('locations regroupe les scènes par lieu', () => {
  const l = locations(doc);
  eq(l[0].name, 'PORT');
  eq(l[0].scenes, [1, 3]);
  eq(l[0].intExt.sort(), ['EXT', 'INT/EXT']);
});
test('statistics', () => {
  const st = statistics(doc);
  eq(st.scenes, 3);
  eq(st.pages, 1);
  eq([st.interior, st.exterior, st.mixed], [1, 1, 1]);
  eq([st.day, st.night], [1, 2]);
  ok(st.dialogueShare > 0.3 && st.dialogueShare < 0.9, `part du dialogue ${st.dialogueShare}`);
});

// ---- Exports ----
test('toFDX : XML Final Draft valide et échappé', () => {
  const x = toFDX([B('scene_heading', 'INT. A & B — JOUR'), B('dialogue', '<Salut> "toi"')], { title: 'Mon film', author: 'Moi' });
  ok(x.startsWith('<?xml'), 'en-tête XML');
  ok(x.includes('<Paragraph Type="Scene Heading"><Text>INT. A &amp; B — JOUR</Text></Paragraph>'), 'scène');
  ok(x.includes('&lt;Salut&gt; &quot;toi&quot;'), 'échappement');
  ok(x.includes('<TitlePage>') && x.includes('MON FILM') && x.includes('Moi'), 'page de titre');
  ok((x.match(/<Paragraph /g) || []).length > 2);
});
test('toFountain : page de titre et éléments forcés', () => {
  const f = toFountain([
    B('scene_heading', 'INT. CUISINE — JOUR'),
    B('scene_heading', 'MONTAGE'),
    B('action', 'BOUM'),
    B('character', 'Anna'),
    B('parenthetical', 'bas'),
    B('dialogue', 'Salut.'),
    B('transition', 'fondu au noir'),
  ], { title: 'Film', author: 'Moi' });
  ok(f.startsWith('Title: Film\nCredit: Écrit par\nAuthor: Moi\n\n'), 'titre');
  ok(f.includes('\nINT. CUISINE — JOUR\n'), 'scène standard');
  ok(f.includes('\n.MONTAGE\n'), 'scène forcée');
  ok(f.includes('\n!BOUM\n'), 'action forcée');
  ok(f.includes('\n@Anna\n(bas)\nSalut.\n'), 'dialogue');
  ok(f.includes('\n> FONDU AU NOIR\n'), 'transition forcée');
});

// ---- Search (same suite as tests/search.test.html, condensed) ----
function fakeEditor(blocks) {
  let selection = { start: { block: 0, offset: 0 }, end: { block: 0, offset: 0 } };
  const model = blocks.map((b) => ({ ...b }));
  return {
    model,
    blocks: () => { let n = 0; return model.map((b) => ({ ...b, sceneNumber: b.type === 'scene_heading' ? ++n : null })); },
    selection: () => selection,
    select: (start, end) => { selection = { start, end }; },
    replaceRange(start, end, text) { const b = model[start.block]; b.text = b.text.slice(0, start.offset) + text + b.text.slice(end.offset); },
    transaction(fn) { fn(); },
  };
}
test('recherche : suivant, filtre, #scène, tout remplacer', () => {
  const e = fakeEditor(doc);
  const s = new SearchManager(e);
  s.setQuery('vent');
  eq(s.allMatches().length, 2);
  s.findNext(); s.findNext();
  eq(s.status(), { total: 2, current: 2 });
  s.setSearchInType('action'); eq(s.allMatches().length, 0); s.setSearchInType(null);
  s.setQuery('#3'); eq(s.find().block, 11);
  s.setQuery('vent'); s.setReplacement('mistral'); eq(s.replaceAll(), 2);
  eq(e.model[4].text, 'Le mistral tourne.');
});

// ---- PDF import ----
// Lay blocks out like a standard US script PDF (12pt Courier, 7.2pt per char) to feed the parser.
const X = { scene_heading: 108, action: 108, character: 266, parenthetical: 223, dialogue: 180, transition: null };
function fakePdf(blocks, { titleLines = null, sceneNumbers = false, extraLines = [] } = {}) {
  const pages = [];
  if (titleLines) pages.push({ width: 612, height: 792, lines: titleLines });
  let page = { width: 612, height: 792, lines: [] };
  let y = 72;
  let scene = 0;
  for (const b of blocks) {
    if (['scene_heading', 'action', 'character', 'transition'].includes(b.type) && page.lines.length) y += 12;
    let text = b.text;
    let x = X[b.type];
    if (b.type === 'scene_heading' && sceneNumbers) { scene++; text = `${scene} ${text} ${scene}`; x = 54; }
    const w = text.length * 7.2;
    if (b.type === 'transition') x = 540 - w;
    page.lines.push({ x, y, w, h: 12, text });
    y += 12;
  }
  page.lines.push(...extraLines);
  pages.push(page);
  return pages;
}
const sample = [
  B('scene_heading', 'EXT. PORT — AUBE'),
  B('action', 'Brume sur l\'eau.'),
  B('character', 'ANNA'),
  B('dialogue', 'Le vent tourne.'),
  B('character', 'LUKAS'),
  B('parenthetical', '(bas)'),
  B('dialogue', 'Avant la tempête ?'),
  B('transition', 'CUT TO:'),
  B('scene_heading', 'INT. CABINE — NUIT'),
  B('action', 'ANNA ET LUKAS SE TAISENT.'),
];
test('import PDF : types retrouvés grâce à l\'indentation', () => {
  const { blocks } = parsePdfLines(fakePdf(sample));
  eq(blocks.map((b) => b.type), sample.map((b) => b.type));
  eq(blocks.map((b) => b.text), sample.map((b) => b.text));
});
test('import PDF : numéros de scène et de page retirés', () => {
  const { blocks } = parsePdfLines(fakePdf(sample, { sceneNumbers: true, extraLines: [{ x: 520, y: 36, w: 14, h: 12, text: '2.' }] }));
  eq(blocks[0], { type: 'scene_heading', text: 'EXT. PORT — AUBE' });
  ok(!blocks.some((b) => b.text === '2.'), 'numéro de page');
});
test('import PDF : numéros de scène sur des lignes séparées (marges)', () => {
  const pages = fakePdf(sample);
  const headings = pages[0].lines.filter((l) => /^(INT|EXT)/.test(l.text));
  headings.forEach((h, i) => pages[0].lines.push({ x: 54, y: h.y, w: 8, h: 12, text: String(i + 1) }, { x: 560, y: h.y, w: 8, h: 12, text: `${i + 1}.` }));
  const { blocks } = parsePdfLines(pages);
  eq(blocks.map((b) => b.text), sample.map((b) => b.text));
});
test('import PDF : lignes coupées réunies en un bloc', () => {
  const pages = [{ width: 612, height: 792, lines: [
    { x: 108, y: 72, w: 400, h: 12, text: 'La radio grésille. MARC, le capitaine du port,' },
    { x: 108, y: 84, w: 200, h: 12, text: 'écoute, un café froid à la main.' },
    { x: 266, y: 108, w: 30, h: 12, text: 'MARC' },
    { x: 223, y: 120, w: 100, h: 12, text: '(dans la radio,' },
    { x: 223, y: 132, w: 60, h: 12, text: 'fatigué)' },
    { x: 180, y: 144, w: 250, h: 12, text: 'Voilier Albatros, ici la' },
    { x: 180, y: 156, w: 250, h: 12, text: 'capitainerie. Répondez.' },
  ] }];
  const { blocks } = parsePdfLines(pages);
  eq(blocks, [
    B('action', 'La radio grésille. MARC, le capitaine du port, écoute, un café froid à la main.'),
    B('character', 'MARC'),
    B('parenthetical', '(dans la radio, fatigué)'),
    B('dialogue', 'Voilier Albatros, ici la capitainerie. Répondez.'),
  ]);
});
test('import PDF : réplique coupée par un saut de page (MORE / CONT\'D)', () => {
  const pages = [
    { width: 612, height: 792, lines: [
      { x: 266, y: 700, w: 30, h: 12, text: 'ANNA' },
      { x: 180, y: 712, w: 200, h: 12, text: 'Si le vent tient,' },
      { x: 266, y: 724, w: 40, h: 12, text: '(MORE)' },
    ] },
    { width: 612, height: 792, lines: [
      { x: 266, y: 72, w: 80, h: 12, text: "ANNA (CONT'D)" },
      { x: 180, y: 84, w: 200, h: 12, text: 'on touche l\'île.' },
    ] },
  ];
  const { blocks } = parsePdfLines(pages);
  eq(blocks, [B('character', 'ANNA'), B('dialogue', 'Si le vent tient, on touche l\'île.')]);
});
test('import PDF : page de titre', () => {
  const title = [
    { x: 236, y: 300, w: 140, h: 12, text: 'LE VENT DU LARGE' },
    { x: 263, y: 324, w: 86, h: 12, text: 'Écrit par' },
    { x: 256, y: 348, w: 100, h: 12, text: 'Prénom Nom' },
    { x: 108, y: 680, w: 140, h: 12, text: 'Première version' },
    { x: 108, y: 692, w: 140, h: 12, text: '17 novembre 2026' },
    { x: 108, y: 704, w: 200, h: 12, text: 'agent@exemple.fr' },
  ];
  const { titlePage, blocks } = parsePdfLines(fakePdf(sample, { titleLines: title }));
  eq(titlePage, { title: 'LE VENT DU LARGE', credit: 'Écrit par', author: 'Prénom Nom', draft: 'Première version', date: '17 novembre 2026', contact: 'agent@exemple.fr' });
  eq(blocks.length, sample.length);
});
test('import PDF : PDF sans texte → message clair', () => {
  let msg = '';
  try { parsePdfLines([{ width: 612, height: 792, lines: [] }]); } catch (e) { msg = e.message; }
  ok(msg.includes('scan'), msg);
});

// ---- Report ----
const failed = results.filter(([p]) => !p);
for (const [p, n] of results) print(`${p ? '✓' : '✗'} ${n}`);
print(`\n${results.length - failed.length}/${results.length} réussis`);
if (failed.length) throw new Error(`${failed.length} test(s) en échec`);
