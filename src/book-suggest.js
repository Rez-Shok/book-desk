import { FuzzySuggestModal } from 'obsidian';
import { isBook } from './constants.js';

/** A picker of the vault's books (PDF and EPUB files). */
export class BookSuggest extends FuzzySuggestModal {
  constructor(app, onPick) { super(app); this.onPick = onPick; this.setPlaceholder('Which book?'); }
  getItems() { return this.app.vault.getFiles().filter(isBook); }
  getItemText(f) { return f.basename; }
  onChooseItem(f) { this.onPick(f); }
}
