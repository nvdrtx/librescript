// Builds the print/PDF layout: an optional title page, then fixed US Letter pages
// laid out with the same pagination as the editor's page marks, numbered top-right.

import { paginate } from '../model/analysis.js';
import { titlePageLines } from '../model/exporters.js';
import { esc } from './dom.js';

// Page margins differ: the script lays out its own fixed pages (margin 0), the synopsis flows (1in).
function setPageMargins(margin) {
  let style = document.getElementById('page-style');
  if (!style) {
    style = Object.assign(document.createElement('style'), { id: 'page-style' });
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: letter; margin: ${margin}; }`;
}

export function buildPrint(root, blocks, titlePage) {
  setPageMargins('0');
  root.dataset.kind = 'script';
  const { pageOf } = paginate(blocks);
  const pages = [];
  blocks.forEach((b, i) => {
    const p = pageOf[i] - 1;
    (pages[p] ||= []).push({ ...b, first: !pages[p] || pages[p].length === 0 });
  });

  let scene = 0;
  const html = [];
  const { center, bottom } = titlePageLines(titlePage);
  if (center.length) {
    html.push(`<section class="print-page title-page">
      <div class="tp-center">${center.map((l) => `<p>${esc(l) || '&nbsp;'}</p>`).join('')}</div>
      <div class="tp-bottom">${bottom.map((l) => `<p>${esc(l).replace(/\n/g, '<br>')}</p>`).join('')}</div>
    </section>`);
  }
  pages.forEach((list = [], i) => {
    const body = list.map((b, k) => {
      const num = b.type === 'scene_heading' ? ++scene : null;
      return `<div class="block ${b.type}${k === 0 ? ' first' : ''}"${num ? ` data-scene="${num}"` : ''}>${esc(b.text) || '&nbsp;'}</div>`;
    }).join('');
    html.push(`<section class="print-page">${i > 0 ? `<div class="page-num">${i + 1}.</div>` : ''}${body}</section>`);
  });
  root.innerHTML = html.join('');
}

// Synopsis document: title, author, logline, short and full synopsis, flowing over pages.
export function buildSynopsisPrint(root, meta) {
  setPageMargins('1in');
  root.dataset.kind = 'synopsis';
  const syn = meta.synopsis || {};
  const tp = meta.titlePage || {};
  const title = meta.project?.name || tp.title || 'Sans titre';
  const paras = (t) => String(t || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const logline = meta.project?.description || '';
  root.innerHTML = `<article class="syn-print">
    <header>
      <h1>${esc(title)}</h1>
      <p class="syn-kind">Synopsis</p>
      ${tp.author ? `<p class="syn-author">${esc(tp.credit || 'Écrit par')} ${esc(tp.author)}</p>` : ''}
    </header>
    ${logline ? `<section><h2>Logline</h2><p class="syn-logline">${esc(logline)}</p></section>` : ''}
    ${syn.short ? `<section><h2>Résumé</h2>${paras(syn.short)}</section>` : ''}
    ${syn.long ? `<section><h2>Synopsis</h2>${paras(syn.long)}</section>` : ''}
    ${!logline && !syn.short && !syn.long ? '<p><em>Synopsis vide.</em></p>' : ''}
  </article>`;
}
