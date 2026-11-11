import { PluginSettingTab, Notice, normalizePath } from 'obsidian';
import { DEFAULT_SETTINGS, readSettings, propertyName } from './settings-data.js';

const badProperty = v => (String(v || '').trim() && !propertyName(v) ? 'A property name cannot contain : [ ] { } # , quotes or a backslash.' : undefined);

export class DeskSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  getSettingDefinitions() {
    return [
      {
        name: 'Desk folder',
        desc: 'Each book gets a .desk file here: the page you are on, pen marks, sticky notes, cards and where you were looking. Drag a .desk file onto an Excalidraw drawing to read the book there. Existing desks are not moved when you change this.',
        control: { type: 'folder', key: 'dataFolder', placeholder: DEFAULT_SETTINGS.dataFolder, defaultValue: DEFAULT_SETTINGS.dataFolder }
      },
      {
        name: 'Book notes folder',
        desc: 'A book’s note is a note in this folder that links to the PDF or EPUB. Leave empty to use any note that links to it.',
        control: { type: 'folder', key: 'notesFolder', placeholder: 'Any folder' }
      },
      {
        name: 'Current page property',
        desc: 'A property of the book’s note that follows the page you are on, for example current_page. Leave empty to leave the note alone.',
        control: { type: 'text', key: 'pageProperty', placeholder: 'Off', validate: badProperty }
      },
      {
        name: 'Total pages property',
        desc: 'Filled with the page count when it is empty, for example total_pages.',
        control: { type: 'text', key: 'totalPagesProperty', placeholder: 'Off', validate: badProperty }
      },
      {
        name: 'New highlights',
        desc: 'A highlight is a link in a note, in the format PDF++ uses, so PDF++ shows it too and the book file never changes. An EPUB’s highlights are links of the same kind, to a chapter and a place in its text.',
        control: { type: 'dropdown', key: 'highlightTarget', defaultValue: 'note', options: { note: 'Add them to the book’s note', clipboard: 'Only copy them' } }
      },
      {
        name: 'Highlights heading',
        desc: 'The section of the book’s note that new highlights go under. It is added if the note has none.',
        control: { type: 'text', key: 'highlightHeading', placeholder: DEFAULT_SETTINGS.highlightHeading, defaultValue: DEFAULT_SETTINGS.highlightHeading }
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
      },
      {
        type: 'group',
        heading: 'Advanced',
        items: [{
          name: 'Stand-in marker',
          desc: 'For libraries that keep large books outside the vault and leave a small stand-in file in their place. When a book file is small and contains this text, the desk offers to open the file itself instead of showing the stand-in as a book. Leave empty if you do not use stand-ins.',
          control: { type: 'text', key: 'standInMarker', placeholder: 'Off' }
        }]
      }
    ];
  }

  // every value is brought into shape before it is kept (a folder path cleaned, a property name checked…)
  async setControlValue(key, value) {
    this.plugin.settings = readSettings({ ...this.plugin.settings, [key]: value }, normalizePath);
    await this.plugin.saveSettings();
  }
}
