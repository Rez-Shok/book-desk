import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTop, splitDeclarations, mapCssUrls, cssUnescape, scopeFontFamilies, sanitizeDeclarations, fontFaceRule, scopeSelectorList, resolveBookUrl } from '../src/epub-css.js';

const CH = '.rd-epub-abc > .rd-epub-chapter';
const inBook = new Map([['OEBPS/img/a.png', 'blob:app/a'], ['OEBPS/fonts/f.woff', 'blob:app/f']]);
const resolve = u => resolveBookUrl(u, p => inBook.get('OEBPS/' + p.replace(/^\.\.\//, '')));
const clean = (css, extra) => sanitizeDeclarations(css, Object.assign({ resolve, scope: 'rd-epub-abc' }, extra));

test('css text is cut only where it really ends', () => {
  assert.deepEqual(splitTop('a, b(c, d), "e, f", [g, h], i\\,j', ','), ['a', ' b(c, d)', ' "e, f"', ' [g, h]', ' i\\,j']);
  assert.deepEqual(splitDeclarations('color: red; background: url("data:image/png;base64,AA;BB"); content: "a; b"; --X: 1'),
    [{ name: 'color', value: 'red' }, { name: 'background', value: 'url("data:image/png;base64,AA;BB")' }, { name: 'content', value: '"a; b"' }, { name: '--X', value: '1' }]);
  assert.equal(cssUnescape('u\\72 l\\28 x\\)'), 'url(x)');
});

test('url() is found however it is written, and never inside a string', () => {
  const seen = [];
  const out = mapCssUrls('url(a.png) URL( "b c.png" ) url(\'d\\29 .png\') "url(no)" my-url(x) url(e', u => { seen.push(u); return 'X'; });
  assert.deepEqual(seen, ['a.png', 'b c.png', 'd).png', 'e']);
  assert.equal(out, 'X X X "url(no)" my-url(x) X');
});

test('only what is inside the book can be addressed', () => {
  assert.equal(resolve('img/a.png'), 'blob:app/a');
  assert.equal(resolve('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(resolve('data:font/woff2;base64,AAAA'), 'data:font/woff2;base64,AAAA');
  for (const bad of ['http://evil/x.png', 'https://evil/x.png', '//evil/x.png', 'file:///etc/passwd', 'data:text/html,<b>', 'data:image/svg+xml-evil,x',
    'blob:app/zzz', 'javascript:1', '#local', '', 'img/missing.png', 'app://obsidian.md/x.png']) assert.equal(resolve(bad), null, bad);
});

test('declarations: nothing is fetched from outside the book', () => {
  assert.equal(clean('background-image: url("http://evil/t.png")'), 'background-image: none');
  assert.equal(clean('background: url("img/a.png") no-repeat'), 'background: url("blob:app/a") no-repeat');
  assert.equal(clean('list-style: url(//evil/x) inside'), 'list-style: none inside');
  assert.equal(clean('background-image: image-set("http://evil/x.png" 1x)'), '');
  assert.equal(clean('background-image: -webkit-image-set(url("img/a.png") 1x)'), '');
  assert.equal(clean('--x: u\\72l(http://evil)'), '');
  assert.equal(clean('background: var(--a) u\\72l(http://evil)'), '');
  assert.equal(clean('--x: url(http://evil/y)'), '--x: none');
  assert.equal(clean('content: "url(http://not-a-url)"'), 'content: "url(http://not-a-url)"');
  assert.equal(clean('content: "back\\\\slash is fine in a string"'), 'content: "back\\\\slash is fine in a string"');
  assert.equal(clean('width: expression(alert(1))'), '');
});

test('declarations: nothing leaves the page or takes over the pointer', () => {
  assert.equal(clean('position: fixed; top: 0px'), 'position: static; top: 0px');
  assert.equal(clean('position: absolute !important'), 'position: static !important');
  assert.equal(clean('position: sticky'), 'position: static');
  assert.equal(clean('position: relative'), 'position: relative');
  assert.equal(clean('position: var(--p)'), 'position: static');
  assert.equal(clean('columns: 2; column-span: all; overflow: scroll; overflow-x: auto; overflow-wrap: anywhere'), 'overflow-wrap: anywhere');
  assert.equal(clean('user-select: none; -webkit-user-select: none; pointer-events: none; cursor: none; -webkit-app-region: drag; -webkit-user-modify: read-write; touch-action: auto'), '');
  assert.equal(clean('--x: } * { display: none'), '');
  assert.equal(clean('color: red; --y: { a: b }'), 'color: red');
});

test('declarations: page breaks become column breaks', () => {
  assert.equal(clean('break-before: page'), 'break-before: column');
  assert.equal(clean('page-break-before: always'), 'break-before: column');
  assert.equal(clean('break-after: page !important'), 'break-after: auto !important');
  assert.equal(clean('page-break-after: avoid'), 'page-break-after: avoid');
  assert.equal(clean('break-inside: avoid'), 'break-inside: avoid');
});

test('declarations: the chapter itself keeps its type but not its box', () => {
  assert.equal(clean('margin: 2em; padding-left: 1em; width: 600px; max-width: 30em; background-color: black; color: red; font-size: 1.1em', { root: true }), 'color: red; font-size: 1.1em');
});

test('the book\'s fonts get names of their own', () => {
  assert.equal(scopeFontFamilies('"Vazir", Georgia, serif', 's'), '"s Vazir", "Vazir", "s Georgia", "Georgia", serif');
  assert.equal(scopeFontFamilies("'My Font' , sans-serif !important", 's'), '"s My Font", "My Font", sans-serif !important');
  assert.equal(scopeFontFamilies('inherit', 's'), 'inherit');
  assert.equal(scopeFontFamilies('var(--f), Inter', 's'), 'var(--f), "s Inter", "Inter"');
  assert.equal(clean('font-family: Inter'), 'font-family: "rd-epub-abc Inter", "Inter"');
  assert.equal(clean('font: italic 12px "Foo", serif', { fontFamilyOf: () => '"Foo", serif' }), 'font: italic 12px "Foo", serif; font-family: "rd-epub-abc Foo", "Foo", serif');
  const ff = fontFaceRule('font-family: "Inter"; src: url("fonts/f.woff") format("woff"), url("http://evil/f.woff"), local("Arial"); font-weight: 700; color: red', { resolve, scope: 's' });
  assert.equal(ff, '@font-face { font-family: "s Inter"; src: url("blob:app/f") format("woff"), local("Arial"); font-weight: 700 }');
  assert.equal(fontFaceRule('font-family: X; src: url("http://evil/f.woff")', { resolve, scope: 's' }), null);
  assert.equal(fontFaceRule('src: url("fonts/f.woff")', { resolve, scope: 's' }), null);
});

test('every selector reaches only into the book', () => {
  const s = t => scopeSelectorList(t, CH);
  assert.deepEqual(s('p, h1 > span'), { roots: [], others: [`${CH} p`, `${CH} h1 > span`] });
  assert.deepEqual(s('body'), { roots: [CH], others: [] });
  assert.deepEqual(s('html'), { roots: [CH], others: [] });
  assert.deepEqual(s(':root'), { roots: [CH], others: [] });
  assert.deepEqual(s('html body.x'), { roots: [`${CH}.x`], others: [] });
  assert.deepEqual(s('html > body p'), { roots: [], others: [`${CH} p`] });
  assert.deepEqual(s('body.dark > p, html.x p, html[lang] > body'), { roots: [CH], others: [`${CH}.dark > p`, `${CH} p`] });
  assert.deepEqual(s('bodybuilder, htmlish'), { roots: [], others: [`${CH} bodybuilder`, `${CH} htmlish`] });
  assert.deepEqual(s('*'), { roots: [], others: [`${CH} *`] });
  assert.deepEqual(s('#ch1 p, a#x.y, :not(#z)'), { roots: [], others: [`${CH} [data-epub-id="ch1"] p`, `${CH} a[data-epub-id="x"].y`, `${CH} :not([data-epub-id="z"])`] });
  // commas and hashes inside strings, brackets and :is() are not cut or rewritten
  assert.deepEqual(s('a[title="x, #y"], :is(h1, h2) b'), { roots: [], others: [`${CH} a[title="x, #y"]`, `${CH} :is(h1, h2) b`] });
  assert.deepEqual(s('a[href=#frag]'), { roots: [], others: [`${CH} a[href=#frag]`] });
  // an attempt to close the rule from inside a selector stays inside its string
  assert.deepEqual(s('a[title="} * { display: none } x{"]'), { roots: [], others: [`${CH} a[title="} * { display: none } x{"]`] });
  assert.deepEqual(s('#a\\.b'), { roots: [], others: [`${CH} [data-epub-id="a.b"]`] });
});
