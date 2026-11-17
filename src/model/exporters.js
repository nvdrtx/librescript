// Text exports: Final Draft (.fdx) and Fountain (.fountain).

const FDX_TYPE = {
  scene_heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
};

const xml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Strip characters XML 1.0 does not allow.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function titlePageLines(tp = {}) {
  const center = [];
  if (tp.title) center.push(tp.title.toUpperCase());
  if (tp.subtitle) center.push(tp.subtitle);
  if (tp.author) center.push('', tp.credit || 'Écrit par', '', tp.author);
  if (tp.source) center.push('', tp.source);
  const bottom = [tp.draft, tp.date, tp.contact].filter(Boolean);
  return { center, bottom };
}

export function toFDX(blocks, titlePage = {}) {
  const paras = blocks.map((b) => {
    const type = FDX_TYPE[b.type] || 'Action';
    const lines = String(b.text).split('\n').map((l) => `<Text>${xml(l)}</Text>`).join('<Text>\n</Text>');
    return `    <Paragraph Type="${type}">${lines || '<Text></Text>'}</Paragraph>`;
  });
  const { center, bottom } = titlePageLines(titlePage);
  const tpParas = [
    ...Array(12).fill('      <Paragraph Alignment="Center" Type="Action"><Text></Text></Paragraph>'),
    ...center.map((l) => `      <Paragraph Alignment="Center" Type="Action"><Text>${xml(l)}</Text></Paragraph>`),
    ...Array(16).fill('      <Paragraph Alignment="Left" Type="Action"><Text></Text></Paragraph>'),
    ...bottom.flatMap((l) => String(l).split('\n')).map((l) => `      <Paragraph Alignment="Left" Type="Action"><Text>${xml(l)}</Text></Paragraph>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join('\n')}
  </Content>
  <TitlePage>
    <Content>
${tpParas.join('\n')}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

// Fountain: https://fountain.io/syntax — force element types where plain text would be ambiguous.
export function toFountain(blocks, titlePage = {}) {
  const tp = [];
  const kv = (k, v) => v && tp.push(`${k}: ${String(v).replace(/\n/g, '\n    ')}`);
  kv('Title', titlePage.title);
  kv('Subtitle', titlePage.subtitle);
  kv('Credit', titlePage.author ? titlePage.credit || 'Écrit par' : '');
  kv('Author', titlePage.author);
  kv('Source', titlePage.source);
  kv('Draft date', titlePage.date);
  kv('Notes', titlePage.draft);
  kv('Contact', titlePage.contact);

  const out = [];
  for (const b of blocks) {
    const t = String(b.text);
    switch (b.type) {
      case 'scene_heading': {
        const standard = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[ .]/i.test(t);
        out.push('', (standard ? t.toUpperCase() : `.${t}`));
        if (b.note) out.push('', `[[${b.note.replace(/\]\]/g, '] ]')}]]`);
        break;
      }
      case 'character': {
        const upper = t.toUpperCase();
        out.push('', /[a-z]/.test(characterPart(t)) || !/[A-Z]/.test(upper) ? `@${t}` : upper);
        break;
      }
      case 'parenthetical':
        out.push(t.startsWith('(') ? t : `(${t})`);
        break;
      case 'dialogue':
        out.push(t || ' ');
        break;
      case 'transition':
        out.push('', /TO:$/.test(t.toUpperCase()) ? t.toUpperCase() : `> ${t.toUpperCase()}`);
        break;
      default: {
        // Action that looks like a heading/character/transition must be forced with "!".
        const looksSpecial = /^(INT|EXT|EST|I\/E)[ .]/i.test(t) || (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length < 40);
        out.push('', looksSpecial ? `!${t}` : t);
      }
    }
  }
  const body = out.join('\n').replace(/^\n+/, '');
  return (tp.length ? tp.join('\n') + '\n\n' : '') + body + '\n';
}

const characterPart = (t) => t.replace(/\([^)]*\)/g, '');
