#!/bin/zsh
# Runs one of the in-app test scripts inside the running Obsidian (its command line must be switched on:
# Settings → General → Advanced). The script is the body of an async function; what it returns is printed.
#   tests/app/run.sh tests/app/security.js
set -e
zmodload zsh/zselect
HERE="${0:A:h}"; ROOT="${HERE:h:h}"; OUT="${TMPDIR:-/tmp}/book-desk-test"; PORT="${BOOK_DESK_CANARY_PORT:-47831}"
OUT="${OUT:A}"
mkdir -p "$OUT"
"$ROOT/node_modules/.bin/esbuild" "$HERE/harness-entry.js" --bundle --external:obsidian --format=cjs --target=es2020 --outfile="$OUT/harness.js" --log-level=warning
SCRIPT="${1:A}"
obs() { (cd /tmp && /Applications/Obsidian.app/Contents/MacOS/Obsidian eval code="$1" 2>&1 | grep -v -i "installer" || true) }
# the test runs on inside the app; this script asks for its result until it is there
obs "(()=>{const fs=require('fs');window.__bookDeskTest={harness:'$OUT/harness.js',fixtures:'$HERE/fixtures.js',canaryLog:'$OUT/canary.log',canaryPort:$PORT,styles:'$ROOT/styles.css',root:'$ROOT'};window.__bookDeskResult=undefined;(new Function('return (async()=>{'+fs.readFileSync('$SCRIPT','utf8')+'\n})()'))().then(r=>{window.__bookDeskResult=typeof r==='string'?r:JSON.stringify(r,null,1)},e=>{window.__bookDeskResult='THREW '+(e&&e.stack||e)});return 'started'})()" > /dev/null
for i in {1..600}; do
  zselect -t 50 || true
  R="$(obs "(()=>window.__bookDeskResult===undefined?'__PENDING__':window.__bookDeskResult)()")"
  if [[ "$R" != *"__PENDING__"* && -n "$R" ]]; then print -r -- "${R#=> }"; exit 0; fi
done
echo "the test did not finish in time"; exit 1
