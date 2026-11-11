/* A desk file (.desk) is a small JSON file: the page you are on, pen marks, sticky notes, cards and the view.
   It may come from another device, another version of the plugin or another person, so nothing in it is taken
   on trust: every value is checked and brought into range before the desk uses it. */

import { clamp } from './util.js';

/** The version of the desk file format this plugin writes. */
export const DESK_FORMAT = 1;

const MAX_PAGES = 100000, MAX_STROKES = 4000, MAX_POINTS = 40000, MAX_NOTES = 400, MAX_TEXT = 50000;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}(\s*,\s*\d{1,3}){2}(\s*,\s*(0|1|0?\.\d+))?\s*\))$/i;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : def);
const int = (v, lo, hi, def) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : def);
const text = v => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const pageKey = k => (/^\d{1,6}$/.test(k) && +k < MAX_PAGES ? String(+k) : null);
// notes are found again by their id: a number (the time it was made), or a short plain string
const noteId = (v, i) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : Date.now() + i);

function stroke(st) {
  if (!isObject(st) || !Array.isArray(st.p)) return null;
  const hl = st.k === 'hl';
  const p = st.p.slice(0, MAX_POINTS).map(v => num(v, -4000, 8000, null));
  if (p.length < 2 || p.length % 2 || p.includes(null)) return null;
  return { k: hl ? 'hl' : 'pen', c: typeof st.c === 'string' && COLOR.test(st.c) ? st.c : (hl ? '#ffd000' : '#1f3a70'), w: num(st.w, 0.5, 60, hl ? 15 : 1.9), p };
}
function sticky(nt, i) {
  if (!isObject(nt)) return null;
  const out = { id: noteId(nt.id, i), x: num(nt.x, -5000, 5000, 20), y: num(nt.y, -5000, 5000, 20), t: text(nt.t), c: int(nt.c, 0, 255, 0), r: num(nt.r, -20, 20, 0) };
  if (nt.w != null) out.w = num(nt.w, 40, 2000, 132);
  if (nt.h != null) out.h = num(nt.h, 30, 2400, 116);
  if (nt.fs != null) out.fs = num(nt.fs, 9, 48, 15);
  return out;
}
function card(nt, i) {
  if (!isObject(nt)) return null;
  const out = { id: noteId(nt.id, i), t: text(nt.t), p: nt.p == null ? null : int(nt.p, 0, MAX_PAGES, null), r: num(nt.r, -20, 20, 0), x: num(nt.x, -1e6, 1e6, null), y: num(nt.y, -1e6, 1e6, null) };
  if (out.x == null || out.y == null) { out.x = null; out.y = null; }   // the desk finds a free spot
  if (nt.w != null) out.w = num(nt.w, 100, 2000, 236);
  if (nt.h != null) out.h = num(nt.h, 40, 2400, 150);
  if (nt.fs != null) out.fs = num(nt.fs, 9, 48, 15);
  return out;
}
function byPage(obj, each, max) {
  const out = {};
  if (!isObject(obj)) return out;
  for (const k of Object.keys(obj)) {
    const key = pageKey(k);
    if (key == null || !Array.isArray(obj[k])) continue;
    const list = obj[k].slice(0, max).map(each).filter(Boolean);
    if (list.length) out[key] = list;
  }
  return out;
}
const place = v => (Array.isArray(v) && v.length === 2 ? [int(v[0], 0, MAX_PAGES, 0), int(v[1], 0, 1e9, 0)] : null);

/**
 * The state read from a desk file, checked. Returns null when the file holds no JSON object.
 * Keys this version does not know are kept as they are, so a desk written by a newer version loses nothing.
 * @param {unknown} raw what JSON.parse gave
 */
export function normalizeDeskState(raw) {
  if (!isObject(raw)) return null;
  const out = {};
  for (const k of Object.keys(raw)) if (!UNSAFE_KEYS.has(k)) out[k] = raw[k];
  out.v = Math.max(DESK_FORMAT, int(raw.v, 1, 1e6, DESK_FORMAT));
  if (typeof raw.book !== 'string') delete out.book;
  if (typeof raw.pdf !== 'string') delete out.pdf;
  out.spread = int(raw.spread, 0, MAX_PAGES, 0);
  out.ink = byPage(raw.ink, stroke, MAX_STROKES);
  out.stickies = byPage(raw.stickies, sticky, MAX_NOTES);
  out.desk = Array.isArray(raw.desk) ? raw.desk.slice(0, MAX_NOTES).map(card).filter(Boolean) : [];
  const xy = v => (isObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: num(v.x, -1e6, 1e6, 0), y: num(v.y, -1e6, 1e6, 0) } : null);
  out.help = xy(raw.help);
  out.view = isObject(raw.view) && Number.isFinite(raw.view.z) && Number.isFinite(raw.view.cx) && Number.isFinite(raw.view.cy)
    ? { z: num(raw.view.z, 0.4, 5, 1), cx: num(raw.view.cx, -1e6, 1e6, 0), cy: num(raw.view.cy, -1e6, 1e6, 0) } : null;
  if (typeof raw.rtl === 'boolean') out.rtl = raw.rtl; else delete out.rtl;   // undecided: the desk looks at the book
  if (raw.board) out.board = 1; else delete out.board;
  const anchors = {};
  if (isObject(raw.anchors)) for (const k of Object.keys(raw.anchors)) { const key = pageKey(k), a = place(raw.anchors[k]); if (key != null && a) anchors[key] = a; }
  out.anchors = anchors;
  const at = place(raw.at);
  if (at) out.at = at; else delete out.at;
  return out;
}
