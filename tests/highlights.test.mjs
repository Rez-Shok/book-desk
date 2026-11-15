import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeHighlightLinks, undoRemoval, drawingDataStart, selectionText, needsSpace, segmentRects, charBoxes, hitChar } from '../src/pdf-highlights.js';

const link = (sel, text = 'p.3') => `[[Book.pdf#page=3&selection=${sel}&color=yellow|Book, ${text}]]`;
const hl = (data, original) => ({ original, start: data.indexOf(original), end: data.indexOf(original) + original.length });

test('erasing a highlight takes its quote block with it and leaves the rest', () => {
  const a = link('1,0,2,5'), b = link('7,0,8,2');
  const note = `# Notes\n\n## Highlights\n\n> (${a})\n> first quote\n\n> (${b})\n> second quote\n\n## Other\n\nkept\n`;
  const r = removeHighlightLinks(note, [hl(note, a)]);
  assert.equal(r.removed, 1);
  assert.equal(r.data, `# Notes\n\n## Highlights\n\n> (${b})\n> second quote\n\n## Other\n\nkept\n`);
});

test('a link inside a sentence leaves the sentence', () => {
  const a = link('1,0,2,5');
  const note = `See ${a} for more.\n- ${a}\n`;
  const r = removeHighlightLinks(note, [{ original: a, start: 4, end: 4 + a.length }]);
  assert.equal(r.data, `See for more.\n- ${a}\n`);
});

test('undo puts the quote back, also when the note changed elsewhere meanwhile', () => {
  const a = link('1,0,2,5'), b = link('7,0,8,2');
  const before = `---\npage: 1\n---\n## Highlights\n\n> (${a})\n> first quote\n\n> (${b})\n> second quote\n\n## Other\n\nkept\n`;
  const after = removeHighlightLinks(before, [hl(before, a)]).data;
  assert.equal(undoRemoval(before, after, after), before);
  // a property changed and a line was added at the end
  const now = after.replace('page: 1', 'page: 7') + 'a new line\n';
  assert.equal(undoRemoval(before, after, now), before.replace('page: 1', 'page: 7') + 'a new line\n');
  // two highlights erased at once
  const after2 = removeHighlightLinks(before, [hl(before, a), hl(before, b)]).data;
  assert.equal(undoRemoval(before, after2, after2.replace('page: 1', 'page: 9')), before.replace('page: 1', 'page: 9'));
});

test('undo gives up rather than guess when the place is gone or not certain', () => {
  const a = link('1,0,2,5');
  const before = `## Highlights\n\n> (${a})\n> quote\n\n## Other\n`, after = removeHighlightLinks(before, [hl(before, a)]).data;
  assert.equal(undoRemoval(before, after, 'a completely different note'), null);
  assert.equal(undoRemoval(before, after, after + after), null);
});

test('the drawing part of an Excalidraw note is told apart from its text', () => {
  const note = 'text\n\n# Excalidraw Data\n## Text Elements\n';
  assert.equal(drawingDataStart(note), note.indexOf('# Excalidraw Data'));
  assert.equal(drawingDataStart('plain note'), 'plain note'.length);
});

test('words set apart on the page get a space between them', () => {
  const item = (str, x, w, y = 100) => ({ str, width: w, height: 10, transform: [10, 0, 0, 10, x, y], hasEOL: false });
  const items = [item('کتاب', 200, 30), item('خوب', 160, 25), item('next', 100, 30, 80)];
  assert.equal(needsSpace(items[0], items[1]), true);
  assert.equal(selectionText(items, 0, 0, 2, 4), 'کتاب خوب next');
  assert.equal(needsSpace(item('ab', 0, 20), item('cd', 20.5, 20)), false);
});

/* ---------- where characters are on the page ---------- */
const vp = { convertToViewportRectangle: r => r };
// glyph boxes in the order they are drawn (left to right), 10 units each, from x0
const glyphs = (seen, x0 = 0) => [...seen].map((c, k) => ({ c, r: [x0 + 10 * k, 0, x0 + 10 * k + 10, 8] }));
const item = (str, chars, dir, x = 0) => ({ str, chars, dir, transform: [10, 0, 0, 10, x, 0], width: 10 * str.length, height: 10 });
const span = (it, c0, c1) => { const r = segmentRects([it], vp, [{ i: 0, c0, c1 }])[0]; return r && [r[0], r[2]]; };

test('a right-to-left item: its first characters are at its right end, though pdf.js lists the glyphs from the left', () => {
  const it = item('کرد. با', glyphs('اب .درک'), 'rtl');
  assert.deepEqual(span(it, 0, 2), [40, 70]);    // «کرد» is drawn at the right
  assert.deepEqual(span(it, 5, 6), [0, 20]);     // «با» at the left
  const boxes = charBoxes([it], vp);
  assert.equal(hitChar(boxes, 68, 4, 5).o, 0);   // a pointer at the right end is on the first character
});

test('a left-to-right item keeps its order', () => {
  const it = item('and gated', glyphs('and gated', 100), 'ltr');
  assert.deepEqual(span(it, 0, 2), [100, 130]);
  assert.deepEqual(span(it, 4, 8), [140, 190]);
});

test('a mark missing from the glyphs (a tanwin) stands beside its neighbour; the rest stay paired', () => {
  const it = item('ab\u064bcd', glyphs('abcd'), 'ltr');
  assert.deepEqual(span(it, 3, 4), [20, 40]);    // «cd» are still the third and fourth glyphs
  const m = span(it, 2, 2);
  assert.ok(m[0] >= 17 && m[1] <= 23, String(m)); // the mark: a sliver at the end of «b»
  const rtl = item('دا\u064bم', glyphs('ماد'), 'rtl');
  assert.deepEqual(span(rtl, 0, 1), [10, 30]);   // «دا» at the right, beside «م»
});

test('without glyph boxes the width is shared out, from the right in a right-to-left item', () => {
  assert.deepEqual(span(item('abcde', null, 'ltr', 100), 0, 0), [100, 110]);
  assert.deepEqual(span(item('ابجده', null, 'rtl', 100), 0, 0), [140, 150]);
  assert.deepEqual(span(item('ابجده', null, 'rtl', 100), 3, 4), [100, 120]);
});
