// The tools, used with a real pointer on a desk of its own: sticky note, index card, pen, eraser, page colour, guide.
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { H, epub, mountDesk, wait } = F;
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
const wc = require('electron').remote.getCurrentWebContents();
const drag = async pts => {
  wc.sendInputEvent({ type: 'mouseDown', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
  for (const [x, y] of pts.slice(1)) { wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await wait(30); }
  const last = pts[pts.length - 1];
  wc.sendInputEvent({ type: 'mouseUp', x: last[0], y: last[1], button: 'left', clickCount: 1 });
  await wait(250);
};
const para = `<p>${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(6)}</p>`;
const book = await H.openEpub(epub([{ name: 'c1.xhtml', body: `<body><h1>One</h1>${para.repeat(14)}</body>` }]), document);
F.awake(true);
let m;
try {
  m = await mountDesk({ epub: book }, { state: { spread: 1 } });
  await wait(500);
  const q = s => m.root.querySelector(s), state = () => m.desk.state();
  const page = q('.rd-pr'), r = page.getBoundingClientRect(), at = (fx, fy) => [Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy)];
  const p = +page.dataset.p;
  ok('the toolbar is built with its icons', m.root.querySelectorAll('.rd-toolbar button').length >= 18 && m.root.querySelectorAll('.rd-toolbar svg').length >= 12, [m.root.querySelectorAll('.rd-toolbar button').length, m.root.querySelectorAll('.rd-toolbar svg').length]);

  q('[data-tool="pen"]').click();
  await drag([at(0.3, 0.3), at(0.4, 0.35), at(0.5, 0.3), at(0.6, 0.38)]);
  ok('the pen writes on the page', (state().ink[p] || []).length === 1 && state().ink[p][0].k === 'pen' && page.querySelectorAll('svg.rd-ink path').length === 1, state().ink);
  await drag([at(0.5, 0.5), at(0.8, 0.5), [Math.round(r.right + 120), Math.round(r.top + r.height * 0.5)]]);
  const second = (state().ink[p] || [])[1];
  ok('a line drawn off the page stops at its edge', second && Math.max(...second.p.filter((v, i) => i % 2 === 0)) <= 440.01, second);

  q('[data-tool="erase"]').click();
  await drag([at(0.3, 0.3), at(0.45, 0.33), at(0.6, 0.38)]);
  ok('the eraser rubs a line out', (state().ink[p] || []).length === 1, state().ink);

  q('[data-tool="sticky"]').click();
  await F.tap(...at(0.5, 0.6));
  await wait(200);
  const sticky = page.querySelector('.rd-sticky');
  ok('a sticky note is put on the page, built from its parts', sticky && sticky.querySelector('.rd-grip .rd-fs') && sticky.querySelector('.rd-del') && sticky.querySelector('.rd-txt[contenteditable="true"]') && sticky.querySelector('.rd-resize') && (state().stickies[p] || []).length === 1, sticky && sticky.outerHTML.slice(0, 300));
  const txt = sticky.querySelector('.rd-txt');
  txt.textContent = 'Title line\n<img src=x onerror=alert(1)>'; txt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(600);
  ok('what is typed is kept as text', state().stickies[p][0].t.includes('<img src=x') && !sticky.querySelector('img'), state().stickies[p][0]);
  sticky.querySelector('.rd-fs[data-d="1"]').click();
  ok('its text can be made larger', state().stickies[p][0].fs === 17, state().stickies[p][0].fs);

  q('.rd-note-btn').click();
  await wait(200);
  const card = q('.rd-card:not(.rd-help)');
  ok('an index card is put on the desk', card && card.querySelector('textarea') && card.querySelector('.rd-chip') && state().desk.length === 1, card && card.outerHTML.slice(0, 200));
  card.querySelector('textarea').value = 'card text'; card.querySelector('textarea').dispatchEvent(new Event('input', { bubbles: true }));
  q('.rd-annos-btn').click();
  await wait(500);
  const rows = [...m.root.querySelectorAll('.rd-anno')].map(x => x.textContent);
  ok('the notes panel lists pen, sticky and card', rows.length === 3 && rows.some(x => /Title line/.test(x)) && rows.some(x => /card text/.test(x)) && rows.some(x => /1 pen mark/.test(x)), rows);
  sticky.querySelector('.rd-del').click();
  card.querySelector('.rd-del').click();
  ok('notes can be thrown away', !state().stickies[p] && state().desk.length === 0, state());

  q('.rd-paper-btn').click();
  ok('the page colour changes', m.root.classList.contains('rd-paper-sepia') && /Sepia/.test(q('.rd-paper-btn').textContent), m.root.className);
  q('[data-tool="read"]').click();
  const saved = JSON.parse(m.saved[m.saved.length - 1]);
  ok('everything is in the saved state', saved.v === 1 && saved.ink[p].length === 1 && saved.spread === 1, saved);
  m.remove(); m = null;

  // the guide card, for a first visit
  const box = document.body.createDiv();
  box.setCssStyles({ position: 'fixed', left: '0px', top: '0px', width: '1200px', height: '800px', zIndex: '9999' });
  const root = box.createDiv(); root.setCssStyles({ height: '100%' });
  let seen = false;
  const desk = H.createDesk(root, { epub: book, title: 'T', state: null, save: () => {}, onSpread: () => {}, notice: () => {}, helpSeen: () => seen, markHelpSeen: () => { seen = true; }, textSize: () => 16 });
  await desk.start();
  const guide = root.querySelector('.rd-help');
  ok('a new reader gets the guide, written out in full', guide && guide.querySelectorAll('li').length === 20 && guide.querySelectorAll('kbd').length > 8 && /Turn pages:/.test(guide.textContent), guide && guide.querySelectorAll('li').length);
  guide.querySelector('.rd-del').click();
  ok('and can put it away', seen && !root.querySelector('.rd-help'), seen);
  desk.destroy(); box.remove();
} finally {
  F.awake(false);
  if (m) m.remove();
  book.destroy();
}
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
