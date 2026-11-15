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
P.settings = { ...keep, dataFolder: `${dir}/desks`, notesFolder: dir, followPage: true, highlightTarget: 'note', highlightHeading: 'Highlights' };
const para = n => `<p>${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(n)}</p>`;
const bytes = epub([
  { name: 'c1.xhtml', title: 'One ]] | <b>bad</b>', body: `<body><h1>One</h1>${para(6).repeat(10)}</body>` },
  { name: 'c2.xhtml', title: 'Two', body: `<body><h1>Two</h1>${para(6).repeat(10)}</body>` }
], [], { title: 'Test Book' });
F.awake(true);
const viewOf = leaf => leaf.view;
const ab = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const modalButton = text => [...document.querySelectorAll('.modal-container button')].find(b => b.textContent === text);
const fmOf = f => { const c = app.metadataCache.getFileCache(f); return (c && c.frontmatter) || {}; };
const settle = q => Promise.race([q, wait(6000).then(() => 'timeout')]);   // an answer, or 'timeout' if the question never closed
const quote = { ci: 0, a: 5, b: 20, colorName: 'Yellow', text: 'a quote', label: 'One' };
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
  const lost = await app.vault.create(`${dir}/desks/Lost.desk`, JSON.stringify({ book: `${dir}/gone.pdf`, spread: 3 }));
  const l4 = await openDesk(lost);
  ok('a desk whose book is gone says so', !viewOf(l4).desk && /not where it was/.test(viewOf(l4).contentEl.textContent), viewOf(l4).contentEl.textContent);
  const broken = await app.vault.create(`${dir}/desks/Broken.desk`, '{ this is not JSON');
  const l5 = await openDesk(broken);
  ok('a damaged desk file does not break the view', !viewOf(l5).desk && /does not say which book/.test(viewOf(l5).contentEl.textContent), viewOf(l5).contentEl.textContent);
  const locked = await app.vault.createBinary(`${dir}/Locked.pdf`, ab(F.pdf(2, true)));
  const lL = await P.openBook(locked); mine.push(lL);
  ok('a PDF locked with a password says so', await until(() => /locked with a password/.test(viewOf(lL).contentEl.textContent), 6000), viewOf(lL).contentEl.textContent);
  const junk = await app.vault.create(`${dir}/Junk.epub`, 'not a zip at all');
  const l6 = await P.openBook(junk); mine.push(l6);
  ok('a damaged book gives a clear message', await until(() => /could not be opened on the desk: .*(damaged|not an EPUB)/i.test(viewOf(l6).contentEl.textContent), 5000), viewOf(l6).contentEl.textContent);

  // ---- which note is a book's note ----
  P.settings = { ...P.settings, notesFolder: `${dir}/notes` };
  await app.vault.createFolder(`${dir}/other`);
  const b2 = await app.vault.createBinary(`${dir}/other/Book Two.epub`, ab(bytes));
  await app.vault.create(`${dir}/other/A daily note.md`, 'Read some of [[Book Two.epub]] today.\n');
  const card2 = await app.vault.create(`${dir}/other/Book Two card.md`, '---\nsource: "[[Book Two.epub]]"\n---\n');
  ok('outside the notes folder, the note whose property links to the book is its note', await until(() => P.cardFor(b2) === card2), P.cardFor(b2) && P.cardFor(b2).path);
  await app.fileManager.processFrontMatter(card2, f => { delete f.source; });
  ok('a note that only mentions the book is not its note', await until(() => P.cardFor(b2) === null), P.cardFor(b2) && P.cardFor(b2).path);

  // ---- a book without a note: the first highlight asks ----
  const b3 = await app.vault.createBinary(`${dir}/other/Book Three.epub`, ab(bytes));
  let asked = P.createHighlight(b3, quote);
  let btn = await until(() => modalButton('Make a note'), 3000);
  ok('the question offers to make a note, to choose one, or only to copy', !!btn && !!modalButton('Choose a note…') && !!modalButton('Only copy it'), document.querySelector('.modal-container') && document.querySelector('.modal-container').textContent);
  if (btn) btn.click();
  let res = await settle(asked);
  const made3 = app.vault.getFileByPath(`${dir}/notes/Book Three.md`), t3 = made3 ? await app.vault.read(made3) : '';
  ok('"Make a note" makes one in the notes folder, linked from a property, with the highlight', res === true && /^---\nbook: "\[\[Book Three\.epub\]\]"\n---\n/.test(t3) && /## Highlights[\s\S]*chapter=1&selection=5,20/.test(t3), [res, t3]);
  ok('and it is the book’s note from then on', await until(() => made3 && P.cardFor(b3) === made3 && P.linksFromProperty(made3.path, b3)), '');
  asked = P.createHighlight(b3, { ...quote, a: 30, b: 40 });
  await wait(400);
  let again = !!modalButton('Make a note');
  if (again) modalButton('Only copy it').click();
  res = await settle(asked);
  ok('a second highlight goes straight into it', !again && res === true && /selection=30,40/.test(await app.vault.read(made3)), [again, res]);

  const b4 = await app.vault.createBinary(`${dir}/other/Book Four.epub`, ab(bytes));
  const pick = await app.vault.create(`${dir}/other/Pick me.md`, '---\nbook: "[[Some Other Book]]"\ntags: [x]\n---\nMy own words.\n');
  asked = P.createHighlight(b4, quote);
  btn = await until(() => modalButton('Choose a note…'), 3000);
  if (btn) btn.click();
  const input = await until(() => document.querySelector('.prompt input.prompt-input'), 3000);
  if (input) { input.value = `${dir}/other/Pick me`; input.dispatchEvent(new Event('input')); }
  const item = await until(() => [...document.querySelectorAll('.prompt .suggestion-item')].find(e => e.textContent.includes('Pick me')), 3000);
  if (item) item.click();
  res = await settle(asked);
  const pt = await app.vault.read(pick);
  ok('"Choose a note…" links the chosen note to the book and writes the highlight there, keeping the rest', res === true && /Some Other Book/.test(pt) && /Book Four\.epub/.test(pt) && /tags:/.test(pt) && /My own words\./.test(pt) && /selection=5,20/.test(pt), [res, pt]);
  ok('and it is the book’s note from then on', await until(() => P.cardFor(b4) === pick), P.cardFor(b4) && P.cardFor(b4).path);

  const b5 = await app.vault.createBinary(`${dir}/other/Book Five.epub`, ab(bytes));
  asked = P.createHighlight(b5, quote);
  btn = await until(() => modalButton('Only copy it'), 3000);
  if (btn) btn.click();
  res = await settle(asked);
  asked = P.createHighlight(b5, quote);
  await wait(400);
  again = !!modalButton('Only copy it');
  if (again) modalButton('Only copy it').click();
  const res2 = await settle(asked);
  ok('"Only copy it" writes nothing, and that book is not asked again', res === false && res2 === false && !again && !app.vault.getFileByPath(`${dir}/notes/Book Five.md`), [res, res2, again]);

  const b6 = await app.vault.createBinary(`${dir}/other/Book Six.epub`, ab(bytes));
  asked = P.createHighlight(b6, quote);
  await until(() => modalButton('Make a note'), 3000);
  const closeX = [...document.querySelectorAll('.modal-container .modal-close-button, .modal-container .modal-header-button')].find(x => x.classList.contains('modal-close-button') || x.querySelector('.lucide-x'));
  if (closeX) closeX.click();
  res = await settle(asked);
  asked = P.createHighlight(b6, quote);
  btn = await until(() => modalButton('Only copy it'), 3000);
  if (btn) btn.click();
  await settle(asked);
  ok('closing the question only copies, and it is asked again next time', !!closeX && res === false && !!btn, [!!closeX, res, !!btn]);

  // ---- a PDF replaced by a shorter file keeps its desk's place ----
  const short = await app.vault.createBinary(`${dir}/Short Book.pdf`, ab(F.pdf(4)));
  const shortNote = await app.vault.create(`${dir}/notes/Short Book.md`, '---\nbook: "[[Short Book.pdf]]"\ncurrent_page: 81\ntotal_pages: 300\n---\n');
  const shortDesk = await app.vault.create(`${dir}/desks/Short Book.desk`, JSON.stringify({ v: 1, book: short.path, spread: 40, stickies: { 80: [{ id: 1, x: 20, y: 20, t: 'far in', c: 0, r: 0 }] } }));
  await until(() => P.cardFor(short) === shortNote);
  const lS = await openDesk(short), vS = viewOf(lS);
  ok('a desk whose place lies past the end of the file says so', vS.ready && vS.file === shortDesk && !!(await until(() => [...document.querySelectorAll('.notice')].some(n => /fewer pages/.test(n.textContent)), 3000)), vS.file && vS.file.path);
  await wait(3200);   // longer than the desk's save delay and the note's page delay
  await P.flush(shortDesk);
  const stS = JSON.parse(await app.vault.read(shortDesk));
  ok('the desk file keeps the place and the marks', stS.spread === 40 && stS.stickies[80] && stS.stickies[80][0].t === 'far in', stS);
  ok('the book’s note keeps its page', fmOf(shortNote).current_page === 81, fmOf(shortNote));
  await vS.desk.goTo('#page=1');
  await wait(300);
  await P.flush(shortDesk);
  ok('turning a page there moves the place', JSON.parse(await app.vault.read(shortDesk)).spread === 0, await app.vault.read(shortDesk));
  await app.vault.modifyBinary(short, ab(F.pdf(6)));
  ok('a book file changed while it is open is opened again', !!(await until(() => vS.ready && vS.contentEl.querySelector('.rd-progress') && /of 6$/.test(vS.contentEl.querySelector('.rd-progress').textContent), 6000)), vS.contentEl.querySelector('.rd-progress') && vS.contentEl.querySelector('.rd-progress').textContent);

  // ---- the guide ----
  const g1 = document.createElement('div'), g2 = document.createElement('div');
  F.H.buildGuide(g1, { excalidraw: false }); F.H.buildGuide(g2, { excalidraw: true });
  ok('the guide speaks of Excalidraw only when it is installed', !/Excalidraw/.test(g1.textContent) && /Excalidraw/.test(g2.textContent), '');

  // ---- the settings tab ----
  app.setting.open(); app.setting.openTabById('book-desk');
  await wait(500);
  const names = [...app.setting.tabContentContainer.querySelectorAll('.setting-item-name')].map(n => n.textContent);
  ok('the settings are all there, and only those', ['Desk folder', 'Book notes folder', 'Keep the page in the book’s note', 'New highlights', 'Highlights heading', 'Desk guide', 'Highlights', 'Reading progress'].every(n => names.includes(n)) && names.length === 8, names);   // with the two group headings
  const pageToggle = [...app.setting.tabContentContainer.querySelectorAll('.setting-item')].find(x => /Keep the page/.test(x.textContent));
  const sw = pageToggle && pageToggle.querySelector('.checkbox-container');
  if (sw) sw.click();
  await wait(300);
  const offValue = P.settings.followPage;
  P.queueCardPage(book, [4], 100);
  const queuedOff = P.cardTimers.has(book.path);
  if (sw) sw.click();
  await wait(300);
  ok('the page switch turns following the page off and on', offValue === false && !queuedOff && P.settings.followPage === true && /current_page/.test(pageToggle.textContent), [offValue, queuedOff, P.settings.followPage]);
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
