/* EPUB books, read without any outside library.
   An EPUB is a zip of XHTML chapters, stylesheets and pictures. The zip is read by hand (zip.js), each chapter is
   parsed and cleaned of anything that could run or reach outside the book (epub-clean.js), the book's styles are
   confined to its pages (epub-css.js), and every chapter is laid out in CSS columns the size of a desk page.
   For each page we note the text offset it starts at, so search, contents, highlights and a reading position
   that survives a change of text size can all speak in (chapter, offset). */

import { unzipIndex, unzipFile, zipPath } from './zip.js';
import { buildBookSheet, inlineStyleCleaner, resolveBookUrl } from './epub-css.js';
import { cleanEpubChapter, bookClasses } from './epub-clean.js';

const RTL_LANG = /^(fa|fas|per|ar|ara|he|heb|ur|ps|ckb|sd|yi|dv)\b/i;

// META-INF/encryption.xml lists the files of the book that are not plain: fonts that are only scrambled (the book
// reads without them), and everything a copy-protected book locks
async function readEncryption(text, parse) {
  const fonts = new Set(), locked = new Set(), xml = await text('META-INF/encryption.xml');
  if (!xml) return { fonts, locked };
  const d = parse(xml, 'application/xml');
  for (const item of d.getElementsByTagNameNS('*', 'EncryptedData')) {
    const method = item.getElementsByTagNameNS('*', 'EncryptionMethod')[0], ref = item.getElementsByTagNameNS('*', 'CipherReference')[0];
    const uri = ref && ref.getAttribute('URI');
    if (!uri) continue;
    const scrambledFont = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/i.test((method && method.getAttribute('Algorithm')) || '');
    (scrambledFont ? fonts : locked).add(zipPath('', uri));
  }
  return { fonts, locked };
}

/**
 * Open an EPUB.
 * @param {Uint8Array} bytes the book file
 * @param {Document} doc the document the book will be shown in
 */
export async function openEpub(bytes, doc) {
  const win = doc.defaultView;
  if (!win || typeof win.CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in doc) || typeof win.DecompressionStream === 'undefined') {
    throw new Error('This device cannot open EPUB books yet: it needs iOS 16.4 or later.');
  }
  const zip = unzipIndex(bytes), dec = new TextDecoder();
  const text = async name => { const b = await unzipFile(zip, name); return b ? dec.decode(b) : null; };
  // DOMParser makes an inert document: nothing in it runs, and nothing is loaded for it
  const parse = (src, type) => new win.DOMParser().parseFromString(src, type);
  const container = await text('META-INF/container.xml');
  if (!container) throw new Error('This file is not an EPUB (it has no META-INF/container.xml).');
  const rootfile = parse(container, 'application/xml').getElementsByTagNameNS('*', 'rootfile')[0];
  const opfPath = rootfile && rootfile.getAttribute('full-path');
  const opfText = opfPath ? await text(opfPath) : null;
  if (!opfText) throw new Error('This EPUB does not say where its contents are.');
  const opf = parse(opfText, 'application/xml');
  const tagText = tag => { const el = opf.getElementsByTagNameNS('*', tag)[0]; return el ? (el.textContent || '').trim() : ''; };
  const manifest = new Map();
  for (const it of opf.getElementsByTagNameNS('*', 'item')) {
    manifest.set(it.getAttribute('id'), { href: zipPath(opfPath, it.getAttribute('href')), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  }
  const spine = opf.getElementsByTagNameNS('*', 'spine')[0];
  const refs = spine ? [...spine.getElementsByTagNameNS('*', 'itemref')] : [];
  const encryption = await readEncryption(text, parse);
  if (refs.some(ref => { const item = manifest.get(ref.getAttribute('idref')); return item && encryption.locked.has(item.href); })) {
    throw new Error('This EPUB is copy-protected (DRM), so the desk cannot read it.');
  }
  const lang = tagText('language');
  const book = {
    title: tagText('title'), lang, urls: new Map(), chapters: [], toc: [],
    scope: 'rd-epub-' + Math.random().toString(36).slice(2, 9),
    rtl: (spine && spine.getAttribute('page-progression-direction') === 'rtl') || RTL_LANG.test(lang),
    sheet: null, destroy: () => {}
  };
  book.destroy = () => {
    if (book.sheet) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(s => s !== book.sheet);
    book.sheet = null;
    book.urls.forEach(u => URL.revokeObjectURL(u));
    book.urls.clear();
  };
  try {
    // pictures and fonts become blob addresses that pages and styles can point at
    for (const m of manifest.values()) {
      if (!/^(image|font)\/|opentype|truetype|woff/i.test(m.type) || encryption.fonts.has(m.href) || encryption.locked.has(m.href)) continue;
      const b = await unzipFile(zip, m.href);
      if (b) book.urls.set(m.href, URL.createObjectURL(new Blob([b], { type: m.type })));
    }
    const inFile = file => url => resolveBookUrl(url, path => book.urls.get(zipPath(file, path)));
    const cleanStyle = inlineStyleCleaner(win, book.scope);
    const inlineStyle = (style, file) => cleanStyle(style, inFile(file));
    const cssDone = new Set(), css = [];
    for (const ref of refs) {
      if (ref.getAttribute('linear') === 'no') continue;
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item || !/html|xml/i.test(item.type)) continue;
      const src = await text(item.href);
      if (src == null) continue;
      let d = parse(src, 'application/xhtml+xml');
      if (d.getElementsByTagName('parsererror').length) d = parse(src, 'text/html');
      for (const l of d.querySelectorAll('link[rel~="stylesheet"][href]')) {
        if (/\balternate\b/i.test(l.getAttribute('rel') || '')) continue;
        const path = zipPath(item.href, l.getAttribute('href'));
        if (cssDone.has(path)) continue;
        cssDone.add(path);
        const s = await text(path);
        if (s) css.push({ text: s, resolve: inFile(path) });
      }
      for (const st of d.getElementsByTagName('style')) css.push({ text: st.textContent || '', resolve: inFile(item.href) });
      const body = d.body || d.getElementsByTagNameNS('*', 'body')[0];
      if (!body) continue;
      const html = d.documentElement;
      const dir = body.getAttribute('dir') || html.getAttribute('dir'), clang = body.getAttribute('lang') || html.getAttribute('lang') || html.getAttribute('xml:lang');
      // cleaned first, while nothing of it is in the window; only then brought in
      cleanEpubChapter(body, { file: item.href, urls: book.urls, inlineStyle });
      const el = doc.createElement('div');
      el.className = ('rd-epub-chapter ' + bookClasses(body.getAttribute('class'))).trim();
      if (dir && /^(ltr|rtl|auto)$/i.test(dir)) el.setAttribute('dir', dir);
      if (clang && /^[\w-]{1,35}$/.test(clang)) el.setAttribute('lang', clang);
      for (const node of [...body.childNodes]) el.appendChild(doc.importNode(node, true));
      book.chapters.push({ href: item.href, el });
    }
    if (!book.chapters.length) throw new Error('This EPUB has no readable chapters.');
    // the book's styles go to the document as a sheet of their own, not a <style> element: built one checked rule at a time
    book.sheet = buildBookSheet(win, css, book.scope);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, book.sheet];
    book.toc = await readEpubToc(manifest, spine, text, parse);
  } catch (e) {
    book.destroy();
    throw e;
  }
  return book;
}

// the contents: EPUB 3's nav document, or EPUB 2's toc.ncx
async function readEpubToc(manifest, spine, text, parse) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const target = (file, href) => {
    if (!href) return null;
    const cut = href.indexOf('#');
    let frag = cut < 0 ? '' : href.slice(cut + 1);
    try { frag = decodeURIComponent(frag); } catch { /* kept as written */ }
    return zipPath(file, cut < 0 ? href : href.slice(0, cut)) + (frag ? '#' + frag : '');
  };
  let budget = 5000;   // entries: a contents list is never longer, and a damaged one must not hang the desk
  const nav = [...manifest.values()].find(m => /\bnav\b/.test(m.props));
  if (nav) {
    const d = parse(await text(nav.href) || '', 'application/xhtml+xml');
    const navs = [...d.getElementsByTagNameNS('*', 'nav')];
    const navEl = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
    const walk = (ol, depth) => (depth > 12 ? [] : [...(ol ? ol.children : [])].filter(li => li.localName === 'li' && budget-- > 0).map(li => {
      const a = [...li.children].find(c => c.localName === 'a' || c.localName === 'span');
      const sub = [...li.children].find(c => c.localName === 'ol');
      return { title: clean(a ? a.textContent : ''), go: target(nav.href, a && a.getAttribute('href')), items: walk(sub, depth + 1) };
    }));
    const list = navEl && [...navEl.children].find(c => c.localName === 'ol');
    if (list) return walk(list, 0);
  }
  const ncxItem = manifest.get(spine && spine.getAttribute('toc')) || [...manifest.values()].find(m => /ncx/.test(m.type));
  if (ncxItem) {
    const d = parse(await text(ncxItem.href) || '', 'application/xml');
    const walk = (parent, depth) => (depth > 12 ? [] : [...parent.children].filter(c => c.localName === 'navPoint' && budget-- > 0).map(np => {
      const label = [...np.children].find(c => c.localName === 'navLabel'), content = [...np.children].find(c => c.localName === 'content');
      return { title: clean(label ? label.textContent : ''), go: target(ncxItem.href, content && content.getAttribute('src')), items: walk(np, depth + 1) };
    }));
    const map = d.getElementsByTagNameNS('*', 'navMap')[0];
    if (map) return walk(map, 0);
  }
  return [];
}

/* ---------- laying the book out in pages ---------- */
// a chapter flowing in columns, each column one page's text box (the sizes are read by styles.css)
export function makeEpubFlow(book, ci, box, doc) {
  const flow = doc.createElement('div');
  flow.className = 'rd-epub-flow ' + book.scope;
  flow.style.setProperty('--epub-w', box.w + 'px');
  flow.style.setProperty('--epub-colh', box.h + 'px');
  flow.style.setProperty('--epub-gap', box.gap + 'px');
  flow.style.setProperty('--epub-fs', box.fontSize + 'px');
  if (book.rtl) flow.dataset.rtl = '1';           // the columns still run left to right; the text inside is right to left
  if (book.lang && /^[\w-]{1,35}$/.test(book.lang)) flow.setAttribute('lang', book.lang);   // for hyphenation
  flow.appendChild(book.chapters[ci].el.cloneNode(true));
  return flow;
}
export function epubTextNodes(root, doc) {
  const out = [], w = doc.createTreeWalker(root, 4 /* text */);
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
}
// where each column starts, as an offset in the chapter's text (found by measuring single characters)
function epubColumnStarts(flow, stride, cols, doc) {
  const starts = new Array(cols).fill(undefined);
  starts[0] = 0;
  const base = flow.getBoundingClientRect().left, range = doc.createRange();
  const colOf = (node, i) => {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    return r.width || r.height ? Math.floor((r.left - base + 1) / stride) : -1;
  };
  let off = 0, cur = 0;
  for (const node of epubTextNodes(flow, doc)) {
    const s = node.data;
    let end = s.length - 1;
    while (end >= 0 && /\s/.test(s[end])) end--;
    if (end < 0) { off += s.length; continue; }
    let lo = 0;
    for (let guard = 0; guard < cols; guard++) {
      const last = colOf(node, end);
      if (last <= cur) break;
      let a = lo, b = end;
      while (a < b) { const m = (a + b) >> 1, c = colOf(node, m); if (c > cur) b = m; else a = m + 1; }
      const c = Math.min(cols - 1, Math.max(cur + 1, colOf(node, a)));
      for (let k = cur + 1; k <= c; k++) if (starts[k] === undefined) starts[k] = off + a;
      cur = c; lo = a;
    }
    off += s.length;
  }
  for (let k = 1; k < cols; k++) if (starts[k] === undefined) starts[k] = starts[k - 1];
  return starts;
}
// lay every chapter out; returns the pages in order and where each chapter begins
export async function layoutEpub(book, doc, box) {
  const stride = box.w + box.gap, host = doc.createElement('div');
  host.className = 'rd-epub-measure';
  host.style.setProperty('--epub-w', box.w + 'px');
  host.style.setProperty('--epub-colh', box.h + 'px');
  doc.body.appendChild(host);
  const pages = [], chapterStart = [];
  try {
    for (let ci = 0; ci < book.chapters.length; ci++) {
      const flow = makeEpubFlow(book, ci, box, doc);
      host.replaceChildren(flow);
      await Promise.all([...flow.querySelectorAll('img')].map(img => (img.decode ? img.decode().catch(() => {}) : null)));
      const cols = clampCols(Math.round((flow.scrollWidth + box.gap) / stride));
      const ch = book.chapters[ci];
      ch.cols = cols;
      ch.starts = epubColumnStarts(flow, stride, cols, doc);
      ch.text = epubTextNodes(flow, doc).map(t => t.data).join('');
      ch.imageOnly = !/\S/.test(ch.text) && flow.querySelectorAll('img, svg').length === 1;
      chapterStart.push(pages.length);
      for (let k = 0; k < cols; k++) pages.push({ ci, col: k });
    }
  } finally { host.remove(); }
  return { pages, chapterStart, box, stride };
}
const clampCols = n => Math.max(1, Math.min(20000, n || 1));
// (chapter, offset) -> page
export function epubPageOf(layout, book, ci, off) {
  const st = book.chapters[ci] && book.chapters[ci].starts;
  if (!st) return 0;
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m] <= off) lo = m; else hi = m - 1; }
  return layout.chapterStart[ci] + lo;
}
// a DOM position (a text node and offset, or an element and child index) -> offset in the chapter's text
export function epubOffsetOf(flow, node, offset, doc) {
  const point = doc.createRange();
  point.setStart(node, offset);
  let off = 0;
  for (const t of epubTextNodes(flow, doc)) {
    if (t === node) return off + offset;
    if (point.comparePoint(t, t.data.length) > 0) return off;   // this text ends after the point: it comes after it
    off += t.data.length;
  }
  return off;
}
// wrap the text between two offsets in marks (highlights, search matches) without changing the text itself
export function epubWrap(flow, a, b, make, doc) {
  const marks = [];
  if (!(b > a)) return marks;
  let off = 0;
  for (const t of epubTextNodes(flow, doc)) {
    const s = off, e = off + t.data.length;
    off = e;
    if (e <= a) continue;
    if (s >= b) break;
    const parent = t.parentNode;
    if (!/\S/.test(t.data) || !parent || parent.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
    let node = t;
    if (a > s) node = node.splitText(a - s);
    if (b < e) node.splitText(b - Math.max(a, s));
    const m = make();
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
    marks.push(m);
  }
  return marks;
}
export function epubUnwrap(flow, selector) {
  const marks = flow.querySelectorAll(selector);
  if (!marks.length) return;
  for (const m of marks) m.replaceWith(...m.childNodes);
  flow.normalize();
}
// 'chapter.xhtml#anchor' -> { ci, off }
export function epubResolve(book, go, doc) {
  if (!go) return null;
  const s = String(go), cut = s.indexOf('#'), path = cut < 0 ? s : s.slice(0, cut), frag = cut < 0 ? '' : s.slice(cut + 1);
  const ci = book.chapters.findIndex(c => c.href === path);
  if (ci < 0) return null;
  return { ci, off: epubAnchorOffset(book.chapters[ci].el, frag, doc) };
}
// a stretch of a chapter's text as it reads: paragraphs apart (or run together with `oneLine`), spaces tidied
const EPUB_BLOCKS = /^(p|div|h[1-6]|li|blockquote|pre|tr|td|th|dt|dd|figcaption|section|article|aside|header|footer|table|ul|ol|dl)$/i;
export function epubBlockOf(chapterEl, node) {
  for (let e = node.parentElement; e && e !== chapterEl; e = e.parentElement) if (EPUB_BLOCKS.test(e.localName)) return e;
  return chapterEl;
}
export function epubTextOf(book, ci, a, b, doc, oneLine) {
  const ch = book.chapters[ci];
  if (!ch) return '';
  const paras = [];
  let off = 0, lastBlock = null;
  for (const t of epubTextNodes(ch.el, doc)) {
    const s = off, e = off + t.data.length;
    off = e;
    if (e <= a) continue;
    if (s >= b) break;
    const piece = t.data.slice(Math.max(0, a - s), Math.min(t.data.length, b - s));
    if (!/\S/.test(piece)) { if (paras.length) paras[paras.length - 1] += ' '; continue; }
    const blk = epubBlockOf(ch.el, t);
    if (blk !== lastBlock || !paras.length) paras.push('');
    lastBlock = blk;
    paras[paras.length - 1] += piece;
  }
  const out = paras.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return out.join(oneLine ? ' ' : '\n\n');
}
// [[book.epub#chapter=3&selection=1200,1260&color=yellow]]: chapters count from 1, offsets are in the chapter's text
export function parseEpubSubpath(subpath) {
  const q = new URLSearchParams(String(subpath == null ? '' : subpath).replace(/^#/, ''));
  const ch = parseInt(q.get('chapter') || '', 10);
  if (!(ch >= 1) || ch > 1e6) return null;
  const s = (q.get('selection') || '').split(',').map(x => (/^\s*\d{1,9}\s*$/.test(x) ? parseInt(x, 10) : NaN));
  if (s.length !== 2 || s.some(x => isNaN(x)) || s[1] <= s[0]) return { ci: ch - 1, a: s[0] >= 0 ? s[0] : 0, b: null, color: '' };
  return { ci: ch - 1, a: s[0], b: s[1], color: q.get('color') || '' };
}
// the text offset of an element (an anchor a contents entry or a link points at) in its chapter
function epubAnchorOffset(chapterEl, id, doc) {
  if (!id) return 0;
  let target = null;
  for (const el of chapterEl.querySelectorAll('[data-epub-id]')) if (el.getAttribute('data-epub-id') === id) { target = el; break; }
  if (!target) return 0;
  let off = 0;
  for (const t of epubTextNodes(chapterEl, doc)) {
    if (target.compareDocumentPosition(t) & 4 /* following */ || target.contains(t)) return off;
    off += t.data.length;
  }
  return off;
}
