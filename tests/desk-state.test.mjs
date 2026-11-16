import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDeskState, DESK_FORMAT } from '../src/desk-state.js';

test('what is not a JSON object is no desk', () => {
  for (const v of [null, undefined, 'x', 5, [1], true]) assert.equal(normalizeDeskState(v), null);
});

test('a desk the plugin wrote comes back unchanged', () => {
  const good = {
    book: 'Books/b.epub', spread: 12,
    ink: { 5: [{ k: 'pen', c: '#1f3a70', w: 1.9, p: [1.5, 2, 3, 4] }, { k: 'hl', c: 'rgb(255, 208, 0)', w: 15, p: [0, 0, 440, 620] }] },
    stickies: { 7: [{ id: 1730000000000, x: 10, y: 20, t: 'hi\nthere', c: 2, r: -1.5, w: 140, h: 120, fs: 17 }] },
    desk: [{ id: 1730000000001, t: 'c', p: 3, r: 1, x: 900, y: 40 }, { id: 1730000000002, t: '', p: null, r: 0, x: -20, y: 700, w: 300, h: 200 }],
    hl: [{ p: 4, b: 10, bo: 3, e: 12, eo: 0, c: 'Yellow', t: 'a quote' }, { ci: 2, a: 40, b: 95, c: '#ea5252', t: 'words', l: 'Chapter II' }],
    help: { x: 1, y: 2 }, view: { z: 1.5, cx: 400, cy: 300 }, rtl: true, board: 1, anchors: { 5: [1, 300] }, at: [2, 40], saved: '2026-11-10T00:00:00.000Z'
  };
  const got = normalizeDeskState(JSON.parse(JSON.stringify(good)));
  assert.equal(got.v, DESK_FORMAT);
  delete got.v;
  assert.deepEqual(got, good);
});

test('a hostile desk file is brought into shape', () => {
  const raw = JSON.parse(`{
    "__proto__": { "polluted": 1 }, "constructor": 1, "book": "a.pdf", "spread": "9",
    "ink": {
      "3": [ { "k": "x onload=1", "c": "url(http://evil)", "w": 1e9, "p": [1, 2, 3, 4] }, { "k": "hl", "c": "#ffd000", "w": 15, "p": [1, "2"] }, { "k": "pen", "p": [1, 2, 3] }, 7, null ],
      "__proto__": [], "-1": [ { "k": "pen", "p": [1, 2] } ], "1e3": [], "9999999": [ { "k": "pen", "p": [1, 2] } ]
    },
    "stickies": { "2": [ { "id": "\\"]x", "x": "1px;", "t": 5, "c": "a", "r": "1deg;x", "w": -5, "fs": 900 } ], "4": "nope" },
    "desk": { "0": 1 }, "view": { "z": 99, "cx": 1, "cy": 2 }, "help": { "x": "1" }, "rtl": "yes", "board": 0,
    "anchors": { "4": [1, 2], "x": [1], "5": [1, 2, 3] }, "at": "x", "future": { "keep": true }, "v": 3
  }`);
  const s = normalizeDeskState(raw);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(s), Object.prototype);
  assert.ok(!Object.prototype.hasOwnProperty.call(s, 'constructor'));
  assert.equal(s.spread, 0);
  assert.deepEqual(Object.keys(s.ink), ['3']);
  assert.deepEqual(s.ink[3], [{ k: 'pen', c: '#1f3a70', w: 60, p: [1, 2, 3, 4] }]);
  assert.equal(s.stickies[2].length, 1);
  const nt = s.stickies[2][0];
  assert.equal(typeof nt.id, 'number');
  assert.deepEqual({ x: nt.x, y: nt.y, t: nt.t, c: nt.c, r: nt.r, w: nt.w, fs: nt.fs }, { x: 20, y: 20, t: "", c: 0, r: 0, w: 40, fs: 48 });
  assert.equal(s.stickies[4], undefined);
  assert.deepEqual(s.desk, []);
  assert.deepEqual(s.view, { z: 5, cx: 1, cy: 2 });
  assert.equal(s.help, null);
  assert.ok(!('rtl' in s));
  assert.ok(!('board' in s));
  assert.deepEqual(s.anchors, { 4: [1, 2] });
  assert.ok(!('at' in s));
  assert.deepEqual(s.future, { keep: true });
  assert.equal(s.v, 3);
});

test('a desk cannot grow without bound', () => {
  const many = { ink: { 0: Array.from({ length: 6000 }, () => ({ k: 'pen', p: [1, 2] })) }, desk: Array.from({ length: 900 }, (_, i) => ({ id: i, t: 'x'.repeat(60000) })) };
  const s = normalizeDeskState(many);
  assert.equal(s.ink[0].length, 4000);
  assert.equal(s.desk.length, 400);
  assert.equal(s.desk[0].t.length, 50000);
  assert.equal(s.desk[0].x, null);
});

test('highlights kept on the desk are checked like the rest of the file', () => {
  const got = normalizeDeskState({ hl: [
    { p: 1, b: 2, bo: 0, e: 3, eo: 4, c: 'Yellow', t: 'ok' },
    { p: -1, b: 2, bo: 0, e: 3, eo: 4 },                          // no such page
    { p: 1, b: 5, bo: 0, e: 3, eo: 4 },                            // ends before it begins
    { p: 1.5, b: 2, bo: 0, e: 3, eo: 4 },                          // not a whole number
    { ci: 0, a: 10, b: 10 },                                       // empty
    { ci: 0, a: 1, b: 9, c: 'url(javascript:x)<b>', t: 7, l: {} },   // a colour that is no colour, text that is no text
    '__proto__', null, [1, 2]
  ] });
  assert.deepEqual(got.hl, [
    { p: 1, b: 2, bo: 0, e: 3, eo: 4, c: 'Yellow', t: 'ok' },
    { ci: 0, a: 1, b: 9, c: '', t: '', l: '' }
  ]);
  assert.deepEqual(normalizeDeskState({}).hl, []);
});
