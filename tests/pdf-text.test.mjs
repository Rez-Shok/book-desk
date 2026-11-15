import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingOrder, readingText, textIndexOf, textSegments, segmentRuns, rangeText, wholeWords } from '../src/pdf-text.js';

// items as pdf.js gives them: one per piece of text, with where it is drawn
const item = (str, x, y = 700, w = str.length * 6) => ({ str, width: w, height: 10, transform: [10, 0, 0, 10, x, y], hasEOL: false });
// a line drawn one piece at a time from left to right: `pieces` are given as they LOOK, left to right
const drawn = (pieces, y, x0 = 50) => { let x = x0; return pieces.map(s => { const it = item(s, x, y); x += it.width + (s === ' ' ? 0 : 0); return it; }); };
const eol = items => { items[items.length - 1].hasEOL = true; return items; };

test('a page in reading order is left as it is', () => {
  const items = [...eol([item('The quick ', 50), item('brown fox', 110)]), ...eol([item('jumps over.', 50, 688)])];
  const m = readingText(items);
  assert.deepEqual(m.order, [0, 1, 2]);
  assert.equal(m.text, 'The quick brown fox jumps over.');
  // Persian drawn word by word from the right (the usual, well-made file)
  const fa = eol([item('کتاب', 300), item(' ', 296, 700, 4), item('خوب', 270), item(' ', 266, 700, 4), item('است', 240)]);
  assert.equal(readingText(fa).text, 'کتاب خوب است');
  assert.deepEqual(readingOrder(fa).order, [0, 1, 2, 3, 4]);
});

test('a right-to-left line drawn left to right is read from the right', () => {
  // looks like:  آگاهی دانش   (letters as separate shapes, drawn left to right: the last letter of the line first)
  const line1 = eol(drawn(['ﺶ', 'ﻧ', 'ا', 'د', ' ', 'ﯽ', 'ﻫ', 'ﺎ', 'ﮔ', 'آ'], 700));
  const m = readingText(line1);
  assert.equal(m.text, 'آگاهی دانش');
  assert.deepEqual(m.order, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test('numbers, Latin words and brackets inside such a line come out right', () => {
  // looks like:  سال ۱۴۰۵ (Occam's razor) بود     drawn left to right
  const looks = ['د', 'ﻮ', 'ﺑ', ' ', '(', 'Occam\'s', ' ', 'razor', ')', ' ', '۱', '۴', '۰', '۵', ' ', 'ل', 'ﺎ', 'ﺳ'];
  const m = readingText(eol(drawn(looks, 700)));
  assert.equal(m.text, 'سال ۱۴۰۵ (Occam\'s razor) بود');
  // looks like:  ۱۰۷ / ۳۱ صفحه ۲/۵   (reads: page 2/5, then 31, then 107)
  const footer = ['۱', '۰', '۷', ' ', '/', ' ', '۳', '۱', ' ', '۲', '/', '۵', ' ', 'ﻪ', 'ﺤ', 'ﻔ', 'ﺻ'];
  assert.equal(readingText(eol(drawn(footer, 700))).text, 'صفحه ۲/۵ ۳۱ / ۱۰۷');
});

test('lines stay in the file\'s order, each read its own way; a raised sign stays on its line', () => {
  const l1 = eol([...drawn(['ب', ' ', 'ا'], 700), { ...item('۴', 90, 704, 4), height: 6, transform: [6, 0, 0, 6, 90, 704] }, ...drawn(['ج'], 700, 100)]);
  const l2 = eol(drawn(['English', ' ', 'line'], 688));
  const m = readingText([...l1, ...l2]);
  assert.equal(m.text, 'ج ۴ ا ب English line');
});

test('a stretch of the text leads back to the items, as ranges a highlight link can hold', () => {
  // two lines, each drawn left to right:   line 1 looks "ج ب ا" (reads ا ب ج), line 2 looks "و ه د" (reads د ه و)
  const items = [...eol(drawn(['ج', ' ', 'ب', ' ', 'ا'], 700)), ...eol(drawn(['و', ' ', 'ه', ' ', 'د'], 688))];
  const m = readingText(items);
  assert.equal(m.text, 'ا ب ج د ه و');
  // from "ب" to "ه": the end of line 1 (ب ج) and the start of line 2 (د ه)
  const a = m.text.indexOf('ب'), b = m.text.indexOf('ه') + 1;
  const segs = textSegments(m, a, b);
  assert.deepEqual(segs.map(s => items[s.i].str), ['ب', ' ', 'ج', 'د', ' ', 'ه']);
  // in the file's order that is two ranges: items 0..2 (ج, space, ب) and items 7..9 (ه, space, د)
  assert.deepEqual(segmentRuns(items, segs), [{ b: 0, bo: 0, e: 2, eo: 1 }, { b: 7, bo: 0, e: 9, eo: 1 }]);
  // whole lines join into one range
  assert.deepEqual(segmentRuns(items, textSegments(m, 0, m.text.length)), [{ b: 0, bo: 0, e: 9, eo: 1 }]);
  assert.equal(rangeText(m, items, { b: 0, bo: 0, e: 2, eo: 1 }), 'ب ج');
  assert.equal(textIndexOf(m, 2, 0), a);
  assert.deepEqual(wholeWords(m, a, a + 1), [a, a + 1]);
});

test('in a file that is in reading order a stretch is one range, with offsets inside items', () => {
  const items = eol([item('The quick ', 50), item('brown fox', 110)]);
  const m = readingText(items);
  const [a, b] = wholeWords(m, m.text.indexOf('uic'), m.text.indexOf('row'));
  assert.equal(m.text.slice(a, b), 'quick brown');
  assert.deepEqual(segmentRuns(items, textSegments(m, a, b)), [{ b: 0, bo: 4, e: 1, eo: 5 }]);
  assert.equal(rangeText(m, items, { b: 0, bo: 4, e: 1, eo: 5 }), 'quick brown');
});

test('letter shapes become plain letters, ligatures are spelled out', () => {
  const m = readingText(eol([item('ﬁnal ', 50), item('ﻻ', 90)]));
  assert.equal(m.text, 'final لا');
  assert.equal(m.at.length, m.text.length);
  assert.deepEqual([...m.off.slice(0, 3)], [0, 0, 1]);   // "fi" both stand for the one ligature
});
