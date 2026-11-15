// Selecting text on a PDF page whose right-to-left lines are drawn left to right (as many Persian PDFs are), and
// moving notes with a finger. The "PDF" here is made up in memory, so the test needs no book.
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { mountDesk, wait } = F;
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
const wc = require('electron').remote.getCurrentWebContents();

// ---- a page of 440 x 620: one English line, then two Persian lines drawn letter by letter from the left ----
const W = 440, H = 620, items = [];
const put = (str, x, y, w) => { items.push({ str, dir: 'ltr', width: w, height: 12, transform: [12, 0, 0, 12, x, y], fontName: 'f', hasEOL: false }); return x + w; };
const drawn = (looks, y, x0) => { let x = x0; for (const s of looks) x = put(s, x, y, s === ' ' ? 5 : 9 * s.length); items[items.length - 1].hasEOL = true; };
drawn(['The quick ', 'brown fox'], 520, 60);
// line 2 reads: "آگاهی دانش است"   line 3 reads: "کتاب خوب بود"
drawn(['ﺖ', 'ﺳ', 'ا', ' ', 'ﺶ', 'ﻧ', 'ا', 'د', ' ', 'ﯽ', 'ﻫ', 'ﺎ', 'ﮔ', 'آ'], 490, 200);
drawn(['د', 'ﻮ', 'ﺑ', ' ', 'ب', 'ﻮ', 'ﺧ', ' ', 'ب', 'ﺎ', 'ﺘ', 'ﮐ'], 460, 218);
const viewport = scale => ({ width: W * scale, height: H * scale, scale, convertToViewportRectangle: r => [r[0] * scale, (H - r[1]) * scale, r[2] * scale, (H - r[3]) * scale] });
const page = {
  getViewport: ({ scale }) => viewport(scale),
  render: ({ canvasContext: c, viewport: vp }) => {   // the letters as plain marks, so a screenshot shows where they are
    c.fillStyle = '#333';
    for (const it of items) if (it.str.trim()) c.fillRect(it.transform[4] * vp.scale, (H - it.transform[5] - 9) * vp.scale, (it.width - 1) * vp.scale, 9 * vp.scale);
    return { promise: Promise.resolve(), cancel: () => {} };
  },
  getTextContent: async () => ({ items: items.map(it => ({ ...it })) }),
  getAnnotations: async () => []
};
const pdf = { numPages: 3, getPage: async () => page, getOutline: async () => null, getDestination: async () => null, getPageIndex: async () => 0 };

let copied = null;
const realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
navigator.clipboard.writeText = async t => { copied = t; };
F.awake(true);
let m; const made = [];
try {
  m = await mountDesk({ pdf }, { state: { spread: 1, rtl: false, board: 1 }, made });
  await wait(900);
  const q = s => m.root.querySelector(s), slot = q('.rd-pr'), r = slot.getBoundingClientRect();
  const at = (x, y) => [Math.round(r.left + x / W * r.width), Math.round(r.top + (H - y) / H * r.height)];   // page units -> screen
  const drag = async pts => {
    wc.sendInputEvent({ type: 'mouseDown', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await wait(40); }
    const last = pts[pts.length - 1];
    wc.sendInputEvent({ type: 'mouseUp', x: last[0], y: last[1], button: 'left', clickCount: 1 });
    await wait(300);
  };
  const bands = () => [...slot.querySelectorAll('.rd-sel-layer .rd-sel')].map(b => b.getBoundingClientRect()).sort((a, b) => a.top - b.top);
  const copy = async () => { copied = null; q('.rd-sel-copy').click(); await wait(150); return copied; };

  q('[data-tool="select"]').click();
  await wait(300);
  // line 2 lies at x 200..318 ("دانش" at 232..268), line 3 at x 218..318 ("خوب" at 250..277)
  // from the "د" of "دانش" (x 259..268) to the "خ" of "خوب" (x 268..277)
  await drag([at(264, 494), at(260, 485), at(272, 464)]);
  let b = bands();
  ok('the selection runs in reading order: the rest of the first line, the start of the next', await copy() === 'دانش است کتاب خ', copied);
  ok('it is drawn as one band per line', b.length === 2, b.length);
  const x = px => r.left + px / W * r.width;
  ok('on the first line the band runs from the pointer to the LEFT end of the line', b.length === 2 && Math.abs(b[0].left - x(200)) < 2 && Math.abs(b[0].right - x(268)) < 2, b[0] && [b[0].left - r.left, b[0].right - r.left]);
  ok('on the last line it runs from the RIGHT end of the line to the pointer', b.length === 2 && Math.abs(b[1].right - x(318)) < 2 && Math.abs(b[1].left - x(268)) < 2, b[1] && [b[1].left - r.left, b[1].right - r.left]);
  ok('the bar with Copy, Highlight and Copy as quote is shown', !q('.rd-selbar').hidden, '');
  ok('nothing of the browser\'s own selection is involved', String(window.getSelection()) === '' && !slot.querySelector('.textLayer'), String(window.getSelection()));

  // Cmd/Ctrl+C copies too
  copied = null;
  q('.rd-desk').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, bubbles: true, cancelable: true }));
  await wait(150);
  ok('the keyboard copies the selection', copied === 'دانش است کتاب خ', copied);

  // highlight: where lines had to be turned round, a stretch is more than one link; the first carries the words
  q('.rd-sel-hl').click();
  await wait(500);
  ok('a highlight of such a stretch is two links, the words on the first', made.length === 2 && made[0].text === 'دانش است کتاب خ' && made[1].text === '' && made.every(h => h.page === 3), made.map(h => [h.b, h.bo, h.e, h.eo, h.text]));
  ok('the selection is gone once it is highlighted', bands().length === 0 && q('.rd-selbar').hidden, bands().length);

  // a click on empty paper selects nothing; a double click takes a word
  await drag([at(60, 300)]);
  ok('a click on empty paper selects nothing', bands().length === 0, bands().length);
  const dbl = at(300, 494);   // inside "آگاهی"
  wc.sendInputEvent({ type: 'mouseDown', x: dbl[0], y: dbl[1], button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: dbl[0], y: dbl[1], button: 'left', clickCount: 1 });
  await wait(80);
  wc.sendInputEvent({ type: 'mouseDown', x: dbl[0], y: dbl[1], button: 'left', clickCount: 2 }); wc.sendInputEvent({ type: 'mouseUp', x: dbl[0], y: dbl[1], button: 'left', clickCount: 2 });
  await wait(300);
  ok('a double click takes the word', await copy() === 'آگاهی', copied);

  // English stays as it was
  await drag([at(75, 524), at(190, 524)]);
  ok('a left-to-right line is selected left to right', /^he quick brown/.test(await copy() || ''), copied);

  // the highlighter, word by word
  made.length = 0;
  q('[data-tool="hl"]').click();
  await drag([at(312, 494), at(300, 494), at(292, 494)]);   // inside "آگاهی" (x 273..318), which is not highlighted yet
  await wait(400);
  ok('the highlighter takes the whole word', made.length === 1 && made[0].text === 'آگاهی', made.map(h => h.text));
  made.length = 0;
  await drag([at(264, 494), at(250, 494)]);   // over "دانش", highlighted a moment ago
  await wait(300);
  ok('and never highlights the same words twice', made.length === 0, made.map(h => h.text));

  // search
  q('[data-tool="read"]').click();
  q('.rd-find-btn').click();
  const input = q('.rd-find-input');
  input.value = 'دانش'; input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(1500);
  ok('search finds the word although the file spells it backwards', /^3 match/.test(q('.rd-find-count').textContent), q('.rd-find-count').textContent);
  const hit = [...m.root.querySelectorAll('.rd-find-item')].find(el => /p\. 3/.test(el.textContent));
  hit.click();
  await wait(900);
  const found = slot.querySelector('.rd-found');
  const fb = found && found.getBoundingClientRect();
  ok('and marks it where it is on the page', fb && Math.abs(fb.left - x(232)) < 2 && Math.abs(fb.right - x(268)) < 2, fb && [fb.left - r.left, fb.right - r.left]);
  ok('the result reads right in the list', /دانش/.test(hit.textContent) && /آگاهی دانش است/.test(hit.textContent), hit.textContent);
  q('.rd-find-close').click();

  // ---- notes under a finger ----
  const touch = (type, target, cx, cy) => target.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true, button: 0 }));
  m.desk.state().stickies[2] = [{ id: 1, x: 100, y: 200, t: 'a note', c: 0, r: 0 }];
  q('[data-tool="read"]').click();
  await m.desk.goTo('#page=1'); await wait(900); await m.desk.goTo('#page=3'); await wait(1200);   // drawn again with the note
  const sticky = m.root.querySelector('.rd-slot.rd-page .rd-sticky'), txt = sticky && sticky.querySelector('.rd-txt');
  ok('the sticky note is there', !!txt, m.root.querySelectorAll('.rd-sticky').length);
  if (txt) {
    const nt = m.desk.state().stickies[2][0], tr = txt.getBoundingClientRect(), cx = tr.left + tr.width / 2, cy = tr.top + tr.height / 2, k = r.width / W;
    touch('pointerdown', txt, cx, cy); touch('pointermove', window, cx + 3, cy + 2); touch('pointerup', window, cx + 3, cy + 2);
    ok('a tap on a note does not move it', nt.x === 100 && nt.y === 200, [nt.x, nt.y]);
    touch('pointerdown', txt, cx, cy); touch('pointermove', window, cx + 30, cy + 10); touch('pointermove', window, cx + 60, cy + 40);
    ok('while a finger drags it by its text, the note follows', sticky.classList.contains('is-moving') && Math.abs(nt.x - (100 + 60 / k)) <= 1 && Math.abs(nt.y - (200 + 40 / k)) <= 1, [nt.x, nt.y, k]);
    touch('pointerup', window, cx + 60, cy + 40);
    await wait(100);
    ok('and stays where the finger left it, without opening the keyboard', !sticky.classList.contains('is-moving') && document.activeElement !== txt && JSON.parse(m.saved[m.saved.length - 1]).stickies[2][0].x === nt.x, document.activeElement && document.activeElement.className);
    // the mouse still needs the grip: a mouse drag on the text does not move the note
    const before = nt.x, tr2 = txt.getBoundingClientRect();
    txt.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', clientX: tr2.left + 20, clientY: tr2.top + 30, bubbles: true, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: tr2.left + 80, clientY: tr2.top + 30, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', clientX: tr2.left + 80, clientY: tr2.top + 30, bubbles: true }));
    ok('with a mouse the text is for writing, the grip for moving', nt.x === before, [before, nt.x]);
    txt.focus();
    const tr3 = txt.getBoundingClientRect();
    touch('pointerdown', txt, tr3.left + 20, tr3.top + 30); touch('pointermove', window, tr3.left + 70, tr3.top + 30); touch('pointerup', window, tr3.left + 70, tr3.top + 30);
    ok('a note that is being written in is not dragged away', nt.x === before, [before, nt.x]);
    txt.blur();
  }
  q('.rd-note-btn').click();
  await wait(200);
  const card = q('.rd-card:not(.rd-help)'), ta = card.querySelector('textarea');
  ta.blur();
  const c0 = { ...m.desk.state().desk[0] }, cr = ta.getBoundingClientRect(), kc = r.width / W;
  touch('pointerdown', ta, cr.left + 30, cr.top + 30); touch('pointermove', window, cr.left + 80, cr.top + 60); touch('pointerup', window, cr.left + 80, cr.top + 60);
  const c1 = m.desk.state().desk[0];
  ok('an index card moves under a finger too', Math.abs(c1.x - (c0.x + 50 / kc)) <= 1 && Math.abs(c1.y - (c0.y + 30 / kc)) <= 1, [c0.x, c0.y, c1.x, c1.y, kc]);
} finally {
  navigator.clipboard.writeText = realWrite;
  F.awake(false);
  if (m) m.remove();
}
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
