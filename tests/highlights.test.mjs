import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeHighlightLinks, undoRemoval, drawingDataStart, selectionText, needsSpace } from '../src/pdf-highlights.js';

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
