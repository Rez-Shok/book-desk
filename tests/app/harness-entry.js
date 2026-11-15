// Everything the in-app tests reach into, as one bundle (see tests/app/README.md).
export { createDesk } from '../../src/desk.js';
export { buildGuide } from '../../src/desk-dom.js';
export { openEpub, layoutEpub, makeEpubFlow, epubTextOf, parseEpubSubpath } from '../../src/epub.js';
export { normalizeDeskState } from '../../src/desk-state.js';
export { safeExternalUrl, escapeMarkdownText } from '../../src/util.js';
export { unzipIndex, unzipFile } from '../../src/zip.js';
export { readingOrder, readingText, textIndexOf, textSegments, segmentRuns, rangeText, wholeWords, tidyText } from '../../src/pdf-text.js';
export { TEXT_OPTIONS, charBoxes, hitChar, segmentRects, needsSpace } from '../../src/pdf-highlights.js';
