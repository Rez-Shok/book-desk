# Contributing to Book Desk

Thank you for helping. Reports, ideas and code are all welcome.

- **Something does not work:** open an [issue](https://github.com/Rez-Shok/book-desk/issues/new/choose). The form
  asks for what helps most: the version, the device, the kind of book, and how to make it happen again.
- **A question or an idea to talk over:** [Discussions](https://github.com/Rez-Shok/book-desk/discussions).
- **A security problem:** please do not open an issue; see [SECURITY.md](SECURITY.md).

## Working on the code

```sh
npm install
npm run dev     # rebuilds main.js on every change
npm run build   # the release build
npm run lint    # the rules of Obsidian's own plugin review (eslint-plugin-obsidianmd), with type information
npm test        # unit tests (Node's own test runner)
```

To try the plugin, copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/book-desk/` of a test
vault (or set `BOOK_DESK_VAULT` and run `./build.sh`), then turn the plugin off and on in Obsidian.

### Tests inside Obsidian

Much of the desk can only be checked in Obsidian itself: pages drawn by pdf.js, an EPUB set in columns, real pointer
events, the vault. `tests/app/` holds those tests; [tests/app/README.md](tests/app/README.md) says how to run them.
Run the ones that touch your change, and use a vault you are not working in: the tests make and remove files of
their own, and `popout.js` can open a window of its own (only with `BOOK_DESK_REAL_WINDOW=1`).

### How the code is laid out

| File | What it does |
| --- | --- |
| `src/main.js` | The plugin: commands, the desk files, the book's note, highlights as links |
| `src/view.js` | The view that opens a `.desk` file (or a book) and puts a desk in it |
| `src/desk.js` | The desk itself: pages, tools, notes, search; it knows nothing of the vault |
| `src/desk-state.js` | What a `.desk` file may hold, checked before it is used |
| `src/pdf-text.js`, `src/pdf-highlights.js` | A PDF page's text in reading order; highlight links and their geometry |
| `src/epub*.js`, `src/zip.js` | Opening an EPUB safely: its chapters, styles and fonts |

## Rules the code keeps

- **Books are untrusted.** An EPUB is web pages written by someone else. Nothing in it may run, load anything from
  the web, or reach outside its own page; read `src/epub-clean.js` and `src/epub-css.js` before changing how a
  chapter is shown, and keep `tests/app/security.js` passing.
- **No network.** The plugin never connects to anything.
- **No `innerHTML`.** Build elements with Obsidian's `createEl` / `createDiv`, and never build a selector from data.
- **Text from a book written into a note** goes through `escapeMarkdownText`, so it stays plain text there.
- **The `.desk` format** is read by every later version: add fields, never change what an existing one means, and
  check every new field in `src/desk-state.js`.
- **The interface is in English**, in sentence case, as Obsidian's own.

## Releasing (maintainers)

```sh
npm version 1.2.3 --no-git-tag-version    # package.json, manifest.json, manifest-beta.json, versions.json
git commit -am "1.2.3: what changed"
git tag -a 1.2.3 -m "What changed, for the release notes"
git push && git push origin 1.2.3
```

The tag starts [the release workflow](.github/workflows/release.yml): it builds the plugin, signs the files and
publishes the release. A pre-release for testers (`1.2.3-beta.1`) goes the same way; `npm version` then changes
only `manifest-beta.json`, which [BRAT](https://github.com/TfTHacker/obsidian42-brat) reads.
