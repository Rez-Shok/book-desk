import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, DEFAULT_SETTINGS } from '../src/settings-data.js';

const norm = p => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');

test('settings the plugin wrote are read as they are', () => {
  const mine = { helpSeen: true, dataFolder: 'Notes/System/Desks', notesFolder: 'Notes/Books', followPage: true, pageProperty: 'current_page', totalPagesProperty: 'total_pages',
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
  const s = readSettings({ dataFolder: '//a//b/', notesFolder: 5, pageProperty: '__proto__', totalPagesProperty: 'a: b', highlightTarget: 'x',
    highlightHeading: '## My\nQuotes', paper: 'url(x)', epubTextSize: '900', standInMarker: 7, helpSeen: 'yes', extra: 1 }, norm);
  assert.deepEqual(s, { helpSeen: false, dataFolder: 'a/b', notesFolder: '5', followPage: false, pageProperty: 'current_page', totalPagesProperty: '', highlightTarget: 'note',
    highlightHeading: 'My Quotes', paper: 'paper', epubTextSize: 30 });
  assert.equal(readSettings({ dataFolder: '   ' }, norm).dataFolder, DEFAULT_SETTINGS.dataFolder);
  assert.equal(readSettings({ epubTextSize: 'big' }, norm).epubTextSize, 16);
  assert.equal(readSettings({ pageProperty: 'page [x]' }, norm).pageProperty, 'current_page');
  assert.equal(readSettings({ pageProperty: 'صفحه فعلی' }, norm).pageProperty, 'صفحه فعلی');
});

test('the page switch: off for a new install, on for settings from before it that named a page property', () => {
  assert.equal(readSettings({}, norm).followPage, false);
  assert.equal(readSettings({ pageProperty: 'current_page' }, norm).followPage, true);
  assert.equal(readSettings({ pageProperty: '' }, norm).followPage, false);
  assert.equal(readSettings({ followPage: false, pageProperty: 'page' }, norm).followPage, false);
  const off = readSettings({ pageProperty: '', totalPagesProperty: '' }, norm);
  assert.equal(off.pageProperty, 'current_page');   // ready for when the switch is turned on
  assert.equal(off.totalPagesProperty, '');         // a count that was left out stays out
});
