/* A PDF page's text in the order it is read.

   pdf.js gives a page's text as items in the order the file draws them. Usually that is reading order. But many
   Persian and Arabic PDFs draw a line one letter at a time from left to right, the way it looks on paper: read in
   that order, every line comes out backwards. A selection, a search or a quote made in drawing order then takes the
   wrong half of the first and last lines and spells the words in reverse.

   Here the items are put in reading order line by line: a right-to-left line is read from its right end to its
   left as it lies on the page (numbers and Latin words inside it keep their own direction, brackets are mirrored
   back), and the letter shapes such files use ("presentation forms") are turned back into plain letters. Lines stay
   in the order the file has them, so columns are read as before, and left-to-right lines are not touched. */

import { needsSpace } from './pdf-highlights.js';

const DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/, LATIN = /[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/, RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
// what may stand inside a number without ending it
const IN_NUMBER = /^[./,:\u066B\u066C-]$/;
// letter shapes that stand for plain letters: Arabic presentation forms, Latin ligatures
const SHAPES = /[\uFB00-\uFB06\uFB50-\uFDFF\uFE70-\uFEFC]/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

// R: right-to-left letters; L: Latin words (with their numbers); D: Persian and Arabic numbers, which run left to
// right inside right-to-left text; N: neither (spaces, punctuation)
function itemClass(str) {
  let r = 0, l = 0, d = 0;
  for (const ch of str) { if (DIGIT.test(ch)) d++; else if (LATIN.test(ch)) l++; else if (RTL.test(ch)) r++; }
  return r > l && r >= d ? 'R' : l ? 'L' : d ? 'D' : 'N';
}
const centre = it => it.transform[4] + (it.width || 0) / 2;
// is there a gap on the page between two pieces of one line? (like needsSpace, but for neighbours on the page,
// whichever of them the file drew first)
function gapBetween(a, b) {
  if (!a.str || !b.str || /\s$/.test(a.str) || /^\s/.test(b.str)) return false;
  const h = Math.max(Math.abs(a.transform[3]) || 0, a.height || 0, Math.abs(b.transform[3]) || 0, b.height || 0, 1);
  const a1 = a.transform[4], a2 = a1 + a.width, b1 = b.transform[4], b2 = b1 + b.width;
  return Math.max(b1 - a2, a1 - b2) > h * 0.12;
}

/**
 * The items of a page in reading order.
 * @param {{ str: string, transform: number[], width: number, height: number, hasEOL?: boolean }[]} items
 * @returns {{ order: number[], line: Int32Array, mirror: Uint8Array, gap: Uint8Array }} order: item indexes as they are read;
 *   line: each item's line number; mirror: 1 for the items of a right-to-left line that are read right to left;
 *   gap: 1 where a space lies between an item and the one read before it
 */
export function readingOrder(items) {
  const line = new Int32Array(items.length), mirror = new Uint8Array(items.length), gap = new Uint8Array(items.length), order = [], lines = [];
  let cur = null, broke = false;
  items.forEach((it, i) => {
    const y = it.transform[5], h = Math.max(Math.abs(it.transform[3]) || 0, it.height || 0, 1);
    // a raised or lowered sign (a footnote mark) is still on its line
    if (!cur || broke || Math.abs(y - cur.y) > 0.7 * Math.max(h, cur.h)) { cur = { ids: [], y, h }; lines.push(cur); }
    else if (it.str.trim() && h > cur.h) cur.h = h;
    cur.ids.push(i);
    line[i] = lines.length - 1;
    broke = !!it.hasEOL;
  });
  for (const ln of lines) {
    const cls = ln.ids.map(i => itemClass(items[i].str));
    const r = cls.filter(c => c === 'R').length, l = cls.filter(c => c === 'L').length;
    if (r <= l) {   // a left-to-right line: the file's order is the reading order
      ln.ids.forEach((i, k) => { gap[i] = k === 0 || needsSpace(items[ln.ids[k - 1]], items[i]) ? 1 : 0; });
      order.push(...ln.ids);
      continue;
    }
    // A right-to-left line is read from its right end to its left, wherever the file put each piece: some files
    // draw the whole line from the left, some draw each phrase from the left and the phrases from the right, and
    // the well-made ones go from the right all along. On the page they all look the same, and that is what counts.
    const seq = ln.ids.map((i, k) => ({ i, c: cls[k], x: centre(items[i]), k })).sort((p, q) => q.x - p.x || p.k - q.k);
    // what is neither takes the direction of the line, except between two Latin words, or inside a number
    const strong = (from, step) => { for (let k = from; k >= 0 && k < seq.length; k += step) if (seq[k].c !== 'N') return seq[k].c; return 'R'; };
    const dir = seq.map((s, k) => {
      if (s.c !== 'N') return s.c;
      const before = strong(k - 1, -1), after = strong(k + 1, 1);
      if (before === 'L' && after === 'L') return 'L';
      return before === 'D' && after === 'D' && IN_NUMBER.test(items[s.i].str) ? 'D' : 'R';
    });
    // is there a gap on the page between a piece and the one to its right? (asked of neighbours on the page; in
    // reading, a bracket and the far end of a Latin phrase follow each other without being neighbours)
    const apart = k => (k <= 0 ? true : gapBetween(items[seq[k - 1].i], items[seq[k].i]));
    for (let k = 0; k < seq.length;) {
      if (dir[k] === 'R') { mirror[seq[k].i] = 1; gap[seq[k].i] = apart(k) ? 1 : 0; order.push(seq[k].i); k++; continue; }
      let e = k;
      while (e + 1 < seq.length && dir[e + 1] === dir[k]) e++;
      // a number or a Latin phrase keeps its own direction: read from its left end (seq[e]) to its right (seq[k])
      for (let j = e; j >= k; j--) { gap[seq[j].i] = (j === e ? apart(k) : apart(j + 1)) ? 1 : 0; order.push(seq[j].i); }
      if (e + 1 < seq.length) seq[e + 1].after = k;   // what follows the phrase touches its left end on the page
      k = e + 1;
    }
    seq.forEach((sq, k) => { if (sq.after != null && dir[k] === 'R') gap[sq.i] = gapBetween(items[seq[k - 1].i], items[sq.i]) ? 1 : 0; });
  }
  return { order, line, mirror, gap };
}

/**
 * The page's text as it is read, and where each of its characters comes from.
 * @returns {{ text: string, at: Int32Array, off: Int32Array, start: Int32Array, order: number[], line: Int32Array }}
 *   at[k], off[k]: the item and the character in it that text[k] stands for (-1, -1 for a space put between words);
 *   start[i]: where item i begins in the text (-1 if it gave none)
 */
export function readingText(items) {
  const { order, line, mirror, gap } = readingOrder(items);
  const at = [], off = [], start = new Int32Array(items.length).fill(-1);
  let text = '', prev = null;
  for (const i of order) {
    const it = items[i];
    if (prev != null && text && !/\s$/.test(text) && !/^\s/.test(it.str) && it.str && (gap[i] || line[i] !== line[prev])) { text += ' '; at.push(-1); off.push(-1); }
    if (it.str) start[i] = text.length;
    for (let o = 0; o < it.str.length; o++) {
      let ch = it.str[o];
      if (mirror[i] && MIRROR[ch]) ch = MIRROR[ch];
      if (SHAPES.test(ch)) ch = ch.normalize('NFKC');
      for (const unit of ch) { text += unit; at.push(i); off.push(o); }
    }
    if (it.str) prev = i;
  }
  return { text, at: Int32Array.from(at), off: Int32Array.from(off), start, order, line };
}

/** Where character `o` of item `i` is in the text (the first place, if the character became several). */
export function textIndexOf(model, i, o) {
  let k = model.start[i];
  if (k < 0) return -1;
  while (k < model.text.length && model.at[k] === i && model.off[k] < o) k++;
  return k < model.text.length && model.at[k] === i ? k : k - 1;
}

/**
 * A stretch of the text as pieces of items, in reading order: [{ i, c0, c1 }] (characters c0..c1 of item i).
 */
export function textSegments(model, a, b) {
  const out = [];
  for (let k = Math.max(0, a); k < Math.min(b, model.text.length); k++) {
    const i = model.at[k], o = model.off[k];
    if (i < 0) continue;
    const last = out[out.length - 1];
    if (last && last.i === i && o >= last.c1 && o <= last.c1 + 1) last.c1 = o;
    else out.push({ i, c0: o, c1: o });
  }
  return out;
}

/**
 * The same stretch as ranges in the file's own order: [{ b, bo, e, eo }], the form a highlight link has (eo is
 * exclusive). One range when the file is in reading order; up to three when its lines had to be turned round
 * (the end of the first line, the lines between, the start of the last).
 */
export function segmentRuns(items, segs) {
  const parts = segs.slice().sort((x, y) => x.i - y.i || x.c0 - y.c0), out = [];
  for (const s of parts) {
    const last = out[out.length - 1];
    let joins = false;
    if (last) {
      if (s.i === last.e) joins = s.c0 <= last.eo;
      else if (s.c0 === 0 && last.eo >= items[last.e].str.length) {
        joins = true;
        for (let k = last.e + 1; k < s.i; k++) if (items[k].str.length) { joins = false; break; }
      }
    }
    if (joins) { last.eo = s.i === last.e ? Math.max(last.eo, s.c1 + 1) : s.c1 + 1; last.e = s.i; }
    else out.push({ b: s.i, bo: s.c0, e: s.i, eo: s.c1 + 1 });
  }
  return out;
}

/** The words of a highlight link (b, bo, e, eo), as they are read. */
export function rangeText(model, items, h) {
  let s = '';
  for (let k = 0; k < model.text.length; k++) {
    const i = model.at[k], o = model.off[k];
    if (i < 0) { if (s && !s.endsWith(' ')) s += ' '; continue; }
    if (i < h.b || i > h.e || (i === h.b && o < h.bo) || (i === h.e && o >= h.eo)) continue;
    s += model.text[k];
  }
  return tidyText(s);
}

/** A stretch of the text widened to whole words. */
export function wholeWords(model, a, b) {
  const t = model.text;
  while (a > 0 && !/\s/.test(t[a - 1])) a--;
  while (b < t.length && !/\s/.test(t[b])) b++;
  return [a, b];
}

/** Text for a note or the clipboard: one line, without the stretching strokes (kashida) a justified line is padded with. */
export const tidyText = text => String(text || '').replace(/\u0640+/g, '').replace(/\s+/g, ' ').trim();
