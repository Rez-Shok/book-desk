/* The plugin's settings and their checking (kept apart from Obsidian's classes, so it can be tested on its own). */

export const DEFAULT_SETTINGS = {
  helpSeen: false,
  dataFolder: 'Book Desk',         // each book's desk: page, ink, stickies, cards, view
  notesFolder: '',                 // where new book notes are made; any note in it that links to a book is that book's note
  followPage: false,               // the book's note keeps the page you are on
  pageProperty: 'current_page',    // ...in this property
  totalPagesProperty: 'total_pages',   // and the page count in this one, when it is empty ('' = left out)
  highlightTarget: 'note',         // new highlights: 'note' = into the book's note, 'clipboard' = copy the link only
  highlightHeading: 'Highlights',  // section of the book's note that new highlights go under
  paper: 'paper',                  // page colour: paper, sepia or night
  epubTextSize: 16                 // an EPUB's text size, in book units (a page is 440 wide)
};

const PAPERS = new Set(['paper', 'sepia', 'night']);
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
// a property name that can be written into a note's frontmatter as it is
export const propertyName = v => { const s = String(v == null ? '' : v).trim(); return s.length <= 80 && !RESERVED.has(s) && !/[:[\]{}#,"'`\\\n]/.test(s) ? s : ''; };

/**
 * The settings as the plugin uses them, whatever the settings file holds (it may have been edited by hand,
 * or written by another version).
 * @param {unknown} raw
 * @param {(path: string) => string} normalizePath Obsidian's own cleaner of vault paths
 */
export function readSettings(raw, normalizePath) {
  const r = raw && typeof raw === 'object' ? raw : {}, d = DEFAULT_SETTINGS;
  const folder = v => { const s = String(v == null ? '' : v).trim(); return s ? normalizePath(s) : ''; };
  const size = Number(r.epubTextSize);
  return {
    helpSeen: r.helpSeen === true,
    dataFolder: folder(r.dataFolder) || d.dataFolder,
    notesFolder: folder(r.notesFolder),
    // settings from before the switch: a page property that was set meant "on"
    followPage: typeof r.followPage === 'boolean' ? r.followPage : !!propertyName(r.pageProperty),
    pageProperty: propertyName(r.pageProperty) || d.pageProperty,
    totalPagesProperty: r.totalPagesProperty == null ? d.totalPagesProperty : propertyName(r.totalPagesProperty),
    highlightTarget: r.highlightTarget === 'clipboard' ? 'clipboard' : 'note',
    highlightHeading: String(r.highlightHeading == null ? '' : r.highlightHeading).replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 120) || d.highlightHeading,
    paper: PAPERS.has(r.paper) ? r.paper : d.paper,
    epubTextSize: Number.isFinite(size) ? Math.max(11, Math.min(30, Math.round(size))) : d.epubTextSize
  };
}
