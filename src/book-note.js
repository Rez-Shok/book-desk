/* When a book has no note yet, the first highlight asks where its highlights should go. */

import { Modal, FuzzySuggestModal } from 'obsidian';

/**
 * Asks once: make a note for the book, choose one, or only copy the highlight.
 * `done` gets 'create', 'choose', 'copy', or null when the question is closed without an answer.
 */
export class BookNoteModal extends Modal {
  constructor(app, book, done) {
    super(app);
    this.book = book;
    this.done = done;
    this.answered = false;
  }
  onOpen() {
    this.setTitle('Where should the highlights go?');
    const el = this.contentEl;
    el.createEl('p', { text: `Highlights are kept as links in a note, with the words they mark. “${this.book.basename}” has no note yet.` });
    el.createEl('p', { cls: 'setting-item-description', text: 'A note is this book’s note when one of its properties links to the book. To never be asked, set “New highlights” to “Only copy them” in the settings.' });
    const row = el.createDiv({ cls: 'modal-button-container' });
    const answer = (text, value, cta) => {
      const b = row.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
      b.addEventListener('click', () => { this.answer(value); });
      return b;
    };
    answer('Make a note', 'create', true);
    answer('Choose a note…', 'choose');
    answer('Only copy it', 'copy');
  }
  answer(value) {
    if (this.answered) return;
    this.answered = true;
    this.close();
    this.done(value);
  }
  onClose() {
    this.contentEl.empty();
    if (!this.answered) { this.answered = true; this.done(null); }
  }
}

/** A picker of the vault's notes; the ones that already link to the book come first. `done` gets the note or null. */
export class NoteSuggest extends FuzzySuggestModal {
  constructor(app, first, done) {
    super(app);
    this.first = first;
    this.done = done;
    this.chosen = false;
    this.setPlaceholder('Which note keeps this book’s highlights?');
  }
  getItems() {
    const first = new Set(this.first);
    return [...this.first, ...this.app.vault.getMarkdownFiles().filter(f => !first.has(f))];
  }
  getItemText(f) { return f.path.replace(/\.md$/i, ''); }
  onChooseItem(f) { this.chosen = true; this.done(f); }
  onClose() {
    super.onClose();
    // the choice is reported after the picker closes
    window.setTimeout(() => { if (!this.chosen) { this.chosen = true; this.done(null); } }, 0);
  }
}
