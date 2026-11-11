// The plugin itself, in the vault it is installed in. Everything happens in a folder made for the test and moved
// to the trash at the end; the plugin's settings are changed in memory only and put back.
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { epub, wait } = F;
const P = app.plugins.plugins['book-desk'];
if (!P) return 'Book Desk is not enabled in this vault.';
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
const until = async (fn, ms = 8000) => { const t = performance.now(); for (;;) { const v = await fn(); if (v) return v; if (performance.now() - t > ms) return null; await wait(100); } };
const errors = [], realError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
const onErr = e => errors.push(String(e.reason || e.message));
window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
const dir = 'book-desk-test-' + Date.now().toString(36), mine = [];
const keep = P.settings, realSave = P.saveSettings;
P.saveSettings = async () => {};   // nothing of the test reaches the settings file
P.settings = { ...keep, dataFolder: `${dir}/desks`, notesFolder: dir, pageProperty: 'current_page', totalPagesProperty: 'total_pages', highlightTarget: 'note', highlightHeading: 'Highlights', standInMarker: 'TEST-STAND-IN' };
const para = n => `<p>${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(n)}</p>`;
const bytes = epub([
  { name: 'c1.xhtml', title: 'One ]] | <b>bad</b>', body: `<body><h1>One</h1>${para(6).repeat(10)}</body>` },
  { name: 'c2.xhtml', title: 'Two', body: `<body><h1>Two</h1>${para(6).repeat(10)}</body>` }
], [], { title: 'Test Book' });
F.awake(true);
const viewOf = leaf => leaf.view;
const openDesk = async file => { const leaf = await P.openBook(file); mine.push(leaf); await until(() => viewOf(leaf).ready || leaf.view.contentEl.querySelector('.rd-stub, .rd-loading:not(:empty)') && !viewOf(leaf).desk && leaf.view.contentEl.querySelector('.rd-stub')); return leaf; };
try {
  await app.vault.createFolder(dir);
  const book = await app.vault.createBinary(`${dir}/Test Book.epub`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const note = await app.vault.create(`${dir}/Test Book note.md`, `---\nlanguage: en\n---\n# Test Book\n\n[[${dir}/Test Book.epub]]\n\n## Highlights\n\n## Other\n\nkept\n`);
  ok('the note that links to the book is found', await until(() => P.cardFor(book) === note), P.cardFor(book) && P.cardFor(book).path);

  // ---- opening ----
  const leaf = await openDesk(book), view = viewOf(leaf);
  ok('a book opens on its desk', view.getViewType() === 'book-desk' && view.ready && view.desk && view.file.extension === 'desk', [view.getViewType(), view.ready, view.file && view.file.path]);
  const deskFile = view.file;
  ok('the desk file is made in the desk folder, with the format version', deskFile.path === `${dir}/desks/Test Book.desk` && JSON.parse(await app.vault.read(deskFile)).v === 1, deskFile.path);
  ok('the same book opens the same desk again', (await P.deskFileFor(book)) === deskFile && (await P.allDeskBooks()).get(deskFile.path) === book.path, '');
  ok('the note\'s title names the tab', view.contentEl.querySelector('.rd-name').textContent === 'Test Book note', view.contentEl.querySelector('.rd-name').textContent);

  // ---- a link into the book ----
  const leaf2 = app.workspace.getLeaf('tab'); mine.push(leaf2);
  await leaf2.openFile(book, { eState: { subpath: '#chapter=2&selection=10,40' } });
  const v2 = await until(() => leaf2.view && leaf2.view.ready && leaf2.view);
  await wait(1500);
  ok('a link to a place in an EPUB opens the desk there', v2 && v2.file === deskFile && [...v2.contentEl.querySelectorAll('.rd-slot.rd-page')].some(s => s.querySelector('h1') && /Two/.test(s.textContent)), v2 && v2.contentEl.querySelector('.rd-progress').textContent);
  leaf2.detach();

  // ---- highlights: written into the note as plain text, found again, erased, brought back ----
  const hostile = 'A quote ![[secret]] <iframe src=x> `$= dv.current()` <%* evil() %> [x](obsidian://y) %%';
  const made = await P.createHighlight(book, { ci: 0, a: 5, b: 20, colorName: 'Yellow', text: hostile, label: 'One ]] | <b>bad</b>' });
  let text = await app.vault.read(note);
  const block = text.slice(text.indexOf('## Highlights'), text.indexOf('## Other'));
  ok('a highlight goes under its heading, the rest of the note stays', made === true && /chapter=1&selection=5,20&color=yellow/.test(block) && /## Other\n\nkept\n/.test(text) && text.startsWith('---\nlanguage: en'), text);
  ok('a quote is written as plain text', block.includes('!\\[\\[secret]]') && block.includes('\\<iframe') && block.includes('\\`$= dv.current()\\`') && !/<%|%>/.test(block) && !/[^\\]\[x\]\(obsidian/.test(block) && !/[^\\]%%/.test(block), block);
  ok('a section title cannot break the link', /\|Test Book, One b bad \/b\]\]/.test(block) || /\[Test Book, One b bad \/b\]\(/.test(block), block);
  const found = await until(() => { P.hlCache.clear(); const h = (P.highlightsFor(book).get(0) || [])[0]; return h && h.a === 5 && h.b === 20 && h; });
  ok('the highlight is read back from the note', !!found, [...P.highlightsFor(book)]);
  await wait(600);
  ok('and painted on the open page', !!(await until(() => view.contentEl.querySelector('.rd-slot.rd-page mark.rd-ehl'), 4000)), '');
  if (found) {
    await P.deleteHighlights([found]);
    text = await app.vault.read(note);
    ok('erasing takes the link and its quote out of the note', !/selection=5,20/.test(text) && !/secret/.test(text) && /## Other\n\nkept\n/.test(text), text);
    const undo = await until(() => [...document.querySelectorAll('.notice a')].find(a => a.textContent === 'Undo'), 3000);
    if (undo) undo.click();
    ok('Undo brings it back', !!(await until(async () => /selection=5,20/.test(await app.vault.read(note)), 3000)), await app.vault.read(note));
  }

  // ---- the page in the note, the state in the desk file ----
  await view.desk.goTo('#chapter=2');
  const page = await until(() => { const c = app.metadataCache.getFileCache(note); return c && c.frontmatter && c.frontmatter.current_page > 1 && c.frontmatter; }, 9000);
  ok('the note follows the page', page && page.total_pages > 5 && page.language === 'en', page);
  await P.flush(deskFile);
  const st = JSON.parse(await app.vault.read(deskFile));
  ok('the desk file keeps the place', st.v === 1 && st.book === book.path && st.spread > 0 && Array.isArray(st.at) && !('pdf' in st) && typeof st.saved === 'string', st);

  // ---- changed elsewhere: another device writes the desk file ----
  await app.vault.process(deskFile, data => JSON.stringify({ ...JSON.parse(data), spread: 0, at: [0, 0], stickies: { 0: [{ id: 5, x: 30, y: 40, t: 'from the phone', c: 1, r: 1 }] } }));
  ok('a desk changed on another device is shown', await until(() => view.ready && view.desk && view.desk.state().spread === 0 && view.desk.state().stickies[0] && view.contentEl.querySelector('.rd-sticky .rd-txt') && view.contentEl.querySelector('.rd-sticky .rd-txt').textContent === 'from the phone', 6000), view.desk && view.desk.state());

  // ---- the book is renamed: its desk follows ----
  await app.fileManager.renameFile(book, `${dir}/Renamed Book.epub`);
  const moved = await until(async () => { const d = app.vault.getFileByPath(`${dir}/desks/Renamed Book.desk`); return d && JSON.parse(await app.vault.read(d)).book === `${dir}/Renamed Book.epub` && d; }, 6000);
  ok('a renamed book keeps its desk', !!moved && (await P.deskFileFor(book)) === moved, app.vault.getFiles().filter(f => f.path.startsWith(dir)).map(f => f.path));

  // ---- files the desk cannot open ----
  const standIn = await app.vault.create(`${dir}/Stand In.pdf`, '%PDF-1.4\nTEST-STAND-IN\n');
  const l3 = await openDesk(standIn);
  ok('a stand-in is named as one, with a way on', !viewOf(l3).desk && /stand-in/.test(viewOf(l3).contentEl.textContent) && viewOf(l3).contentEl.querySelectorAll('button').length === 2, viewOf(l3).contentEl.textContent);
  const lost = await app.vault.create(`${dir}/desks/Lost.desk`, JSON.stringify({ book: `${dir}/gone.pdf`, spread: 3 }));
  const l4 = await openDesk(lost);
  ok('a desk whose book is gone says so', !viewOf(l4).desk && /not where it was/.test(viewOf(l4).contentEl.textContent), viewOf(l4).contentEl.textContent);
  const broken = await app.vault.create(`${dir}/desks/Broken.desk`, '{ this is not JSON');
  const l5 = await openDesk(broken);
  ok('a damaged desk file does not break the view', !viewOf(l5).desk && /does not say which book/.test(viewOf(l5).contentEl.textContent), viewOf(l5).contentEl.textContent);
  const junk = await app.vault.create(`${dir}/Junk.epub`, 'not a zip at all');
  const l6 = await P.openBook(junk); mine.push(l6);
  ok('a damaged book gives a clear message', await until(() => /could not be opened on the desk: .*(damaged|not an EPUB)/i.test(viewOf(l6).contentEl.textContent), 5000), viewOf(l6).contentEl.textContent);

  // ---- the settings tab ----
  app.setting.open(); app.setting.openTabById('book-desk');
  await wait(500);
  const names = [...app.setting.tabContentContainer.querySelectorAll('.setting-item-name')].map(n => n.textContent);
  ok('the settings are all there', ['Desk folder', 'Book notes folder', 'Current page property', 'Total pages property', 'New highlights', 'Highlights heading', 'Desk guide', 'Stand-in marker'].every(n => names.includes(n)), names);
  app.setting.close();
  ok('nothing was reported as an error', errors.filter(e => !/damaged|not an EPUB/.test(e)).length === 0, errors);
} finally {
  F.awake(false);
  console.error = realError;
  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  for (const l of mine) { try { l.detach(); } catch { /* closed already */ } }
  await wait(300);
  for (const p of [...P.pending.keys()]) if (p.startsWith(dir)) { window.clearTimeout(P.pending.get(p).timer); P.pending.delete(p); }
  P.settings = keep; P.saveSettings = realSave;
  const folder = app.vault.getFolderByPath(dir);
  if (folder) await app.fileManager.trashFile(folder);
}
ok('the test left nothing in the vault', !app.vault.getAbstractFileByPath(dir) && P.settings === keep, '');
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
