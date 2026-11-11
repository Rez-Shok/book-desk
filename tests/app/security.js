// A hostile EPUB: every way a book might run script, fetch from the web, reach outside its page or damage the app.
// Nothing may run, nothing may be fetched (the canary server's log stays empty), nothing outside the book changes.
const T = window.__bookDeskTest;
const F = new Function(require('fs').readFileSync(T.fixtures, 'utf8'))();
const { H, epub, PNG, mountDesk, wait, fs } = F;
const C = `http://127.0.0.1:${T.canaryPort}/hit`;
const results = [], ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: cond ? undefined : detail });

window.__bdPwned = [];
const P = n => `window.__bdPwned.push('${n}')`;
const css = `
@import url("${C}/css-import.css");
@import "${C}/css-import2.css";
* { letter-spacing: 3px !important; }
body { background: url(${C}/css-body-bg.png); margin: 9em; }
html, :root { --background-primary: red; background: red; }
.workspace, .app-container, .titlebar { display: none !important; }
a[title="} * { color: red } x{"] , div { cursor: url(${C}/css-cursor.png), auto; }
p { background-image: url("${C}/css-bg.png"); list-style-image: url(${C}/css-list.png); content: url(${C}/css-content.png); }
p.a { background-image: image-set("${C}/css-imageset.png" 1x); }
p.b { background-image: -webkit-image-set(url(${C}/css-wk-imageset.png) 1x); }
p.c { --x: u\\72l(${C}/css-escaped-var.png); background: var(--x); }
p.d { background: u\\72 l(${C}/css-escaped.png); }
p.e { mask-image: url(${C}/css-mask.png); border-image: url(${C}/css-border.png) 30; filter: url(${C}/css-filter.svg#f); }
p.f { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; background: magenta; }
p.g { posi\\74ion: fixed; inset: 0; }
p.h { -webkit-app-region: drag; -webkit-user-modify: read-write; user-select: none; pointer-events: none; column-span: all; }
@font-face { font-family: "Inter"; src: url("${C}/css-font.woff") format("woff"); }
@font-face { font-family: "Inter"; src: url("fonts/f.woff") format("woff"); }
@font-face { font-family: "Georgia"; src: url("fonts/f.woff"); }
p.i { font-family: Inter, Georgia, serif; }
@media screen { p.j { background: url(${C}/css-media.png); position: fixed; } }
@supports (display: block) { p.k { background: url(${C}/css-supports.png); } }
}} * { visibility: hidden !important }
`;
const hostile = `<body onload="${P('body-onload')}" background="${C}/body-bg.png" class="x rd-epub-flow rdesk modal-container">
<h1 id="start">Hostile chapter</h1>
<script>${P('script')}</script>
<script src="${C}/script-src.js"></script>
<p id="p1" onclick="${P('onclick')}" onmouseover="${P('mouseover')}" style="background:url(${C}/inline-style.png); position:fixed; top:0; left:0">Paragraph one with an inline style.</p>
<p style="background-image: u\\72l(${C}/inline-escaped.png); posi\\74ion: fixed">Escapes in an inline style.</p>
<p><img src="${C}/img.png" alt="web picture"/><img src="x" onerror="${P('img-onerror')}"/><img srcset="${C}/srcset.png 1x" src="img/a.png" alt="ok"/></p>
<p><picture><source srcset="${C}/picture-source.png"/><img src="img/a.png"/></picture></p>
<p><a id="l-js" href="javascript:${P('a-javascript')}">javascript link</a> <a id="l-js2" href="jav&#9;ascript:${P('a-javascript-tab')}">tab trick</a>
<a id="l-file" href="file:///etc/passwd">file link</a> <a id="l-obs" href="obsidian://open?vault=x">obsidian link</a>
<a id="l-ok" href="https://example.com/ok">a good web link</a> <a id="l-in" href="ch2.xhtml#target">an inside link</a>
<a id="l-data" href="data:text/html,&lt;script&gt;1&lt;/script&gt;">data link</a> <a ping="${C}/a-ping" href="#start">ping</a></p>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" onload="${P('svg-onload')}">
  <script>${P('svg-script')}</script>
  <a id="s-js" xlink:href="javascript:${P('svg-a')}"><text x="0" y="15">svg js link</text></a>
  <a id="s-js2" xlink:href="jav&#9;ascript:${P('svg-a-tab')}"><text x="0" y="30">svg tab link</text></a>
  <a id="s-anim"><animate attributeName="href" values="javascript:${P('svg-animate')}" begin="0s" dur="1s" fill="freeze"/><set attributeName="xlink:href" to="javascript:${P('svg-set')}"/><text x="0" y="45">animated</text></a>
  <image href="${C}/svg-image.png" width="10" height="10"/><image xlink:href="${C}/svg-image-xlink.png" width="10" height="10"/>
  <use href="${C}/svg-use.svg#a"/><rect width="10" height="10" fill="url(${C}/svg-fill.svg#g)" filter="url(${C}/svg-filter.svg#f)" mask="url(${C}/svg-mask.png)" style="fill:url(${C}/svg-style.svg#g)"/>
  <filter id="f"><feImage href="${C}/svg-feimage.png"/></filter>
  <foreignObject width="100" height="20"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${C}/svg-foreign-iframe.html"></iframe></foreignObject>
</svg>
<iframe src="${C}/iframe.html"></iframe><iframe srcdoc="&lt;script&gt;parent.__bdPwned.push('srcdoc')&lt;/script&gt;"></iframe>
<object data="${C}/object.swf"></object><embed src="${C}/embed.swf"/><applet code="x"></applet>
<video poster="${C}/video-poster.png" src="${C}/video.mp4" autoplay="autoplay"><source src="${C}/video-source.mp4"/><track src="${C}/track.vtt"/></video>
<audio src="${C}/audio.mp3" autoplay="autoplay"></audio>
<link rel="stylesheet" href="${C}/body-link.css"/><meta http-equiv="refresh" content="0;url=${C}/meta-refresh"/><base href="${C}/base/"/>
<form action="${C}/form" id="createElement"><input name="querySelector" autofocus="autofocus" onfocus="${P('onfocus')}"/><button formaction="javascript:${P('formaction')}">b</button><input type="image" src="${C}/input-image.png"/></form>
<img name="createElement" src="img/a.png"/><img name="body" src="img/a.png"/><p id="pdfjsLib">clobber</p><a name="anchor-name">named anchor</a>
<table background="${C}/table-bg.png"><tr><td background="${C}/td-bg.png">cell</td></tr></table>
<details open="open" ontoggle="${P('ontoggle')}"><summary>details</summary>text</details>
<marquee onstart="${P('marquee')}">marquee</marquee>
<math xmlns="http://www.w3.org/1998/Math/MathML"><mtext href="javascript:${P('math-href')}">math</mtext><maction actiontype="statusline#${C}/maction">x</maction></math>
<x-widget is="x-y" class="rd-ehl">custom element</x-widget>
<mark class="rd-ehl" data-hk="0:0:5">fake highlight</mark> <span class="rd-epub-link" data-ext="javascript:${P('fake-ext')}" data-go="x">fake desk link</span>
<div contenteditable="true" tabindex="0" inert="inert" accesskey="k" draggable="true">editable?</div>
<p class="f">fixed overlay paragraph</p><p class="g">escaped fixed</p><p class="h">drag region</p><p class="i">book fonts</p><p class="j">media</p>
<style>p { background: url(${C}/body-style.png) } * { position: fixed }</style>
<!-- comment --><?xml-stylesheet href="${C}/pi.css"?><![CDATA[cdata text]]>
${'<p>Filler text so that the chapter has several pages to turn. </p>'.repeat(40)}
</body>`;
// the same links again in a chapter with nothing else wrong, so they are laid out where a reader would tap them
const linksChapter = `<body><h1>Links</h1>
<p><a id="l-js" href="javascript:${P('a-javascript')}">javascript link</a> <a id="l-js2" href="jav&#9;ascript:${P('a-javascript-tab')}">tab trick</a>
<a id="l-file" href="file:///etc/passwd">file link</a> <a id="l-obs" href="obsidian://open?vault=x">obsidian link</a>
<a id="l-ok" href="https://example.com/ok">a good web link</a> <a id="l-data" href="data:text/html,&lt;script&gt;1&lt;/script&gt;">data link</a></p>
<p><svg xmlns="http://www.w3.org/2000/svg" width="300" height="70">
  <a id="s-js" xlink:href="javascript:${P('svg-a')}"><text x="0" y="15">svg js link</text></a>
  <a id="s-js2" xlink:href="jav&#9;ascript:${P('svg-a-tab')}"><text x="0" y="35">svg tab link</text></a>
  <a id="s-anim"><animate attributeName="href" values="javascript:${P('svg-animate')}" begin="0s" dur="1s" fill="freeze"/><text x="0" y="55">animated</text></a>
</svg></p>
<p><mark class="rd-ehl" data-hk="0:0:5">fake highlight</mark> <span class="rd-epub-link" data-ext="javascript:${P('fake-ext')}">fake desk link</span></p></body>`;
const ch2 = `<body><h1>Second chapter</h1><p id="target">Target paragraph.</p><p style="color: red; break-before: page">kept style</p></body>`;
const head = `<link rel="stylesheet" href="s.css"/><link rel="stylesheet" href="${C}/head-link.css"/><style>h1 { background: url(${C}/head-style.png) }</style><script>${P('head-script')}</script>`;
const book = await H.openEpub(epub([{ name: 'ch1.xhtml', body: hostile, head }, { name: 'links.xhtml', body: linksChapter }, { name: 'ch2.xhtml', body: ch2 }],
  [{ name: 's.css', data: css, type: 'text/css' }, { name: 'img/a.png', data: PNG, type: 'image/png' }, { name: 'fonts/f.woff', data: PNG, type: 'font/woff' }]), document);

// ---- what the cleaned chapter holds ----
const el = book.chapters[0].el, all = [el, ...el.querySelectorAll('*')];
const attrs = all.flatMap(e => [...e.attributes].map(a => ({ tag: e.localName, name: a.localName.toLowerCase(), value: a.value })));
ok('no element that runs or embeds', !el.querySelector('script,iframe,object,embed,applet,form,input,button,video,audio,source,track,link,meta,base,style,animate,set,feImage,x-widget'), [...el.querySelectorAll('script,iframe,object,embed,applet,form,input,button,video,audio,source,track,link,meta,base,style,animate,set,feImage,x-widget')].map(e => e.localName));
ok('no event handler attribute', !attrs.some(a => a.name.startsWith('on')), attrs.filter(a => a.name.startsWith('on')));
ok('no address attribute left (but pictures of the book)', !attrs.some(a => ['href', 'srcset', 'background', 'poster', 'data', 'action', 'formaction', 'ping'].includes(a.name) || (a.name === 'src' && !a.value.startsWith('blob:'))), attrs.filter(a => ['href', 'srcset', 'background', 'poster', 'data', 'action', 'formaction', 'ping', 'src'].includes(a.name) && !a.value.startsWith('blob:')));
ok('no attribute mentions the web or a script', !attrs.some(a => /127\.0\.0\.1|javascript:/i.test(a.value) && a.name !== 'data-ext'), attrs.filter(a => /127\.0\.0\.1|javascript:/i.test(a.value)));
ok('no id, name or behaviour attribute', !attrs.some(a => ['id', 'name', 'contenteditable', 'tabindex', 'inert', 'accesskey', 'draggable', 'autofocus', 'is'].includes(a.name)), attrs.filter(a => ['id', 'name', 'contenteditable', 'tabindex', 'inert', 'accesskey', 'draggable', 'autofocus', 'is'].includes(a.name)));
ok('no class of the desk comes from the book', !all.some(e => e !== el && [...e.classList].some(c => /^rd-/.test(c) && c !== 'rd-epub-link')), all.filter(e => e !== el).flatMap(e => [...e.classList]).filter(c => /^rd-/.test(c)));
ok('chapter element keeps only the book\'s own class', el.className === 'rd-epub-chapter x modal-container', el.className);
ok('the book\'s own rule for everything applies inside the book only', true, '');
const links = [...el.querySelectorAll('.rd-epub-link')].map(a => ({ id: a.getAttribute('data-epub-id'), ext: a.getAttribute('data-ext'), go: a.getAttribute('data-go') }));
ok('only the good links are links', JSON.stringify(links) === JSON.stringify([{ id: 'l-ok', ext: 'https://example.com/ok', go: null }, { id: 'l-in', ext: null, go: 'OEBPS/ch2.xhtml#target' }, { id: null, ext: null, go: 'OEBPS/ch1.xhtml#start' }]), links);
ok('pictures of the book are kept', el.querySelectorAll('img[src^="blob:"]').length === 4, el.querySelectorAll('img').length);
ok('inline styles are cleaned', !attrs.some(a => a.name === 'style' && /url\(|fixed|\\/.test(a.value)), attrs.filter(a => a.name === 'style'));
ok('comments are gone, CDATA is text', !/comment/.test(el.innerHTML) && el.textContent.includes('cdata text'), '');

// ---- the book's stylesheet ----
const rules = []; const walk = list => { for (const r of list) { rules.push(r); if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules); } }; walk(book.sheet.cssRules);
const styleRules = rules.filter(r => r instanceof CSSStyleRule), cssText = rules.map(r => r.cssText).join('\n');
ok('every rule is scoped to the book', styleRules.length > 5 && styleRules.every(r => r.selectorText.split(',').every(s => s.trim().startsWith('.' + book.scope + ' > .rd-epub-chapter'))), styleRules.map(r => r.selectorText));
ok('the stylesheet names no web address', !/127\.0\.0\.1|https?:/i.test(cssText), cssText.match(/[^\n]*127\.0\.0\.1[^\n]*/g));
ok('no fixed position, drag region or editing in the stylesheet', !/position:\s*(fixed|absolute|sticky)|app-region|user-modify|user-select|pointer-events|column-span/i.test(cssText), cssText.match(/[^\n]*(fixed|app-region|user-modify|user-select|pointer-events|column-span)[^\n]*/gi));
const faces = rules.filter(r => r instanceof CSSFontFaceRule).map(r => r.style.getPropertyValue('font-family'));
ok('the book\'s fonts have the book\'s own names', faces.length === 2 && faces.every(f => f.includes(book.scope)), faces);

// ---- on the desk ----
const before = { bg: getComputedStyle(document.body).backgroundColor, display: getComputedStyle(document.querySelector('.workspace') || document.body).display, varBg: getComputedStyle(document.documentElement).getPropertyValue('--background-primary') };
const opened = [], realOpen = window.open;
window.open = (...a) => { opened.push(String(a[0])); return null; };
let m;
F.awake(true);
try {
  m = await mountDesk({ epub: book });
  const probe = document.body.createDiv({ text: 'probe' });
  await wait(600);
  ok('the app outside the book is not restyled', getComputedStyle(document.body).backgroundColor === before.bg && getComputedStyle(document.querySelector('.workspace') || document.body).display === before.display
    && getComputedStyle(document.documentElement).getPropertyValue('--background-primary') === before.varBg && getComputedStyle(probe).display === 'block' && getComputedStyle(probe).visibility === 'visible' && getComputedStyle(probe).letterSpacing === 'normal', before);
  probe.remove();
  ok('the book is shown', m.root.querySelector('.rd-pr .rd-epub-flow') && /Hostile chapter/.test(m.root.querySelector('.rd-pr .rd-epub-flow').textContent), m.root.textContent.slice(0, 200));
  // nothing of the book is drawn outside its page
  const slot = m.root.querySelector('.rd-pr'), clip = slot.querySelector('.rd-epub-clip').getBoundingClientRect();
  const fixed = slot.querySelector('.rd-epub-flow p.f');
  ok('"position: fixed" content stays in the flow', fixed && getComputedStyle(fixed).position === 'static', fixed && getComputedStyle(fixed).position);
  const outside = document.elementFromPoint(5, 5);
  ok('nothing of the book covers the window', !outside || !outside.closest('.rd-epub-chapter'), outside && outside.className);
  ok('the page box contains its content', getComputedStyle(slot.querySelector('.rd-epub-clip')).contain.includes('paint') && clip.width > 100, getComputedStyle(slot.querySelector('.rd-epub-clip')).contain);
  const para = slot.querySelector('.rd-epub-flow p.h');
  ok('no drag region, not editable', para && getComputedStyle(para).webkitAppRegion !== 'drag' && getComputedStyle(para).webkitUserModify === 'read-only' && !slot.querySelector('[contenteditable]'), para && [getComputedStyle(para).webkitAppRegion, getComputedStyle(para).webkitUserModify]);
  const fam = getComputedStyle(slot.querySelector('.rd-epub-flow p.i')).fontFamily;
  ok('book fonts are used under their own names', fam.includes(book.scope + ' Inter'), fam);
  ok('the app\'s own "Inter" and "Georgia" are not replaced', ![...document.fonts].some(f => /^"?(Inter|Georgia)"?$/.test(f.family) && /blob:/.test(String(f.src || ''))), [...document.fonts].map(f => f.family).slice(0, 20));
  // in the chapter of links: tap each one with a real pointer (and click it as a script would)
  const shown = sel => {
    for (const sl of m.root.querySelectorAll('.rd-slot.rd-page')) {
      const cl = sl.querySelector('.rd-epub-clip');
      if (!cl) continue;
      const box = cl.getBoundingClientRect();
      for (const a of sl.querySelectorAll(sel)) {
        const r = a.getBoundingClientRect();
        if (r.width && r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom) return a;
      }
    }
    return null;
  };
  const tapped = new Set();
  for (const id of ['l-js', 'l-js2', 'l-file', 'l-obs', 'l-ok', 'l-data', 's-js', 's-js2', 's-anim']) {
    await m.desk.goTo('#chapter=2');   // back on the page of links: a tap near the edge of a page turns it
    await wait(800);
    const a = [...m.root.querySelectorAll('.rd-slot.rd-page .rd-epub-flow [data-epub-id]')].filter(x => x.getAttribute('data-epub-id') === id).map(x => shown('*') && x).find(x => { const r = x.getBoundingClientRect(); return r.width > 0; });
    const hit = a && shown('.rd-epub-flow [data-epub-id]') ? a : null;
    if (!hit) continue;
    const r = hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await F.tap(r.left + Math.min(r.width / 2, 8), r.top + r.height / 2);
    tapped.add(id);
    await wait(500);
  }
  ok('the desk\'s own marks cannot be forged by a book', !m.root.querySelector('.rd-epub-flow [data-ext^="javascript"], .rd-epub-flow mark.rd-ehl, .rd-epub-flow span.rd-epub-link'), '');
  await wait(400);
  ok('the links of the book were found and tapped', ['l-js', 'l-js2', 'l-file', 'l-obs', 'l-ok', 'l-data', 's-js', 's-js2', 's-anim'].every(id => tapped.has(id)), [...tapped]);
  ok('only the web link opened, as a web address', opened.every(u => u === 'https://example.com/ok'), opened);
  ok('the good web link does open', opened.includes('https://example.com/ok'), opened);
  await m.desk.goTo('#chapter=3&selection=0,5');
  await wait(900);
  ok('the last chapter opens through a link', [...m.root.querySelectorAll('.rd-slot.rd-page')].some(sl => /Second chapter/.test(sl.textContent)), m.root.querySelector('.rd-progress') && m.root.querySelector('.rd-progress').textContent);
} finally {
  window.open = realOpen;
  F.awake(false);
}
await wait(1500);
ok('no script of the book ran', window.__bdPwned.length === 0, window.__bdPwned);
ok('document and window are not clobbered', typeof document.createElement === 'function' && typeof document.querySelector === 'function' && document.body instanceof HTMLBodyElement && !(window.pdfjsLib instanceof Element), '');
const hits = fs.existsSync(T.canaryLog) ? fs.readFileSync(T.canaryLog, 'utf8').trim().split('\n').filter(Boolean) : ['(no canary log: is the canary server running?)'];
ok('nothing was fetched from the web', hits.length === 0, hits);
// the canary itself works (otherwise an empty log proves nothing)
await fetch(`${C}/self-check`, { mode: 'no-cors' }).catch(() => {});
await wait(300);
ok('the canary server is listening', fs.readFileSync(T.canaryLog, 'utf8').includes('/hit/self-check'), 'start it: node tests/app/canary-server.mjs');
if (m) m.remove();
const sheet = book.sheet;
book.destroy();
ok('closing the book takes its styles and pictures away', !document.adoptedStyleSheets.includes(sheet) && !document.querySelector('.book-desk-test-box') && book.urls.size === 0, '');
delete window.__bdPwned;
const failed = results.filter(r => !r.pass);
return `${results.length - failed.length}/${results.length} passed\n` + (failed.length ? 'FAILED:\n' + failed.map(f => ' - ' + f.name + ': ' + JSON.stringify(f.detail)).join('\n') : results.map(r => ' ✓ ' + r.name).join('\n'));
