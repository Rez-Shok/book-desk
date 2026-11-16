/* The Obsidian side: a file view for books (PDF, EPUB), each book's desk file, the book's note, highlights as links. */

import { Plugin, ItemView, Notice, TFile, Keymap, Platform, normalizePath, getLinkpath } from 'obsidian';
import { VIEW_TYPE, isBook, deskBook } from './constants.js';
import { readSettings } from './settings-data.js';
import { DeskSettingTab } from './settings.js';
import { DeskView } from './view.js';
import { BookSuggest } from './book-suggest.js';
import { BookNoteModal, NoteSuggest } from './book-note.js';
import { DESK_FORMAT } from './desk-state.js';
import { escapeMarkdownText, plainLinkText } from './util.js';
import { pdfPlusSettings, collectHighlights, drawingDataStart, removeHighlightLinks, undoRemoval } from './pdf-highlights.js';

const RTL_LANG = /^(fa|fas|per|persian|farsi|ar|ara|arabic|he|heb|hebrew|ur|urd|urdu|ps|pus|pashto|ckb|sd|yi|dv)\b/i;
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g, LTR_CHARS = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/g;

export default class BookDeskPlugin extends Plugin {
  async onload() {
    this.settings = readSettings(await this.loadData(), normalizePath);
    this.pending = new Map();     // desk path -> { state, timer, desk, book }: a desk waiting to be written
    this.hlCache = new Map();     // book path -> highlights by page
    this.hlTimer = 0;
    this.lastSaved = new Map();   // desk path -> the text this plugin last wrote there
    this.deskBooks = null;        // desk path -> book path, for every desk file in the vault (made on first use)
    this.deskBooksReady = null;
    this.bookNotes = new Map();   // book -> the note made or chosen for it in this session (until the vault's index has it)
    this.copyOnly = new Set();    // books whose highlights are only copied, as asked in this session
    this.asking = new Map();      // book -> the question about its note, while it is open
    this.registerView(VIEW_TYPE, leaf => new DeskView(leaf, this));
    this.registerExtensions(['desk'], VIEW_TYPE);
    // EPUB files open on the desk too, unless another plugin reads them already (then: "Open this book on the desk")
    try { this.registerExtensions(['epub'], VIEW_TYPE); } catch { /* another plugin owns .epub */ }
    this.addSettingTab(new DeskSettingTab(this.app, this));
    this.addRibbonIcon('book-open', 'Open this book on the desk', () => this.openActive());
    this.addCommand({
      id: 'open-on-desk',
      name: 'Open this book on the desk',
      checkCallback: checking => {
        const f = this.bookFor(this.app.workspace.getActiveFile());
        if (!f) return false;
        if (!checking) void this.openBook(f);
        return true;
      }
    });
    this.addCommand({
      id: 'insert-into-drawing',
      name: 'Put a book on this Excalidraw drawing',
      checkCallback: checking => {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        if (!view || view.getViewType() !== 'excalidraw' || !window.ExcalidrawAutomate) return false;
        if (!checking) new BookSuggest(this.app, book => { void this.embedInDrawing(book, view); }).open();
        return true;
      }
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const f = this.bookFor(file);
      if (f) menu.addItem(i => i.setTitle('Open on the desk').setIcon('book-open').onClick(() => { void this.openBook(f); }));
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { void this.onRename(file, oldPath); }));
    this.registerEvent(this.app.vault.on('modify', file => { void this.onModify(file); }));
    this.registerEvent(this.app.vault.on('delete', file => { if (this.deskBooks) this.deskBooks.delete(file.path); }));
    // (Obsidian reports every file as "created" while it starts: only listen once the vault is loaded)
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('create', file => { if (file instanceof TFile && file.extension === 'desk') void this.noteDesk(file); }));
    });
    // a note's links changed: highlights may have come or gone
    this.registerEvent(this.app.metadataCache.on('resolve', () => this.refreshHighlightsSoon()));
  }
  onunload() {
    // the last changes of each desk are written now (started here; Obsidian does not wait for them)
    for (const path of [...this.pending.keys()]) void this.writeState(path);
    window.clearTimeout(this.hlTimer);
  }
  // the settings file changed under us (Obsidian Sync, or another device)
  async onExternalSettingsChange() {
    this.settings = readSettings(await this.loadData(), normalizePath);
    this.deskViews().forEach(v => { if (v.desk) v.desk.setPaper(this.settings.paper); });
  }
  saveSettings() { return this.saveData(this.settings); }
  /** The open desks. @returns {DeskView[]} */
  deskViews() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v instanceof DeskView);
  }

  /* ---------- which book belongs to a file, and which note belongs to a book ---------- */
  bookFor(file) {
    if (!(file instanceof TFile)) return null;
    if (isBook(file) || file.extension === 'desk') return file;
    if (file.extension !== 'md') return null;
    for (const p of Object.keys(this.app.metadataCache.resolvedLinks[file.path] || {})) {
      if (!/\.(pdf|epub)$/i.test(p)) continue;
      const f = this.app.vault.getFileByPath(p);
      if (f) return f;
    }
    return null;
  }
  // the book's note: a note whose properties link to the book, or any note in the book notes folder that links to it.
  // Of several, one in the folder comes first, then one that links from a property; their paths decide the rest.
  cardFor(book) {
    const rl = this.app.metadataCache.resolvedLinks, dir = (this.settings.notesFolder || '').replace(/\/$/, '');
    let best = null, bestScore = 0;
    for (const src of Object.keys(rl)) {
      if (!rl[src][book.path] || !src.endsWith('.md')) continue;
      const score = (dir && src.startsWith(dir + '/') ? 2 : 0) + (this.linksFromProperty(src, book) ? 1 : 0);
      if (score > bestScore || (score && score === bestScore && src.localeCompare(best) < 0)) { best = src; bestScore = score; }
    }
    const found = best ? this.app.vault.getFileByPath(best) : null;
    if (found) return found;
    const kept = this.bookNotes.get(book);
    return kept && this.app.vault.getFileByPath(kept.path) === kept ? kept : null;
  }
  linksFromProperty(src, book) {
    const cache = this.app.metadataCache.getCache(src);
    return !!cache && (cache.frontmatterLinks || []).some(l => this.app.metadataCache.getFirstLinkpathDest(getLinkpath(l.link), src) === book);
  }
  // the book has no note yet: ask (one question at a time per book) whether to make one, choose one, or only copy
  askForNote(book) {
    let q = this.asking.get(book);
    if (!q) {
      q = this.pickNote(book).finally(() => this.asking.delete(book));
      this.asking.set(book, q);
    }
    return q;
  }
  async pickNote(book) {
    const answer = await new Promise(done => new BookNoteModal(this.app, book, done).open());
    let note = null;
    if (answer === 'copy') this.copyOnly.add(book);
    else if (answer === 'create') note = await this.makeBookNote(book);
    else if (answer === 'choose') {
      const rl = this.app.metadataCache.resolvedLinks;
      const linking = Object.keys(rl).filter(src => rl[src][book.path] && src.endsWith('.md')).sort().map(p => this.app.vault.getFileByPath(p)).filter(Boolean);
      const chosen = await new Promise(done => new NoteSuggest(this.app, linking, done).open());
      if (chosen) { await this.linkNoteToBook(chosen, book); note = chosen; }
    }
    if (note) this.bookNotes.set(book, note);
    return note;
  }
  // a new note for the book, named after it, in the book notes folder (or where Obsidian puts new notes)
  async makeBookNote(book) {
    let folder = normalizePath(this.settings.notesFolder || '/');
    if (!this.settings.notesFolder) folder = this.app.fileManager.getNewFileParent(book.path).path;
    else if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const base = !folder || folder === '/' ? '' : folder + '/';
    let path = normalizePath(`${base}${book.basename}.md`);
    for (let i = 1; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${base}${book.basename} ${i}.md`);
    const link = `[[${this.app.metadataCache.fileToLinktext(book, path, true)}]]`;
    return this.app.vault.create(path, `---\nbook: ${JSON.stringify(link)}\n---\n`);
  }
  // a chosen note becomes the book's note: a "book" property links it to the book (unless one of its properties does already)
  async linkNoteToBook(note, book) {
    if (this.linksFromProperty(note.path, book)) return;
    const link = `[[${this.app.metadataCache.fileToLinktext(book, note.path, true)}]]`;
    await this.app.fileManager.processFrontMatter(note, fm => {
      const cur = fm.book;
      fm.book = cur == null || cur === '' ? link : [...(Array.isArray(cur) ? cur : [cur]), link];
    });
  }
  openActive() {
    const f = this.bookFor(this.app.workspace.getActiveFile());
    if (f) void this.openBook(f);
    else new Notice('Open a PDF or EPUB, or a note that links to one, first.');
  }
  async openBook(file, mobile = Platform.isMobile) {
    const desk = file.extension === 'desk' ? file : await this.deskFileFor(file);
    const open = this.app.workspace.getLeavesOfType(VIEW_TYPE).find(l => {
      const st = l.getViewState().state;
      return st && st.file === desk.path && !l.view.containerEl.closest('.excalidraw');
    });
    const leaf = open || (mobile && this.pdfLeafOf(file)) || this.app.workspace.getLeaf('tab');
    if (!open) await leaf.setViewState({ type: VIEW_TYPE, state: { file: desk.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    await leaf.loadIfDeferred();
    return leaf;
  }
  // the tab that shows this PDF in Obsidian's own PDF view, when it is the one in use. On a phone the desk takes its
  // place: a large book read twice over (once by that view, once by the desk) is more than a phone has room for.
  pdfLeafOf(file) {
    const leaf = this.app.workspace.getMostRecentLeaf();
    return leaf && leaf.view && leaf.view.getViewType() === 'pdf' && leaf.view.file === file ? leaf : null;
  }
  // right-to-left: the book's note says the language, or else the text of the first pages decides
  async defaultRtl(file, pdf, epub) {
    const note = this.cardFor(file);
    const cache = note ? this.app.metadataCache.getFileCache(note) : null, fm = cache && cache.frontmatter;
    let lang = fm && (fm.language || fm.lang);
    if (Array.isArray(lang)) lang = lang[0];
    if (lang) return RTL_LANG.test(String(lang).trim());
    let rtl = 0, ltr = 0;
    if (epub) {
      for (const ch of epub.chapters) {
        const t = ch.text || ch.el.textContent || '';
        rtl += (t.match(RTL_CHARS) || []).length; ltr += (t.match(LTR_CHARS) || []).length;
        if (rtl + ltr > 4000) break;
      }
      return rtl + ltr ? rtl > ltr : !!epub.rtl;
    }
    for (let i = 1; i <= Math.min(pdf.numPages, 12) && rtl + ltr < 600; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      for (const it of tc.items) {
        if (!it.str) continue;
        rtl += (it.str.match(RTL_CHARS) || []).length;
        ltr += (it.str.match(LTR_CHARS) || []).length;
      }
    }
    return rtl > ltr;
  }

  /* ---------- each book's desk: <desk folder>/<book name>.desk, a small JSON file ---------- */
  deskPathFor(book) { return normalizePath(`${this.settings.dataFolder}/${book.basename}.desk`); }
  async deskBookOf(desk) { try { return deskBook(JSON.parse(await this.app.vault.cachedRead(desk))); } catch { return null; } }
  // every desk file in the vault and the book it belongs to. Read once, then kept up to date as files change,
  // so finding a book's desk never means reading through the vault again.
  async allDeskBooks() {
    if (this.deskBooksReady == null) {
      this.deskBooksReady = (async () => {
        const map = new Map();
        for (const f of this.app.vault.getFiles()) if (f.extension === 'desk') map.set(f.path, await this.deskBookOf(f));
        this.deskBooks = map;
      })();
    }
    await this.deskBooksReady;
    return this.deskBooks;
  }
  async noteDesk(desk) { if (this.deskBooks) this.deskBooks.set(desk.path, await this.deskBookOf(desk)); }
  async ensureFolder() {
    const dir = normalizePath(this.settings.dataFolder);
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => {});
  }
  // the desk of a book, made on first use
  async deskFileFor(book) {
    let path = this.deskPathFor(book);
    const f = this.app.vault.getFileByPath(path);
    if (f) {
      const owner = await this.deskBookOf(f);
      if (!owner || owner === book.path || !isBook(this.app.vault.getFileByPath(owner))) return f;
      path = normalizePath(`${this.settings.dataFolder}/${book.basename} (${book.extension}).desk`);   // the PDF and the EPUB of one book
    }
    const desks = await this.allDeskBooks();
    for (const [deskPath, owner] of desks) {   // a desk saved under another name still belongs to this book
      if (owner !== book.path) continue;
      const d = this.app.vault.getFileByPath(deskPath);
      if (d) return d;
    }
    const again = this.app.vault.getFileByPath(path);
    if (again) return again;
    await this.ensureFolder();
    const text = JSON.stringify({ v: DESK_FORMAT, book: book.path });
    this.lastSaved.set(path, text);
    const made = await this.app.vault.create(path, text);
    desks.set(made.path, book.path);
    return made;
  }
  queueSave(desk, book, state) {
    const cur = this.pending.get(desk.path);
    if (cur) window.clearTimeout(cur.timer);
    const timer = window.setTimeout(() => { void this.writeState(desk.path); }, 1200);
    this.pending.set(desk.path, { state, timer, desk, book });
  }
  async writeState(deskPath) {
    const job = this.pending.get(deskPath);
    if (!job) return;
    window.clearTimeout(job.timer);
    this.pending.delete(deskPath);
    const st = { ...job.state, v: Math.max(DESK_FORMAT, job.state.v || 0), book: job.book.path, saved: new Date().toISOString() };
    delete st.pdf;
    if (this.app.vault.getFileByPath(job.desk.path) !== job.desk) return;   // the desk file was deleted meanwhile
    await this.writeDesk(job.desk, st);
  }
  async flush(file) { if (file && this.pending.has(file.path)) await this.writeState(file.path); }
  async writeDesk(desk, state) {
    const text = JSON.stringify(state);
    this.lastSaved.set(desk.path, text);
    await this.app.vault.process(desk, () => text);
    if (this.deskBooks) this.deskBooks.set(desk.path, deskBook(state));
  }
  async onModify(file) {
    if (!(file instanceof TFile)) return;
    if (isBook(file)) {
      // the book file itself has changed (downloaded at last, replaced by another edition…): open it again
      this.deskViews().forEach(v => { if (v.bookFile === file) void v.reload(); });
    } else if (file.extension === 'desk') {
      // changed somewhere else (another device, or the same book open twice): show the new state
      if (this.pending.has(file.path)) return;
      const text = await this.app.vault.read(file);
      if (text === this.lastSaved.get(file.path)) return;
      this.lastSaved.set(file.path, text);
      void this.noteDesk(file);
      this.deskViews().forEach(v => { if (v.file === file) void v.reload(); });
    }
  }
  async onRename(file, oldPath) {
    if (!(file instanceof TFile)) return;
    if (file.extension === 'desk') {
      if (this.deskBooks && this.deskBooks.has(oldPath)) { this.deskBooks.set(file.path, this.deskBooks.get(oldPath)); this.deskBooks.delete(oldPath); }
      return;
    }
    if (!isBook(file)) return;
    // the desks of a moved or renamed book follow it
    const desks = await this.allDeskBooks();
    for (const [deskPath, owner] of [...desks]) {
      if (owner !== oldPath) continue;
      const d = this.app.vault.getFileByPath(deskPath);
      if (!d) continue;
      let text = null;
      await this.app.vault.process(d, data => {
        let st;
        try { st = JSON.parse(data); } catch { return data; }
        if (deskBook(st) !== oldPath) return data;
        st.book = file.path;
        delete st.pdf;
        text = JSON.stringify(st);
        return text;
      });
      if (text == null) continue;
      this.lastSaved.set(d.path, text);
      desks.set(d.path, file.path);
      const oldBase = (oldPath.split('/').pop() || '').replace(/\.(pdf|epub)$/i, '');
      if (d.basename === oldBase && !this.app.vault.getAbstractFileByPath(this.deskPathFor(file))) {
        await this.app.fileManager.renameFile(d, this.deskPathFor(file));
      }
    }
  }

  /* ---------- Excalidraw: the desk as a live box on a canvas ---------- */
  async embedInDrawing(book, view) {
    const desk = await this.deskFileFor(book);
    const ea = window.ExcalidrawAutomate.getAPI(view);
    const st = view.excalidrawAPI.getAppState(), z = st.zoom.value;
    const w = 1100, h = 720;
    const cx = -st.scrollX + st.width / 2 / z, cy = -st.scrollY + st.height / 2 / z;
    ea.addEmbeddable(cx - w / 2, cy - h / 2, w, h, undefined, desk);
    await ea.addElementsToView(false, true);
    if (ea.destroy) ea.destroy();
  }

  /* ---------- highlights: links in notes, in the format PDF++ uses ---------- */
  highlightsFor(book) {
    let c = this.hlCache.get(book.path);
    if (!c) { c = collectHighlights(this.app, book); this.hlCache.set(book.path, c); }
    return c;
  }
  refreshHighlightsSoon() {
    if (!this.app.workspace.getLeavesOfType(VIEW_TYPE).length) return;
    window.clearTimeout(this.hlTimer);
    this.hlTimer = window.setTimeout(() => {
      this.hlCache.clear();
      this.deskViews().forEach(v => { if (v.desk && v.ready && v.bookFile) v.desk.setHighlights(this.highlightsFor(v.bookFile)); });
    }, 300);
  }
  // the markdown PDF++ itself would copy for this selection: its link, display text and copy format.
  // The words come from the book, so they are written as plain text (see escapeMarkdownText).
  highlightMarkdown(book, h, sourcePath) {
    const pp = pdfPlusSettings(this.app) || {};
    const color = String(h.colorName || '').toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, ''), isEpub = book.extension === 'epub';
    const vars = {
      text: escapeMarkdownText(h.text), page: h.page, pageLabel: h.page, color, calloutType: typeof pp.calloutType === 'string' ? pp.calloutType : 'PDF',
      'file.basename': book.basename, 'file.name': book.name, 'file.path': book.path, 'file.extension': book.extension
    };
    const fill = t => String(t || '').replace(/{{\s*([\w.]+)\s*}}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null ? String(vars[k]) : ''));
    const formats = Array.isArray(pp.displayTextFormats) && pp.displayTextFormats.length ? pp.displayTextFormats : [{ template: '{{file.basename}}, p.{{pageLabel}}' }];
    vars.display = fill((formats[pp.defaultDisplayTextFormatIndex || 0] || formats[0]).template);
    // an EPUB has no fixed pages: the place is a chapter and an offset in its text; the section's title names it
    if (isEpub) { vars.page = vars.pageLabel = plainLinkText(h.label) || `ch. ${h.ci + 1}`; vars.display = `${book.basename}, ${vars.pageLabel}`; }
    vars.display = plainLinkText(vars.display);
    const sub = isEpub ? `#chapter=${h.ci + 1}&selection=${h.a},${h.b}` + (color ? `&color=${color}` : '')
      : `#page=${h.page}&selection=${h.b},${h.bo},${h.e},${h.eo}` + (color ? `&color=${color}` : '');
    vars.link = this.app.fileManager.generateMarkdownLink(book, sourcePath, sub);
    vars.linkWithDisplay = vars.display ? this.app.fileManager.generateMarkdownLink(book, sourcePath, sub, vars.display) : vars.link;
    const cmds = Array.isArray(pp.copyCommands) && pp.copyCommands.length ? pp.copyCommands : [{ template: '> ({{linkWithDisplay}})\n> {{text}}\n' }];
    const cmd = cmds[pp.defaultColorPaletteActionIndex] || cmds[0];
    // PDF++ leaves empty callout lines to type into; a written note doesn't need them
    return fill(cmd.template).replace(/(\n>[ \t]*)+\s*$/, '').replace(/\s+$/, '');
  }
  async createHighlight(book, h) {
    let note = null;
    if (this.settings.highlightTarget === 'note') note = this.cardFor(book) || (this.copyOnly.has(book) ? null : await this.askForNote(book));
    const md = this.highlightMarkdown(book, h, note ? note.path : '');
    try { await navigator.clipboard.writeText(md); } catch { /* the clipboard refused */ }
    if (note) {
      await this.insertUnderHeading(note, md);
      new Notice(`Highlight added to “${note.basename}”.`, 3000);
      return true;
    }
    new Notice('Highlight copied: paste it into a note to keep it.', 6000);
    return false;
  }
  // append `md` at the end of the section whose heading contains settings.highlightHeading (made if missing)
  async insertUnderHeading(note, md) {
    const want = (this.settings.highlightHeading || 'Highlights').trim();
    const bare = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim();
    await this.app.vault.process(note, data => {
      const lines = data.split('\n');
      let start = 0;
      if (lines[0] === '---') { const e = lines.indexOf('---', 1); if (e > 0) start = e + 1; }
      // in an Excalidraw note, the note's own text stops where the drawing's data begins
      let end = lines.findIndex((l, i) => i >= start && /^#{1,2} Excalidraw Data\s*$/.test(l));
      if (end < 0) end = lines.findIndex((l, i) => i >= start && /^%%\s*$/.test(l) && /^#{1,2} Drawing\s*$/.test(lines[i + 1] || ''));
      if (end < 0) end = lines.length;
      let head = -1, level = 0;
      for (let i = start; i < end; i++) {
        const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
        if (m && bare(m[2]).includes(bare(want))) { head = i; level = m[1].length; break; }
      }
      const block = md.split('\n');
      if (head < 0) {
        let at = end;
        while (at > start && !lines[at - 1].trim()) at--;
        lines.splice(at, end - at, '', `## ${want}`, '', ...block, '');
        return lines.join('\n');
      }
      let stop = end;
      for (let i = head + 1; i < end; i++) {
        const m = /^(#{1,6})\s/.exec(lines[i]);
        if (m && m[1].length <= level) { stop = i; break; }
      }
      // drop empty template placeholders ("> ", "- ") and trailing blank lines at the end of the section
      let at = stop;
      while (at > head + 1 && /^\s*(>|-)?\s*$/.test(lines[at - 1])) at--;
      lines.splice(at, stop - at, '', ...block, '');
      return lines.join('\n');
    });
  }
  // the eraser went over text highlights: take their links out of the notes they live in (with an Undo)
  async deleteHighlights(list) {
    const byNote = new Map();
    for (const h of list) { if (!byNote.has(h.source)) byNote.set(h.source, []); byNote.get(h.source).push(h); }
    const undo = [], onDrawing = [];
    let removed = 0;
    for (const [path, hs] of byNote) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      let before = '', after = '', n = 0, drawn = false;
      await this.app.vault.process(file, data => {
        // a link written on an Excalidraw drawing is part of the drawing: it has to be deleted there
        const dataStart = drawingDataStart(data), inText = hs.filter(h => !(h.start >= dataStart));
        drawn = inText.length < hs.length;
        if (!inText.length) return data;
        const r = removeHighlightLinks(data, inText);
        before = data; after = r.data; n = r.removed;
        return r.data;
      });
      if (drawn) onDrawing.push(file.basename);
      if (n) { removed += n; undo.push({ file, before, after }); }
    }
    if (removed) {
      const notice = new Notice(createFragment(f => {
        f.appendText(`Erased ${removed} highlight${removed > 1 ? 's' : ''} from ${undo.map(u => `“${u.file.basename}”`).join(', ')}. `);
        const a = f.createEl('a', { text: 'Undo', href: '#' });
        a.addEventListener('click', ev => {
          ev.preventDefault();
          notice.hide();
          // each note gets back what was taken out of it, also if something else in it has changed since
          for (const u of undo) {
            void this.app.vault.process(u.file, data => {
              const back = undoRemoval(u.before, u.after, data);
              if (back == null) new Notice(`“${u.file.basename}” has changed since, so its highlight could not be put back.`, 6000);
              return back == null ? data : back;
            });
          }
        });
      }), 10000);
    }
    if (onDrawing.length) new Notice(`Highlights written on a drawing (${onDrawing.join(', ')}) can only be erased there.`, 6000);
    if (!removed) this.refreshHighlightsSoon();   // put back the faded boxes
  }
  // open the note a highlight lives in, at its line; Ctrl/Cmd-click opens it in a new tab
  async openSource(h, ev) {
    const file = this.app.vault.getFileByPath(h.source);
    if (!file) return;
    let leaf = null;
    this.app.workspace.iterateAllLeaves(l => { if (!leaf && l.view && l.view.file === file) leaf = l; });
    const inNewTab = !!ev && Keymap.isModEvent(ev);
    if (!leaf || inNewTab) {
      leaf = this.app.workspace.getLeaf(inNewTab ? 'tab' : 'split');
      await leaf.openFile(file, { eState: { line: h.line } });
    } else {
      await this.app.workspace.revealLeaf(leaf);
      leaf.view.setEphemeralState({ line: h.line });
    }
  }
}
