import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeExternalUrl, escapeMarkdownText, plainLinkText, cssString } from '../src/util.js';

test('only web and mail addresses from a book are opened', () => {
  assert.equal(safeExternalUrl('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(safeExternalUrl('  http://example.com'), 'http://example.com/');
  assert.equal(safeExternalUrl('mailto:a@b.co'), 'mailto:a@b.co');
  assert.equal(safeExternalUrl('h\nttps://example.com'), 'https://example.com/');
  for (const bad of ['javascript:alert(1)', 'java\tscript:alert(1)', 'JaVaScRiPt:alert(1)', '\u0001javascript:alert(1)', ' javascript:alert(1)',
    'vbscript:x', 'file:///etc/passwd', 'obsidian://open?vault=x', 'smb://host/share', 'data:text/html,<script>1</script>',
    'blob:https://x/y', '//evil.com/x', 'ms-msdt:/id', 'tel:123', 'ftp://x/y', '', 'not a url', 'https://', 'a'.repeat(3000)]) {
    assert.equal(safeExternalUrl(bad), null, bad);
  }
  for (const bad of [undefined, null, 5, {}, ['https://x.y']]) assert.equal(safeExternalUrl(bad), null);
});

test('ordinary quotes are written as they are', () => {
  for (const s of ['It cost $5 in 1919 [see p. 4].', 'Smith (1776) and the "invisible hand" — 50% of it.', 'کتاب‌های «ثروت ملل» [۱] را خواند.',
    'A & B, C# and #1 of 3 * 4 = 12; a < b > c', 'e-mail: a_b@c.org, 3*4, x_y_z']) {
    assert.equal(escapeMarkdownText(s), s);
  }
});

test('text from a book cannot come alive in a note', () => {
  const e = escapeMarkdownText;
  assert.equal(e('![[secret note]]'), '!\\[\\[secret note]]');
  assert.equal(e('see [[other note|x]] here'), 'see \\[\\[other note|x]] here');
  assert.equal(e('a ![](http://t.co/p.png) b'), 'a !\\[](http://t.co/p.png) b');
  assert.equal(e('click [here](obsidian://x)'), 'click \\[here](obsidian://x)');
  assert.equal(e('[foo]: http://evil'), '\\[foo]: http://evil');
  assert.equal(e('[a][b] ref'), '\\[a]\\[b] ref');
  assert.equal(e('x[^1]'), 'x\\[^1]');
  assert.equal(e('<iframe src=x>'), '\\<iframe src=x>');
  // Templater reads raw text: no "<%" or "%>" may be left in the note
  assert.equal(e('<% tp.file.title %>'), '<\\% tp.file.title %\\>');
  for (const s of ['<%* evil() %>', '<%- x -%>', '<%%>', 'a <%_ tp.user.x() _%> b', '%%<%*x%>%%']) assert.ok(!/<%|%>/.test(e(s)), e(s));
  assert.equal(e('</div><script>'), '\\</div>\\<script>');
  assert.equal(e('<http://autolink>'), '\\<http://autolink>');
  assert.equal(e('`$= dv.current()`'), '\\`$= dv.current()\\`');
  assert.equal(e('```dataviewjs'), '\\`\\`\\`dataviewjs');
  assert.equal(e('from $5 to $10'), 'from \\$5 to \\$10');
  assert.equal(e('$$x$$'), '\\$\\$x\\$\\$');
  assert.equal(e('a %%hidden'), 'a \\%\\%hidden');
  assert.equal(e('a #tag b'), 'a \\#tag b');
  assert.equal(e('&lt;b&gt; &#60;'), '\\&lt;b\\&gt; \\&#60;');
  assert.equal(e('back\\slash \\[x'), 'back\\\\slash \\\\[x');
});

test('a quote cannot become a heading, a list, a rule or a code block', () => {
  const e = escapeMarkdownText;
  assert.equal(e('# Heading'), '\\# Heading');
  assert.equal(e('- [ ] task'), '\\- [ ] task');
  assert.equal(e('* * *'), '\\* * *');
  assert.equal(e('> nested'), '\\> nested');
  assert.equal(e('1. one'), '1\\. one');
  assert.equal(e('12) twelve'), '12\\) twelve');
  assert.equal(e('~~~js'), '\\~~~js');
  assert.equal(e('| a | b |'), '\\| a | b |');
  assert.equal(e('=== x'), '\\=== x');
});

test('a quote is always one clean line', () => {
  assert.equal(escapeMarkdownText('a\u0000b\u001bc\n\n# d\u2028e\tf'), 'abc # d e f');
  assert.equal(escapeMarkdownText('  spaced   out  '), 'spaced out');
  assert.equal(escapeMarkdownText(null), '');
  assert.equal(escapeMarkdownText(undefined), '');
  assert.ok(!/\n/.test(escapeMarkdownText('a\r\nb\u0085c')));
});

test('a section title is safe as the text of a link', () => {
  assert.equal(plainLinkText('Chapter ]] | <b>x</b> `q` [1]'), 'Chapter b x /b q 1');
  assert.equal(plainLinkText('I.\nThe  Problem'), 'I. The Problem');
  assert.equal(plainLinkText('x'.repeat(500)).length, 120);
  assert.equal(plainLinkText(null), '');
});

test('css strings are quoted whole', () => {
  assert.equal(cssString('Foo Bar'), '"Foo Bar"');
  assert.equal(cssString('a"b\\c\nd'), '"a\\22 b\\5c c\\a d"');
});
