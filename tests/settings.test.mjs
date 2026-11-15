import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, DEFAULT_SETTINGS } from '../src/settings-data.js';

const norm = p => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

test('settings the plugin wrote are read as they are', () => {
  const mine = { helpSeen: true, dataFolder: 'Notes/System/Desks', notesFolder: 'Notes/Books', followPage: true,
    highlightTarget: 'note', highlightHeading: 'Quotes', paper: 'sepia', epubTextSize: 18 };
  assert.deepEqual(readSettings(mine, norm), mine);
});

test('a setting this version no longer has is left out', () => {
  assert.equal('standInMarker' in readSettings({ standInMarker: 'ARCHIVE-STUB' }, norm), false);
});

test('a new install gets the defaults', () => {
  assert.deepEqual(readSettings(null, norm), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(undefined, norm), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings('x', norm), DEFAULT_SETTINGS);
});

test('a settings file edited by hand cannot break the plugin', () => {
  const s = readSettings({ dataFolder: '//a//b/', notesFolder: 5, followPage: 'yes', highlightTarget: 'x',
    highlightHeading: '## My\nQuotes', paper: 'url(x)', epubTextSize: '900', standInMarker: 7, helpSeen: 'yes', extra: 1 }, norm);
  assert.deepEqual(s, { helpSeen: false, dataFolder: 'a/b', notesFolder: '5', followPage: false, highlightTarget: 'note',
    highlightHeading: 'My Quotes', paper: 'paper', epubTextSize: 30 });
  assert.equal(readSettings({ dataFolder: '   ' }, norm).dataFolder, DEFAULT_SETTINGS.dataFolder);
  assert.equal(readSettings({ epubTextSize: 'big' }, norm).epubTextSize, 16);
});

test('the page switch: off for a new install, on for settings from before it that named a page property', () => {
  assert.equal(readSettings({}, norm).followPage, false);
  assert.equal(readSettings({ pageProperty: 'current_page' }, norm).followPage, true);
  assert.equal(readSettings({ pageProperty: '' }, norm).followPage, false);
  assert.equal(readSettings({ followPage: false, pageProperty: 'page' }, norm).followPage, false);
  // the property names are fixed now: the old settings for them are left out
  const old = readSettings({ pageProperty: 'page', totalPagesProperty: 'pages' }, norm);
  assert.equal('pageProperty' in old || 'totalPagesProperty' in old, false);
});
