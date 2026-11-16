import { PluginSettingTab, Notice, normalizePath } from 'obsidian';
import { DEFAULT_SETTINGS, readSettings } from './settings-data.js';

export class DeskSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  getSettingDefinitions() {
    return [
      {
        name: 'Desk folder',
        desc: 'Each book gets a .desk file here: the page you are on, pen marks, sticky notes, cards and where you were looking. Existing desks are not moved when you change this, and are still found. With Obsidian Sync, turn on “Sync all other types” so desks reach your other devices.' + (window.ExcalidrawAutomate ? ' Drag a .desk file onto an Excalidraw drawing to read the book there.' : ''),
        control: { type: 'folder', key: 'dataFolder', placeholder: DEFAULT_SETTINGS.dataFolder, defaultValue: DEFAULT_SETTINGS.dataFolder }
      },
      {
        name: 'Book notes folder',
        desc: 'A book’s note holds its highlights. It is a note whose properties link to the book, or any note in this folder that links to it. When a book has none, its first highlight offers to make one, here. Leave empty to make new notes where Obsidian puts new notes.',
        control: { type: 'folder', key: 'notesFolder', placeholder: 'Where new notes go' }
      },
      {
        type: 'group',
        heading: 'Highlights',
        items: [
          {
            name: 'New highlights',
            desc: 'A highlight is a link in a note, in the format PDF++ uses, so PDF++ shows it too and the book file never changes. An EPUB’s highlights are links of the same kind, to a chapter and a place in its text.',
            control: { type: 'dropdown', key: 'highlightTarget', defaultValue: 'note', options: { note: 'Add them to the book’s note', clipboard: 'Only copy them (they stay on the desk)' } }
          },
          {
            name: 'Highlights heading',
            desc: 'The section of the book’s note that new highlights go under. It is added if the note has none.',
            control: { type: 'text', key: 'highlightHeading', placeholder: DEFAULT_SETTINGS.highlightHeading, defaultValue: DEFAULT_SETTINGS.highlightHeading }
          }
        ]
      },
      {
        name: 'Desk guide',
        desc: 'Show the guide card on the desk again.',
        render: setting => {
          setting.addButton(b => b.setButtonText('Show it again').onClick(async () => {
            this.plugin.settings.helpSeen = false;
            await this.plugin.saveSettings();
            new Notice('The guide will be on the desk next time you open a book.');
          }));
        }
      }
    ];
  }

  // every value is brought into shape before it is kept (a folder path cleaned, a property name checked…)
  async setControlValue(key, value) {
    this.plugin.settings = readSettings({ ...this.plugin.settings, [key]: value }, normalizePath);
    await this.plugin.saveSettings();
  }
}
