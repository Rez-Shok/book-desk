import { parseEpubSubpath } from './epub.js';

/* PDF++ compatibility.
   PDF++ keeps a text highlight as a link in a note: [[book.pdf#page=3&selection=b,bo,e,eo&color=yellow]].
   b/e index the page's text items (the ones with a string, in the order Obsidian's text layer uses);
   bo/eo are character offsets in those items, eo exclusive. The PDF file itself never changes. */

export const PDFPP_COLORS = { Yellow: '#ffd000', Red: '#ea5252', Note: '#086ddd', Important: '#bb61e5' };
export const TEXT_OPTIONS = { includeMarkedContent: true, disableNormalization: true, includeChars: true };

// PDF++'s settings when that plugin is installed (read only, never changed): its colours and its copy format
export function pdfPlusSettings(app) {
  const plugins = app.plugins && app.plugins.plugins;
  const p = plugins && Object.prototype.hasOwnProperty.call(plugins, 'pdf-plus') ? plugins['pdf-plus'] : null;
  return (p && p.settings && typeof p.settings === 'object') ? p.settings : null;
}
const HEX = /^#[0-9a-f]{3,8}$/i;
// [{ name, hex }] — PDF++'s palette when it is installed, its defaults otherwise
export function highlightPalette(app) {
  const s = pdfPlusSettings(app);
  const own = s && s.colors && typeof s.colors === 'object' ? Object.entries(s.colors).filter(([name, hex]) => name && typeof hex === 'string' && HEX.test(hex)) : [];
  return (own.length ? own : Object.entries(PDFPP_COLORS)).map(([name, hex]) => ({ name: String(name), hex }));
}
export function colorHex(app, name) {
  const palette = highlightPalette(app);
  if (!name) {
    const s = pdfPlusSettings(app), def = s && s.defaultColor;
    const hit = def && palette.find(c => c.name.toLowerCase() === def.toLowerCase());
    return hit ? hit.hex : palette[0].hex;
  }
  const hit = palette.find(c => c.name.toLowerCase() === String(name).toLowerCase());
  if (hit) return hit.hex;
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(name)) return `rgb(${name})`;
  if (/^#?[0-9a-f]{6}$/i.test(name)) return name[0] === '#' ? name : '#' + name;
  return palette[0].hex;
}
function parseSelectionSubpath(subpath) {
  const q = new URLSearchParams(String(subpath).replace(/^#/, ''));
  const page = parseInt(q.get('page') || '', 10);
  if (!(page >= 1) || page > 1e6 || !q.has('selection')) return null;
  const s = (q.get('selection') || '').split(',').map(x => (/^\s*\d{1,9}\s*$/.test(x) ? parseInt(x, 10) : NaN));
  if (s.length !== 4 || s.some(x => isNaN(x))) return null;
  return { page, b: s[0], bo: s[1], e: s[2], eo: s[3], color: q.get('color') || '' };
}
// Every PDF++ text highlight of `pdf` found in the vault's notes (canvases in Excalidraw included), by page index.
// An EPUB's highlights are links of the same kind (#chapter=3&selection=a,b), by chapter index.
export function collectHighlights(app, pdf) {
  const out = new Map(), isEpub = pdf.extension === 'epub';
  const rl = app.metadataCache.resolvedLinks;
  for (const src of Object.keys(rl)) {
    if (!rl[src][pdf.path]) continue;
    const cache = app.metadataCache.getCache(src);
    if (!cache) continue;
    const refs = [].concat(cache.links || [], cache.embeds || [], cache.frontmatterLinks || []);
    for (const r of refs) {
      const hash = r.link.indexOf('#');
      if (hash < 0 || r.link.indexOf('selection=', hash) < 0) continue;
      if (app.metadataCache.getFirstLinkpathDest(r.link.slice(0, hash), src) !== pdf) continue;
      const h = isEpub ? parseEpubSubpath(r.link.slice(hash)) : parseSelectionSubpath(r.link.slice(hash));
      if (!h || (isEpub && h.b == null)) continue;
      h.source = src;
      h.line = r.position ? r.position.start.line : 0;
      h.start = r.position ? r.position.start.offset : -1;
      h.end = r.position ? r.position.end.offset : -1;
      h.original = r.original;
      const key = isEpub ? h.ci : h.page - 1, list = out.get(key) || [];
      list.push(h);
      out.set(key, list);
    }
  }
  return out;
}

/* ---------- geometry: a selection -> rectangles on the page ---------- */
function findLastIndexOf(a, fn) { for (let i = a.length - 1; i >= 0; i--) if (fn(a[i])) return i; return -1; }
// the characters of an item that belong to its string (PDF++ trims the same way)
function itemChars(item) {
  if (item._chars) return item._chars;
  let a = null;
  if (item.chars && item.chars.length && item.str) {
    const first = item.chars.findIndex(c => c.c === item.str.charAt(0));
    const last = findLastIndexOf(item.chars, c => c.c === item.str.charAt(item.str.length - 1));
    if (first >= 0 && last >= first) a = item.chars.slice(first, last + 1);
  }
  item._chars = a;
  return a;
}
// PDF-space rectangle of characters c0..c1 of an item
function itemRangeRect(item, c0, c1) {
  const a = itemChars(item);
  if (a) {
    if (c0 > a.length - 1 || c1 < 0) return null;
    const d = a[Math.max(0, c0)], h = a[Math.min(a.length - 1, c1)];
    return [Math.min(d.r[0], h.r[0]), Math.min(d.r[1], h.r[1]), Math.max(d.r[2], h.r[2]), Math.max(d.r[3], h.r[3])];
  }
  // no per-character boxes: share the item's width evenly between its characters
  const len = Math.max(1, item.str.length), x = item.transform[4], y = item.transform[5];
  return [x + item.width * Math.max(0, c0) / len, y, x + item.width * Math.min(len, c1 + 1) / len, y + (item.height || Math.abs(item.transform[3]) || 10)];
}
// rectangles in page units (viewport `vp`), merged along lines
export function selectionRects(items, vp, b, bo, e, eo) {
  if (eo === 0 && e > b) { e--; eo = items[e] ? items[e].str.length : 0; }
  const rects = [];
  for (let i = b; i <= e && i < items.length; i++) {
    const it = items[i];
    if (!it || !it.str) continue;
    const c0 = i === b ? bo : 0;
    const c1 = (i === e ? Math.min(eo, it.str.length) : it.str.length) - 1;
    const r = itemRangeRect(it, c0, c1);
    if (!r) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
    const box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    const last = rects[rects.length - 1];
    // same line and touching: one rectangle
    if (last && Math.min(last[3], box[3]) - Math.max(last[1], box[1]) > 0.5 * Math.min(last[3] - last[1], box[3] - box[1])
        && box[0] - last[2] < 6 && last[0] - box[2] < 6) {
      last[0] = Math.min(last[0], box[0]); last[1] = Math.min(last[1], box[1]);
      last[2] = Math.max(last[2], box[2]); last[3] = Math.max(last[3], box[3]);
    } else rects.push(box);
  }
  return rects;
}
// the same for pieces given in reading order ([{ i, c0, c1 }]: characters c0..c1 of item i), whichever way the line runs
export function segmentRects(items, vp, segs) {
  const rects = [];
  for (const sg of segs) {
    const it = items[sg.i];
    if (!it || !it.str) continue;
    const r = itemRangeRect(it, sg.c0, sg.c1);
    if (!r) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
    const box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    const last = rects[rects.length - 1];
    if (last && Math.min(last[3], box[3]) - Math.max(last[1], box[1]) > 0.5 * Math.min(last[3] - last[1], box[3] - box[1])
        && box[0] - last[2] < 6 && last[0] - box[2] < 6) {
      last[0] = Math.min(last[0], box[0]); last[1] = Math.min(last[1], box[1]);
      last[2] = Math.max(last[2], box[2]); last[3] = Math.max(last[3], box[3]);
    } else rects.push(box);
  }
  return rects;
}
// Many PDFs (Persian ones above all) keep no space character between words: just a gap on the line.
// Where two text items on a line stand apart, or the second starts a new line, the reader sees a space.
export function needsSpace(prev, cur) {
  if (!prev || !cur || !prev.str || !cur.str || prev.hasEOL) return false;
  if (/\s$/.test(prev.str) || /^\s/.test(cur.str)) return false;
  const h = Math.max(Math.abs(prev.transform[3]) || prev.height || 1, 1);
  if (Math.abs(prev.transform[5] - cur.transform[5]) > h * 0.5) return true;   // a new line with no end-of-line mark
  const pa = prev.transform[4], pb = pa + prev.width, ca = cur.transform[4], cb = ca + cur.width;
  return Math.max(ca - pb, pa - cb) > h * 0.12;   // the gap, whichever way the line runs
}
export function selectionText(items, b, bo, e, eo) {
  let s = '';
  for (let i = b; i <= e && i < items.length; i++) {
    const it = items[i];
    if (!it || it.str === undefined) continue;
    if (i > b && needsSpace(items[i - 1], it)) s += ' ';
    s += it.str.slice(i === b ? bo : 0, i === e ? eo : undefined);
    if (it.hasEOL && i < e) s += ' ';
  }
  return s.replace(/\s+/g, ' ').trim();
}
// character boxes in page units, for hit-testing a pointer: [{ i, o, x1, y1, x2, y2 }]
export function charBoxes(items, vp) {
  const out = [];
  items.forEach((it, i) => {
    if (!it.str) return;
    for (let o = 0; o < it.str.length; o++) {
      const r = itemRangeRect(it, o, o);
      if (!r) continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
      out.push({ i, o, x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) });
    }
  });
  return out;
}
// the character under (x, y), or the nearest one within `reach` page units
export function hitChar(boxes, x, y, reach) {
  let best = null, bd = Infinity;
  for (const b of boxes) {
    const dx = x < b.x1 ? b.x1 - x : x > b.x2 ? x - b.x2 : 0;
    const dy = y < b.y1 ? b.y1 - y : y > b.y2 ? y - b.y2 : 0;
    const d = dx + dy * 3;   // a character on the same line beats one on the next line
    if (d < bd) { bd = d; best = b; }
    if (d === 0) break;
  }
  return best && bd <= reach ? best : null;
}

/* ---------- erasing: take highlight links out of a note's text ---------- */
// Where a drawing's own data begins in an Excalidraw note; links after it belong to the drawing.
export function drawingDataStart(data) {
  const m = /^#{1,2} Excalidraw Data\s*$/m.exec(data) || /^%%\s*\n#{1,2} Drawing\s*$/m.exec(data);
  return m ? m.index : data.length;
}
// Remove the links of `hs` (from one note). A link heading a quote or callout (the way PDF++ and the desk
// write highlights) takes its whole block with it; a link inside other text leaves the text alone.
export function removeHighlightLinks(data, hs) {
  const spots = [];
  for (const h of hs) {
    let start = h.start, end = h.end;
    if (!(start >= 0) || data.slice(start, end) !== h.original) {
      start = data.indexOf(h.original);
      end = start + (h.original || '').length;
    }
    if (start < 0 || !h.original) continue;
    spots.push({ start, end });
  }
  spots.sort((a, b) => b.start - a.start);
  let removed = 0;
  for (const { start, end } of spots) {
    const lineStart = data.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = data.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = data.length;
    const rest = (data.slice(lineStart, start) + data.slice(end, lineEnd)).replace(/[()]/g, '');
    if (/^>\s*(\[![^\]]*\][+-]?)?\s*$/.test(rest)) {
      // the link heads a quote block: remove the block (up to the next callout or non-quote line)
      let blockEnd = lineEnd;
      while (blockEnd < data.length) {
        const nextEnd = data.indexOf('\n', blockEnd + 1) < 0 ? data.length : data.indexOf('\n', blockEnd + 1);
        const next = data.slice(blockEnd + 1, nextEnd);
        if (!/^>/.test(next) || /^>\s*\[!/.test(next)) break;
        blockEnd = nextEnd;
      }
      let from = lineStart, to = Math.min(data.length, blockEnd + 1);
      // keep one blank line between the neighbours
      if (data.slice(to, to + 1) === '\n' && (from === 0 || data.slice(from - 2, from) === '\n\n')) to++;
      data = data.slice(0, from) + data.slice(to);
    } else {
      // a link between two spaces leaves one
      const cut = data[start - 1] === ' ' && data[end] === ' ' ? end + 1 : end;
      data = data.slice(0, start) + data.slice(cut);
      // a line left with nothing but a bullet or a quote mark goes too
      const ls = data.lastIndexOf('\n', start - 1) + 1;
      let le = data.indexOf('\n', ls);
      if (le < 0) le = data.length;
      if (/^\s*([-*+]|>|\d+\.)?\s*$/.test(data.slice(ls, le))) data = data.slice(0, ls) + data.slice(Math.min(data.length, le + 1));
    }
    removed++;
  }
  return { data, removed };
}

/**
 * Put back what the eraser took out of a note. `before` and `after` are the note's text around the erasing, `now`
 * its text at this moment: if the note has changed elsewhere since (a property, another paragraph), the erased
 * part still goes back to its place. Returns null when its place can no longer be found for certain.
 * @param {string} before
 * @param {string} after
 * @param {string} now
 * @returns {string | null}
 */
export function undoRemoval(before, after, now) {
  if (now === after) return before;
  const max = Math.min(before.length, after.length);
  let p = 0, s = 0;
  while (p < max && before[p] === after[p]) p++;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  // between the unchanged start and end: what the note held before, and what was left of it
  const was = before.slice(p, before.length - s), left = after.slice(p, after.length - s);
  // the place is known by the text around it: as much of it as still stands in the note, as long as it is there once only
  for (const reach of [80, 40, 20, 10]) {
    const lead = after.slice(Math.max(0, p - reach), p), tail = after.slice(after.length - s, after.length - s + reach);
    const needle = lead + left + tail;
    if (needle.length < 8) return null;
    const i = now.indexOf(needle);
    if (i < 0) continue;
    if (now.indexOf(needle, i + 1) >= 0) return null;
    return now.slice(0, i + lead.length) + was + now.slice(i + lead.length + left.length);
  }
  return null;
}
