// A desk moved into a window of its own: the book is opened again there (its styles belong to a document, the desk
// listens to a window), at the same place. Also: a setting typed by hand is cleaned before it is kept.
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { epub, wait } = F;
const P = app.plugins.plugins['book-desk'];
if (!P) return 'Book Desk is not enabled in this vault.';
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
const until = async (fn, ms = 10000) => { const t = performance.now(); for (;;) { const v = await fn(); if (v) return v; if (performance.now() - t > ms) return null; await wait(100); } };
const dir = 'book-desk-test-' + Date.now().toString(36), keep = P.settings, realSave = P.saveSettings;
P.saveSettings = async () => {};
P.settings = { ...keep, dataFolder: `${dir}/desks`, notesFolder: dir, pageProperty: '' };
const para = `<p>${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(6)}</p>`;
const bytes = epub([{ name: 'c1.xhtml', body: `<body><h1>One</h1>${para.repeat(10)}</body>`, head: '<style>h1 { color: rgb(9, 8, 7); }</style>' }, { name: 'c2.xhtml', body: `<body><h1>Two</h1>${para.repeat(10)}</body>` }]);
let leaf;
F.awake(true);
try {
  await app.vault.createFolder(dir);
  const book = await app.vault.createBinary(`${dir}/Window Book.epub`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  leaf = await P.openBook(book);
  await until(() => leaf.view.ready);
  await leaf.view.desk.goTo('#chapter=2');
  await wait(1200);
  const place = leaf.view.contentEl.querySelector('.rd-progress').textContent;
  const sheetsMain = document.adoptedStyleSheets.length;
  // a new window may only be opened by the user's own hand: Electron is told that this is one.
  // (While Obsidian's window is hidden no window can be opened at all: then only the reopening itself is checked.)
  let popped = true;
  window.__bookDeskLeaf = leaf;
  try { await require('electron').remote.getCurrentWebContents().executeJavaScript('app.workspace.moveLeafToPopout(window.__bookDeskLeaf); 1', true); }
  catch { popped = false; await leaf.view.reload(); }
  delete window.__bookDeskLeaf;
  const moved = await until(() => (!popped || leaf.view.contentEl.doc !== document) && leaf.view.ready && leaf.view.desk && leaf.view.contentEl.querySelector('.rd-slot.rd-page h1'), 15000);
  const doc = leaf.view.contentEl.doc;
  ok(popped ? 'the desk opens again in the new window' : 'NO WINDOW COULD BE OPENED HERE: the desk opens again in place', !!moved && (doc !== document) === popped, leaf.view.contentEl.textContent.slice(0, 200));
  ok('at the same place', leaf.view.contentEl.querySelector('.rd-progress') && leaf.view.contentEl.querySelector('.rd-progress').textContent === place, [place, leaf.view.contentEl.querySelector('.rd-progress') && leaf.view.contentEl.querySelector('.rd-progress').textContent]);
  const h1 = leaf.view.contentEl.querySelector('.rd-slot.rd-page h1');
  ok('the book\'s styles moved with it', h1 && doc.defaultView.getComputedStyle(h1).color === 'rgb(9, 8, 7)' && doc.adoptedStyleSheets.length >= 1 && document.adoptedStyleSheets.length === sheetsMain - (popped ? 1 : 0), h1 && [doc.defaultView.getComputedStyle(h1).color, doc.adoptedStyleSheets.length, document.adoptedStyleSheets.length, sheetsMain]);
  ok('its elements belong to the new window', h1 && h1.ownerDocument === doc && leaf.view.contentEl.querySelector('.rd-toolbar svg'), '');
  leaf.view.contentEl.querySelector('.rd-desk').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await wait(1200);
  ok('pages turn there', leaf.view.contentEl.querySelector('.rd-progress').textContent !== place, leaf.view.contentEl.querySelector('.rd-progress').textContent);

  // settings: values are cleaned before they are kept
  const tab = app.setting.pluginTabs.find(t => t.id === 'book-desk');
  await tab.setControlValue('highlightHeading', '  ## My quotes ');
  await tab.setControlValue('dataFolder', `//${dir}//desks/`);
  await tab.setControlValue('pageProperty', 'bad: name');
  ok('settings are cleaned when they change', P.settings.highlightHeading === 'My quotes' && P.settings.dataFolder === `${dir}/desks` && P.settings.pageProperty === '', P.settings);
} finally {
  F.awake(false);
  if (leaf) { try { leaf.detach(); } catch { /* closed */ } }
  await wait(500);
  for (const p of [...P.pending.keys()]) if (p.startsWith(dir)) { window.clearTimeout(P.pending.get(p).timer); P.pending.delete(p); }
  P.settings = keep; P.saveSettings = realSave;
  const folder = app.vault.getFolderByPath(dir);
  if (folder) await app.fileManager.trashFile(folder);
}
ok('nothing is left behind', !app.vault.getAbstractFileByPath(dir) && document.adoptedStyleSheets.length <= 1, document.adoptedStyleSheets.length);
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
