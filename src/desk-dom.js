/* The desk's fixed parts (toolbar, side panels, the book and its slots), built element by element with Obsidian's
   own helpers: no HTML text is ever turned into elements here. */

import { setIcon } from 'obsidian';

/**
 * @param {HTMLElement} parent
 * @param {string} cls
 * @param {{ label?: string, icon?: string, text?: string, tool?: string, plain?: string, title?: string }} o
 */
function button(parent, cls, o) {
  const attr = {};
  if (o.label) attr['aria-label'] = o.label;
  if (o.tool) attr['data-tool'] = o.tool;
  if (o.title) attr.title = o.title;
  const b = parent.createEl('button', { cls, attr });
  if (o.icon) setIcon(b.createSpan({ attr: { 'data-icon': o.icon } }), o.icon);
  if (o.text) b.createSpan({ cls: 'rd-lbl', text: o.text });
  if (o.plain) b.setText(o.plain);
  return b;
}
const group = (parent, cls, label) => parent.createDiv({ cls: 'rd-group' + (cls ? ' ' + cls : ''), attr: { role: 'group', 'aria-label': label } });
const sep = parent => parent.createSpan({ cls: 'rd-sep' });

function toolbar(root) {
  const bar = root.createDiv({ cls: 'rd-toolbar' });
  button(bar, 'rd-btn rd-toc-btn', { label: 'Contents (O)', icon: 'list', text: 'Contents' });
  button(bar, 'rd-btn rd-find-btn', { label: 'Search in this book (Cmd/Ctrl+F or /)', icon: 'search', text: 'Search' });
  button(bar, 'rd-btn rd-annos-btn', { label: 'Your highlights, sticky notes, cards and pen marks in this book (N)', icon: 'bookmark', text: 'Notes' });
  sep(bar);
  const tools = group(bar, '', 'Tools');
  button(tools, 'rd-btn', { tool: 'read', label: 'Read and turn pages (Esc)', icon: 'book-open', text: 'Read' });
  button(tools, 'rd-btn', { tool: 'select', label: 'Select text (S): copy it, highlight it, or copy it as a quote', icon: 'text-cursor', text: 'Select' });
  button(tools, 'rd-btn', { tool: 'pen', label: 'Pen: write on the page', icon: 'pen-line', text: 'Pen' });
  button(tools, 'rd-btn', { tool: 'hl', label: 'Highlighter', icon: 'highlighter', text: 'Highlight' });
  button(tools, 'rd-btn', { tool: 'erase', label: 'Eraser', icon: 'eraser', text: 'Erase' });
  button(tools, 'rd-btn', { tool: 'sticky', label: 'Sticky note: click on a page', icon: 'sticky-note', text: 'Sticky' });
  group(bar, 'rd-swatches', 'Colour');
  sep(bar);
  button(bar, 'rd-btn rd-note-btn', { label: 'Put an index card on the desk', icon: 'notebook-pen', text: 'Card' });
  sep(bar);
  button(bar, 'rd-btn rd-pdf-btn', { label: 'Open this page in the PDF view (text selection, PDF++)', icon: 'file-text', text: 'PDF view' });
  sep(bar);
  const zoom = group(bar, '', 'Zoom');
  button(zoom, 'rd-btn rd-zoom-out', { label: 'Zoom out (−)', icon: 'zoom-out' });
  button(zoom, 'rd-btn rd-zoom-val', { label: 'Fit the book (0)', plain: '100%' });
  button(zoom, 'rd-btn rd-zoom-in', { label: 'Zoom in (+). Also: pinch, or Ctrl + scroll', icon: 'zoom-in' });
  const size = group(bar, 'rd-textsize', 'Text size');
  size.hidden = true;
  button(size, 'rd-btn rd-text-smaller', { label: 'Smaller text', plain: 'A−' });
  button(size, 'rd-btn rd-text-larger', { label: 'Larger text', plain: 'A+' });
  button(bar, 'rd-btn rd-paper-btn', { label: 'Page colour', icon: 'sun', text: 'Paper' });
  button(bar, 'rd-btn rd-rtl-btn', { label: 'Right-to-left book: the spine is on the right and pages turn to the right', icon: 'arrow-left-right', text: 'RTL' });
  const meta = bar.createDiv({ cls: 'rd-meta' });
  meta.createSpan({ cls: 'rd-progress', attr: { 'aria-live': 'polite' } });
  meta.createSpan({ cls: 'rd-name' });
  button(bar, 'rd-btn rd-hide-btn', { label: 'Hide the toolbar (T)', icon: 'chevron-up' });
}

function panelHead(panel, title, closeCls, closeLabel) {
  const head = panel.createDiv({ cls: 'rd-toc-head' });
  head.createSpan({ text: title });
  button(head, closeCls, { label: closeLabel, plain: '×' });
}

function panels(root) {
  const toc = root.createDiv({ cls: 'rd-toc' });
  toc.hidden = true;
  panelHead(toc, 'Contents', 'rd-toc-close', 'Close the contents');
  toc.createDiv({ cls: 'rd-toc-list' });

  const find = root.createDiv({ cls: 'rd-find rd-sidepanel' });
  find.hidden = true;
  const findHead = find.createDiv({ cls: 'rd-find-head' });
  findHead.createEl('input', { cls: 'rd-find-input', type: 'search', placeholder: 'Search in this book', attr: { spellcheck: 'false', 'aria-label': 'Search in this book' } });
  button(findHead, 'rd-find-close', { label: 'Close search', plain: '×' });
  const findBar = find.createDiv({ cls: 'rd-find-bar' });
  findBar.createSpan({ cls: 'rd-find-count' });
  findBar.createSpan({ cls: 'rd-grow' });
  button(findBar, 'rd-find-prev', { label: 'Previous match (Shift+Enter)', plain: '↑' });
  button(findBar, 'rd-find-next', { label: 'Next match (Enter)', plain: '↓' });
  find.createDiv({ cls: 'rd-find-list' });

  const annos = root.createDiv({ cls: 'rd-annos rd-sidepanel' });
  annos.hidden = true;
  panelHead(annos, 'In this book', 'rd-annos-close', 'Close');
  annos.createDiv({ cls: 'rd-annos-filters' });
  annos.createDiv({ cls: 'rd-annos-list' });

  const selbar = root.createDiv({ cls: 'rd-selbar' });
  selbar.hidden = true;
  button(selbar, 'rd-sel-copy', { plain: 'Copy' });
  button(selbar, 'rd-sel-hl', { plain: 'Highlight' });
  button(selbar, 'rd-sel-quote', { plain: 'Copy as quote' });

  const show = root.createEl('button', { cls: 'rd-show-btn', attr: { 'aria-label': 'Show the toolbar (T)' } });
  show.hidden = true;
  show.createSpan({ cls: 'rd-pill-page' });
  setIcon(show.createSpan({ attr: { 'data-icon': 'chevron-down' } }), 'chevron-down');
}

function board(root) {
  const desk = root.createDiv({ cls: 'rd-desk', attr: { tabindex: '0' } });
  const world = desk.createDiv({ cls: 'rd-world' });
  const book = world.createDiv({ cls: 'rd-book' });
  book.createDiv({ cls: 'rd-cover' });
  book.createDiv({ cls: 'rd-stack l' });
  book.createDiv({ cls: 'rd-stack r' });
  book.createDiv({ cls: 'rd-stack-hit l' });
  book.createDiv({ cls: 'rd-stack-hit r' });
  book.createDiv({ cls: 'rd-marks' });
  book.createDiv({ cls: 'rd-scrub' }).hidden = true;
  book.createDiv({ cls: 'rd-slot rd-page lside rd-pl' });
  book.createDiv({ cls: 'rd-slot rd-page rside rd-pr' });
  const leaf = book.createDiv({ cls: 'rd-leaf is-idle' });
  leaf.createDiv({ cls: 'rd-slot rd-face front rside' });
  leaf.createDiv({ cls: 'rd-slot rd-face back lside' });
  world.createDiv({ cls: 'rd-notes' });
  root.createDiv({ cls: 'rd-tip' }).hidden = true;
}

/** Build the desk inside `root` (an empty element). */
export function buildDeskDom(root) {
  root.empty();
  toolbar(root);
  panels(root);
  board(root);
}

/** The two small buttons that change a note's text size. */
export function fontButtons(parent) {
  button(parent, 'rd-fs', { label: 'Smaller text', title: 'Smaller text', plain: 'A−' }).dataset.d = '-1';
  button(parent, 'rd-fs', { label: 'Larger text', title: 'Larger text', plain: 'A+' }).dataset.d = '1';
}

/** A sticky note's inside: grip with the size buttons, a button to peel it off, the text, the corner to resize it. */
export function buildSticky(el) {
  fontButtons(el.createDiv({ cls: 'rd-grip', attr: { title: 'Drag to move' } }));
  button(el, 'rd-del', { label: 'Peel off this note', plain: '×' });
  el.createDiv({ cls: 'rd-txt', attr: { contenteditable: 'true', dir: 'auto', spellcheck: 'false' } });
  el.createSpan({ cls: 'rd-resize', attr: { 'aria-hidden': 'true' } });
}

/** An index card's inside. */
export function buildCard(el) {
  const head = el.createDiv({ cls: 'rd-card-head' });
  head.createEl('button', { cls: 'rd-chip' });
  head.createSpan({ cls: 'rd-grow' });
  fontButtons(head);
  button(head, 'rd-del', { label: 'Throw this card away', plain: '×' });
  el.createEl('textarea', { attr: { dir: 'auto', spellcheck: 'false', placeholder: 'Write…' } });
  el.createSpan({ cls: 'rd-resize', attr: { 'aria-hidden': 'true' } });
}

// the guide: [title, parts]; a part is plain text, or [tag, text] for a key or a name
const K = t => ['kbd', t];
const GUIDE = [
  ['Turn pages', ['drag a page corner, tap the outer edge, or press ', K('←'), ' ', K('→'), '. A quick flick turns quickly.']],
  ['Thickness', ['hover the page edges to see a page number; click to open there.']],
  ['Marking a place', ['a sticky note’s flag stays on the page edge; click the flag to open that page.']],
  ['Zoom to a page', ['double-tap (or double-click) the middle of a page to fit it to the screen; again to see the whole book. Zoomed in, a tap on the edge or ', K('→'), ' moves through the pages in reading order.']],
  ['Zoom and move', ['pinch, Ctrl + scroll, or ', K('+'), ' ', K('−'), '; the zoom stays under the pointer. Drag the empty desk (or scroll) to move around; double-click the desk, or ', K('0'), ', to bring the book back.']],
  ['Select', ['the Select tool (or ', K('S'), ') selects the book’s text like any text: copy it, highlight it, or copy it as a quote with its link. Scanned books have no text to select.']],
  ['Page colour', ['the Paper / Sepia / Night button; it applies to every book.']],
  ['EPUB books', ['A− and A+ set the text size; the book is set again and stays at your place. Highlights go into the book’s note like a PDF’s.']],
  ['Pen', ['write straight on the page.']],
  ['Highlighter', ['drag over text to highlight it word by word. It is saved as a link in the book’s note (the same kind PDF++ makes); click a highlight to open that note. A highlight only copied stays on the desk. Off the text it draws freely.']],
  ['RTL', ['for right-to-left books the spine moves to the right and pages turn the other way.']],
  ['Search', ['the Search button, ', K('Cmd/Ctrl+F'), ' or ', K('/'), '. Enter goes to the next match, Shift+Enter to the one before.']],
  ['Notes', ['the Notes button (or ', K('N'), ') lists your highlights, sticky notes, cards and pen marks in page order; click one to go to it.']],
  ['Contents', ['the Contents button (or ', K('O'), ') lists the book’s chapters; click one to go there. Links inside the book work too.']],
  ['Eraser', ['rubs out pen marks, and text highlights too (it takes their link out of the note; Undo is offered).']],
  ['Toolbar', ['hide it with the arrow at its end, or ', K('T'), '; the tag in the corner brings it back.']],
  ['Excalidraw', ['drag the book’s .desk file onto a drawing, or run “Put a book on this Excalidraw drawing”.']],
  ['Sticky notes', ['click on a page. The first line is its title, written on its flag at the page edge. Drag one anywhere, even off the page; it fades when you are not using it. The corner resizes it, A− A+ change its text size.']],
  ['Cards', ['each card remembers the page it was written on.']],
  ['The book’s note', ['a note whose properties link to the book (or any note in the book notes folder that links to it). New highlights go into it; the first highlight of a book without one offers to make one. A ', ['code', 'language'], ' property such as fa, ar or he opens the book right to left.']]
];

/** The guide card's inside. `opts.excalidraw`: Excalidraw is installed, so its part of the guide applies. */
export function buildGuide(el, opts = {}) {
  const head = el.createDiv({ cls: 'rd-card-head' });
  head.createSpan({ text: 'How the desk works' });
  head.createSpan({ cls: 'rd-grow' });
  button(head, 'rd-del', { label: 'Close the guide', plain: '×' });
  const list = el.createDiv({ cls: 'rd-help-body' }).createEl('ul');
  for (const [title, parts] of GUIDE) {
    if (title === 'Excalidraw' && !opts.excalidraw) continue;
    const li = list.createEl('li');
    li.createEl('b', { text: title + ':' });
    li.appendText(' ');
    for (const part of parts) { if (typeof part === 'string') li.appendText(part); else li.createEl(part[0], { text: part[1] }); }
  }
}
