/* The styles of an EPUB, made safe and confined to the book's own pages.

   A book's stylesheet is written by a stranger and ends up in the same document as the rest of Obsidian, so:
   - every selector is rewritten to reach only into the book's chapters;
   - nothing is ever fetched from outside the book file (no web pictures, fonts or "pixels" that tell someone
     you opened the book);
   - nothing can leave the page it is on, or take over the pointer, the selection or the window;
   - the book's fonts get names of their own, so a font the book calls "Georgia" does not replace yours.

   The browser's own CSS parser reads the stylesheet first; what is kept is put together again one rule at a time,
   and each finished rule is checked once more before it is used. */

import { cssString } from './util.js';

/* ---------- reading CSS text ---------- */
// the index just past the string that opens at `i`
function stringEnd(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === quote) return j + 1;
  }
  return text.length;
}
// a CSS escape at `i` (a backslash): the character it stands for, and its length
function readEscape(text, i) {
  const m = /^\\([0-9a-f]{1,6})\s?/i.exec(text.slice(i, i + 8));
  if (m) { const cp = parseInt(m[1], 16); return { ch: cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd', len: m[0].length }; }
  return { ch: text[i + 1] || '', len: 2 };
}
export function cssUnescape(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\') { const e = readEscape(text, i); out += e.ch; i += e.len; } else out += text[i++];
  }
  return out;
}
/** `text` cut at every `sep` that is not inside a string, brackets or an escape. */
export function splitTop(text, sep) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '"' || c === "'") i = stringEnd(text, i) - 1;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}
/** A declaration block, as the browser writes it out, as a list of { name, value }. */
export function splitDeclarations(cssText) {
  const out = [];
  for (const d of splitTop(String(cssText || ''), ';')) {
    const k = d.indexOf(':');
    if (k < 0) continue;
    const raw = d.slice(0, k).trim(), value = d.slice(k + 1).trim();
    if (raw && value) out.push({ name: raw.startsWith('--') ? raw : raw.toLowerCase(), value });
  }
  return out;
}
// the value with its strings taken out: what is left is the part that can do something
function withoutStrings(value) {
  let out = '';
  for (let i = 0; i < value.length;) {
    if (value[i] === '"' || value[i] === "'") { i = stringEnd(value, i); out += '""'; } else out += value[i++];
  }
  return out;
}
/** Every url(...) in a value handed to `map`, which returns what to write in its place. Strings are left alone. */
export function mapCssUrls(value, map) {
  let out = '';
  const n = value.length;
  for (let i = 0; i < n;) {
    const c = value[i];
    if (c === '"' || c === "'") { const j = stringEnd(value, i); out += value.slice(i, j); i = j; continue; }
    if ((c === 'u' || c === 'U') && /^url\($/i.test(value.slice(i, i + 4)) && !/[\w-]/.test(value[i - 1] || ' ')) {
      let j = i + 4, url;
      while (j < n && /\s/.test(value[j])) j++;
      if (value[j] === '"' || value[j] === "'") { const k = stringEnd(value, j); url = cssUnescape(value.slice(j + 1, k - 1)); j = k; }
      else { const k = value.indexOf(')', j), end = k < 0 ? n : k; url = cssUnescape(value.slice(j, end).trim()); j = end; }
      while (j < n && value[j] !== ')') j++;
      out += map(url);
      i = j + 1;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/* ---------- declarations ---------- */
// functions that fetch something without saying url(), and old ways of running script from CSS
const FORBIDDEN_FN = /(^|[^\w-])(-webkit-image-set|image-set|image|src|element|expression)\(/i;
// nothing may fight the columns the pages are made of, take the pointer or the selection, or make the page editable
const DROP = /^(columns?|column-[\w-]+|overflow(-(x|y|block|inline|clip-margin|anchor))?|(-webkit-|-moz-)?user-select|pointer-events|cursor|(-webkit-)?app-region|-webkit-user-drag|(-webkit-)?user-modify|touch-action|-webkit-touch-callout)$/;
// the book's html and body are the chapter itself: its type and colour stay, its margins and size go
const ROOT_DROP = /^(margin[\w-]*|padding[\w-]*|(min-|max-)?(width|height|inline-size|block-size)|background[\w-]*)$/;
const PAGE_BREAK = /^(always|page|left|right|recto|verso)\b/i;
const IMPORTANT = /\s*!\s*important\s*$/i;
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'math', 'emoji', 'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', '-apple-system', 'blinkmacsystemfont',
  '-webkit-body', '-webkit-standard', '-webkit-pictograph']);

/** A font-family list with the book's own name for each family put before it. */
export function scopeFontFamilies(value, scope) {
  const imp = IMPORTANT.exec(value), list = imp ? value.slice(0, imp.index) : value, out = [];
  for (const item of splitTop(list, ',')) {
    const t = item.trim();
    if (!t) continue;
    let name;
    if (t[0] === '"' || t[0] === "'") name = cssUnescape(t.slice(1, stringEnd(t, 0) - 1));
    else if (GENERIC_FONTS.has(t.toLowerCase()) || t.includes('(')) { out.push(t); continue; }
    else name = t.replace(/\s+/g, ' ');
    if (!name) continue;
    out.push(cssString(`${scope} ${name}`), cssString(name));
  }
  return out.join(', ') + (imp ? ' !important' : '');
}

/**
 * A declaration block made safe.
 * @param {string} cssText the block as the browser's parser wrote it out
 * @param {{ resolve: (url: string) => string | null, scope: string, root?: boolean, fontFamilyOf?: (font: string) => string }} opts
 *   resolve: the address to use for a url() in the book (null: none); root: the block styles the chapter itself
 * @returns {string}
 */
export function sanitizeDeclarations(cssText, opts) {
  const out = [];
  for (const { name, value } of splitDeclarations(cssText)) {
    if (DROP.test(name) || (opts.root && ROOT_DROP.test(name))) continue;
    const bare = withoutStrings(value);
    // an escape outside a string can spell a function's name in a way this file does not read; braces could end the rule
    if (bare.includes('\\') || /[{}]/.test(bare) || FORBIDDEN_FN.test(bare)) continue;
    const imp = IMPORTANT.test(value) ? ' !important' : '';
    if (name === 'position') { out.push(/^(static|relative)\b/i.test(value) ? `position: ${value}` : `position: static${imp}`); continue; }
    // a page break in the book is a column break on the desk (only before something: a break after the last
    // paragraph of a chapter would leave an empty page)
    if ((name === 'break-before' || name === 'page-break-before') && PAGE_BREAK.test(value)) { out.push(`break-before: column${imp}`); continue; }
    if ((name === 'break-after' || name === 'page-break-after') && PAGE_BREAK.test(value)) { out.push(`break-after: auto${imp}`); continue; }
    const v = mapCssUrls(value, u => { const to = opts.resolve(u); return to ? `url(${cssString(to)})` : 'none'; });
    if (name === 'font-family') { out.push(`font-family: ${scopeFontFamilies(v, opts.scope)}`); continue; }
    out.push(`${name}: ${v}`);
    if (name === 'font' && opts.fontFamilyOf) {
      const family = opts.fontFamilyOf(imp ? v.replace(IMPORTANT, '') : v);
      if (family) out.push(`font-family: ${scopeFontFamilies(family, opts.scope)}${imp}`);
    }
  }
  return out.join('; ');
}

/**
 * An @font-face rule of the book under the book's own name for the family; null if it has no usable source.
 * @param {string} cssText
 * @param {{ resolve: (url: string) => string | null, scope: string }} opts
 */
export function fontFaceRule(cssText, opts) {
  let family = '';
  const src = [], rest = [];
  for (const { name, value } of splitDeclarations(cssText)) {
    const bare = withoutStrings(value);
    if (bare.includes('\\') || /[{}]/.test(bare)) continue;
    if (name === 'font-family') {
      const t = splitTop(value, ',')[0].trim();
      family = t[0] === '"' || t[0] === "'" ? cssUnescape(t.slice(1, stringEnd(t, 0) - 1)) : t.replace(/\s+/g, ' ');
    } else if (name === 'src') {
      for (const item of splitTop(value, ',')) {
        if (FORBIDDEN_FN.test(withoutStrings(item))) continue;
        let ok = true;
        const mapped = mapCssUrls(item, u => { const to = opts.resolve(u); if (!to) ok = false; return to ? `url(${cssString(to)})` : 'none'; }).trim();
        if (ok && mapped) src.push(mapped);
      }
    } else if (/^(font-(weight|style|stretch|display|variant[\w-]*|feature-settings|variation-settings)|unicode-range|ascent-override|descent-override|line-gap-override|size-adjust)$/.test(name)) {
      rest.push(`${name}: ${value}`);
    }
  }
  if (!family || !src.length) return null;
  return `@font-face { font-family: ${cssString(`${opts.scope} ${family}`)}; src: ${src.join(', ')}; ${rest.join('; ')} }`;
}

/* ---------- selectors ---------- */
// an element's id is kept as data-epub-id (a page's copies would share ids, and ids are reachable from scripts)
function mapIds(sel) {
  let out = '', brackets = 0;
  for (let i = 0; i < sel.length;) {
    const c = sel[i];
    if (c === '\\') { out += sel.slice(i, i + 2); i += 2; continue; }
    if (c === '"' || c === "'") { const j = stringEnd(sel, i); out += sel.slice(i, j); i = j; continue; }
    if (c === '[') brackets++; else if (c === ']') brackets = Math.max(0, brackets - 1);
    if (c === '#' && !brackets) {
      let j = i + 1, name = '';
      while (j < sel.length) {
        const d = sel[j];
        if (d === '\\') { const e = readEscape(sel, j); name += e.ch; j += e.len; }
        else if (/[\w-]/.test(d) || d.charCodeAt(0) > 127) { name += d; j++; }
        else break;
      }
      if (name) { out += `[data-epub-id=${cssString(name)}]`; i = j; continue; }
    }
    out += c; i++;
  }
  return out;
}
// where the first compound selector ends (at a combinator, or the end)
function compoundEnd(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === '"' || c === "'") i = stringEnd(s, i) - 1;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (!depth && /[\s>+~]/.test(c)) return i;
  }
  return s.length;
}
/**
 * A selector list rewritten to reach only into the book's chapters. `chapter` is the selector of a chapter element
 * (which stands in for the book's html and body). Selectors for the chapter itself come back apart from the others,
 * since their declarations are treated differently.
 * @returns {{ roots: string[], others: string[] }}
 */
export function scopeSelectorList(selectorText, chapter) {
  const roots = [], others = [];
  for (const raw of splitTop(String(selectorText || ''), ',')) {
    let s = mapIds(raw.trim());
    if (!s) continue;
    let end = compoundEnd(s), first = s.slice(0, end), dropped = false;
    if (/^(?:html|:root)(?![\w-])/i.test(first)) {   // what is said of <html> cannot be kept; what follows it can
      s = s.slice(end).replace(/^\s*[>+~]?\s*/, '');
      if (!s) { roots.push(chapter); continue; }
      end = compoundEnd(s); first = s.slice(0, end); dropped = true;
    }
    if (/^body(?![\w-])/i.test(first)) {
      const rest = s.slice(end);
      (rest.trim() ? others : roots).push(chapter + first.slice(4) + rest);
    } else others.push(`${chapter} ${s}`);
    void dropped;
  }
  return { roots, others };
}

/* ---------- the whole stylesheet ---------- */
/**
 * The address a url() in the book may use: a picture or font of the book itself (a blob made from the book file),
 * or data written into the stylesheet. Never anything outside the book.
 * @param {string} url as written in the book
 * @param {(path: string) => string | undefined} lookup the blob address of a file in the book, by its path
 */
export function resolveBookUrl(url, lookup) {
  const u = String(url || '').trim();
  if (!u || u[0] === '#') return null;
  if (/^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/[\w.+-]+|application\/(x-)?font-[\w.+-]+|application\/vnd\.ms-(fontobject|opentype))[;,]/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return null;
  return lookup(u) || null;
}

/**
 * The book's stylesheets as one sheet, ready to be adopted by the document.
 * @param {Window} win the window the book is shown in
 * @param {{ text: string, resolve: (url: string) => string | null }[]} sources each stylesheet's text, in the book's order
 * @param {string} scope the class that marks this book's pages
 * @returns {CSSStyleSheet}
 */
export function buildBookSheet(win, sources, scope) {
  const chapter = `.${scope} > .rd-epub-chapter`;
  const sheet = new win.CSSStyleSheet();
  const scratch = new win.CSSStyleSheet();
  scratch.replaceSync('x{}');
  const scratchStyle = /** @type {CSSStyleRule} */ (scratch.cssRules[0]).style;
  const fontFamilyOf = font => { scratchStyle.cssText = ''; scratchStyle.setProperty('font', font); return scratchStyle.getPropertyValue('font-family'); };
  const insert = (target, text) => { try { return target.cssRules[target.insertRule(text, target.cssRules.length)]; } catch { return null; } };
  const removeLast = target => target.deleteRule(target.cssRules.length - 1);
  // the last check: the rule the browser made of our text is one style rule, and every selector of it starts in a chapter
  const addStyle = (target, selectors, body) => {
    if (!selectors.length || !body) return;
    const made = insert(target, `${selectors.join(', ')} { ${body} }`);
    if (!made) return;
    const ok = made instanceof win.CSSStyleRule && splitTop(made.selectorText, ',').every(s => s.trim().startsWith(chapter));
    if (!ok) removeLast(target);
  };
  let count = 0;
  const walk = (rules, target, resolve) => {
    for (const r of rules) {
      if (++count > 30000) return;
      if (r instanceof win.CSSStyleRule) {
        const { roots, others } = scopeSelectorList(r.selectorText, chapter), text = r.style.cssText;
        addStyle(target, others, sanitizeDeclarations(text, { resolve, scope, fontFamilyOf }));
        addStyle(target, roots, sanitizeDeclarations(text, { resolve, scope, fontFamilyOf, root: true }));
      } else if (r instanceof win.CSSMediaRule || r instanceof win.CSSSupportsRule) {
        const kind = r instanceof win.CSSMediaRule ? '@media' : '@supports';
        const made = insert(target, `${kind} ${r.conditionText || (r.media && r.media.mediaText) || 'all'} {}`);
        if (!made) continue;
        if (made instanceof win.CSSMediaRule || made instanceof win.CSSSupportsRule) walk(r.cssRules, made, resolve); else removeLast(target);
      } else if (r instanceof win.CSSFontFaceRule) {
        const text = fontFaceRule(r.style.cssText, { resolve, scope });
        const made = text && insert(sheet, text);
        if (made && !(made instanceof win.CSSFontFaceRule)) removeLast(sheet);
      }
      // everything else (@import, @keyframes, @namespace, @page, @property…) is left out
    }
  };
  for (const src of sources) {
    const parsed = new win.CSSStyleSheet();
    try { parsed.replaceSync(String(src.text || '').replace(/@import\b[^;]*;/gi, '')); } catch { continue; }
    walk(parsed.cssRules, sheet, src.resolve);
  }
  return sheet;
}

/**
 * A way to make an element's own style attribute safe, in the same way as a stylesheet's declarations.
 * @param {Window} win
 * @param {string} scope
 * @returns {(style: string, resolve: (url: string) => string | null) => string}
 */
export function inlineStyleCleaner(win, scope) {
  const scratch = new win.CSSStyleSheet();
  scratch.replaceSync('x{} y{}');
  const a = /** @type {CSSStyleRule} */ (scratch.cssRules[0]).style, b = /** @type {CSSStyleRule} */ (scratch.cssRules[1]).style;
  const fontFamilyOf = font => { b.cssText = ''; b.setProperty('font', font); return b.getPropertyValue('font-family'); };
  return (style, resolve) => {
    a.cssText = String(style || '');   // the browser's parser reads it; only what it understood is looked at
    return sanitizeDeclarations(a.cssText, { resolve, scope, fontFamilyOf });
  };
}
