#!/bin/zsh
# Builds main.js from src/ and installs the plugin into a vault, to try it out:
#   BOOK_DESK_VAULT="/path/to/your vault" ./build.sh
set -e
cd "${0:A:h}"
: "${BOOK_DESK_VAULT:?Set BOOK_DESK_VAULT to the folder of the vault to install into}"
npm run --silent build
node --check main.js
DEST="$BOOK_DESK_VAULT/.obsidian/plugins/book-desk"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"
echo "installed → $DEST"
