/* The desk itself: a book that turns its pages, shows its thickness, takes pen marks, highlights and sticky notes,
   with index cards beside it. It knows nothing of Obsidian's vault: everything it needs comes through `host`. */

import { setIcon } from 'obsidian';
import { clamp, safeExternalUrl } from './util.js';
import { normalizeDeskState } from './desk-state.js';
import { buildDeskDom, buildSticky, buildCard, buildGuide } from './desk-dom.js';
import { PDFPP_COLORS, TEXT_OPTIONS, selectionRects, segmentRects, selectionText, charBoxes, hitChar } from './pdf-highlights.js';
import { readingText, textIndexOf, textSegments, segmentRuns, rangeText, wholeWords, tidyText } from './pdf-text.js';
import { makeEpubFlow, epubTextNodes, layoutEpub, epubPageOf, epubOffsetOf, epubWrap, epubUnwrap, epubResolve, epubBlockOf, epubTextOf, parseEpubSubpath } from './epub.js';

/* ---------------------------------------------------------------------------
   createDesk(root, host) builds one desk inside `root`.
   host: { pdf (a pdf.js document) or epub (an opened EPUB, see epub.js), title, state, save(state), onSpread(state, pages), openInPdf(page),
           notice(msg), helpSeen(), markHelpSeen(),
           palette(), colorHex(name), highlights(), createHighlight(h), openSource(h, event),
           sourceLabel(h), defaultRtl(), deleteHighlights(list), toolbarHidden(), setToolbarHidden(bool), quoteFor(h),
           paper(), setPaper(name), textSize(), setTextSize(px), excalidraw(), mobile (true on a phone or tablet) }
--------------------------------------------------------------------------- */
export function createDesk(root, host) {
  const W = root.ownerDocument.defaultView, D = root.ownerDocument;
  const reduceMotion = W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The paper is as thick as the book is long: a leaf of real paper is about 0.1 mm and a page about 150 mm wide,
  // so 0.28 book units per leaf. Very long PDFs grow more slowly past 1200 pages; very short ones keep a visible edge.
  const bookThickness = L => Math.max(6, L <= 600 ? L * 0.28 : 168 + 60 * Math.log(L / 600));
  const pdf = host.pdf || null, epub = host.epub || null;
  let n = pdf ? pdf.numPages : 0;                    // an EPUB's pages are counted once its text is set
  let STACK_MAX = bookThickness(Math.ceil(n / 2));
  const CP = 9, FM = 70, CARD_ROOM = 260;
  const PEN = '#1f3a70';
  // one palette for the highlighter and the stickies: PDF++'s colours when it is installed
  const palette = (host.palette && host.palette()) || Object.entries(PDFPP_COLORS).map(([name, hex]) => ({ name, hex }));
  const hue = c => palette[((c % palette.length) + palette.length) % palette.length];
  const STK = c => `color-mix(in srgb, ${hue(c).hex} 42%, #fff8dc)`;
  let PW = 440, PH = epub ? 640 : 620;
  let tool = 'read', color = 0, busy = false, destroyed = false;
  const geom = { k: 1 };
  let zoom = 1, renderedK = 0, sharpenTimer = 0;

  root.classList.add('rdesk');
  buildDeskDom(root);
  // Obsidian's phone and tablet app opens a side panel when a finger swipes across the screen; on the desk a
  // swipe moves the book instead (the pages are canvases, which Obsidian already leaves alone)
  root.dataset.ignoreSwipe = 'true';
  const q = s => root.querySelector(s);
  const els = {
    desk: q('.rd-desk'), world: q('.rd-world'), book: q('.rd-book'),
    cover: q('.rd-cover'), stackL: q('.rd-stack.l'), stackR: q('.rd-stack.r'), marks: q('.rd-marks'),
    hitL: q('.rd-stack-hit.l'), hitR: q('.rd-stack-hit.r'), scrub: q('.rd-scrub'),
    pageL: q('.rd-pl'), pageR: q('.rd-pr'), leaf: q('.rd-leaf'), front: q('.rd-face.front'), back: q('.rd-face.back'),
    notes: q('.rd-notes'), tip: q('.rd-tip'), progress: q('.rd-progress'), name: q('.rd-name'), zoom: q('.rd-zoom-val')
  };

  // the state comes from a file: it is checked and brought into shape before anything here trusts it
  const S = normalizeDeskState(host.state || {}) || normalizeDeskState({});
  delete S.fingers; delete S.zoom;   // the finger is gone (sticky-note flags mark places now); zoom lives in S.view
  let highlights = (host.highlights && host.highlights()) || new Map();   // page index -> PDF++ highlights
  let epubHl = epub ? highlights : null;                                  // an EPUB's, by chapter
  if (epub) highlights = new Map();
  // a place the desk file remembers past the end of this PDF (a shorter file: another edition, a placeholder):
  // it is kept as it was, and the book's note keeps its page, until a page is turned here
  let held = null;
  const save = () => {
    if (epub && L) keepAnchors();
    if (held && S.spread !== held.shown) held = null;
    host.save(held ? { ...S, spread: held.spread } : S);
    if (typeof refreshAnnosSoon === 'function') refreshAnnosSoon();
  };

  /* ---------- spreads ----------
     Spread s shows page 2s-1 on the left and 2s on the right (page 0 = cover, alone on the right).
     Leaf k carries pages 2k (front) and 2k+1 (back); leaves below s lie on the left. */
  const leaves = () => Math.ceil(n / 2);
  const leftOf = s => 2 * s - 1;
  const rightOf = s => 2 * s;
  const spreadOfPage = p => Math.ceil(p / 2);
  const thick = () => STACK_MAX / Math.max(1, leaves());
  const shownPages = s => [leftOf(s), rightOf(s)].filter(p => p >= 0 && p < n);
  const pageLabel = s => shownPages(s).map(p => p + 1).join('–');

  /* ---------- geometry ---------- */
  function place(el, x, y, w, h) {
    el.style.left = x + 'px'; el.style.top = y + 'px';
    if (w != null) el.style.width = w + 'px';
    if (h != null) el.style.height = h + 'px';
  }
  function buildGeometry() {
    geom.BW = 2 * (PW + STACK_MAX + CP + FM);
    geom.BH = PH + 2 * CP + 16;
    geom.spine = geom.BW / 2;
    geom.top = CP + 4;
    els.book.style.width = geom.BW + 'px';
    els.book.style.height = geom.BH + 'px';
    place(els.pageL, geom.spine - PW, geom.top, PW, PH);
    place(els.pageR, geom.spine, geom.top, PW, PH);
    place(els.leaf, geom.spine, geom.top, PW, PH);
    place(els.marks, 0, 0, geom.BW, geom.BH);
  }
  /* ---------- the view: a camera over the desk ----------
     The book and the cards lie on one board, measured in book units. The camera moves and zooms over
     it: a zoom stays anchored under the pointer at every scale, and the desk can be moved freely. */
  const cam = { x: 0, y: 0, k: 1 };
  let home = null, atHome = true;
  // where the camera rests: the whole book in view, with room for cards beside it on a wide screen
  function computeHome() {
    const dw = els.desk.clientWidth, dh = els.desk.clientHeight;
    if (!dw || !dh) return null;
    const kW = (dw - 16) / geom.BW, kH = (dh - 20) / geom.BH;
    const wide = kW >= kH * 0.75;   // a tall, narrow pane fits the width and keeps the cards below the book
    let k = clamp(wide ? Math.min(kW, kH) : kW, 0.18, 2.4), side = 0;
    if (wide && dw - geom.BW * k < 2 * CARD_ROOM) {
      const kSide = (dw - CARD_ROOM - 16) / geom.BW;
      if (kSide >= k * 0.82) { k = Math.min(k, kSide); side = CARD_ROOM; }
    } else if (wide) side = CARD_ROOM;
    const w = geom.BW * k, h = geom.BH * k;
    const x = side && dw - w < 2 * CARD_ROOM ? (dw - side - w) / 2 : (dw - w) / 2;
    const y = wide ? Math.max(10, (dh - h) / 2) : 12;
    return { x, y, k, wide };
  }
  function applyCam() {
    els.world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    geom.k = cam.k;
    zoom = cam.k / home.k;
    els.zoom.textContent = Math.round(zoom * 100) + '%';
    sharpenSoon();
  }
  // kept per book: the zoom, and the board point in the middle of the desk
  function rememberCam() {
    const dw = els.desk.clientWidth, dh = els.desk.clientHeight;
    S.view = atHome ? null : { z: +zoom.toFixed(3), cx: Math.round((dw / 2 - cam.x) / cam.k), cy: Math.round((dh / 2 - cam.y) / cam.k) };
    save();
  }
  // the book and the cards are never lost: a part of them always stays on screen
  function clampCam() {
    const dw = els.desk.clientWidth, dh = els.desk.clientHeight, m = 60;
    let x1 = 0, y1 = 0, x2 = geom.BW, y2 = geom.BH;
    for (const c of S.desk) { if (c.x == null) continue; x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x + (c.w || 236)); y2 = Math.max(y2, c.y + (c.h || 150) + 30); }
    // the cards as they are drawn (the guide too, which is long): the view can always reach their far end
    for (const el of els.notes.querySelectorAll('.rd-card')) {
      if (!el.offsetHeight) continue;
      x1 = Math.min(x1, el.offsetLeft); y1 = Math.min(y1, el.offsetTop);
      x2 = Math.max(x2, el.offsetLeft + el.offsetWidth); y2 = Math.max(y2, el.offsetTop + el.offsetHeight + 30);
    }
    cam.x = clamp(cam.x, m - x2 * cam.k, dw - m - x1 * cam.k);
    cam.y = clamp(cam.y, m - y2 * cam.k, dh - m - y1 * cam.k);
  }
  function fit() {
    const h = computeHome();
    if (!h) return;
    home = h; geom.wide = h.wide;
    if (atHome) { cam.x = h.x; cam.y = h.y; cam.k = h.k; } else clampCam();
    applyCam();
  }
  function restoreCam() {
    const v = S.view;
    if (!v || !home) return;
    const dw = els.desk.clientWidth, dh = els.desk.clientHeight;
    cam.k = home.k * clamp(v.z, 0.4, 5); cam.x = dw / 2 - v.cx * cam.k; cam.y = dh / 2 - v.cy * cam.k;
    atHome = false; clampCam(); applyCam();
  }
  // zoom around a point on screen (a cursor, or the middle of two fingers)
  function setZoom(z, cx, cy) {
    if (!home) return;
    z = clamp(z, 0.4, 5);
    const dr = els.desk.getBoundingClientRect();
    if (cx == null) { cx = dr.left + dr.width / 2; cy = dr.top + dr.height / 2; }
    const px = cx - dr.left, py = cy - dr.top;
    const wx = (px - cam.x) / cam.k, wy = (py - cam.y) / cam.k;   // the board point under the pointer stays there
    cam.k = home.k * z; cam.x = px - wx * cam.k; cam.y = py - wy * cam.k;
    atHome = false;
    clampCam(); applyCam(); rememberCam();
  }
  function panBy(dx, dy) {
    if (!dx && !dy) return;
    cam.x += dx; cam.y += dy; atHome = false;
    clampCam(); applyCam(); rememberCam();
  }
  function resetView() { atHome = true; fit(); rememberCam(); }
  // bring a board rectangle into view (a new card, say)
  function reveal(x, y, w, h) {
    const dw = els.desk.clientWidth, dh = els.desk.clientHeight, m = 20;
    const sx1 = cam.x + x * cam.k, sy1 = cam.y + y * cam.k, sx2 = sx1 + w * cam.k, sy2 = sy1 + h * cam.k;
    let dx = 0, dy = 0;
    if (sx2 > dw - m) dx = dw - m - sx2; if (sx1 + dx < m) dx = m - sx1;
    if (sy2 > dh - m) dy = dh - m - sy2; if (sy1 + dy < m) dy = m - sy1;
    if (dx || dy) { cam.x += dx; cam.y += dy; atHome = false; applyCam(); rememberCam(); }
  }
  // Pages are drawn for one scale; after a big change, draw the open ones again (no blank flash).
  function sharpenSoon() {
    if (epub) return;   // text is drawn sharp at every size
    W.clearTimeout(sharpenTimer);
    sharpenTimer = W.setTimeout(() => {
      if (destroyed || !renderedK || Math.abs(renderedK - geom.k) / geom.k < 0.2) return;
      hiCache.clear();
      [els.pageL, els.pageR].forEach(el => {
        const p = +el.dataset.p, cv = el.querySelector('.rd-pc canvas');
        if (!cv) return;
        request('hi', p).then(c => { if (el.dataset.p == String(p)) paint(cv, c); }).catch(() => {});
      });
    }, 350);
  }
  function layoutStacks(s) {
    const t = thick(), tl = s * t, tr = (leaves() - s) * t;
    place(els.stackL, geom.spine - PW - tl, geom.top, tl, PH);
    place(els.stackR, geom.spine + PW, geom.top, tr, PH);
    place(els.cover, geom.spine - PW - tl - CP, geom.top - CP, 2 * PW + tl + tr + 2 * CP, PH + 2 * CP);
    // the page edges are thin: a wider strip outside each catches the mouse or a finger
    const pad = 16;
    place(els.hitL, geom.spine - PW - tl - pad, geom.top, tl + pad + 3, PH); els.hitL.hidden = !tl;
    place(els.hitR, geom.spine + PW - 3, geom.top, tr + pad + 3, PH); els.hitR.hidden = !tr;
    geom.tl = tl; geom.tr = tr;
  }

  /* ---------- PDF pages ----------
     Two layers: a quick low-resolution copy ("lo") of every page near the reader, and a sharp copy
     ("hi") for the open spread and the next one. Fast turns show the quick copy until the sharp one
     is ready. Sharp rendering waits while a leaf is moving, so turns stay smooth. */
  const LO_W = 520;                                  // device pixels across a quick copy
  // a phone has far less room for pictures: fewer pages are kept
  const LO_KEEP = host.mobile ? 24 : 48, HI_PIXELS = host.mobile ? 2.5e7 : 6e7;
  const loCache = new Map(), hiCache = new Map();
  // a page dropped from a cache gives its memory back at once (iOS counts a canvas until it is collected)
  const drop = (m, key) => { const c = m.get(key); m.delete(key); if (c && !c.isConnected) { c.width = 0; c.height = 0; } };
  const pending = new Map();                         // 'lo12' / 'hi12' -> job
  let pumping = false, readDir = 1, current = null;
  const wait = ms => new Promise(r => W.setTimeout(r, ms));
  function cached(kind, p) {
    const m = kind === 'hi' ? hiCache : loCache, c = m.get(p);
    if (c) { m.delete(p); m.set(p, c); }             // most recently used last
    return c;
  }
  function request(kind, p) {
    const c = cached(kind, p);
    if (c) return Promise.resolve(c);
    let j = pending.get(kind + p);
    if (!j) {
      j = { kind, p };
      j.promise = new Promise((res, rej) => { j.res = res; j.rej = rej; });
      pending.set(kind + p, j);
    }
    void pump();
    return j.promise;
  }
  // lower runs sooner: the open pages first, then what comes next in the reading direction
  function priority(j) {
    const d = (spreadOfPage(j.p) - S.spread) * readDir, dist = d >= 0 ? d : -d * 2;
    if (j.kind === 'lo') return dist === 0 ? 0 : 2 + dist;
    return dist === 0 ? 1 : 3 + dist * 3;
  }
  const tooFar = j => Math.abs(spreadOfPage(j.p) - S.spread) > (j.kind === 'lo' ? 10 : 2);
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.size && !destroyed) {
        let best = null, bp = Infinity;
        for (const [key, j] of pending) {
          if (tooFar(j)) { pending.delete(key); j.rej(new Error('skipped')); continue; }
          const pr = priority(j);
          if (pr < bp) { bp = pr; best = j; }
        }
        if (!best) break;
        if (best.kind === 'hi' && busy) { await wait(60); continue; }
        pending.delete(best.kind + best.p);
        try { best.res(await drawPage(best.p, best.kind)); }
        catch (e) {
          // a sharp render stopped for a page turn goes back in the queue
          if (e && e.name === 'RenderingCancelledException' && !e.timedOut && !destroyed) pending.set(best.kind + best.p, best);
          else best.rej(e);
        }
      }
    } finally { pumping = false; }
  }
  async function drawPage(p, kind) {
    const page = await pdf.getPage(p + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const full = PW * geom.k * (W.devicePixelRatio || 1);
    const scale = kind === 'lo' ? Math.min(LO_W, full) / vp1.width : Math.min(4, full / vp1.width);
    const vp = page.getViewport({ scale });
    const c = W.createEl('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    // "display" yields to the page between chunks; "print" keeps going while the window is hidden
    const task = page.render({ canvasContext: ctx, canvas: c, viewport: vp, intent: D.visibilityState === 'visible' ? 'display' : 'print' });
    current = { kind, task };
    // a page that never finishes (a picture pdf.js cannot decode) must not hold up every page after it
    let timedOut = false;
    const timer = W.setTimeout(() => { timedOut = true; task.cancel(); }, 30000);
    // the picture is on the canvas now: pdf.js lets go of what it read for the page (its pictures above all,
    // which in a book of photographs fill the memory page by page)
    try { await task.promise; }
    catch (e) { if (timedOut && e) e.timedOut = true; throw e; }
    finally { W.clearTimeout(timer); current = null; page.cleanup(); }
    if (kind === 'lo') {
      loCache.set(p, c);
      while (loCache.size > LO_KEEP) drop(loCache, loCache.keys().next().value);
    } else {
      hiCache.set(p, c);
      renderedK = geom.k;
      // keep roughly 60 megapixels of sharp pages (about 240 MB) at most, 25 on a phone
      const keep = clamp(Math.floor(HI_PIXELS / (c.width * c.height)), 4, 12);
      while (hiCache.size > keep) drop(hiCache, hiCache.keys().next().value);
    }
    return c;
  }
  // a turn is starting: a sharp render in progress would make it stutter
  function pauseSharp() { if (current && current.kind === 'hi') current.task.cancel(); }
  function prefetch(s) {
    if (epub) return;
    const ahead = host.mobile ? 3 : 6, behind = host.mobile ? 1 : 2;   // a phone gets fewer pages ready
    for (let d = 1; d <= ahead; d++) shownPages(s + d * readDir).forEach(p => request('lo', p).catch(() => {}));
    for (let d = 1; d <= behind; d++) shownPages(s - d * readDir).forEach(p => request('lo', p).catch(() => {}));
    shownPages(s + readDir).forEach(p => request('hi', p).catch(() => {}));
  }

  /* ---------- EPUB pages ----------
     An EPUB has no pages of its own: each chapter is set in columns one page wide, and a page shows one
     column through a window. Highlights and search matches are marks in the text itself, so they turn with
     the page. Places are kept as (chapter, offset in its text): a new text size, or another device's fonts,
     moves the pages but not the places. */
  const EM = { top: 46, bottom: 54, side: 40, gap: 60 };   // the page's margins, in book units
  const TEXT_MIN = 11, TEXT_MAX = 30;
  let L = null;   // the layout: { pages: [{ ci, col }], chapterStart, box, stride }
  const textSize = () => clamp(+(host.textSize && host.textSize()) || 16, TEXT_MIN, TEXT_MAX);
  const pageStart = p => { const pg = L.pages[p]; return epub.chapters[pg.ci].starts[pg.col]; };
  const pageEnd = p => { const pg = L.pages[p], ch = epub.chapters[pg.ci]; return pg.col + 1 < ch.starts.length ? ch.starts[pg.col + 1] : ch.text.length; };
  const pageAt = (ci, off) => epubPageOf(L, epub, clamp(ci, 0, epub.chapters.length - 1), off);
  const anchorOf = p => { const pg = L.pages[clamp(p, 0, n - 1)]; return [pg.ci, epub.chapters[pg.ci].starts[pg.col]]; };
  const hk = h => `${h.ci}:${h.a}:${h.b}`;
  function epubByPage(map) {
    const out = new Map();
    for (const list of map.values()) for (const h of list) {
      if (!epub.chapters[h.ci]) continue;
      const p = pageAt(h.ci, h.a);
      if (!out.has(p)) out.set(p, []);
      out.get(p).push(h);
    }
    return out;
  }
  async function layoutEpubBook() {
    const box = { w: PW - 2 * EM.side, h: PH - EM.top - EM.bottom, gap: EM.gap, fontSize: textSize() };
    L = await layoutEpub(epub, D, box);
    n = L.pages.length;
    STACK_MAX = bookThickness(Math.ceil(n / 2));
    highlights = epubByPage(epubHl || new Map());
  }
  // where each page that holds something began in the text: saved with the desk
  function keepAnchors() {
    const keys = new Set([...Object.keys(S.ink), ...Object.keys(S.stickies)].map(Number));
    S.desk.forEach(c => { if (c.p != null) keys.add(c.p); });
    const A = {};
    keys.forEach(p => { if (p >= 0 && p < n) A[p] = anchorOf(p); });
    S.anchors = A;
    const shown = shownPages(S.spread);
    S.at = shown.length ? anchorOf(shown[0]) : [0, 0];
  }
  // after the text is set again: move what belongs to a page to where that page's text is now
  function remapEpub() {
    const A = S.anchors || {}, to = k => clamp(A[k] ? pageAt(A[k][0], A[k][1]) : +k, 0, n - 1);
    const move = obj => {
      const out = {};
      for (const k of Object.keys(obj)) { const np = to(k); out[np] = (out[np] || []).concat(obj[k]); }
      return out;
    };
    S.ink = move(S.ink); S.stickies = move(S.stickies);
    S.desk.forEach(c => { if (c.p != null) c.p = to(c.p); });
    if (S.at) S.spread = spreadOfPage(pageAt(S.at[0], S.at[1]));
    S.spread = clamp(S.spread || 0, 0, leaves());
    keepAnchors();
  }
  // the contents with their places, flat, in reading order
  let tocFlat = null;
  function epubTocFlat() {
    if (tocFlat) return tocFlat;
    tocFlat = [];
    const walk = (items, depth) => (items || []).forEach(it => {
      tocFlat.push({ title: it.title, depth, loc: epubResolve(epub, it.go, D) });
      walk(it.items, depth + 1);
    });
    walk(epub.toc, 0);
    return tocFlat;
  }
  // the section a place is in: the last contents entry that starts at or before it
  function sectionTitle(ci, off) {
    let best = null;
    for (const e of epubTocFlat()) if (e.loc && (e.loc.ci < ci || (e.loc.ci === ci && e.loc.off <= off))) best = e;
    return best ? best.title : '';
  }
  function epubOutline() {
    const map = items => (items || []).map(it => {
      const loc = epubResolve(epub, it.go, D);
      return { title: it.title, page: loc ? pageAt(loc.ci, loc.off) : null, items: map(it.items) };
    });
    return map(epub.toc);
  }
  // one page: a window onto its column, a running head and the page number, as in a printed book.
  // A slot keeps its chapter set: a page of the same chapter only moves the window, so a turn needs no new layout.
  let marksVersion = 0;
  function fillEpubSlot(el, p) {
    el.dataset.p = p;
    if (p < 0 || p >= n) { el.replaceChildren(); el._flow = null; el._epub = null; el.classList.add('blank'); return; }
    el.classList.remove('blank');
    const pg = L.pages[p], E = el._epub;
    if (E && E.L === L && E.ci === pg.ci && E.flow && E.face.parentNode === el) {
      for (const c of [...el.children]) if (c !== E.face) c.remove();
      for (const c of [...E.face.children]) if (c !== E.page) c.remove();
      E.flow.style.transform = `translateX(${-pg.col * L.stride}px)`;
      epubHead(el, E, p);
      if (E.marks !== marksVersion) paintEpubMarks(el);
    } else {
      el.replaceChildren();
      el._flow = null;
      el._epub = buildEpubPage(el, p);
      el.appendChild(el._epub.face);
    }
    el._epub.face.append(hlLayer(p), inkSvg(p));
    el.append(stickyLayer(p));
  }
  function buildEpubPage(el, p) {
    const pg = L.pages[p], ch = epub.chapters[pg.ci];
    const face = W.createDiv();
    face.className = 'rd-pageface';
    const page = W.createDiv();
    page.className = 'rd-epub-page';
    face.appendChild(page);
    const E = { L, ci: pg.ci, face, page, flow: null, marks: -1 };
    const pic = ch.imageOnly && ch.el.querySelector('img, image');
    const src = pic && (pic.getAttribute('src') || pic.getAttribute('href') || pic.getAttributeNS('http://www.w3.org/1999/xlink', 'href'));
    if (src && pg.col === 0) {   // a picture alone in its chapter (the cover) fills the page
      page.classList.add('is-picture');
      const img = W.createEl('img');
      img.src = src; img.alt = '';
      page.appendChild(img);
      return E;
    }
    const clip = W.createDiv();
    clip.className = 'rd-epub-clip';
    place(clip, EM.side, EM.top, L.box.w, L.box.h);
    const flow = makeEpubFlow(epub, pg.ci, L.box, D);
    flow.style.transform = `translateX(${-pg.col * L.stride}px)`;
    clip.appendChild(flow);
    E.head = W.createDiv(); E.head.className = 'rd-epub-head'; E.head.dir = 'auto';
    E.folio = W.createDiv(); E.folio.className = 'rd-epub-folio';
    page.append(clip, E.head, E.folio);
    E.flow = el._flow = flow;
    epubHead(el, E, p);
    paintEpubMarks(el, E);
    return E;
  }
  // no running head on the page a chapter opens on; the left page names the book, the right one the section
  function epubHead(el, E, p) {
    const pg = L.pages[p];
    E.head.hidden = pg.col === 0;
    if (pg.col > 0) E.head.textContent = el.classList.contains('lside') ? (epub.title || host.title) : sectionTitle(pg.ci, pageStart(p));
    E.folio.textContent = p + 1;
  }
  // highlights (from notes, and new ones the note has not caught up with) and search matches, as marks in the text
  // (all of the slot's chapter, since its pages share one setting of the text)
  function paintEpubMarks(slot, E) {
    E = E || slot._epub;
    const flow = slot._flow;
    if (!flow || !E || !L) return;
    E.marks = marksVersion;
    const ci = E.ci, s = 0, e = Infinity;
    epubUnwrap(flow, 'mark.rd-ehl:not(.rd-ehl-preview), mark.rd-efound');
    const mark = (cls, fill, key) => () => {
      const m = W.createEl('mark');
      m.className = cls;
      if (fill) m.style.setProperty('--hl', fill);
      if (key) m.dataset.hk = key;
      return m;
    };
    for (const h of epubHl.get(ci) || []) if (h.b > s && h.a < e) epubWrap(flow, h.a, h.b, mark('rd-ehl', host.colorHex ? host.colorHex(h.color) : '#ffd000', hk(h)), D);
    for (const m of madeHere) if (m.ci === ci && m.b > s && m.a < e) epubWrap(flow, m.a, m.b, mark('rd-ehl is-new', m.hex), D);
    if (!find.el.hidden) find.results.forEach((r, i) => {
      if (r.ci === ci && r.b > s && r.a < e) epubWrap(flow, r.a, r.b, mark('rd-efound' + (i === find.cur ? ' is-current' : '')), D);
    });
  }
  // something marked changed: the open pages show it now, the others when they are next shown
  function paintStatic() { marksVersion++; [els.pageL, els.pageR].forEach(slot => { if (slot._flow) paintEpubMarks(slot); }); }
  // what is under the pointer on a page: a highlight mark, a link, a place in the text
  // the marks of one highlight on the open pages
  const marksOf = (within, key) => [...within.querySelectorAll('.rd-slot.rd-page mark.rd-ehl[data-hk]')].filter(m => m.dataset.hk === key);
  function epubMarkAt(slot, e) {
    const t = D.elementFromPoint(e.clientX, e.clientY), m = t && t.closest && t.closest('mark.rd-ehl[data-hk]');
    return m && slot.contains(m) ? m : null;
  }
  function epubHlAt(slot, e) {
    const m = epubMarkAt(slot, e);
    if (!m) return null;
    const [ci, a, b] = m.dataset.hk.split(':').map(Number);
    return (epubHl.get(ci) || []).find(h => h.a === a && h.b === b) || null;
  }
  function epubLinkAt(slot, e) {
    const t = D.elementFromPoint(e.clientX, e.clientY), a = t && t.closest && t.closest('.rd-epub-link');
    if (!a || !slot.contains(a)) return null;
    if (a.dataset.ext) { const url = safeExternalUrl(a.dataset.ext); return url ? { url } : null; }
    const loc = epubResolve(epub, a.dataset.go, D);
    return loc ? { page: pageAt(loc.ci, loc.off) } : null;
  }
  function caretAt(x, y) {
    if (D.caretPositionFromPoint) { const c = D.caretPositionFromPoint(x, y); return c && c.offsetNode ? { node: c.offsetNode, offset: c.offset } : null; }
    if (D.caretRangeFromPoint) { const r = D.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
    return null;
  }
  // the place in the chapter's text under the pointer; `strict`: only on the text itself, not on empty paper
  function epubOffsetAt(slot, e, strict) {
    const flow = slot._flow;
    if (!flow) return null;
    if (strict) {
      const t = D.elementFromPoint(e.clientX, e.clientY);
      if (!t || !flow.contains(t) || t === flow || t.classList.contains('rd-epub-chapter')) return null;
    }
    const c = caretAt(e.clientX, e.clientY);
    if (!c || !flow.contains(c.node)) return null;
    return epubOffsetOf(flow, c.node, c.offset, D);
  }
  // a new text size: the book is set again and opens where it was
  async function setTextSize(d) {
    if (!epub || !L || busy) return;
    const cur = textSize(), next = clamp(cur + d, TEXT_MIN, TEXT_MAX);
    if (next === cur) return;
    keepAnchors();
    if (host.setTextSize) host.setTextSize(next);
    busy = true;
    root.classList.add('rd-setting');
    try { await layoutEpubBook(); remapEpub(); }
    finally { busy = false; root.classList.remove('rd-setting'); }
    buildGeometry(); fit(); renderSpread(); renderDesk();
    resetToc();
    if (!find.el.hidden && findInput.value.trim()) void runSearch(findInput.value);
    refreshAnnosSoon();
    host.notice(`Text size ${next}`);
  }

  /* ---------- page slots ---------- */
  // The shadow a turning leaf casts, and its own shading, are layers of their own: their opacity changes every
  // frame, and a change on the page itself (a CSS variable) would restyle everything on it, a whole EPUB chapter.
  function addShade(el) {
    const o = W.createDiv();
    o.className = el.classList.contains('rd-face') ? 'rd-shade' : 'rd-cast';
    o.style.opacity = el._shadeV || 0;
    el.appendChild(o);
    el._shade = o;
  }
  function shade(el, v) {
    v = +v.toFixed(3);
    if (el._shadeV === v) return;
    el._shadeV = v;
    if (el._shade) el._shade.style.opacity = v;
  }
  function paint(cv, c) { cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); }
  function fillSlot(el, p) {
    if (epub) fillEpubSlot(el, p); else fillPdfSlot(el, p);
    addShade(el);
  }
  function fillPdfSlot(el, p) {
    el.replaceChildren();
    el.dataset.p = p;
    if (p < 0 || p >= n) { el.classList.add('blank'); return; }
    el.classList.remove('blank');
    const pc = W.createDiv();
    pc.className = 'rd-pc';
    const cv = W.createEl('canvas');
    pc.appendChild(cv);
    const same = () => el.dataset.p == String(p);
    const hi = cached('hi', p);
    if (hi) paint(cv, hi);
    else {
      const lo = cached('lo', p);
      if (lo) paint(cv, lo);
      else request('lo', p).then(c => { if (same() && !cv.dataset.hi) paint(cv, c); }).catch(() => {});
      // only pages that stay open get a sharp copy, not leaves flying past
      if (!el.classList.contains('rd-face')) request('hi', p).then(c => { if (same()) { paint(cv, c); cv.dataset.hi = '1'; } }).catch(() => {});
    }
    // the page itself (picture, highlights, ink) is one layer, so a page colour recolours it all together;
    // sticky notes and the selectable text sit above it and keep their own colours
    const face = W.createDiv();
    face.className = 'rd-pageface';
    face.append(pc, hlLayer(p), inkSvg(p));
    el.append(face, stickyLayer(p));
  }

  /* ---------- the PDF's own links: contents entries, references, web addresses ---------- */
  const linkCache = new Map(), linkReady = new Map();
  function pageLinks(p) {
    let t = linkCache.get(p);
    if (!t) {
      t = (async () => {
        const page = await pdf.getPage(p + 1);
        const anns = await page.getAnnotations({ intent: 'display' });
        const vp = page.getViewport({ scale: PW / page.getViewport({ scale: 1 }).width }), sy = PH / vp.height;
        const links = anns.filter(a => a.subtype === 'Link' && a.rect && (a.dest || a.url || a.unsafeUrl || a.action)).map(a => {
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          // a web address is kept only if it is a plain web or mail address (see safeExternalUrl)
          return { r: [Math.min(x1, x2), Math.min(y1, y2) * sy, Math.max(x1, x2), Math.max(y1, y2) * sy], dest: a.dest, url: safeExternalUrl(a.url || a.unsafeUrl), action: a.action };
        }).filter(l => l.dest != null || l.url || l.action);
        linkReady.set(p, links);
        return links;
      })().catch(() => []);
      linkCache.set(p, t);
      while (linkCache.size > 60) { const k = linkCache.keys().next().value; linkCache.delete(k); linkReady.delete(k); }
    }
    return t;
  }
  function linkAt(slot, e) {
    if (epub) return epubLinkAt(slot, e);
    const list = linkReady.get(+slot.dataset.p);
    if (!list || !list.length) return null;
    const [x, y] = pageCoords(e, slot);
    return list.find(l => x >= l.r[0] - 2 && x <= l.r[2] + 2 && y >= l.r[1] - 2 && y <= l.r[3] + 2) || null;
  }
  // a destination in the PDF -> page index
  async function destPage(dest) {
    let d = dest;
    if (typeof d === 'string') d = await pdf.getDestination(d);
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    if (typeof ref === 'number') return ref;
    if (ref && typeof ref === 'object') { try { return await pdf.getPageIndex(ref); } catch { return null; } }
    return null;
  }
  async function linkPage(l) {
    if (l.page === undefined) {
      const named = { FirstPage: 0, LastPage: n - 1, NextPage: rightOf(S.spread) + 1, PrevPage: leftOf(S.spread) - 1 };
      l.page = l.dest != null ? await destPage(l.dest) : (l.action in named ? clamp(named[l.action], 0, n - 1) : null);
    }
    return l.page;
  }
  async function followLink(l) {
    if (l.url) {   // web addresses open in the browser, and nothing but web addresses
      const url = safeExternalUrl(l.url);
      if (url) W.open(url);
      return;
    }
    const idx = await linkPage(l);
    if (idx != null) await jumpTo(spreadOfPage(idx));
  }

  /* ---------- PDF++ highlights on the pages ---------- */
  const texts = new Map(), textReady = new Map();
  // the page's text items, in page units (PW wide, PH tall), as Obsidian's text layer orders them
  function pageText(p) {
    let t = texts.get(p);
    if (!t) {
      t = (async () => {
        const page = await pdf.getPage(p + 1);
        const tc = await page.getTextContent(TEXT_OPTIONS);
        const vp = page.getViewport({ scale: PW / page.getViewport({ scale: 1 }).width }), sy = PH / vp.height;
        const pvp = { convertToViewportRectangle: r => { const a = vp.convertToViewportRectangle(r); return [a[0], a[1] * sy, a[2], a[3] * sy]; } };
        const info = { items: tc.items.filter(it => it.str !== undefined), vp: pvp, boxes: null };
        textReady.set(p, info);
        return info;
      })();
      texts.set(p, t);
      while (texts.size > 40) { const k = texts.keys().next().value; texts.delete(k); textReady.delete(k); }
    }
    return t;
  }
  function hlBox(r, fill) {
    const d = W.createDiv();
    d.className = 'rd-hl';
    place(d, r[0], r[1], r[2] - r[0], r[3] - r[1]);
    if (fill) d.style.backgroundColor = fill;
    return d;
  }
  function hlLayer(p) {
    const layer = W.createDiv();
    layer.className = 'rd-hl-layer';
    layer._hits = [];
    if (epub) return layer;   // an EPUB's highlights are marks in its text
    const list = highlights.get(p);
    if (list && list.length) pageText(p).then(info => {
      for (const h of list) {
        const rects = selectionRects(info.items, info.vp, h.b, h.bo, h.e, h.eo);
        const fill = host.colorHex ? host.colorHex(h.color) : '#ffd000';
        const boxes = rects.map(r => layer.appendChild(hlBox(r, fill)));
        layer._hits.push({ h, rects, boxes });
      }
    }).catch(() => {});
    return layer;
  }
  // the PDF++ highlight under the pointer, if any: { h, rects, boxes }
  function hlHitAt(slot, e) {
    const layer = slot.querySelector('.rd-hl-layer');
    if (!layer || !layer._hits.length) return null;
    const [x, y] = pageCoords(e, slot);
    for (const hit of layer._hits) for (const r of hit.rects) if (x >= r[0] - 2 && x <= r[2] + 2 && y >= r[1] - 2 && y <= r[3] + 2) return hit;
    return null;
  }
  function hlAt(slot, e) { if (epub) return epubHlAt(slot, e); const hit = hlHitAt(slot, e); return hit ? hit.h : null; }
  const madeHere = [];   // highlights made on this desk that the notes don't show yet
  function setHighlights(map) {
    if (epub) {
      epubHl = map;
      for (let i = madeHere.length - 1; i >= 0; i--) {
        const m = madeHere[i];
        if ((map.get(m.ci) || []).some(h => h.a === m.a && h.b === m.b)) madeHere.splice(i, 1);
      }
      if (L) { highlights = epubByPage(map); paintStatic(); }
      if (typeof refreshAnnosSoon === 'function') refreshAnnosSoon();
      return;
    }
    highlights = map;
    if (typeof refreshAnnosSoon === 'function') refreshAnnosSoon();
    for (let i = madeHere.length - 1; i >= 0; i--) {
      const m = madeHere[i];
      if ((map.get(m.p) || []).some(h => h.b === m.b && h.bo === m.bo && h.e === m.e && h.eo === m.eo)) madeHere.splice(i, 1);
    }
    [els.pageL, els.pageR].forEach(el => {
      const old = el.querySelector('.rd-hl-layer');
      if (old) old.replaceWith(hlLayer(+el.dataset.p));
    });
  }
  function pathD(a) {
    if (a.length < 2) return '';
    let d = `M${a[0]} ${a[1]}`;
    if (a.length <= 4) return d + ` L${a[a.length - 2] + 0.01} ${a[a.length - 1]}`;
    for (let i = 2; i < a.length - 2; i += 2) {
      d += ` Q${a[i]} ${a[i + 1]} ${((a[i] + a[i + 2]) / 2).toFixed(1)} ${((a[i + 1] + a[i + 3]) / 2).toFixed(1)}`;
    }
    return d + ` L${a[a.length - 2]} ${a[a.length - 1]}`;
  }
  function strokePath(st) {
    const path = W.createSvg('path');
    path.setAttribute('class', st.k);
    path.setAttribute('stroke', st.c);
    path.setAttribute('stroke-width', st.w);
    path.setAttribute('d', pathD(st.p));
    return path;
  }
  function inkSvg(p) {
    const svg = W.createSvg('svg');
    svg.setAttribute('class', 'rd-ink');
    svg.setAttribute('viewBox', `0 0 ${PW} ${PH}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    (S.ink[p] || []).forEach(st => svg.appendChild(strokePath(st)));
    return svg;
  }
  function stickyLayer(p) {
    const layer = W.createDiv();
    layer.className = 'rd-stk-layer';
    (S.stickies[p] || []).forEach(nt => layer.appendChild(stickyEl(p, nt)));
    return layer;
  }

  /* ---------- spread, stacks, markers ---------- */
  function renderSpread() {
    const s = S.spread;
    pick = null; if (!epub) selbar.hidden = true;
    fillSlot(els.pageL, leftOf(s));
    fillSlot(els.pageR, rightOf(s));
    layoutStacks(s);
    renderMarkers();
    els.progress.textContent = `p. ${pageLabel(s) || '—'} of ${n}`;
    q('.rd-pill-page').textContent = `p. ${pageLabel(s) || '—'}`;
    prefetch(s);
    if (!epub) shownPages(s).forEach(p => { pageText(p).catch(() => {}); pageLinks(p); });   // ready for the highlighter and for taps
    if (!epub && typeof paintFoundMarks === 'function') paintFoundMarks();   // an EPUB page brings its marks along
    if (typeof markToc === 'function') markToc();
    save();
    if (!held) host.onSpread(S, shownPages(s), n);
  }
  /* Sticky-note flags on the page edges, like paper tabs: every flag has the same length from its own page,
     so one on a page deep in the stack sticks out further than one on a page close by; each stays at its
     note's own height, the nearer page lies on top, and the first line of the note is written on the tip.
     No aria-label or title: Obsidian and the browser would each show a tooltip; the desk shows its own tag. */
  const FLAG_H = 16, FLAG_LEN = 62, FLAG_STEP = 10;
  const noteTitle = nt => (nt.t || '').split('\n').map(x => x.trim()).find(Boolean) || '';
  function renderMarkers() {
    if (destroyed) return;
    const s = S.spread, t = thick();
    els.marks.replaceChildren();
    const flags = [];
    Object.keys(S.stickies).forEach(key => {
      const p = +key, list = S.stickies[p];
      if (!list || !list.length || p === leftOf(s) || p === rightOf(s)) return;
      const leaf = Math.floor(p / 2), onLeft = leaf < s;
      const depth = onLeft ? (s - 1 - leaf) * t : (leaf - s) * t;
      list.forEach(nt => flags.push({ p, nt, onLeft, depth, y: geom.top + clamp(nt.y + 14, 2, PH - FLAG_H - 2) }));
    });
    const maxEnd = STACK_MAX + CP + FM + 110;   // a crowded height may reach past the book's margin onto the desk
    for (const side of [true, false]) {
      // nearest pages first: they lie on top; a flag whose tip would hide under one at the same height reaches further
      const col = flags.filter(f => f.onLeft === side).sort((a, b) => a.depth - b.depth || a.y - b.y);
      const placed = [];
      for (const f of col) {
        f.end = f.depth + FLAG_LEN;
        let moved = true;
        while (moved) {
          moved = false;
          for (const g of placed) {
            if (Math.abs(g.y - f.y) < FLAG_H && f.end < g.end + FLAG_STEP) { f.end = g.end + FLAG_STEP; moved = true; }
          }
        }
        f.end = Math.min(f.end, maxEnd);
        placed.push(f);
      }
      col.forEach((f, i) => { f.z = col.length - i; });
    }
    for (const f of flags) {
      const b = W.createEl('button');
      b.className = 'rd-flag ' + (f.onLeft ? 'l' : 'r');
      b.style.setProperty('--sc', STK(f.nt.c));
      b.style.zIndex = f.z;
      const len = f.end - f.depth;
      if (f.onLeft) place(b, geom.spine - PW - f.depth - len, f.y, len, FLAG_H);
      else place(b, geom.spine + PW + f.depth, f.y, len, FLAG_H);
      const title = noteTitle(f.nt);
      const tip = W.createSpan();
      tip.className = 'rd-flag-t';
      tip.dir = 'auto';
      tip.textContent = title;
      const sr = W.createSpan();
      sr.className = 'rd-sr';
      sr.textContent = `Sticky note on page ${f.p + 1}. ${title}`;
      b.append(tip, sr);
      const label = `p. ${f.p + 1}` + (title ? '\n' + (title.length > 70 ? title.slice(0, 68) + '…' : title) : '');
      b.addEventListener('pointerdown', e => e.stopPropagation());
      b.addEventListener('pointermove', e => placeTip(e, label));
      b.addEventListener('pointerleave', () => { els.tip.hidden = true; });
      b.addEventListener('click', () => { els.tip.hidden = true; void jumpTo(spreadOfPage(f.p)); });
      els.marks.appendChild(b);
    }
  }

  /* ---------- turning pages ---------- */
  const ease = u => u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  function setAngle(deg) {
    els.leaf.style.transform = `rotateY(${deg}deg)`;
    // only the side of the turning leaf that faces the reader is drawn. Browsers hide the other side by
    // themselves, but WebKit (iPhone, iPad) lets blended highlights on it show through onto the new page.
    const past = deg < -90;
    if (els.leaf._past !== past) { els.leaf._past = past; els.leaf.classList.toggle('past-half', past); }
    const f = Math.sin(Math.abs(deg) * Math.PI / 180);
    shade(els.front, f * 0.3); shade(els.back, f * 0.3);
    shade(els.pageR, deg > -90 ? f * 0.35 : 0);
    shade(els.pageL, deg < -90 ? f * 0.35 : 0);
  }
  const easeOut = u => 1 - (1 - u) * (1 - u);
  // animation frames stop while the window is hidden or covered; a timer keeps the turn going then
  const nextFrame = cb => {
    let done = false;
    const go = () => { if (!done) { done = true; cb(W.performance.now()); } };
    W.requestAnimationFrame(go); W.setTimeout(go, 40);
  };
  let activeTween = null, turning = null, interruptible = false, lastTurnEnd = 0;
  function tween(a0, a1, dur, fn = ease) {
    return new Promise(res => {
      if (reduceMotion || dur <= 0) { setAngle(a1); return res(); }
      const t0 = W.performance.now();
      let over = false;
      const end = () => { if (!over) { over = true; activeTween = null; setAngle(a1); res(); } };
      activeTween = { finish: end };
      const step = now => {
        if (over) return;
        const u = Math.min(1, (now - t0) / dur);
        if (u >= 1 || destroyed) return end();
        setAngle(a0 + (a1 - a0) * fn(u));
        nextFrame(step);
      };
      nextFrame(step);
    });
  }
  // A page that is only finishing its fall lands at once when the next gesture or key comes.
  async function settle() {
    if (busy && interruptible && activeTween) { activeTween.finish(); await turning; }
  }
  // Static pages + the moving leaf for a turn between spreads a < b.
  function stageTurn(a, b) {
    fillSlot(els.pageL, leftOf(a));
    fillSlot(els.pageR, rightOf(b));
    fillSlot(els.front, rightOf(a));
    fillSlot(els.back, leftOf(b));
    els.leaf.classList.remove('is-idle');
    pauseSharp();
  }
  function endTurn(target) {
    if (target !== S.spread) readDir = target > S.spread ? 1 : -1;
    S.spread = target;
    els.leaf.classList.add('is-idle');
    setAngle(0);
    shade(els.pageL, 0); shade(els.pageR, 0);
    renderSpread();
  }
  async function flipTo(target, dur, canInterrupt = true) {
    await settle();
    const s = S.spread;
    target = clamp(target, 0, leaves());
    if (busy || target === s) return;
    if (dur == null) dur = W.performance.now() - lastTurnEnd < 350 ? 300 : 560;   // quick presses turn quickly
    busy = true; interruptible = canInterrupt;
    turning = (async () => {
      if (target > s) { stageTurn(s, target); setAngle(0); await tween(0, -180, dur); }
      else { stageTurn(target, s); setAngle(-180); await tween(-180, 0, dur); }
      busy = false; interruptible = false; lastTurnEnd = W.performance.now();
      endTurn(target);
    })();
    await turning;
  }
  async function flipBy(d) { await settle(); return flipTo(S.spread + d); }
  // A long jump riffles a few leaves, like a thumb running along the fore-edge.
  async function jumpTo(target) {
    await settle();
    target = clamp(target, 0, leaves());
    const s = S.spread, diff = target - s;
    if (!diff || busy) return;
    if (Math.abs(diff) === 1 || reduceMotion) return flipTo(target);
    const steps = Math.min(Math.abs(diff), 6);
    for (let i = 1; i <= steps; i++) await flipTo(Math.round(s + diff * i / steps), i === steps ? 420 : 170, false);
  }


  /* ---------- pointer helpers ---------- */
  function pageCoords(e, slot) {
    const r = slot.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * PW, (e.clientY - r.top) / r.height * PH];
  }
  // the drags under way. Each follows the pointer whose pointerdown started it, and no other: another finger
  // on the glass must not move it, and a drag whose pointer's "up" was lost must not wait for that pointer forever.
  const drags = new Set();
  let downEvent = null;   // the pointerdown being handled now (see the listener on the document, below)
  function onDrag(move, up, cancel) {
    const id = downEvent ? downEvent.pointerId : null;
    let last = downEvent;
    const mine = e => id == null || e.pointerId === id;
    const mv = e => { if (!mine(e)) return; last = e; move(e); };
    const end = e => { if (!mine(e)) return; stop(); if (up) up(e); };
    const stop = () => {
      W.removeEventListener('pointermove', mv); W.removeEventListener('pointerup', end); W.removeEventListener('pointercancel', end);
      drags.delete(d);
    };
    const d = {
      id, touch: !!downEvent && downEvent.pointerType === 'touch',
      cancel: () => { stop(); if (cancel) cancel(); },
      finish: () => { stop(); if (up && last) up(last); }   // its pointer is gone: it ends where it was last seen
    };
    drags.add(d);
    W.addEventListener('pointermove', mv); W.addEventListener('pointerup', end); W.addEventListener('pointercancel', end);
  }

  /* ---------- a pointer on a page: turn it, pan it, or use the current tool ---------- */
  /* In a right-to-left book the whole book is drawn mirrored (the page contents are mirrored back),
     so every gesture is worked out in "book space": screen x reflected around the spine. */
  const spineX = () => { const r = els.book.getBoundingClientRect(); return r.left + r.width / 2; };
  const bx = x => S.rtl ? 2 * spineX() - x : x;
  function brect(el) {
    const r = el.getBoundingClientRect();
    if (!S.rtl) return r;
    const c = spineX();
    return { left: 2 * c - r.right, right: 2 * c - r.left, width: r.width, top: r.top, bottom: r.bottom, height: r.height };
  }
  function applyDir() {
    els.book.classList.toggle('rtl', !!S.rtl);
    q('.rd-rtl-btn').setAttribute('aria-pressed', String(!!S.rtl));
  }

  // with a tool in hand, only a thin strip at the outer edge turns the page; on an EPUB page it stays in the margin,
  // so a selection or a highlight can start at the very first letter of a line
  const EDGE = () => epub ? (EM.side - 12) / PW : 0.1;
  function onPageDown(e) {
    if (e.button > 0 || pinch || touches.size > 1) return;
    if (busy && !interruptible) return;
    const slot = e.currentTarget, side = slot === els.pageR ? 'r' : 'l';
    const go = () => {
      const r = brect(slot), x = bx(e.clientX);
      const nearEdge = side === 'r' ? x > r.right - r.width * EDGE() : x < r.left + r.width * EDGE();
      if (tool !== 'read' && !nearEdge) return useTool(e, slot);
      if (zoom > 1.001 && tool === 'read') return panGesture(e, side, r, slot);
      turnGesture(e, side, r, slot);
    };
    // a page still falling from the last flick lands at once, and this gesture starts from there
    if (busy) void settle().then(() => { if (!busy) go(); }); else go();
  }
  // a tap: on a highlight it opens the note behind it, on the outer third it turns the page
  function tapTurn(side, sx, r, t0, ev, slot) {
    if (W.performance.now() - t0 > 400) return;
    if (tool === 'read' && ev && slot) {
      const ln = linkAt(slot, ev);
      if (ln) { els.tip.hidden = true; void followLink(ln); return; }
      const h = hlAt(slot, ev);
      if (h) { els.tip.hidden = true; return host.openSource && host.openSource(h, ev); }
    }
    const zone = r.width * (tool === 'read' ? 1 / 3 : EDGE());
    if (side === 'r' ? sx > r.right - zone : sx < r.left + zone) { lastTap = null; return readingStep(side === 'r' ? 1 : -1); }
    // a double tap in the middle of a page fits that page to the screen's width; another one shows the whole book
    if (tool === 'read' && ev && slot) {
      const now = W.performance.now();
      if (lastTap && now - lastTap.t < 380 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) { lastTap = null; void toggleFitPage(slot, ev); }
      else lastTap = { t: now, x: ev.clientX, y: ev.clientY };
    }
  }
  let lastTap = null;

  /* ---------- reading zoomed in on a phone ----------
     Zoomed in so far that one page fills the screen, the next step goes where the eyes go: from the first
     page of the spread to the second, then a turn and back to the first page of the next spread. */
  function animateCam(to, dur = 300) {
    const from = { x: cam.x, y: cam.y, k: cam.k }, t0 = W.performance.now(), id = ++animateCam.id;
    atHome = false;
    return new Promise(res => {
      const done = () => { clampCam(); applyCam(); rememberCam(); res(); };
      if (reduceMotion) { cam.x = to.x; cam.y = to.y; cam.k = to.k; return done(); }
      const step = () => {
        if (id !== animateCam.id || destroyed) return res();
        const u = Math.min(1, (W.performance.now() - t0) / dur), e = easeOut(u);
        cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e; cam.k = from.k + (to.k - from.k) * e;
        applyCam();
        if (u < 1) nextFrame(step); else done();
      };
      nextFrame(step);
    });
  }
  animateCam.id = 0;
  const FIT_M = 8;   // screen pixels left free around a fitted page
  function toggleFitPage(slot, ev) {
    const dr = els.desk.getBoundingClientRect(), sr = slot.getBoundingClientRect();
    if (Math.abs(sr.width - (dr.width - 2 * FIT_M)) < 12) {   // fitted already: back to the whole book
      const h = computeHome();
      return animateCam({ x: h.x, y: h.y, k: h.k }).then(() => { atHome = true; rememberCam(); });
    }
    const k = clamp(cam.k * (dr.width - 2 * FIT_M) / sr.width, home.k * 0.4, home.k * 5);
    const wx = (sr.left - dr.left - cam.x) / cam.k, wy = (ev.clientY - dr.top - cam.y) / cam.k;   // the tapped height stays under the finger
    return animateCam({ k, x: FIT_M - wx * k, y: (ev.clientY - dr.top) - wy * k });
  }
  // zoomed in past the spread: the two pages together are wider than the screen
  const zoomedIn = () => 2 * PW * cam.k > els.desk.clientWidth * 1.05;
  const hasPage = slot => { const p = +slot.dataset.p; return p >= 0 && p < n; };
  // which open page the reader is looking at: the one nearer the middle of the screen
  function viewing() {
    const dr = els.desk.getBoundingClientRect(), mid = dr.left + dr.width / 2;
    const c = el => { const r = el.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - mid); };
    return c(els.pageL) <= c(els.pageR) ? els.pageL : els.pageR;
  }
  // bring a page into view from its top (centred if it fits)
  function showSlot(slot) {
    const dr = els.desk.getBoundingClientRect(), sr = slot.getBoundingClientRect();
    const tx = sr.width <= dr.width - 2 * FIT_M ? dr.left + (dr.width - sr.width) / 2 : dr.left + FIT_M;
    const ty = sr.height <= dr.height - 2 * FIT_M ? dr.top + (dr.height - sr.height) / 2 : dr.top + FIT_M;
    return animateCam({ k: cam.k, x: cam.x + (tx - sr.left), y: cam.y + (ty - sr.top) }, 320);
  }
  // one step in reading order: the first page of a spread is pageL, the second pageR (in either direction of writing)
  async function readingStep(d) {
    if (!zoomedIn()) return flipBy(d);
    const onSecond = viewing() === els.pageR;
    if (d > 0) {
      if (!onSecond && hasPage(els.pageR)) return showSlot(els.pageR);
      if (S.spread >= leaves()) return;
      await flipBy(1);
      return showSlot(hasPage(els.pageL) ? els.pageL : els.pageR);
    }
    if (onSecond && hasPage(els.pageL)) return showSlot(els.pageL);
    if (S.spread <= 0) return;
    await flipBy(-1);
    return showSlot(hasPage(els.pageR) ? els.pageR : els.pageL);
  }
  function turnGesture(e, side, r, slot) {
    const sx = bx(e.clientX), sy = e.clientY, t0 = W.performance.now();
    const spine = spineX();   // the mirror axis, so the same in book space
    const reach = Math.max(20, Math.abs(sx - spine));   // the page edge follows the hand from where it was grabbed
    const s = S.spread, forward = side === 'r';
    const canTurn = forward ? s < leaves() : s > 0;
    let dragging = false, angle = forward ? 0 : -180;
    const samples = [];   // [time, angle] over the last ~90 ms
    onDrag(ev => {
      const x = bx(ev.clientX), dx = x - sx;
      if (!dragging) {
        if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(ev.clientY - sy)) return;
        if (!canTurn || (forward && dx > 0) || (!forward && dx < 0)) return;
        dragging = true; busy = true; interruptible = false;
        if (forward) stageTurn(s, s + 1); else stageTurn(s - 1, s);
      }
      angle = -Math.acos(clamp((x - spine) / reach, -1, 1)) * 180 / Math.PI;
      const now = ev.timeStamp || W.performance.now();   // input time, so a busy frame doesn't blur the speed
      samples.push([now, angle]);
      while (samples.length > 2 && now - samples[0][0] > 90) samples.shift();
      setAngle(angle);
    }, up => {
      if (!dragging) return tapTurn(side, sx, r, t0, up, slot);
      // the hand's speed at release carries the page on (degrees per ms; negative = towards the left)
      const now = (up && up.timeStamp) || W.performance.now();
      let w = 0;
      if (samples.length > 1 && now - samples[samples.length - 1][0] < 70) {
        const [ta, aa] = samples[0], [tb, ab] = samples[samples.length - 1];
        if (tb - ta > 4) w = (ab - aa) / (tb - ta);
      }
      const ahead = angle + w * 160;
      const done = forward ? ahead < -70 : ahead > -110;
      const endA = forward ? (done ? -180 : 0) : (done ? 0 : -180);
      const rem = Math.abs(endA - angle);
      const withHand = Math.abs(w) > 0.12 && Math.sign(w) === Math.sign(endA - angle);
      // ease-out starts at twice the average speed, so this duration starts the fall at the hand's speed
      const dur = withHand ? clamp(2 * rem / Math.abs(w), 60, 450) : clamp(150 + rem * 1.5, 150, 450);
      interruptible = true;
      turning = (async () => {
        await tween(angle, endA, dur, easeOut);
        busy = false; interruptible = false; lastTurnEnd = W.performance.now();
        endTurn(done ? s + (forward ? 1 : -1) : s);
      })();
    }, () => {   // a second finger arrived: this becomes a pinch
      if (dragging) { busy = false; interruptible = false; endTurn(s); }
    });
  }
  // Zoomed in, dragging the page moves the view; turning is a tap on the outer third, a flick at the edge, or the arrow keys.
  function panGesture(e, side, r, slot) {
    const sx = e.clientX, sy = e.clientY, t0 = W.performance.now();
    let lx = sx, ly = sy, moved = false;
    onDrag(ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      panBy(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY;
    }, up => { if (!moved) tapTurn(side, bx(sx), r, t0, up, slot); });
  }

  /* ---------- text that is highlighted already is left out: only the free parts become highlights ---------- */
  function freePartsOn(p, r, items) {
    const at = (i, o) => i * 1e6 + o, from = v => [Math.floor(v / 1e6), v % 1e6];
    let parts = [[at(r.b, r.bo), at(r.e, r.eo)]];
    for (const h of (highlights.get(p) || []).concat(madeHere.filter(m => m.p === p))) {
      const hb = at(h.b, h.bo), he = at(h.e, h.eo), next = [];
      for (const [a, b] of parts) {
        if (he <= a || hb >= b) { next.push([a, b]); continue; }
        if (hb > a) next.push([a, hb]);
        if (he < b) next.push([he, b]);
      }
      parts = next;
    }
    return parts.map(([a, b]) => { const [pb, pbo] = from(a), [pe, peo] = from(b); return { b: pb, bo: pbo, e: pe, eo: peo }; })
      .filter(x => selectionText(items, x.b, x.bo, x.e, x.eo));
  }
  // write each part as a PDF++ highlight in the current colour; true if any reached a note
  // the page's text as it is read (see pdf-text.js), made when first asked for
  const modelOf = info => info.model || (info.model = readingText(info.items));
  // a stretch of that text as the ranges a highlight link can hold, without what is highlighted already.
  // `runs` is how many ranges the stretch itself needed: more than one where the file draws its lines backwards.
  function freeRuns(p, info, a, b) {
    const runs = segmentRuns(info.items, textSegments(modelOf(info), a, b));
    return { parts: runs.flatMap(r => freePartsOn(p, r, info.items)), runs: runs.length };
  }
  // `whole`: the words of the whole stretch, when it had to be written as several links (the first one carries them)
  async function makeHighlights(p, parts, info, whole) {
    if (!parts.length || !host.createHighlight) return false;
    const items = info.items;
    let kept = false;
    try {
      for (const [k, x] of parts.entries()) {
        const text = whole == null ? rangeText(modelOf(info), items, x) : (k === 0 ? whole : '');
        const ok = await host.createHighlight({ page: p + 1, colorName: hue(color).name, text, ...x });
        if (ok) madeHere.push({ p, ...x });
        kept = ok || kept;
      }
    } catch (err) { console.error('The highlight could not be written:', err); }
    return kept;
  }

  /* ---------- an EPUB's highlights: a stretch of a chapter's text, kept as a link in the book's note ---------- */
  function freeEpubParts(ci, a, b) {
    let parts = [[a, b]];
    for (const h of (epubHl.get(ci) || []).concat(madeHere.filter(m => m.ci === ci))) {
      const next = [];
      for (const [x, y] of parts) {
        if (h.b <= x || h.a >= y) { next.push([x, y]); continue; }
        if (h.a > x) next.push([x, h.a]);
        if (h.b < y) next.push([h.b, y]);
      }
      parts = next;
    }
    const text = epub.chapters[ci].text;
    return parts.map(([x, y]) => { while (x < y && isSpace(text[x])) x++; while (y > x && isSpace(text[y - 1])) y--; return [x, y]; }).filter(([x, y]) => y > x);
  }
  const epubQuote = (ci, a, b) => ({ ci, a, b, colorName: hue(color).name, text: epubTextOf(epub, ci, a, b, D, true), label: sectionTitle(ci, a) });
  async function makeEpubHighlights(ci, parts) {
    if (!parts.length || !host.createHighlight) return false;
    let kept = false;
    try {
      for (const [a, b] of parts) {
        const ok = await host.createHighlight(epubQuote(ci, a, b));
        if (ok) madeHere.push({ ci, a, b, hex: hue(color).hex });
        kept = ok || kept;
      }
    } catch (err) { console.error('The highlight could not be written:', err); }
    paintStatic();
    return kept;
  }
  // the highlighter on an EPUB page: word by word, within the page
  function epubTextHighlight(e, slot, start) {
    const p = +slot.dataset.p, ci = L.pages[p].ci, text = epub.chapters[ci].text, flow = slot._flow;
    const fill = hue(color).hex, x0 = e.clientX, y0 = e.clientY, lo = pageStart(p), hi = pageEnd(p);
    let z = start, moved = false;
    const range = () => {
      let [a, b] = start <= z ? [start, z] : [z, start];
      while (a > lo && !isSpace(text[a - 1])) a--;
      b = Math.max(b, a + 1);
      while (b < hi && !isSpace(text[b])) b++;
      return [a, b];
    };
    const clear = () => epubUnwrap(flow, 'mark.rd-ehl-preview');
    const draw = () => {
      clear();
      for (const [a, b] of freeEpubParts(ci, ...range())) epubWrap(flow, a, b, () => { const m = W.createEl('mark'); m.className = 'rd-ehl rd-ehl-preview'; m.style.setProperty('--hl', fill); return m; }, D);
    };
    draw();
    onDrag(ev => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true;
      const o = epubOffsetAt(slot, ev, false);
      if (o == null) return;
      const c = clamp(o, lo, hi);
      if (c !== z) { z = c; draw(); }
    }, async () => {
      const parts = moved ? freeEpubParts(ci, ...range()) : [];
      clear();
      if (parts.length) await makeEpubHighlights(ci, parts);
    }, clear);
  }

  /* ---------- the Select tool ----------
     In an EPUB the page is real text and the selection is the device's own. A PDF page is a picture with text
     behind it, piece by piece and not always in reading order, so there the desk keeps the selection itself:
     from the letter under the pointer to the letter under it now, in the order the page is read, drawn as clean
     bands along the lines. A small bar offers Copy, Highlight (never twice on the same words) and Copy as quote. */
  let pick = null, lastPickDown = null;   // pick: { a: { p, t }, z: { p, t }, words } places in the pages' text
  const infoOf = slot => { const info = textReady.get(+slot.dataset.p); if (info && !info.boxes) info.boxes = charBoxes(info.items, info.vp); return info; };
  // the place in the page's text nearest the pointer
  function textPlace(ev, slot, reach) {
    const info = hasPage(slot) && infoOf(slot);
    if (!info || !info.items.length) return null;
    const [x, y] = pageCoords(ev, slot), hit = hitChar(info.boxes, x, y, reach);
    if (!hit) return null;
    const t = textIndexOf(modelOf(info), hit.i, hit.o);
    return t < 0 ? null : { p: +slot.dataset.p, t };
  }
  // the selection as stretches of text, one per page: [{ p, a, b }]
  function pickedRanges() {
    if (!pick) return [];
    const [lo, hi] = pick.a.p < pick.z.p || (pick.a.p === pick.z.p && pick.a.t <= pick.z.t) ? [pick.a, pick.z] : [pick.z, pick.a];
    const len = p => { const info = textReady.get(p); return info ? modelOf(info).text.length : 0; };
    const out = lo.p === hi.p ? [{ p: lo.p, a: lo.t, b: hi.t + 1 }] : [{ p: lo.p, a: lo.t, b: len(lo.p) }, { p: hi.p, a: 0, b: hi.t + 1 }];
    return out.map(r => { const info = textReady.get(r.p); if (!info) return null; const [a, b] = pick.words ? wholeWords(modelOf(info), r.a, r.b) : [r.a, r.b]; return { p: r.p, a, b }; }).filter(r => r && r.b > r.a);
  }
  function paintPick() {
    const ranges = pickedRanges();
    [els.pageL, els.pageR].forEach(slot => {
      const face = slot.querySelector('.rd-pageface');
      if (!face) return;
      let layer = face.querySelector('.rd-sel-layer');
      const mine = ranges.filter(r => r.p === +slot.dataset.p), info = textReady.get(+slot.dataset.p);
      if (!mine.length || !info) { if (layer) layer.remove(); return; }
      if (!layer) { layer = W.createDiv(); layer.className = 'rd-sel-layer'; face.appendChild(layer); }
      const boxes = mine.flatMap(r => segmentRects(info.items, info.vp, textSegments(modelOf(info), r.a, r.b)));
      layer.replaceChildren(...boxes.map(b => { const d = hlBox(b, ''); d.className = 'rd-sel'; return d; }));
    });
  }
  function clearPick() {
    if (!pick && selbar.hidden) return;
    pick = null; paintPick(); selbar.hidden = true;
  }
  const pickedText = () => pickedRanges().map(r => tidyText(modelOf(textReady.get(r.p)).text.slice(r.a, r.b))).filter(Boolean).join(' ');
  function textSelect(e, slot) {
    const now = W.performance.now();
    const again = lastPickDown && now - lastPickDown.t < 450 && Math.hypot(e.clientX - lastPickDown.x, e.clientY - lastPickDown.y) < 24;
    lastPickDown = { t: now, x: e.clientX, y: e.clientY };
    clearPick();
    const a = textPlace(e, slot, 1e5);   // from the letter nearest the pointer: a drag may begin in a margin or between lines
    if (!a) return;   // a page without text
    pick = { a, z: a, words: !!again };   // a double click (or double tap) takes the word
    let moved = false;
    if (again) paintPick();
    onDrag(ev => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
      moved = true;
      // the other open page, when the pointer has gone over to it
      const over = [els.pageL, els.pageR].find(sl => { const r = sl.getBoundingClientRect(); return hasPage(sl) && ev.clientX >= r.left && ev.clientX <= r.right; }) || slot;
      const z = textPlace(ev, over, 1e5);
      if (z && pick && (z.p !== pick.z.p || z.t !== pick.z.t)) { pick.z = z; paintPick(); }
    }, () => { if (!moved && !again) clearPick(); else showPickBar(); }, clearPick);
  }
  function placeSelbar(rr) {
    const r = root.getBoundingClientRect();
    const sx = r.width / (root.offsetWidth || r.width) || 1, sy = r.height / (root.offsetHeight || r.height) || 1;
    selbar.hidden = false;
    selbar.style.left = ((rr.left + rr.width / 2 - r.left) / sx) + 'px';
    selbar.style.top = ((rr.top - r.top) / sy) + 'px';
  }
  function showPickBar() {
    const boxes = [...root.querySelectorAll('.rd-sel-layer .rd-sel')].map(x => x.getBoundingClientRect()).filter(b => b.width);
    if (!boxes.length) { selbar.hidden = true; return; }
    placeSelbar(boxes.reduce((top, b) => (b.top < top.top ? b : top)));
  }
  // in an EPUB: the selection as stretches of chapter text [{ ci, a, b }], kept to the open pages
  function epubSelectionRanges() {
    const sel = W.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !L) return [];
    const range = sel.getRangeAt(0);
    const at = (node, off) => {
      const el = node.nodeType === 3 ? node.parentElement : node;
      const flow = el && el.closest && el.closest('.rd-epub-flow'), slot = flow && flow.closest('.rd-slot.rd-page');
      if (!slot || !root.contains(slot) || slot._flow !== flow) return null;
      const p = +slot.dataset.p;
      return { p, ci: L.pages[p].ci, off: clamp(epubOffsetOf(flow, node, off, D), pageStart(p), pageEnd(p)) };
    };
    const A = at(range.startContainer, range.startOffset), Z = at(range.endContainer, range.endOffset);
    if (!A || !Z) return [];
    if (A.ci === Z.ci) return Z.off > A.off ? [{ ci: A.ci, a: A.off, b: Z.off }] : [];
    return [{ ci: A.ci, a: A.off, b: pageEnd(A.p) }, { ci: Z.ci, a: pageStart(Z.p), b: Z.off }].filter(r => r.b > r.a);
  }
  const selbar = q('.rd-selbar');
  function showSelbar() {
    const sel = W.getSelection();
    if (!epub) return;
    if (tool !== 'select' || !sel || sel.isCollapsed || !epubSelectionRanges().length) { selbar.hidden = true; return; }
    let rr = sel.getRangeAt(0).getBoundingClientRect();
    if (epub) {   // the selection may run on into the chapter's hidden columns: only what shows counts
      const box = els.desk.getBoundingClientRect();
      const vis = [...sel.getRangeAt(0).getClientRects()].filter(x => x.width && x.right > box.left && x.left < box.right && x.bottom > box.top && x.top < box.bottom
        && [els.pageL, els.pageR].some(sl => { const b = sl.getBoundingClientRect(); return x.left >= b.left - 2 && x.right <= b.right + 2; }));
      if (vis.length) {
        const left = Math.min(...vis.map(x => x.left)), right = Math.max(...vis.map(x => x.right)), top = Math.min(...vis.map(x => x.top));
        rr = { left, width: right - left, top };
      }
    }
    placeSelbar(rr);
  }
  // the bar comes once the hand lets go (or after a keyboard or touch-handle change), not mid-drag
  let selTimer = 0;
  let pointerIsDown = false;
  const onSelChange = () => {
    if (!(epub && tool === 'select')) return;
    W.clearTimeout(selTimer);
    if (pointerIsDown) selbar.hidden = true;
    else selTimer = W.setTimeout(showSelbar, 150);
  };
  const onDocDown = () => { pointerIsDown = true; };
  const onDocUp = () => {
    pointerIsDown = false;
    if (!(epub && tool === 'select')) return;
    W.clearTimeout(selTimer); selTimer = W.setTimeout(showSelbar, 60);
  };
  D.addEventListener('selectionchange', onSelChange);
  D.addEventListener('pointerdown', onDocDown, true);
  D.addEventListener('pointerup', onDocUp, true);
  selbar.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });   // keep the selection
  q('.rd-sel-copy').addEventListener('click', async () => {
    await copyPicked();
  });
  async function copyPicked() {
    const text = epub ? epubSelectionRanges().map(r => epubTextOf(epub, r.ci, r.a, r.b, D, false)).join('\n\n') : pickedText();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); host.notice('Copied.'); } catch { host.notice('The text could not be copied here. Select it and use the copy command of your device.'); }
  }
  q('.rd-sel-hl').addEventListener('click', async () => {
    if (epub) {
      const ranges = epubSelectionRanges();
      W.getSelection().removeAllRanges(); selbar.hidden = true;
      for (const r of ranges) await makeEpubHighlights(r.ci, freeEpubParts(r.ci, r.a, r.b));
      return;
    }
    const ranges = pickedRanges();
    clearPick();
    for (const r of ranges) {
      const info = await pageText(r.p), free = freeRuns(r.p, info, r.a, r.b);
      await makeHighlights(r.p, free.parts, info, free.runs > 1 ? tidyText(modelOf(info).text.slice(r.a, r.b)) : null);
    }
  });
  q('.rd-sel-quote').addEventListener('click', async () => {
    const out = [];
    if (epub) for (const r of epubSelectionRanges()) { if (host.quoteFor) out.push(host.quoteFor(epubQuote(r.ci, r.a, r.b))); }
    else for (const r of pickedRanges()) {
      const info = await pageText(r.p), m = modelOf(info);
      const text = tidyText(m.text.slice(r.a, r.b)), run = segmentRuns(info.items, textSegments(m, r.a, r.b))[0];
      if (text && run && host.quoteFor) out.push(host.quoteFor({ page: r.p + 1, colorName: hue(color).name, text, ...run }));
    }
    if (!out.length) return;
    try { await navigator.clipboard.writeText(out.join('\n\n')); host.notice('Quote copied, with its link to the page.'); } catch { /* the clipboard refused */ }
  });

  /* ---------- the highlighter on text: a PDF++ highlight, word by word ---------- */
  const isSpace = ch => /\s/.test(ch || ' ');
  function textHighlight(e, slot, p, info, start) {
    const layer = slot.querySelector('.rd-hl-layer');
    const preview = W.createDiv();
    preview.className = 'rd-hl-preview';
    layer.appendChild(preview);
    const fill = hue(color).hex, x0 = e.clientX, y0 = e.clientY;
    const m = modelOf(info), t0 = textIndexOf(m, start.i, start.o);
    let tz = t0, moved = false;
    // the stretch in the order the page is read, widened to whole words
    const range = () => wholeWords(m, Math.min(t0, tz), Math.max(t0, tz) + 1);
    const free = () => freeRuns(p, info, ...range());
    const draw = () => {
      const boxes = [];
      for (const x of free().parts) boxes.push(...selectionRects(info.items, info.vp, x.b, x.bo, x.e, x.eo));
      preview.replaceChildren(...boxes.map(box => hlBox(box, fill)));
    };
    draw();
    onDrag(ev => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true;
      const [x, y] = pageCoords(ev, slot);
      const hit = hitChar(info.boxes, x, y, 80), t = hit ? textIndexOf(m, hit.i, hit.o) : -1;
      if (t >= 0 && t !== tz) { tz = t; draw(); }
    }, async () => {
      if (!moved) { preview.remove(); return; }
      const [a, b] = range(), f = free();
      const kept = await makeHighlights(p, f.parts, info, f.runs > 1 ? tidyText(m.text.slice(a, b)) : null);
      // when the link is written into a note, the real highlight replaces this preview
      W.setTimeout(() => preview.remove(), kept ? 4000 : 0);
    }, () => preview.remove());
  }

  function useTool(e, slot) {
    const p = +slot.dataset.p;
    if (!(p >= 0 && p < n)) return;
    if (tool === 'select' && epub) return;   // the page is text: the device's own selection
    e.preventDefault();
    if (tool === 'select') return textSelect(e, slot);
    if (tool === 'sticky') {
      const [x, y] = pageCoords(e, slot);
      const nt = { id: Date.now(), x: Math.round(clamp(x - 66, -30, PW - 100)), y: Math.round(clamp(y - 20, 0, PH - 110)), t: '', c: color, r: +(Math.random() * 5 - 2.5).toFixed(1) };
      (S.stickies[p] = S.stickies[p] || []).push(nt);
      save();
      const el = stickyEl(p, nt);
      slot.querySelector('.rd-stk-layer').appendChild(el);
      W.setTimeout(() => el.querySelector('.rd-txt').focus(), 0);
      return;
    }
    if (tool === 'erase') {
      const rubbed = new Set(), rubbedKeys = new Set();   // text highlights the eraser went over
      const fade = (hit, on) => hit.boxes.forEach(b => b.classList.toggle('is-rubbed', on));
      // distance from a point to a line segment, so a fast stroke with far-apart points is still caught
      const segDist = (x, y, x1, y1, x2, y2) => {
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
        const t = l2 ? clamp(((x - x1) * dx + (y - y1) * dy) / l2, 0, 1) : 0;
        return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
      };
      const inkHit = (st, x, y) => {
        const r = 12 + st.w / 2, a = st.p;
        if (a.length === 2) return Math.hypot(a[0] - x, a[1] - y) < r;
        for (let i = 0; i + 3 < a.length; i += 2) if (segDist(x, y, a[i], a[i + 1], a[i + 2], a[i + 3]) < r) return true;
        return false;
      };
      const rub = ev => {
        // both open pages: a line begun on one page may run across the spine onto the other
        for (const s2 of [els.pageL, els.pageR]) {
          const p2 = +s2.dataset.p;
          if (!(p2 >= 0 && p2 < n)) continue;
          if (epub) {
            const m = epubMarkAt(s2, ev), h = m && epubHlAt(s2, ev);
            if (h && !rubbedKeys.has(m.dataset.hk)) {
              rubbedKeys.add(m.dataset.hk);
              const hit = { h, boxes: marksOf(s2, m.dataset.hk) };
              rubbed.add(hit); fade(hit, true);
            }
          } else {
            const hit = hlHitAt(s2, ev);
            if (hit && !rubbed.has(hit)) { rubbed.add(hit); fade(hit, true); }
          }
          const list = S.ink[p2];
          if (!list) continue;
          const [x, y] = pageCoords(ev, s2);
          const keep = list.filter(st => !inkHit(st, x, y));
          if (keep.length === list.length) continue;
          if (keep.length) S.ink[p2] = keep; else delete S.ink[p2];
          s2.querySelector('svg.rd-ink').replaceChildren(...(S.ink[p2] || []).map(strokePath));
          save();
        }
      };
      rub(e);
      onDrag(rub, () => {
        // a text highlight lives as a link in a note: erasing it takes the link out of that note
        if (rubbed.size && host.deleteHighlights) host.deleteHighlights([...rubbed].map(hit => hit.h));
      }, () => rubbed.forEach(hit => fade(hit, false)));
      return;
    }
    if (tool === 'hl' && epub) {
      const start = epubOffsetAt(slot, e, true);
      if (start != null) return epubTextHighlight(e, slot, start);
    } else if (tool === 'hl') {
      const info = textReady.get(p);
      if (info && info.items.length) {
        if (!info.boxes) info.boxes = charBoxes(info.items, info.vp);
        const [x, y] = pageCoords(e, slot);
        const start = hitChar(info.boxes, x, y, 6);
        if (start) return textHighlight(e, slot, p, info, start);
      }
      // off the text (a picture, a margin): a free highlighter stroke
    }
    // The pen stays on the paper, as on a real book: off the page the line stops at the edge, and on the other open
    // page it goes on as a line of that page. Each page keeps its own ink, so the ink turns with its page.
    const proto = tool === 'pen' ? { k: 'pen', c: PEN, w: 1.9 } : { k: 'hl', c: hue(color).hex, w: 15 };
    const inside = (x, y) => x >= 0 && x <= PW && y >= 0 && y <= PH;
    const openPage = ev => {
      for (const s2 of [els.pageL, els.pageR]) {
        const p2 = +s2.dataset.p;
        if (!(p2 >= 0 && p2 < n)) continue;
        const [x, y] = pageCoords(ev, s2);
        if (inside(x, y)) return { slot: s2, p: p2, x, y };
      }
      return null;
    };
    // where the way from a point on the page (ax, ay) to (bx, by) leaves the page
    const edge = (ax, ay, bx, by) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (inside(ax + (bx - ax) * m, ay + (by - ay) * m)) lo = m; else hi = m; }
      return [ax + (bx - ax) * lo, ay + (by - ay) * lo];
    };
    const made = [];
    let cur = null, last = null;   // the line being drawn { slot, p, st, path }; the pointer's last point
    const put = (x, y) => cur.st.p.push(+x.toFixed(1), +y.toFixed(1));
    const finish = () => { if (cur) cur.path.setAttribute('d', pathD(cur.st.p)); cur = null; };
    const add = ev => {
      const hit = openPage(ev);
      if (cur && (!hit || hit.slot !== cur.slot)) {   // off this page: the line ends on its edge
        const a = pageCoords(last, cur.slot), b = pageCoords(ev, cur.slot);
        put(...edge(a[0], a[1], b[0], b[1]));
        finish();
      }
      if (hit && !cur) {
        const st = { p: [], ...proto }, path = strokePath(st);
        hit.slot.querySelector('svg.rd-ink').appendChild(path);
        cur = { slot: hit.slot, p: hit.p, st, path };
        made.push(cur);
        if (last) { const a = pageCoords(last, hit.slot); if (!inside(a[0], a[1])) put(...edge(hit.x, hit.y, a[0], a[1])); }   // back on paper: from its edge
      }
      if (hit) put(hit.x, hit.y);
      last = { clientX: ev.clientX, clientY: ev.clientY };
    };
    add(e);
    onDrag(ev => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
      (evs.length ? evs : [ev]).forEach(add);
      if (cur) cur.path.setAttribute('d', pathD(cur.st.p));
    }, () => {
      finish();
      let kept = false;
      for (const m of made) {
        if (m.st.p.length < 4) { m.path.remove(); continue; }
        (S.ink[m.p] = S.ink[m.p] || []).push(m.st);
        kept = true;
      }
      if (kept) save();
    }, () => made.forEach(m => m.path.remove()));
  }

  /* ---------- sizes and text size of stickies and cards ---------- */
  function wireFont(el, nt, def) {
    const set = () => el.style.setProperty('--fs', (nt.fs || def) + 'px');
    set();
    el.querySelectorAll('.rd-fs').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      nt.fs = clamp((nt.fs || def) + 2 * +b.dataset.d, 9, 48);
      set(); save();
    }));
  }
  // the corner handle: width and height in book units, so a note keeps its size at every zoom
  function wireResize(el, nt, defW, defH, minW, minH, heightEl) {
    el.querySelector('.rd-resize').addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, w0 = nt.w || defW, h0 = nt.h || defH, k = geom.k;
      onDrag(ev => {
        nt.w = Math.round(clamp(w0 + (ev.clientX - sx) / k, minW, 900));
        nt.h = Math.round(clamp(h0 + (ev.clientY - sy) / k, minH, 1200));
        el.style.width = nt.w + 'px'; heightEl.style.height = nt.h + 'px';
      }, () => save());
    });
  }

  /* ---------- sticky notes on pages ----------
     A sticky belongs to its page and shows only while that page is open. It can sit anywhere: on the
     page, or pulled off it onto the desk beside the book. Left alone it fades, so the text shows through. */
  /* A finger has no fine grip, and on a phone a note's grip is a few pixels high: on a touch screen the whole note
     is its handle. A tap still puts the cursor in its text; a drag moves the note without opening the keyboard.
     (The mouse keeps to the grip, so that text can be selected with it.) `mover()` is called when the drag begins
     and returns what moves the note by (dx, dy) screen pixels from where it was. */
  function dragWhole(el, field, e, mover, done) {
    if (e.pointerType === 'mouse' || e.button > 0 || pinch || e.target.closest('button, .rd-resize, .rd-grip, .rd-card-head')) return;
    if (D.activeElement === field) return;   // being written in: touches there belong to the text
    const sx = e.clientX, sy = e.clientY;
    let move = null;
    onDrag(ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!move) {
        if (Math.hypot(dx, dy) < 8) return;
        move = mover();
        el.classList.add('is-moving');
      }
      move(dx, dy);
    }, () => { el.classList.remove('is-moving'); if (move) done(); }, () => el.classList.remove('is-moving'));
  }
  function activateSticky(el) {
    root.querySelectorAll('.rd-sticky.is-active').forEach(x => { if (x !== el) x.classList.remove('is-active'); });
    if (el) el.classList.add('is-active');
  }
  function stickyEl(p, nt) {
    const el = W.createDiv();
    el.className = 'rd-sticky';
    el.dataset.id = nt.id;
    el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px';
    el.style.width = (nt.w || 132) + 'px'; el.style.height = (nt.h || 116) + 'px';
    el.style.setProperty('--sc', STK(nt.c)); el.style.setProperty('--r', nt.r + 'deg');
    buildSticky(el);
    const txt = el.querySelector('.rd-txt');
    txt.textContent = nt.t;
    let titleTimer = 0;
    txt.addEventListener('input', () => {
      nt.t = txt.innerText; save();
      W.clearTimeout(titleTimer); titleTimer = W.setTimeout(renderMarkers, 400);   // the first line is the flag's title
    });
    // anywhere on the page, or off it onto the desk next to the book
    const mover = () => {
      const ox = nt.x, oy = nt.y, k = geom.k;
      return (dx, dy) => {
        nt.x = Math.round(clamp(ox + dx / k, -PW * 1.2, PW * 2.2 - (nt.w || 132)));
        nt.y = Math.round(clamp(oy + dy / k, -PH * 0.4, PH * 1.3));
        el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px';
      };
    };
    const moved = () => { save(); renderMarkers(); };
    el.addEventListener('pointerdown', e => { e.stopPropagation(); activateSticky(el); dragWhole(el, txt, e, mover, moved); });
    el.querySelector('.rd-del').addEventListener('click', () => {
      S.stickies[p] = (S.stickies[p] || []).filter(x => x !== nt);
      if (!S.stickies[p].length) delete S.stickies[p];
      el.remove(); save(); renderMarkers();
    });
    wireFont(el, nt, 15);
    wireResize(el, nt, 132, 116, 70, 50, el);
    el.querySelector('.rd-grip').addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, move = mover();
      onDrag(ev => move(ev.clientX - sx, ev.clientY - sy), moved);
    });
    return el;
  }

  /* ---------- a tag that sits exactly at the pointer ----------
     Positioned inside the desk, not on the screen: Obsidian's panes (and an Excalidraw canvas, which may
     be zoomed) are their own frames for "fixed" elements, which used to push the tag away from the mouse. */
  function placeTip(e, text) {
    const r = root.getBoundingClientRect();
    const sx = r.width / (root.offsetWidth || r.width) || 1, sy = r.height / (root.offsetHeight || r.height) || 1;
    els.tip.textContent = text;
    els.tip.style.left = (e.clientX - r.left) / sx + 'px';
    els.tip.style.top = (e.clientY - r.top) / sy + 'px';
    els.tip.classList.toggle('touch', e.pointerType === 'touch');   // above the finger, where it can be seen
    els.tip.hidden = false;
  }

  /* ---------- the page edges: point at a page and see its number; click, or let go, to open it ---------- */
  function stackTarget(e, left) {
    const r = brect(left ? els.stackL : els.stackR), x = bx(e.clientX);
    const depth = (left ? r.right - x : x - r.left) / geom.k;
    const m = Math.max(1, Math.round(depth / thick()));
    return left ? clamp(S.spread - m, 0, S.spread - 1) : clamp(S.spread + m, S.spread + 1, leaves());
  }
  // a thin line on the edge marks the very page the number belongs to
  function showStackTarget(e, left) {
    const target = stackTarget(e, left), d = Math.abs(target - S.spread) * thick();
    const x = left ? geom.spine - PW - Math.min(d, geom.tl) : geom.spine + PW + Math.min(d, geom.tr);
    place(els.scrub, x - 1, geom.top, 2, PH);
    els.scrub.hidden = false;
    placeTip(e, `p. ${pageLabel(target)}`);
    return target;
  }
  function hideStackTarget() { els.scrub.hidden = true; els.tip.hidden = true; }
  let scrubbing = false;
  [[els.hitL, true], [els.hitR, false]].forEach(([el, left]) => {
    el.addEventListener('pointermove', e => { if (!scrubbing && !busy) showStackTarget(e, left); });
    el.addEventListener('pointerleave', () => { if (!scrubbing) hideStackTarget(); });
    // press and slide along the edge (a finger, or the mouse): the number follows; letting go opens that page
    el.addEventListener('pointerdown', e => {
      if (e.button > 0 || busy || pinch) return;
      e.preventDefault(); e.stopPropagation();
      scrubbing = true;
      let target = showStackTarget(e, left);
      onDrag(ev => { target = showStackTarget(ev, left); }, () => {
        scrubbing = false;
        hideStackTarget();
        void jumpTo(target);
      }, () => { scrubbing = false; hideStackTarget(); });
    });
  });
  els.pageL.addEventListener('pointerdown', onPageDown);
  els.pageR.addEventListener('pointerdown', onPageDown);
  // hovering a highlight names the note it lives in
  [els.pageL, els.pageR].forEach(slot => {
    slot.addEventListener('pointermove', e => {
      if (e.buttons || busy || tool !== 'read') return;
      const ln = linkAt(slot, e), h = ln ? null : hlAt(slot, e);
      slot.classList.toggle('on-hl', !!(ln || h));
      if (ln) {
        if (ln.url) placeTip(e, ln.url.replace(/^https?:\/\//, '').slice(0, 60));
        else {
          placeTip(e, ln.page != null ? `Go to p. ${ln.page + 1}` : 'Go to…');
          if (ln.page === undefined) void linkPage(ln).then(pg => { if (pg != null && !els.tip.hidden && /^Go to/.test(els.tip.textContent)) els.tip.textContent = `Go to p. ${pg + 1}`; });
        }
      } else if (h) placeTip(e, `${host.sourceLabel ? host.sourceLabel(h) : h.source} · click to open`);
      else els.tip.hidden = true;
    });
    slot.addEventListener('pointerleave', () => { slot.classList.remove('on-hl'); els.tip.hidden = true; });
  });

  /* ---------- index cards on the desk ---------- */
  function renderDesk() {
    els.notes.replaceChildren();
    S.desk.forEach(nt => els.notes.appendChild(deskNoteEl(nt)));
    if (!host.helpSeen()) els.notes.appendChild(helpCard());
  }
  function dragByHead(el, head, pos) {
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY, ox = pos.x, oy = pos.y, k = geom.k;
      onDrag(ev => {
        pos.x = Math.round(ox + (ev.clientX - sx) / k);
        pos.y = Math.round(oy + (ev.clientY - sy) / k);
        el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
      }, () => save());
    });
  }
  // cards lie on the board next to the book (book units), so they move and scale with it
  function deskNoteEl(nt) {
    const el = W.createDiv();
    el.className = 'rd-card';
    el.dataset.id = nt.id;
    el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px'; el.style.setProperty('--r', nt.r + 'deg');
    el.style.width = (nt.w || 236) + 'px';
    buildCard(el);
    const chip = el.querySelector('.rd-chip'), ta = el.querySelector('textarea');
    if (nt.p != null && nt.p < n) {
      chip.textContent = `↩ p. ${nt.p + 1}`;
      chip.title = 'Go back to the page this card was written on';
      chip.addEventListener('click', () => jumpTo(spreadOfPage(nt.p)));
    } else chip.hidden = true;
    ta.value = nt.t;
    ta.style.height = (nt.h || 150) + 'px';
    ta.addEventListener('input', () => { nt.t = ta.value; save(); });
    el.addEventListener('pointerdown', e => {
      e.stopPropagation();
      dragWhole(el, ta, e, () => {
        const ox = nt.x, oy = nt.y, k = geom.k;
        return (dx, dy) => { nt.x = Math.round(ox + dx / k); nt.y = Math.round(oy + dy / k); el.style.left = nt.x + 'px'; el.style.top = nt.y + 'px'; };
      }, save);
    });
    el.querySelector('.rd-del').addEventListener('click', () => { S.desk = S.desk.filter(x => x !== nt); el.remove(); save(); });
    wireFont(el, nt, 15);
    wireResize(el, nt, 236, 150, 140, 60, ta);
    dragByHead(el, el.querySelector('.rd-card-head'), nt);
    return el;
  }
  function freeSpot() {
    const i = S.desk.length;
    if (geom.wide) return { x: Math.round(geom.BW - FM + 24 + (i % 3) * 10), y: Math.round(30 + (i % 6) * 64) };
    return { x: Math.round(geom.BW / 2 - 118 + (i % 3) * 12), y: Math.round(geom.BH + 24 + (i % 6) * 40) };
  }
  function addDeskNote() {
    const s = S.spread, p = rightOf(s) < n ? rightOf(s) : leftOf(s);
    const nt = { id: Date.now(), t: '', p: p >= 0 ? p : null, r: +(Math.random() * 3 - 1.5).toFixed(1), ...freeSpot() };
    S.desk.push(nt); save();
    const el = deskNoteEl(nt);
    els.notes.appendChild(el);
    reveal(nt.x, nt.y, 236, 180);
    el.querySelector('textarea').focus({ preventScroll: true });
  }
  function helpCard() {
    const pos = S.help || (S.help = geom.wide ? { x: Math.round(geom.BW - FM + 24), y: 330 } : { x: Math.round(geom.BW / 2 - 136), y: Math.round(geom.BH + 260) });
    const el = W.createDiv();
    el.className = 'rd-card rd-help';
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.style.setProperty('--r', '1deg');
    buildGuide(el, { excalidraw: !!(host.excalidraw && host.excalidraw()) });
    el.querySelector('.rd-del').addEventListener('click', () => { host.markHelpSeen(); el.remove(); });
    dragByHead(el, el.querySelector('.rd-card-head'), pos);
    return el;
  }

  /* ---------- toolbar + keyboard ---------- */
  function setTool(t) {
    tool = t;
    els.book.dataset.tool = t;
    clearPick();
    if (t === 'select' && !epub) {
      const open = shownPages(S.spread);
      void Promise.all(open.map(pg => pageText(pg).catch(() => null))).then(infos => {
        if (tool === 'select' && open.length && infos.every(info => info && !info.items.some(it => it.str.trim()))) host.notice('These pages have no text to select: the book is a scan.');
      });
    } else if (t !== 'select') selbar.hidden = true;
    root.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  }
  root.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  palette.forEach((c, i) => {
    const b = W.createEl('button');
    b.className = 'rd-swatch';
    b.setAttribute('aria-label', c.name);
    b.title = c.name;
    q('.rd-swatches').appendChild(b);
    b.style.setProperty('--sc', c.hex);
    b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => {
      color = i;
      root.querySelectorAll('.rd-swatch').forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
      if (tool !== 'hl' && tool !== 'sticky') setTool('hl');   // colours belong to the highlighter and stickies; the pen is always ink
    });
  });
  q('.rd-note-btn').addEventListener('click', addDeskNote);
  // the toolbar can be put away, so a phone screen is all book; a small tag keeps the page and brings it back
  function setBarHidden(hide, remember = true) {
    root.classList.toggle('rd-bar-hidden', hide);
    q('.rd-toolbar').hidden = hide;
    q('.rd-show-btn').hidden = !hide;
    if (remember && host.setToolbarHidden) host.setToolbarHidden(hide);
  }
  q('.rd-hide-btn').addEventListener('click', () => setBarHidden(true));

  /* ---------- contents: the PDF's own table of contents ---------- */
  const toc = q('.rd-toc'), tocList = q('.rd-toc-list'), tocRows = [];
  let tocBuilt = false;
  async function buildToc() {
    tocBuilt = true;
    const outline = epub ? epubOutline() : await pdf.getOutline().catch(() => null);
    if (!outline || !outline.length) { const e = W.createDiv(); e.className = 'rd-toc-empty'; e.textContent = 'This book has no table of contents.'; tocList.appendChild(e); return; }
    const add = (items, depth) => items.forEach(it => {
      const row = W.createEl('button');
      row.className = 'rd-toc-item';
      row.style.paddingInlineStart = (10 + depth * 14) + 'px';
      const t = W.createSpan(); t.className = 'rd-toc-title'; t.dir = 'auto'; t.textContent = it.title || '—';
      const pg = W.createSpan(); pg.className = 'rd-toc-page';
      row.append(t, pg);
      tocList.appendChild(row);
      const entry = { row, page: null };
      tocRows.push(entry);
      const link = it.page !== undefined ? { page: it.page } : { dest: it.dest, url: safeExternalUrl(it.url || it.unsafeUrl), action: it.action };
      void linkPage(link).then(idx => { entry.page = idx; if (idx != null) pg.textContent = idx + 1; markToc(); });
      row.addEventListener('click', () => {
        void followLink(link);
        if (root.clientWidth < 760) setToc(false);   // a narrow screen needs the book back
      });
      if (it.items && it.items.length) add(it.items, depth + 1);
    });
    add(outline, 0);
  }
  // the section being read: the last entry that starts on or before the open pages
  function markToc() {
    if (!tocRows.length) return;
    const here = Math.max(...shownPages(S.spread), 0);
    let cur = null;
    for (const r of tocRows) if (r.page != null && r.page <= here && (!cur || r.page >= cur.page)) cur = r;
    tocRows.forEach(r => r.row.classList.toggle('is-current', r === cur));
  }
  // the pages changed (a new text size): the contents are listed again when next opened
  function resetToc() {
    tocBuilt = false; tocRows.length = 0; tocList.replaceChildren();
    if (!toc.hidden) void buildToc();
  }
  function setToc(show) {
    if (show && !tocBuilt) void buildToc();
    sidePanel(show, toc);
    q('.rd-toc-btn').setAttribute('aria-pressed', String(show));
    if (show) { markToc(); const c = tocList.querySelector('.is-current'); if (c) c.scrollIntoView({ block: 'center' }); }
  }
  q('.rd-toc-btn').addEventListener('click', () => setToc(toc.hidden));

  /* ---------- plain text of a page (no character boxes): for search and the notes panel ---------- */
  const plainItems = new Map();
  function pagePlain(p) {
    let t = plainItems.get(p);
    if (!t) {
      t = pdf.getPage(p + 1).then(page => page.getTextContent({ includeMarkedContent: true, disableNormalization: true }))
        .then(tc => tc.items.filter(it => it.str !== undefined));
      plainItems.set(p, t);
      while (plainItems.size > 1200) plainItems.delete(plainItems.keys().next().value);
    }
    return t;
  }
  const yieldNow = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  function sidePanel(show, panel) {
    // one side panel at a time on the left (contents, search); the notes panel sits on the right
    if (show && panel !== annos) [toc, find.el].forEach(x => { if (x !== panel && !x.hidden) { x.hidden = true; if (x === find.el) closeFind(true); if (x === toc) q('.rd-toc-btn').setAttribute('aria-pressed', 'false'); } });
    panel.style.top = q('.rd-toolbar').hidden ? '0px' : q('.rd-toolbar').offsetHeight + 'px';
    panel.hidden = !show;
  }

  /* ---------- search in the book ----------
     Every page's text is folded the same way as the query: case, accents and the Arabic-script letter
     variants (ي/ی, ك/ک, ة/ه, أ/ا…) are made alike, and the zero-width non-joiner and kashida are dropped,
     so a search finds a word however the PDF happens to spell it. Matches come in page by page. */
  const find = { el: q('.rd-find'), token: 0, results: [], cur: -1, done: true, pages: new Map(), timer: 0 };
  const findList = q('.rd-find-list'), findInput = q('.rd-find-input'), findCount = q('.rd-find-count');
  function foldChar(ch) {
    if (ch === '‌' || ch === '‍' || ch === 'ـ' || ch === '­') return '';
    if (/\s/.test(ch)) return ' ';
    return ch.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
      .replace(/[يىئ]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه')
      .replace(/[أإآٱ]/g, 'ا').replace(/ؤ/g, 'و');
  }
  function fold(text, withMap) {
    let out = '', space = true;
    const map = withMap ? [] : null;
    for (let k = 0; k < text.length; k++) {
      for (const x of foldChar(text[k])) {
        if (x === ' ') { if (space) continue; space = true; } else space = false;
        out += x;
        if (map) map.push(k);
      }
    }
    return withMap ? { text: out, map } : out.trim();
  }
  async function pageSearchText(p) {
    let t = find.pages.get(p);
    if (t) return t;
    const items = await pagePlain(p), model = readingText(items);
    const f = fold(model.text, true);
    t = { orig: model.text, norm: f.text, map: Int32Array.from(f.map), model, items };
    find.pages.set(p, t);
    return t;
  }
  // an EPUB is searched chapter by chapter
  // (with a space where one paragraph ends and the next begins, so their words don't run together;
  // `back` leads from this text to the chapter's own)
  function chapterSearchText(ci) {
    let t = find.pages.get('c' + ci);
    if (t) return t;
    const ch = epub.chapters[ci], back = [];
    let orig = '', off = 0, last = null;
    for (const node of epubTextNodes(ch.el, D)) {
      const blk = epubBlockOf(ch.el, node);
      if (last && blk !== last && /\S/.test(node.data) && !/\s$/.test(orig)) { orig += ' '; back.push(off); }
      for (let k = 0; k < node.data.length; k++) back.push(off + k);
      orig += node.data; off += node.data.length;
      if (/\S/.test(node.data)) last = blk;
    }
    const f = fold(orig, true);
    t = { orig, norm: f.text, map: Int32Array.from(f.map), back: Int32Array.from(back) };
    find.pages.set('c' + ci, t);
    return t;
  }
  function setFindCount() {
    const k = find.results.length;
    findCount.textContent = !findInput.value.trim() ? '' : (k ? `${find.cur >= 0 ? find.cur + 1 + ' of ' : ''}${k}${k >= 500 ? '+' : ''} match${k === 1 ? '' : 'es'}` : (find.done ? (find.textless ? 'No text to search: this book is a scan.' : 'No matches') : '')) + (find.done ? '' : ' …');
  }
  function findRow(r, idx) {
    const t = r.src, row = W.createEl('button');
    row.className = 'rd-find-item';
    const pg = W.createSpan(); pg.className = 'rd-find-page'; pg.textContent = `p. ${r.p + 1}`;
    const ctx = W.createSpan(); ctx.className = 'rd-find-ctx'; ctx.dir = 'auto';
    const ra = r.ta ?? r.a, rb = r.tb ?? r.b;   // where the match is in the searched text
    const s = Math.max(0, ra - 50), e = Math.min(t.orig.length, rb + 60);
    const tidy = x => x.replace(/\s+/g, ' ');
    const mark = W.createEl('mark'); mark.textContent = tidy(t.orig.slice(ra, rb));
    ctx.append((s > 0 ? '…' : '') + tidy(t.orig.slice(s, ra)), mark, tidy(t.orig.slice(rb, e)) + (e < t.orig.length ? '…' : ''));
    row.append(pg, ctx);
    row.addEventListener('click', () => goToResult(idx));
    return row;
  }
  async function runSearch(query) {
    const token = ++find.token, nq = fold(query, false);
    find.results = []; find.cur = -1; find.done = false; find.textless = false;
    findList.replaceChildren();
    paintFoundMarks();
    if (nq.length < 2) { find.done = true; setFindCount(); return; }
    setFindCount();
    let empty = 0, shown = 0;
    const units = epub ? epub.chapters.length : n;   // pages of a PDF, chapters of an EPUB
    for (let u = 0; u < units; u++) {
      if (token !== find.token || destroyed) return;
      const t = epub ? chapterSearchText(u) : await pageSearchText(u).catch(() => null);
      if (!t) continue;
      if (!t.norm.trim()) empty++;
      for (let i = t.norm.indexOf(nq); i >= 0 && find.results.length < 500; i = t.norm.indexOf(nq, i + nq.length)) {
        const a = t.map[i], b = t.map[i + nq.length - 1] + 1;
        if (epub) { const ca = t.back[a], cb = t.back[b - 1] + 1; find.results.push({ ci: u, p: pageAt(u, ca), a: ca, b: cb, ta: a, tb: b, src: t }); }
        else find.results.push({ p: u, a, b, src: t });
      }
      if (u % 6 === 5 || u === units - 1) {
        for (; shown < find.results.length; shown++) findList.appendChild(findRow(find.results[shown], shown));
        setFindCount();
        if (shown && shown === find.results.length && find.cur < 0) paintFoundMarks();
        await yieldNow();
      }
      if (find.results.length >= 500) break;
    }
    if (token !== find.token) return;
    for (; shown < find.results.length; shown++) findList.appendChild(findRow(find.results[shown], shown));
    find.done = true; find.textless = !epub && empty > n * 0.8;
    setFindCount(); paintFoundMarks();
  }
  async function goToResult(idx) {
    if (!find.results.length) return;
    find.cur = ((idx % find.results.length) + find.results.length) % find.results.length;
    const r = find.results[find.cur];
    findList.querySelectorAll('.is-current').forEach(x => x.classList.remove('is-current'));
    const row = findList.children[find.cur];
    if (row) { row.classList.add('is-current'); row.scrollIntoView({ block: 'nearest' }); }
    setFindCount();
    if (spreadOfPage(r.p) !== S.spread) await jumpTo(spreadOfPage(r.p));
    paintFoundMarks();
    if (root.clientWidth < 760) sidePanel(false, find.el);   // a narrow screen needs the page back
  }
  // the matches on the open pages, the current one stronger
  function paintFoundMarks() {
    if (epub) return paintStatic();
    [els.pageL, els.pageR].forEach(slot => {
      const old = slot.querySelector('.rd-found-layer');
      if (old) old.remove();
      const p = +slot.dataset.p;
      if (find.el.hidden || !(p >= 0 && p < n)) return;
      const mine = find.results.map((r, i) => ({ r, i })).filter(x => x.r.p === p);
      if (!mine.length) return;
      const layer = W.createDiv();
      layer.className = 'rd-found-layer';
      const face = slot.querySelector('.rd-pageface');
      if (!face) return;
      face.appendChild(layer);
      Promise.all([pageText(p), pageSearchText(p)]).then(([info, t]) => {
        if (+slot.dataset.p !== p || !layer.isConnected) return;
        for (const { r, i } of mine) {
          for (const box of segmentRects(info.items, info.vp, textSegments(t.model, r.a, r.b))) {
            const d = hlBox(box, '');
            d.className = 'rd-found' + (i === find.cur ? ' is-current' : '');
            layer.appendChild(d);
          }
        }
      }).catch(() => {});
    });
  }
  function openFind() {
    sidePanel(true, find.el);
    q('.rd-find-btn').setAttribute('aria-pressed', 'true');
    findInput.focus(); findInput.select();
    paintFoundMarks();
  }
  function closeFind(keepPanelState) {
    if (!keepPanelState) sidePanel(false, find.el);
    q('.rd-find-btn').setAttribute('aria-pressed', 'false');
    find.token++;
    paintFoundMarks();
    els.desk.focus({ preventScroll: true });
  }
  q('.rd-find-btn').addEventListener('click', () => (find.el.hidden ? openFind() : closeFind()));
  q('.rd-find-close').addEventListener('click', () => closeFind());
  q('.rd-find-next').addEventListener('click', () => goToResult(find.cur + 1));
  q('.rd-find-prev').addEventListener('click', () => goToResult(find.cur - 1));
  findInput.addEventListener('input', () => { W.clearTimeout(find.timer); find.timer = W.setTimeout(() => runSearch(findInput.value), 280); });
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); W.clearTimeout(find.timer); if (find.lastQuery !== findInput.value) { find.lastQuery = findInput.value; void runSearch(findInput.value).then(() => goToResult(0)); } else void goToResult(find.cur + (e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    e.stopPropagation();
  });

  /* ---------- the notes panel: everything you have done in this book, in page order ---------- */
  const annos = q('.rd-annos'), annosList = q('.rd-annos-list'), annosFilters = q('.rd-annos-filters');
  let annosKind = 'all', annosTimer = 0;
  const KINDS = [['all', 'All'], ['hl', 'Highlights'], ['sticky', 'Stickies'], ['card', 'Cards'], ['ink', 'Pen']];
  KINDS.forEach(([k, label]) => {
    const b = W.createEl('button');
    b.className = 'rd-chip-filter'; b.textContent = label; b.dataset.kind = k;
    b.setAttribute('aria-pressed', String(k === annosKind));
    b.addEventListener('click', () => { annosKind = k; annosFilters.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.kind === k))); renderAnnos(); });
    annosFilters.appendChild(b);
  });
  const firstLine = t => (t || '').split('\n').map(x => x.trim()).find(Boolean) || '';
  function annosEntries() {
    const out = [];
    for (const [p, list] of highlights) for (const h of list) out.push({ kind: 'hl', p, h, color: host.colorHex ? host.colorHex(h.color) : '#ffd000' });
    for (const key of Object.keys(S.stickies)) for (const nt of S.stickies[key] || []) out.push({ kind: 'sticky', p: +key, nt, color: STK(nt.c) });
    for (const nt of S.desk) out.push({ kind: 'card', p: nt.p == null ? null : nt.p, nt });
    for (const key of Object.keys(S.ink)) { const list = S.ink[key] || []; if (list.length) out.push({ kind: 'ink', p: +key, count: list.length, hl: list.filter(x => x.k === 'hl').length }); }
    return out.sort((a, b) => (a.p == null ? 1e9 : a.p) - (b.p == null ? 1e9 : b.p));
  }
  function renderAnnos() {
    if (annos.hidden) return;
    const all = annosEntries(), list = all.filter(x => annosKind === 'all' || x.kind === annosKind);
    const counts = k => all.filter(x => x.kind === k).length;
    annosFilters.querySelectorAll('button').forEach(b => {
      const k = b.dataset.kind, label = KINDS.find(x => x[0] === k)[1];
      b.textContent = k === 'all' ? `${label} ${all.length}` : `${label} ${counts(k)}`;
    });
    const rows = [];
    for (const x of list) {
      const row = W.createEl('button');
      row.className = 'rd-anno rd-anno-' + x.kind;
      const dot = W.createSpan(); dot.className = 'rd-anno-dot';
      if (x.color) dot.style.setProperty('--sc', x.color);
      const pg = W.createSpan(); pg.className = 'rd-anno-page'; pg.textContent = x.p == null ? 'desk' : `p. ${x.p + 1}`;
      const body = W.createSpan(); body.className = 'rd-anno-text'; body.dir = 'auto';
      const sub = W.createSpan(); sub.className = 'rd-anno-sub';
      if (x.kind === 'hl') {
        body.textContent = '…';
        if (epub) body.textContent = epubTextOf(epub, x.h.ci, x.h.a, x.h.b, D, true) || '(highlight)';
        else pageSearchText(x.p).then(t => { body.textContent = rangeText(t.model, t.items, x.h) || '(highlight)'; }).catch(() => {});
        sub.textContent = host.sourceLabel ? host.sourceLabel(x.h) : x.h.source;
      } else if (x.kind === 'sticky') { body.textContent = firstLine(x.nt.t) || '(empty sticky note)'; sub.textContent = 'Sticky note'; }
      else if (x.kind === 'card') { body.textContent = firstLine(x.nt.t) || '(empty card)'; sub.textContent = 'Card on the desk'; }
      else { body.textContent = `${x.count} pen mark${x.count > 1 ? 's' : ''}` + (x.hl ? `, ${x.hl} with the highlighter` : ''); sub.textContent = 'Ink'; }
      const text = W.createSpan(); text.className = 'rd-anno-main'; text.append(body, sub);
      row.append(dot, pg, text);
      row.addEventListener('click', () => openAnno(x));
      rows.push(row);
    }
    if (!rows.length) { const e = W.createDiv(); e.className = 'rd-toc-empty'; e.textContent = all.length ? 'Nothing of this kind yet.' : 'Nothing yet: highlights, sticky notes, cards and pen marks will be listed here.'; rows.push(e); }
    annosList.replaceChildren(...rows);
  }
  function refreshAnnosSoon() { if (annos.hidden) return; W.clearTimeout(annosTimer); annosTimer = W.setTimeout(renderAnnos, 300); }
  // open the page, and let the thing itself blink so the eye finds it
  async function openAnno(x) {
    if (x.p != null && spreadOfPage(x.p) !== S.spread) await jumpTo(spreadOfPage(x.p));
    const blink = el => { if (!el) return; el.classList.remove('rd-blink'); void el.offsetWidth; el.classList.add('rd-blink'); W.setTimeout(() => el.classList.remove('rd-blink'), 1800); };
    if (x.kind === 'hl' && epub) {
      marksOf(root, hk(x.h)).forEach(blink);
    } else if (x.kind === 'hl') {
      for (let k = 0; k < 20; k++) {   // its boxes are drawn once the page's text is in
        const slot = [els.pageL, els.pageR].find(s => +s.dataset.p === x.p), layer = slot && slot.querySelector('.rd-hl-layer');
        const hit = layer && layer._hits.find(hh => hh.h.b === x.h.b && hh.h.bo === x.h.bo && hh.h.e === x.h.e && hh.h.eo === x.h.eo);
        if (hit) { hit.boxes.forEach(blink); break; }
        await new Promise(r => W.setTimeout(r, 100));
      }
    } else if (x.kind === 'sticky') {
      const el = [...root.querySelectorAll('.rd-slot.rd-page .rd-sticky')].find(s => s.dataset.id === String(x.nt.id));
      if (el) { activateSticky(el); blink(el); }
    } else if (x.kind === 'card') {
      reveal(x.nt.x, x.nt.y, x.nt.w || 236, (x.nt.h || 150) + 30);
      blink([...root.querySelectorAll('.rd-card')].find(c => c.dataset.id === String(x.nt.id)));
    }
    if (root.clientWidth < 760) setAnnos(false);
  }
  function setAnnos(show) {
    sidePanel(show, annos);
    q('.rd-annos-btn').setAttribute('aria-pressed', String(show));
    if (show) renderAnnos();
  }
  q('.rd-annos-btn').addEventListener('click', () => setAnnos(annos.hidden));
  q('.rd-annos-close').addEventListener('click', () => setAnnos(false));

  q('.rd-toc-close').addEventListener('click', () => setToc(false));
  q('.rd-show-btn').addEventListener('click', () => setBarHidden(false));
  /* ---------- page colour: Paper, Sepia (warm, softer contrast), Night (dark page, light text) ---------- */
  const PAPERS = [['paper', 'Paper', 'sun'], ['sepia', 'Sepia', 'coffee'], ['night', 'Night', 'moon']];
  let paper = 'paper';
  function applyPaper(name) {
    const i = Math.max(0, PAPERS.findIndex(x => x[0] === name)), cur = PAPERS[i], nxt = PAPERS[(i + 1) % PAPERS.length];
    paper = cur[0];
    root.classList.toggle('rd-paper-sepia', paper === 'sepia');
    root.classList.toggle('rd-paper-night', paper === 'night');
    const b = q('.rd-paper-btn');
    b.querySelector('.rd-lbl').textContent = cur[1];
    setIcon(b.querySelector('[data-icon]'), cur[2]);
    b.setAttribute('aria-label', `Page colour: ${cur[1]}. Click for ${nxt[1]}`);
  }
  q('.rd-paper-btn').addEventListener('click', () => {
    const next = PAPERS[(PAPERS.findIndex(x => x[0] === paper) + 1) % PAPERS.length][0];
    applyPaper(next);
    if (host.setPaper) host.setPaper(next);
  });
  q('.rd-rtl-btn').addEventListener('click', () => { S.rtl = !S.rtl; applyDir(); save(); });
  q('.rd-pdf-btn').addEventListener('click', () => { const pg = shownPages(S.spread); host.openInPdf((pg[0] ?? 0) + 1); });
  q('.rd-text-smaller').addEventListener('click', () => setTextSize(-1));
  q('.rd-text-larger').addEventListener('click', () => setTextSize(1));
  if (epub) { q('.rd-pdf-btn').hidden = true; q('.rd-textsize').hidden = false; }
  root.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('textarea, input, [contenteditable="true"]')) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); e.stopPropagation(); openFind(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'c' || e.key === 'C') && pick) { e.preventDefault(); e.stopPropagation(); void copyPicked(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key, next = S.rtl ? 'ArrowLeft' : 'ArrowRight', prev = S.rtl ? 'ArrowRight' : 'ArrowLeft';
    if (k === next || k === 'PageDown' || k === ' ') { e.preventDefault(); void readingStep(1); }
    else if (k === prev || k === 'PageUp') { e.preventDefault(); void readingStep(-1); }
    else if (k === '+' || k === '=') setZoom(zoom * 1.25);
    else if (k === '-' || k === '_') setZoom(zoom / 1.25);
    else if (k === '0') resetView();
    else if (k === 'Home') void jumpTo(0);
    else if (k === 'End') void jumpTo(leaves());
    else if (k === 'Escape') setTool('read');
    else if (k === 's' || k === 'S') setTool(tool === 'select' ? 'read' : 'select');
    else if (k === 't' || k === 'T') setBarHidden(!root.classList.contains('rd-bar-hidden'));
    else if (k === 'o' || k === 'O') setToc(toc.hidden);
    else if (k === '/') { e.preventDefault(); openFind(); }
    else if (k === 'n' || k === 'N') setAnnos(annos.hidden);
    else return;
    e.stopPropagation();
  });
  els.desk.addEventListener('pointerdown', e => { if (!e.target.closest('textarea, [contenteditable="true"], button, .textLayer, .rd-epub-flow')) els.desk.focus({ preventScroll: true }); });

  q('.rd-zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
  q('.rd-zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
  q('.rd-zoom-val').addEventListener('click', () => resetView());
  // ctrl + wheel (a trackpad pinch too) zooms at the pointer; plain scrolling moves the desk
  els.desk.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      setZoom(zoom * Math.exp(-clamp(e.deltaY, -25, 25) * 0.01), e.clientX, e.clientY);
      return;
    }
    if (root.classList.contains('rd-embedded')) return;   // on a canvas, plain scrolling moves the canvas
    if (e.target.closest && e.target.closest('textarea, .rd-txt')) return;
    e.preventDefault();
    const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? els.desk.clientHeight : 1;
    panBy(-e.deltaX * f, -e.deltaY * f);
  }, { passive: false });
  // dragging the empty desk moves the view; a double-click puts the book back in the middle
  const isBoard = t => t === els.desk || t === els.world || t === els.book || t === els.notes || (t.classList && t.classList.contains('rd-cover'));
  els.desk.addEventListener('pointerdown', e => {
    if (!e.target.closest('.rd-sticky')) activateSticky(null);
    if (pick && !e.target.closest('.rd-slot.rd-page')) clearPick();
    if (e.button > 0 || pinch || touches.size > 1 || !isBoard(e.target)) return;
    e.preventDefault();
    let lx = e.clientX, ly = e.clientY;
    els.desk.classList.add('panning');
    const stop = () => els.desk.classList.remove('panning');
    onDrag(ev => { panBy(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; }, stop, stop);
  });
  els.desk.addEventListener('dblclick', e => { if (isBoard(e.target)) resetView(); });
  // two fingers: zoom and move together, the board point between them stays between them
  const touches = new Map();   // pointerId -> { x, y, n }: the fingers on the glass, as far as the events tell
  let pinch = null, touchCount = 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  /* Events get lost. On iOS a finger's "up" goes to the element it went down on, and when that element has been
     replaced meanwhile (a page turned or drawn again under the finger) it never reaches the window. A finger left
     on the list would turn every later touch into a pinch, and the tools would take no touch at all. So the list is
     put right whenever the browser says how many fingers there are: the latest ones are kept. */
  const keepFingers = n => {
    if (touches.size > n) {
      const keep = new Set([...touches.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, n).map(([id]) => id));
      for (const id of [...touches.keys()]) if (!keep.has(id)) touches.delete(id);
      for (const d of [...drags]) if (d.touch && !touches.has(d.id)) d.finish();
    }
    if (touches.size < 2) pinch = null;
  };
  // a primary pointer goes down only when no other is down: whatever is still on the lists is stale
  const onAnyDown = e => {
    if (e.isPrimary) { keepFingers(0); for (const d of [...drags]) d.finish(); }
    downEvent = e;
  };
  const onTouchCount = e => keepFingers(e.touches.length);
  D.addEventListener('pointerdown', onAnyDown, true);
  D.addEventListener('touchstart', onTouchCount, { capture: true, passive: true });
  D.addEventListener('touchend', onTouchCount, { capture: true, passive: true });
  D.addEventListener('touchcancel', onTouchCount, { capture: true, passive: true });
  const onTouchDown = e => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, n: ++touchCount });
    if (touches.size === 2 && home) {
      for (const d of [...drags]) d.cancel();
      const [a, b] = [...touches.values()], dr = els.desk.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - dr.left, my = (a.y + b.y) / 2 - dr.top;
      pinch = { d0: Math.max(10, dist(a, b)), k0: cam.k, wx: (mx - cam.x) / cam.k, wy: (my - cam.y) / cam.k };
    }
  };
  const onTouchMove = e => {
    if (!touches.has(e.pointerId)) return;
    touches.get(e.pointerId).x = e.clientX; touches.get(e.pointerId).y = e.clientY;
    if (!pinch || touches.size < 2) return;
    const [a, b] = [...touches.values()], dr = els.desk.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - dr.left, my = (a.y + b.y) / 2 - dr.top;
    cam.k = clamp(pinch.k0 * dist(a, b) / pinch.d0, home.k * 0.4, home.k * 5);
    cam.x = mx - pinch.wx * cam.k; cam.y = my - pinch.wy * cam.k;
    atHome = false; clampCam(); applyCam(); rememberCam();
  };
  const onTouchUp = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  els.desk.addEventListener('pointerdown', onTouchDown, true);
  W.addEventListener('pointermove', onTouchMove);
  W.addEventListener('pointerup', onTouchUp);
  W.addEventListener('pointercancel', onTouchUp);

  const ro = new W.ResizeObserver(() => fit());
  ro.observe(els.desk);

  /* ---------- a link to a place in the book: #page=12 (a PDF), #chapter=3&selection=a,b (an EPUB) ---------- */
  async function goTo(subpath) {
    let p = null, key = null;
    if (epub) {
      const h = parseEpubSubpath(subpath);
      if (h && L && epub.chapters[h.ci]) { p = pageAt(h.ci, h.a); if (h.b != null) key = hk(h); }
    } else {
      const pg = parseInt(new URLSearchParams(String(subpath || '').replace(/^#/, '')).get('page'), 10);
      if (pg >= 1) p = clamp(pg - 1, 0, n - 1);
    }
    if (p == null) return;
    if (spreadOfPage(p) !== S.spread) await jumpTo(spreadOfPage(p));
    if (key) marksOf(root, key).forEach(el => { el.classList.add('rd-blink'); W.setTimeout(() => el.classList.remove('rd-blink'), 1800); });
  }

  /* ---------- start ---------- */
  async function start() {
    if (epub) { await layoutEpubBook(); remapEpub(); }
    else {
      const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
      PH = Math.round(clamp(PW * vp.height / vp.width, 360, 820));
    }
    if (destroyed) return;
    if (!epub && (S.spread || 0) > leaves()) {
      held = { spread: S.spread, shown: leaves() };
      host.notice('This file has fewer pages than the book this desk was used with. Your place is kept until you turn a page here.');
    }
    S.spread = clamp(S.spread || 0, 0, leaves());
    els.name.textContent = host.title;
    if (S.rtl === undefined) { try { S.rtl = !!(host.defaultRtl && await host.defaultRtl()); } catch { S.rtl = false; } }
    applyDir();
    applyPaper(host.paper ? host.paper() : 'paper');
    setBarHidden(!!(host.toolbarHidden && host.toolbarHidden()), false);
    setTool('read');
    buildGeometry(); fit();
    // the first versions kept cards in screen pixels; on the board they are in book units
    if (!S.board) {
      const conv = c => { if (c && c.x != null) { c.x = Math.round((c.x - home.x) / home.k); c.y = Math.round((c.y - home.y) / home.k); } };
      S.desk.forEach(conv); conv(S.help);
      S.board = 1;
    }
    restoreCam();
    S.desk.forEach(nt => { if (nt.x == null) { const spot = freeSpot(); nt.x = spot.x; nt.y = spot.y; } });
    renderSpread(); renderDesk();
    els.desk.focus({ preventScroll: true });
  }

  return {
    start,
    fit,
    destroy() {
      destroyed = true; ro.disconnect(); pauseSharp(); pending.clear(); hiCache.clear(); loCache.clear(); texts.clear(); textReady.clear();
      [sharpenTimer, selTimer, annosTimer, find.timer].forEach(t => W.clearTimeout(t));
      W.removeEventListener('pointermove', onTouchMove); W.removeEventListener('pointerup', onTouchUp); W.removeEventListener('pointercancel', onTouchUp);
      D.removeEventListener('selectionchange', onSelChange);
      D.removeEventListener('pointerdown', onDocDown, true); D.removeEventListener('pointerup', onDocUp, true);
      for (const d of [...drags]) d.cancel();
      D.removeEventListener('pointerdown', onAnyDown, true);
      D.removeEventListener('touchstart', onTouchCount, true); D.removeEventListener('touchend', onTouchCount, true); D.removeEventListener('touchcancel', onTouchCount, true);
      root.replaceChildren();
    },
    state: () => S,
    setPaper: applyPaper,
    setHighlights,
    goTo
  };
}
