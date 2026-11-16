/* A file view for books: it opens a .desk file (or a PDF or EPUB, which leads to its desk) and puts the desk in it. */

import { FileView, Notice, Platform, loadPdfJs } from 'obsidian';
import { VIEW_TYPE, BOOK_EXT, isBook, deskBook } from './constants.js';
import { normalizeDeskState } from './desk-state.js';
import { createDesk } from './desk.js';
import { openEpub } from './epub.js';
import { highlightPalette, colorHex } from './pdf-highlights.js';
import { BookSuggest } from './book-suggest.js';

export class DeskView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.desk = null;
    this.ready = false;
    this.pdfDoc = null;
    this.epub = null;
    this.bookFile = null;
    this.pendingSubpath = null;
    this.loadingTask = null;   // a PDF still being opened
    this.loads = 0;   // counts openings, so one that was overtaken by another gives up
    // moved to another window: the desk listens to its window and the book's styles belong to its document,
    // so the book is opened again there (at the same place: the desk file was just saved)
    this.register(this.contentEl.onWindowMigrated(() => { void this.reload(); }));
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file ? this.file.basename : 'Book'; }
  getIcon() { return 'book-open'; }
  canAcceptExtension(ext) { return ext === 'desk' || BOOK_EXT.has(ext); }
  // a link to a place in the book (#page=… or #chapter=…&selection=…), passed on by Obsidian when it opens one
  setEphemeralState(st) {
    const sub = st && typeof st === 'object' && typeof st.subpath === 'string' ? st.subpath : '';
    if (!sub) return;
    if (this.ready && this.desk) { this.pendingSubpath = null; void this.desk.goTo(sub); }
    else this.pendingSubpath = sub;
  }

  async onLoadFile(file) {
    const P = this.plugin, app = this.app, load = ++this.loads;
    this.contentEl.empty();
    this.contentEl.addClass('rdesk-host');
    if (BOOK_EXT.has(file.extension)) {
      // the book itself (a tab that points at it, or a link into it): open the book's desk instead
      const desk = await P.deskFileFor(file);
      window.setTimeout(() => {
        const sub = this.pendingSubpath;
        this.pendingSubpath = null;
        void this.leaf.openFile(desk, sub ? { eState: { subpath: sub } } : undefined);
      }, 30);
      return;
    }
    let state = null;
    try { state = normalizeDeskState(JSON.parse(await app.vault.read(file))); } catch { state = null; }
    let bookFile = deskBook(state) ? app.vault.getFileByPath(deskBook(state)) : null;
    if (!isBook(bookFile) && state) {
      // the book was moved or renamed without the desk noticing: a book with the desk's name is the same book
      bookFile = ['pdf', 'epub'].map(ext => app.metadataCache.getFirstLinkpathDest(`${file.basename}.${ext}`, file.path)).find(isBook) || null;
      if (bookFile) { state.book = bookFile.path; delete state.pdf; await P.writeDesk(file, state); }
    }
    if (!isBook(bookFile)) return this.showMissing(file, state);
    this.bookFile = bookFile;
    const msg = this.contentEl.createDiv({ cls: 'rd-loading', text: 'Opening the book…' });
    try {
      let pdf = null, epub = null;
      if (bookFile.extension === 'epub') epub = await openEpub(new Uint8Array(await app.vault.readBinary(bookFile)), this.contentEl.doc);
      // a PDF is read a piece at a time, from its address in the vault, as Obsidian's own PDF view reads it: a large
      // book is never in memory all at once (on a phone, reading a file of some hundred megabytes in one go makes
      // the system close the app)
      else {
        // with what Obsidian's own PDF view gives pdf.js: the decoders of scanned pages (JPEG 2000 and others come as
        // WebAssembly), the standard fonts, the character maps and colour profiles; and no code made up from a book's fonts
        const lib = new URL('/lib/pdfjs/', window.location.href).href;
        const task = (await loadPdfJs()).getDocument({
          url: app.vault.getResourcePath(bookFile),
          cMapUrl: lib + 'cmaps/', cMapPacked: true, standardFontDataUrl: lib + 'standard_fonts/', wasmUrl: lib + 'wasm/', iccUrl: lib + 'iccs/',
          isEvalSupported: false
        });
        this.loadingTask = task;
        // a large book takes a while: say how far it is
        const size = bookFile.stat.size;
        if (size > 2e7) task.onProgress = ({ loaded }) => { if (load === this.loads) msg.setText(`Opening the book… ${Math.min(99, Math.round(loaded / size * 100))}%`); };
        try { pdf = await task.promise; } finally { if (this.loadingTask === task) this.loadingTask = null; }
      }
      if (this.file !== file || load !== this.loads) { if (pdf) void pdf.destroy(); if (epub) epub.destroy(); return; }
      this.pdfDoc = pdf; this.epub = epub;
      const note = P.cardFor(bookFile);
      msg.remove();
      const root = this.contentEl.createDiv();
      this.desk = createDesk(root, {
        pdf, epub,
        title: note ? note.basename : (epub && epub.title) || bookFile.basename,
        state,
        save: st => P.queueSave(file, bookFile, st),
        openInPdf: page => { void app.workspace.openLinkText(`${bookFile.path}#page=${page}`, '', 'tab'); },
        notice: m => { new Notice(m, 5000); },
        helpSeen: () => !!P.settings.helpSeen,
        markHelpSeen: () => { P.settings.helpSeen = true; void P.saveSettings(); },
        palette: () => highlightPalette(app),
        colorHex: name => colorHex(app, name),
        highlights: () => P.highlightsFor(bookFile),
        createHighlight: h => P.createHighlight(bookFile, h),
        openSource: (h, ev) => P.openSource(h, ev),
        sourceLabel: h => { const f = app.vault.getFileByPath(h.source); return f ? f.basename : h.source; },
        // (the first pages' text decides; a book whose text will not come is taken as left to right)
        defaultRtl: () => Promise.race([P.defaultRtl(bookFile, pdf, epub), new Promise(r => window.setTimeout(() => r(false), 8000))]),
        deleteHighlights: list => P.deleteHighlights(list),
        paper: () => P.settings.paper || 'paper',
        setPaper: name => {
          P.settings.paper = name; void P.saveSettings();
          P.deskViews().forEach(v => { if (v.desk && v !== this) v.desk.setPaper(name); });
        },
        quoteFor: h => { const n = P.cardFor(bookFile); return P.highlightMarkdown(bookFile, h, n ? n.path : ''); },
        textSize: () => P.settings.epubTextSize || 16,
        setTextSize: px => { P.settings.epubTextSize = px; void P.saveSettings(); },
        excalidraw: () => !!window.ExcalidrawAutomate,
        mobile: Platform.isMobile,
        toolbarHidden: () => !!app.loadLocalStorage('book-desk-toolbar-hidden'),
        setToolbarHidden: hide => app.saveLocalStorage('book-desk-toolbar-hidden', hide ? '1' : null)
      });
      const desk = this.desk;
      await desk.start();
      if (this.desk !== desk) return;   // closed or opened again meanwhile
      this.ready = true;
      this.markEmbedded();
      if (this.pendingSubpath) { const sub = this.pendingSubpath; this.pendingSubpath = null; void this.desk.goTo(sub); }
    } catch (e) {
      if (load !== this.loads) return;
      const locked = !!e && e.name === 'PasswordException';
      if (!locked) console.error('The book could not be opened on the desk:', e);
      this.dropBook();
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: 'rd-loading', text: 'This book could not be opened on the desk: ' + (locked ? 'it is locked with a password, and the desk cannot open locked books yet.' : e instanceof Error ? e.message : String(e)) });
    }
  }
  dropBook() {
    this.loads++;
    this.ready = false;
    if (this.loadingTask) { void this.loadingTask.destroy(); this.loadingTask = null; }   // closed while still opening
    if (this.desk) { this.desk.destroy(); this.desk = null; }
    if (this.pdfDoc) { void this.pdfDoc.destroy(); this.pdfDoc = null; }
    if (this.epub) { this.epub.destroy(); this.epub = null; }
  }
  async onUnloadFile(file) {
    await this.plugin.flush(file);
    this.dropBook();
    this.bookFile = null;
    this.contentEl.empty();
  }
  async reload() {
    const f = this.file;
    if (!f) return;
    await this.onUnloadFile(f);
    await this.onLoadFile(f);
  }
  showMissing(file, state) {
    const box = this.contentEl.createDiv({ cls: 'rd-loading rd-stub' });
    box.createEl('p', { text: deskBook(state) ? `This desk’s book is not where it was: ${deskBook(state)}` : 'This desk file does not say which book it belongs to.' });
    const row = box.createDiv({ cls: 'rd-stub-row' });
    row.createEl('button', { text: 'Find the book…', cls: 'mod-cta' }).addEventListener('click', () => {
      new BookSuggest(this.app, book => {
        const st = { ...(state || {}), book: book.path };
        delete st.pdf;
        void this.plugin.writeDesk(file, st).then(() => this.reload());
      }).open();
    });
  }
  // on an Excalidraw canvas the canvas is the desk: no wooden desk around the book
  markEmbedded() {
    const root = this.contentEl.querySelector('.rdesk');
    if (root) root.classList.toggle('rd-embedded', !!this.containerEl.closest('.excalidraw, .excalidraw-wrapper'));
  }
  onResize() { this.markEmbedded(); if (this.desk) this.desk.fit(); }
}
