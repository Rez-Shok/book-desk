import { TFile } from 'obsidian';

export const VIEW_TYPE = 'book-desk';
export const BOOK_EXT = new Set(['pdf', 'epub']);
/** @returns {file is TFile} */
export const isBook = file => file instanceof TFile && BOOK_EXT.has(file.extension);
// the path of the book a desk file belongs to (desks made before EPUBs called the book "pdf")
export const deskBook = st => (st && typeof (st.book || st.pdf) === 'string' ? (st.book || st.pdf) : null);
