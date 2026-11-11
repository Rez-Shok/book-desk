/* A chapter of an EPUB, made safe to show inside Obsidian.

   A chapter is a web page written by a stranger, and on the desk it becomes part of Obsidian's own window, where
   a script could reach your notes and your files. So a chapter is cleaned while it is still an inert document
   (one the browser neither runs nor loads anything for), and only the cleaned copy is brought into the window:
   - nothing that can run: scripts, event handlers, script addresses, forms, frames, plug-ins, animated attributes;
   - nothing that fetches from outside the book: every picture must be a file of the book itself;
   - links stay as marks for the desk to follow, never as real links;
   - nothing that could pass for a part of the desk or of Obsidian: ids, names and the desk's own marks are renamed
     or removed. */

import { safeExternalUrl } from './util.js';
import { cssUnescape } from './epub-css.js';
import { zipPath } from './zip.js';

const XHTML = 'http://www.w3.org/1999/xhtml';

// removed with everything inside them
const DROP_ELEMENTS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'datalist', 'output', 'keygen', 'dialog',
  'link', 'meta', 'base', 'basefont', 'noscript', 'template', 'slot', 'audio', 'video', 'source', 'track', 'canvas', 'bgsound', 'param',
  'animate', 'set', 'animatemotion', 'animatetransform', 'mpath', 'discard', 'feimage', 'handler', 'listener']);
// attributes that hold an address; the three the desk needs (a link's, a picture's) are read before they go
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'data', 'poster', 'background', 'action', 'formaction', 'ping', 'longdesc', 'lowsrc', 'dynsrc',
  'manifest', 'codebase', 'cite', 'icon', 'profile', 'usemap', 'classid', 'archive', 'code', 'imagesrcset', 'imagesizes', 'srcdoc', 'base', 'attributename']);
// attributes that change how the page behaves, and the desk's own marks
const DROP_ATTRS = new Set(['contenteditable', 'tabindex', 'autofocus', 'accesskey', 'draggable', 'inert', 'is', 'slot', 'nonce', 'integrity',
  'target', 'download', 'rel', 'referrerpolicy', 'crossorigin', 'loading', 'decoding', 'fetchpriority', 'sizes', 'popover', 'popovertarget',
  'popovertargetaction', 'enterkeyhint', 'inputmode', 'actiontype', 'data-epub-id', 'data-go', 'data-ext', 'data-hk']);

// a value that would fetch or run something when the browser reads it as CSS or as an address
function unsafeValue(value) {
  if (value.length < 4) return false;
  // eslint-disable-next-line no-control-regex -- browsers skip these characters when they read an address
  const norm = cssUnescape(value).replace(/[\u0000-\u0020\u007f-\u009f]+/g, '').toLowerCase();
  return /(?:java|vb)script:|url\(|image-set\(|expression\(/.test(norm);
}
/** Class names of the book, without any that belong to the desk. */
export function bookClasses(value) {
  return String(value || '').split(/\s+/).filter(c => c && !/^(rd-|rdesk)/i.test(c)).join(' ');
}

/**
 * Clean a chapter's body in place. `body` must still belong to the inert document the chapter was parsed into.
 * @param {Element} body
 * @param {{ file: string, urls: Map<string, string>, inlineStyle: (style: string, file: string) => string }} ctx
 *   file: the chapter's path in the book; urls: the book's pictures as blob addresses, by path
 */
export function cleanEpubChapter(body, ctx) {
  const doc = body.ownerDocument;
  // comments and processing instructions go; CDATA is plain text
  const odd = [], walker = doc.createTreeWalker(body, 0x8 | 0x40 | 0x80);
  for (let n; (n = walker.nextNode());) odd.push(n);
  for (const n of odd) { if (n.nodeType === 4) n.replaceWith(doc.createTextNode(n.data)); else n.remove(); }

  for (let el of [...body.querySelectorAll('*')]) {
    if (!body.contains(el)) continue;   // went with an element around it
    const name = el.localName.toLowerCase();
    if (DROP_ELEMENTS.has(name)) { el.remove(); continue; }
    if (el.namespaceURI === XHTML && name.includes('-')) {
      // a "custom element": some plugin may have taught the window what to do with this name
      const span = doc.createElementNS(XHTML, 'span');
      const cls = el.getAttribute('class');
      if (cls) span.setAttribute('class', cls);
      while (el.firstChild) span.appendChild(el.firstChild);
      el.replaceWith(span);
      el = span;
    }
    let href = null, src = null, id = '', anchor = '';
    for (const a of [...el.attributes]) {
      const an = a.localName.toLowerCase(), v = a.value;
      const drop = () => el.removeAttributeNode(a);
      if (an.startsWith('on') || DROP_ATTRS.has(an) || an.startsWith('data-rd-')) drop();
      else if (URL_ATTRS.has(an)) {
        if (an === 'href' && href == null) href = v;   // also xlink:href: the name without its prefix is "href"
        if (an === 'src' && src == null) src = v;
        drop();
      } else if (an === 'style') {
        const s = ctx.inlineStyle(v, ctx.file);
        if (s) a.value = s; else drop();
      } else if (an === 'id') { id = v.trim(); drop(); }
      else if (an === 'name') { anchor = v.trim(); drop(); }   // a name can stand in for document.<name> in scripts
      else if (an === 'class') { const c = bookClasses(v); if (c) a.value = c; else drop(); }
      else if (unsafeValue(v)) drop();
    }
    if (id || (anchor && name === 'a')) el.setAttribute('data-epub-id', id || anchor);   // a page's copies would share ids

    if (name === 'img') {
      const u = src != null ? ctx.urls.get(zipPath(ctx.file, src)) : null;
      if (u) el.setAttribute('src', u); else el.remove();
    } else if (name === 'image') {
      const u = href != null ? ctx.urls.get(zipPath(ctx.file, href)) : null;
      if (u) el.setAttribute('href', u); else el.remove();
    } else if (name === 'a' && href != null) {
      // eslint-disable-next-line no-control-regex -- browsers skip these characters when they read an address
      const h = href.replace(/[\u0000-\u001f\u007f-\u009f]+/g, '').trim();
      if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
        const ext = safeExternalUrl(h);
        if (ext) el.setAttribute('data-ext', ext);
      } else if (h && !h.startsWith('//')) {
        const cut = h.indexOf('#'), path = cut < 0 ? h : h.slice(0, cut);
        let frag = cut < 0 ? '' : h.slice(cut + 1);
        try { frag = decodeURIComponent(frag); } catch { /* kept as written */ }
        el.setAttribute('data-go', (path ? zipPath(ctx.file, path) : ctx.file) + (frag ? '#' + frag : ''));
      }
      if (el.hasAttribute('data-ext') || el.hasAttribute('data-go')) el.classList.add('rd-epub-link');
    }
  }
}
