// Shared by the in-app tests: loads the test bundle, builds zip files and EPUB books in memory.
// Evaluated as the body of a function; returns the helpers.
const T = window.__bookDeskTest, fs = require('fs');
const mod = { exports: {} };
// the real Obsidian module, borrowed from Excalidraw's script API when it is installed
const obsidian = (window.ExcalidrawAutomate && window.ExcalidrawAutomate.obsidian) || { setIcon: () => {} };
new Function('require', 'module', 'exports', fs.readFileSync(T.harness, 'utf8'))(n => (n === 'obsidian' ? obsidian : require(n)), mod, mod.exports);
const H = mod.exports, enc = new TextEncoder();
const bytes = v => (typeof v === 'string' ? enc.encode(v) : v);
const concat = list => { const out = new Uint8Array(list.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of list) { out.set(b, o); o += b.length; } return out; };
// a zip of stored (uncompressed) files; a file may bring its own compressed data: { name, data, method: 8, usize }
function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = bytes(f.data), method = f.method || 0, usize = f.usize == null ? data.length : f.usize;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, f.flags || 0, true); lh.setUint16(8, method, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, usize, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, f.flags || 0, true); ch.setUint16(10, method, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, usize, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
  return concat([...parts, ...central, new Uint8Array(end.buffer)]);
}
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const xhtml = (title, body, head = '') => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink"><head><title>${title}</title>${head}</head>${body}</html>`;
// an EPUB from chapters [{ name, body (a whole <body>…</body>), head }] and extra files [{ name, data, type }]
function epub(chapters, extra = [], opts = {}) {
  const items = chapters.map((c, i) => `<item id="c${i}" href="${c.name}" media-type="application/xhtml+xml"/>`)
    .concat(extra.filter(f => f.type).map((f, i) => `<item id="x${i}" href="${f.name}" media-type="${f.type}"/>`)).join('');
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">test</dc:identifier><dc:title>${opts.title || 'Test book'}</dc:title><dc:language>${opts.lang || 'en'}</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items}</manifest>
<spine>${chapters.map((c, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`;
  const nav = xhtml('Contents', `<body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="${c.name}">${c.title || 'Chapter ' + (i + 1)}</a></li>`).join('')}${opts.navExtra || ''}</ol></nav></body>`);
  return zip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    ...(opts.meta || []),
    { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav },
    ...chapters.map(c => ({ name: 'OEBPS/' + c.name, data: xhtml(c.title || c.name, c.body, c.head || '') })),
    ...extra.map(f => ({ name: 'OEBPS/' + f.name, data: f.data, method: f.method, usize: f.usize }))
  ]);
}
// a plain PDF of `n` pages, each with one line of text; `locked`: it asks for a password (pdf.js stops there)
function pdf(n, locked = false) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < n; i++) {
    const content = `BT /F1 18 Tf 72 700 Td (Page ${i + 1} of the test book) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  let lock = '';
  if (locked) {
    const hex = k => Array.from({ length: 32 }, (_, i) => ((i * 37 + k) % 256).toString(16).padStart(2, '0')).join('');
    offs.push(out.length);
    out += `${objs.length + 1} 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${hex(3)}> /U <${hex(11)}> /P -4 >>\nendobj\n`;
    objs.push('encrypt');
    lock = ` /Encrypt ${objs.length} 0 R /ID [<${hex(5).slice(0, 32)}> <${hex(5).slice(0, 32)}>]`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${lock} >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}
// a desk on its own, over the window, with a stand-in for everything the plugin would give it
async function mountDesk(book, more = {}) {
  let style = document.getElementById('book-desk-test-style');
  if (!style) { style = document.createElement('style'); style.id = 'book-desk-test-style'; document.head.appendChild(style); }
  style.textContent = fs.readFileSync(T.styles, 'utf8');   // the styles as they are now, not as they were when the app last loaded them
  const box = document.body.createDiv({ cls: 'book-desk-test-box' });
  box.setCssStyles({ position: 'fixed', left: '0px', top: '0px', width: (more.width || 1200) + 'px', height: (more.height || 800) + 'px', zIndex: '9999', background: '#888' });
  const root = box.createDiv();
  root.setCssStyles({ height: '100%' });
  const saved = [], notices = [];
  const desk = H.createDesk(root, {
    epub: book.epub || null, pdf: book.pdf || null, pdfjs: book.pdfjs || null, title: 'Test', state: more.state || null,
    save: st => saved.push(JSON.stringify(st)), onSpread: () => {}, openInPdf: () => {}, notice: m => notices.push(m),
    helpSeen: () => true, markHelpSeen: () => {}, highlights: () => more.highlights || new Map(), createHighlight: async h => { (more.made || []).push(h); return true; },
    openSource: () => {}, deleteHighlights: () => {}, paper: () => 'paper', setPaper: () => {}, quoteFor: h => JSON.stringify(h),
    textSize: () => more.textSize || 16, setTextSize: () => {}, toolbarHidden: () => false, setToolbarHidden: () => {}, defaultRtl: () => !!more.rtl, mobile: !!more.mobile
  });
  await desk.start();
  return { desk, root, box, saved, notices, remove: () => { desk.destroy(); box.remove(); } };
}
const wait = ms => new Promise(r => window.setTimeout(r, ms));
// Obsidian's window is often hidden while tests run: timers would then tick once a second and a tap would look like a long press
const wc = require('electron').remote.getCurrentWebContents();
const awake = on => wc.setBackgroundThrottling(!on);
// a real tap (the browser's own pointer events) at a point of the window
const tap = async (x, y) => {
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await wait(150);
};
return { H, zip, epub, pdf, xhtml, PNG, mountDesk, wait, T, fs, concat, bytes, awake, tap };
