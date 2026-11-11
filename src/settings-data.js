/* The plugin's settings and their checking (kept apart from Obsidian's classes, so it can be tested on its own). */

export const DEFAULT_SETTINGS = {
  helpSeen: false,
  dataFolder: 'Book Desk',         // each book's desk: page, ink, stickies, cards, view
  notesFolder: '',                 // the book's note is a note in this folder that links to the book ('' = any note)
  pageProperty: '',                // property of the book's note that follows the current page ('' = off)
  totalPagesProperty: '',
  highlightTarget: 'note',         // new highlights: 'note' = into the book's note, 'clipboard' = copy the link only
  highlightHeading: 'Highlights',  // section of the book's note that new highlights go under
  paper: 'paper',                  // page colour: paper, sepia or night
  epubTextSize: 16,                // an EPUB's text size, in book units (a page is 440 wide)
  standInMarker: ''                // a small file holding this text is a stand-in for a book kept elsewhere ('' = off)
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
    pageProperty: propertyName(r.pageProperty),
    totalPagesProperty: propertyName(r.totalPagesProperty),
    highlightTarget: r.highlightTarget === 'clipboard' ? 'clipboard' : 'note',
    highlightHeading: String(r.highlightHeading == null ? '' : r.highlightHeading).replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 120) || d.highlightHeading,
    paper: PAPERS.has(r.paper) ? r.paper : d.paper,
    epubTextSize: Number.isFinite(size) ? Math.max(11, Math.min(30, Math.round(size))) : d.epubTextSize,
    standInMarker: String(r.standInMarker == null ? '' : r.standInMarker).trim().slice(0, 200)
  };
}
