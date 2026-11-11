/* Small helpers shared by the desk and the plugin. */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * A link taken from a book (a PDF's link annotation, an EPUB's <a href>) is only ever opened in the browser when
 * it is a plain web or mail address. Everything else a book might carry (file:, javascript:, obsidian:, smb: and
 * other handlers of the operating system) is refused.
 * @param {unknown} raw
 * @returns {string | null} the address to open, or null
 */
export function safeExternalUrl(raw) {
  if (typeof raw !== 'string') return null;
  // browsers drop tabs and line breaks anywhere in an address, and control characters around it, before reading it
  // eslint-disable-next-line no-control-regex -- control characters are exactly what has to go
  const text = raw.replace(/[\u0000-\u0020\u007f-\u009f]+/g, c => (/[\t\n\r]/.test(c) ? '' : ' ')).trim();
  if (!text || text.length > 2048) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'mailto:') return null;
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  return url.href;
}

/**
 * Text taken from a book, made safe to write into a note. A book's text is not to be trusted: the words on the page
 * and the text behind them can differ, and in a note some of it would come alive (an embed, a web picture, raw HTML,
 * a Dataview or Templater expression, a link that changes the note's other links). The words stay as they are;
 * only the characters that would start such a thing get a backslash, so most quotes are not touched at all.
 * @param {unknown} text
 * @returns {string} one line of Markdown that shows as the plain text
 */
export function escapeMarkdownText(text) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what has to go
  let s = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  // comments, and Templater's tags: Templater reads the note's raw text, so "<%" itself must not be left standing
  s = s.replace(/%%/g, '\\%\\%').replace(/<%/g, '<\\%').replace(/%>/g, '%\\>');
  // HTML and autolinks
  s = s.replace(/<(?=[A-Za-z/!?])/g, '\\<');
  // character references would show as another character
  s = s.replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
  // links and embeds: every bracket when a Markdown link is spelled out, else only the ones that open something
  if (/\]\s*[([]/.test(s) || /\]:/.test(s)) s = s.replace(/\[/g, '\\[');
  else s = s.replace(/\[{2,}/g, m => m.replace(/\[/g, '\\[')).replace(/!\[/g, '!\\[').replace(/\[(?=\^)/g, '\\[').replace(/^\[/, '\\[');
  // two dollar signs make a formula
  if ((s.match(/\$/g) || []).length > 1) s = s.replace(/\$/g, '\\$');
  // a tag: # and then something that is not only digits
  s = s.replace(/(^|\s)#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])/gu, '$1\\#');
  // at the very start of a line these would make a heading, a list, a rule, a quote or a code block of the quote
  s = s.replace(/^(\d+)([.)])(?=\s)/, '$1\\$2').replace(/^([-+*>#=~|])/, '\\$1');
  return s;
}

/**
 * A title taken from a book (an EPUB's section name), safe as the display text of a link.
 * @param {unknown} text
 * @returns {string}
 */
export function plainLinkText(text) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what has to go
  return String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[[\]|`<>\\^#%$]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** `text` as a CSS string, quotes included. */
export function cssString(text) {
  // eslint-disable-next-line no-control-regex -- a control character in a CSS string has to be written as an escape
  return '"' + String(text).replace(/[\u0000-\u001f\u007f"\\]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ') + '"';
}
