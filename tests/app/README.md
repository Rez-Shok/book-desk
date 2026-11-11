# Tests that run inside Obsidian

The unit tests in `tests/*.test.mjs` cover the parts that are plain logic. What needs a real browser and a real vault
is tested here, inside a running Obsidian on macOS.

## Before you start

1. In Obsidian, switch on the command line: **Settings → General → Advanced**.
2. Start the canary server, a tiny web server that writes down every request it gets:

   ```sh
   node tests/app/canary-server.mjs 47831 "${TMPDIR:-/tmp}/book-desk-test/canary.log"
   ```

3. For `plugin.js` and `popout.js`, install and enable the plugin in the vault that is open.

## Run

```sh
tests/app/run.sh tests/app/security.js   # a hostile EPUB: nothing runs, nothing is fetched, nothing leaves the page
tests/app/run.sh tests/app/books.js      # damaged, locked and "zip bomb" books are refused; plain and Persian books work
tests/app/run.sh tests/app/tools.js      # pen, eraser, sticky notes, cards, with a real pointer
tests/app/run.sh tests/app/plugin.js     # the plugin in the vault: desk files, highlights in a note, renames, settings
tests/app/run.sh tests/app/popout.js     # a desk moved to a window of its own
```

Each prints its checks and how many passed. `plugin.js` and `popout.js` work in a folder of their own in the vault and
move it to the trash when they are done; the plugin's settings are changed in memory only and put back.

The first three mount a desk over Obsidian's window for a few seconds, without touching the vault.
