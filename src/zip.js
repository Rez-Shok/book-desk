/* Reading a zip file (an EPUB is one) without any outside library: the directory is read by hand and the browser's
   own DecompressionStream inflates the entries. Nothing is ever written anywhere: an entry's name is only a key.
   A zip is a classic way to hide a "bomb" (a few kilobytes that unfold into gigabytes), so the reader keeps count
   of what it unfolds and stops at a limit. */

const MAX_ENTRY = 160 * 1024 * 1024;    // one file of the book, unfolded
const MAX_TOTAL = 1024 * 1024 * 1024;   // everything the reader unfolds from one book

export class ZipError extends Error {}
const damaged = () => new ZipError('This book file is damaged, or is not an EPUB.');

/**
 * The zip's directory.
 * @param {Uint8Array} bytes the whole file
 */
export function unzipIndex(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) throw damaged();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;   // the "end of central directory" record
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw damaged();
  const count = dv.getUint16(eocd + 10, true), entries = new Map(), dec = new TextDecoder();
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new ZipError('This EPUB is too large for the desk (a "zip64" file).');
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw damaged();
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    if (p + 46 + nlen > bytes.length) throw damaged();
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (!entries.has(name)) {
      entries.set(name, {
        encrypted: (dv.getUint16(p + 8, true) & 1) === 1, method: dv.getUint16(p + 10, true),
        csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), loc: dv.getUint32(p + 42, true)
      });
    }
    p += 46 + nlen + xlen + clen;
  }
  return { bytes, dv, entries, unfolded: 0 };
}

async function inflate(data, limit) {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('This device cannot open EPUB books: it needs iOS 16.4 or later.');
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    let step;
    try { step = await reader.read(); } catch { throw damaged(); }
    if (step.done) break;
    size += step.value.length;
    if (size > limit) { void reader.cancel().catch(() => {}); throw new ZipError('This EPUB unfolds into far more data than a book holds. It was not opened.'); }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * One file of the zip, unfolded; null when the zip has no such file.
 * @param {ReturnType<typeof unzipIndex>} zip
 * @param {string} name
 * @returns {Promise<Uint8Array | null>}
 */
export async function unzipFile(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  if (e.encrypted) throw new ZipError('This EPUB is locked with a password.');
  const { bytes, dv } = zip;
  if (e.loc + 30 > bytes.length || dv.getUint32(e.loc, true) !== 0x04034b50) throw damaged();
  const start = e.loc + 30 + dv.getUint16(e.loc + 26, true) + dv.getUint16(e.loc + 28, true);
  if (start + e.csize > bytes.length) throw damaged();
  const data = bytes.subarray(start, start + e.csize);
  const room = Math.min(MAX_ENTRY, MAX_TOTAL - zip.unfolded);
  let out;
  if (e.method === 0) {
    if (data.length > room) throw new ZipError('This EPUB is too large for the desk.');
    out = data.slice();
  } else if (e.method === 8) out = await inflate(data, room);
  else throw new ZipError('This EPUB uses a kind of compression the desk cannot read.');
  zip.unfolded += out.length;
  return out;
}

/**
 * A link inside the book, seen from the file it appears in, as a path in the zip.
 * @param {string} fromFile
 * @param {unknown} href
 */
export function zipPath(fromFile, href) {
  const clean = String(href == null ? '' : href).split('#')[0].split('?')[0];
  if (!clean) return fromFile;
  let parts = fromFile.split('/');
  parts.pop();
  if (clean.startsWith('/')) parts = [];
  for (const seg of clean.split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  const out = parts.join('/');
  try { return decodeURIComponent(out); } catch { return out; }
}
