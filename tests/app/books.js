// Books that must be refused with a clear message, and books that must simply work (made here, in memory).
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { H, zip, epub, PNG, mountDesk, wait, concat } = F;
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });
const refuses = async (name, bytes, re) => { try { const b = await H.openEpub(bytes, document); b.destroy(); ok(name, false, 'it opened'); } catch (e) { ok(name, re.test(String(e && e.message)), String(e && e.message)); } };
const sheetsBefore = document.adoptedStyleSheets.length;

await refuses('a file that is not a zip is refused', new TextEncoder().encode('this is not a book '.repeat(50)), /damaged|not an EPUB/i);
await refuses('an empty file is refused', new Uint8Array(0), /damaged|not an EPUB/i);
const good = epub([{ name: 'a.xhtml', body: '<body><p>Hello</p></body>' }]);
await refuses('a cut-off book is refused', good.slice(0, good.length - 40), /damaged|not an EPUB/i);
await refuses('a book cut in the middle of its directory is refused', concat([good.slice(0, 200), good.slice(good.length - 22)]), /damaged|not an EPUB|does not say|no META-INF/i);
await refuses('a zip that is not an EPUB is refused', zip([{ name: 'readme.txt', data: 'hi' }]), /not an EPUB/i);
await refuses('a book with no chapters is refused', epub([]), /no readable chapters/i);
await refuses('a password-locked book is refused', zip([{ name: 'META-INF/container.xml', data: 'x', flags: 1 }]), /locked with a password/i);
const drm = '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/a.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>';
await refuses('a copy-protected book is refused, and says why', epub([{ name: 'a.xhtml', body: '<body><p>x</p></body>' }], [], { meta: [{ name: 'META-INF/encryption.xml', data: drm }] }), /copy-protected/i);

// a zip bomb: 300 MB of nothing in a few hundred kilobytes
const MB = new Uint8Array(1024 * 1024), opened = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>';
const src = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(opened)); }, pull(c) { if (++this.n > 300) c.close(); else c.enqueue(MB); }, n: 0 });
const packed = new Uint8Array(await new Response(src.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const t0 = performance.now();
const bomb = (() => {
  const container = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  const opf = '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>';
  return zip([{ name: 'META-INF/container.xml', data: container }, { name: 'c.opf', data: opf }, { name: 'a.xhtml', data: packed, method: 8, usize: 1000 }]);
})();
await refuses(`a zip bomb (${Math.round(packed.length / 1024)} KB that unfold into 300 MB) is stopped`, bomb, /far more data/i);
ok('the bomb was stopped quickly', performance.now() - t0 < 15000, Math.round(performance.now() - t0) + ' ms');
ok('refused books leave nothing behind', document.adoptedStyleSheets.length === sheetsBefore && !document.querySelector('.rd-epub-measure'), document.adoptedStyleSheets.length - sheetsBefore);

// ---- a plain book, and a Persian one ----
const para = n => `<p>${'The quick brown fox jumps over the lazy dog near the quiet river bank. '.repeat(n)}</p>`;
const plain = epub([
  { name: 'c1.xhtml', title: 'One', body: `<body><h1 id="top">One</h1>${para(6).repeat(12)}<p>The word zebra appears here once.</p><p><img src="img/a.png" alt=""/></p></body>`, head: '<link rel="stylesheet" href="s.css"/>' },
  { name: 'c2.xhtml', title: 'Two', body: `<body><h1>Two</h1>${para(5).repeat(8)}<p id="mark">A zebra again, and a <a href="c1.xhtml#top">link back</a>.</p></body>` }
], [{ name: 's.css', data: 'h1 { color: rgb(1, 2, 3); break-before: page; } p { margin: 0 0 1em; }', type: 'text/css' }, { name: 'img/a.png', data: PNG, type: 'image/png' }], { title: 'Plain book' });
F.awake(true);
let m, book;
try {
  book = await H.openEpub(plain, document);
  ok('a plain book opens: title, chapters, contents', book.title === 'Plain book' && book.chapters.length === 2 && book.toc.length === 2 && book.toc[1].go === 'OEBPS/c2.xhtml' && !book.rtl, [book.title, book.chapters.length, book.toc]);
  m = await mountDesk({ epub: book });
  await wait(400);
  const pages = () => +/of (\d+)/.exec(m.root.querySelector('.rd-progress').textContent)[1];
  const n16 = pages();
  ok('it is set in pages', n16 >= 6 && n16 < 80, n16);
  const h1 = m.root.querySelector('.rd-pr .rd-epub-flow h1');
  ok('the book\'s own styles reach its pages', h1 && getComputedStyle(h1).color === 'rgb(1, 2, 3)', h1 && getComputedStyle(h1).color);
  const flow = m.root.querySelector('.rd-pr .rd-epub-flow'), clip = m.root.querySelector('.rd-pr .rd-epub-clip');
  ok('a page is one column wide', Math.abs(flow.getBoundingClientRect().height - clip.getBoundingClientRect().height) < 1 && getComputedStyle(flow).columnWidth !== 'auto', [getComputedStyle(flow).columnWidth, getComputedStyle(flow).height]);
  // search
  m.root.querySelector('.rd-find-btn').click();
  const input = m.root.querySelector('.rd-find-input');
  input.value = 'zebra'; input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(1200);
  ok('search finds both zebras', /2 match/.test(m.root.querySelector('.rd-find-count').textContent) && m.root.querySelectorAll('.rd-find-item').length === 2, m.root.querySelector('.rd-find-count').textContent);
  m.root.querySelectorAll('.rd-find-item')[1].click();
  await wait(1500);
  ok('a search result opens its page and is marked', [...m.root.querySelectorAll('.rd-slot.rd-page')].some(s => /Two/.test(s.textContent)) && m.root.querySelector('mark.rd-efound.is-current'), m.root.querySelector('.rd-progress').textContent);
  m.root.querySelector('.rd-find-close').click();
  // contents
  m.root.querySelector('.rd-toc-btn').click();
  await wait(300);
  const rows = [...m.root.querySelectorAll('.rd-toc-item')];
  ok('contents list both chapters with page numbers', rows.length === 2 && rows.every(r => /\d/.test(r.querySelector('.rd-toc-page').textContent)), rows.map(r => r.textContent));
  rows[0].click();
  await wait(1500);
  ok('a contents entry opens its chapter', /p\. 1/.test(m.root.querySelector('.rd-progress').textContent), m.root.querySelector('.rd-progress').textContent);
  m.root.querySelector('.rd-toc-close').click();
  // a link to a place, and a highlight painted from a note's link
  await m.desk.goTo('#chapter=2&selection=10,40');
  await wait(1200);
  const before = m.root.querySelector('.rd-progress').textContent;
  m.desk.setHighlights(new Map([[1, [{ ci: 1, a: 10, b: 40, color: 'yellow', source: 'x.md', line: 0 }]]]));
  await wait(300);
  const marks = [...m.root.querySelectorAll('.rd-slot.rd-page mark.rd-ehl')];
  ok('a highlight from a note is painted in the text', marks.length > 0 && marks.map(x => x.textContent).join('').length === 30, marks.map(x => x.textContent));
  // text size: the book is set again and stays at the same place
  m.root.querySelector('.rd-text-larger').click();
  await wait(2500);
  ok('larger text makes more pages and keeps the place', pages() >= n16 && [...m.root.querySelectorAll('.rd-slot.rd-page')].some(s => /Two/.test(s.querySelector('.rd-epub-flow') ? s.querySelector('.rd-epub-flow').textContent : '')), [n16, pages(), before, m.root.querySelector('.rd-progress').textContent]);
  ok('the desk saves a checked state with a format version', m.saved.length > 0 && JSON.parse(m.saved[m.saved.length - 1]).v === 1 && Array.isArray(JSON.parse(m.saved[m.saved.length - 1]).at), m.saved[m.saved.length - 1]);
  m.remove(); m = null; book.destroy(); book = null;

  const fa = epub([{ name: 'f.xhtml', title: 'فصل یک', body: `<body><h1>فصل یک</h1>${'<p>این یک متن آزمایشی فارسی است که برای بررسی جهت نوشتار و جست‌وجو نوشته شده است. کتاب‌ها و می‌خواهم.</p>'.repeat(30)}</body>` }], [], { lang: 'fa', title: 'کتاب آزمایشی' });
  book = await H.openEpub(fa, document);
  ok('a Persian book is right-to-left', book.rtl === true && book.title === 'کتاب آزمایشی', [book.rtl, book.title]);
  m = await mountDesk({ epub: book }, { rtl: true });
  await wait(400);
  const p = m.root.querySelector('.rd-slot.rd-page .rd-epub-flow p');
  ok('its text runs right to left on a mirrored book', p && getComputedStyle(p).direction === 'rtl' && m.root.querySelector('.rd-book').classList.contains('rtl'), p && getComputedStyle(p).direction);
  m.root.querySelector('.rd-find-btn').click();
  const fin = m.root.querySelector('.rd-find-input');
  fin.value = 'كتاب‌ها'; fin.dispatchEvent(new Event('input', { bubbles: true }));   // Arabic kaf: must still find the Persian spelling
  await wait(1200);
  ok('search folds Arabic and Persian letters', /30 match/.test(m.root.querySelector('.rd-find-count').textContent), m.root.querySelector('.rd-find-count').textContent);
} finally {
  F.awake(false);
  if (m) m.remove();
  if (book) book.destroy();
}
ok('closed books leave nothing behind', document.adoptedStyleSheets.length === sheetsBefore && !document.querySelector('.book-desk-test-box'), '');
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
