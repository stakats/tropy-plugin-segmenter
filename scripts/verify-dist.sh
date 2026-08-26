#!/usr/bin/env bash
# Check that what we are about to publish is installable.
#
# Everything here has been got wrong at least once. Tropy installs a plugin by
# unzipping it with `strip: true` and naming the folder after the filename, so
# the archive's shape is not cosmetic — a stray directory, a `v` in the
# version, or a missing package.json produces a plugin that either fails to
# install or installs under the wrong name.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
ZIP="dist/$NAME-$VERSION.zip"
STAGE="$NAME-$VERSION"

fail() { echo "verify: $1" >&2; exit 1; }

[ -f "$ZIP" ] || fail "no archive at $ZIP — run npm run dist"

LISTING=$(unzip -Z1 "$ZIP")

# One top-level directory, named for the archive. `strip: true` unwraps exactly
# one; anything else lands in the plugins folder unwrapped.
ROOTS=$(echo "$LISTING" | cut -d/ -f1 | sort -u)
[ "$(echo "$ROOTS" | wc -l)" -eq 1 ] || fail "expected one top-level directory, got: $ROOTS"
[ "$ROOTS" = "$STAGE" ] || fail "top-level directory is '$ROOTS', expected '$STAGE'"

# The version must not be prefixed. Tropy strips a trailing `-1.2.3` to name
# the installed folder, and that pattern needs a digit after the dash.
case "$VERSION" in
  v*) fail "version '$VERSION' starts with v; the installed folder would keep it" ;;
esac

EXPECTED="COPYRIGHT LICENSE icon.svg index.js package.json third-party-licenses.txt"
ACTUAL=$(echo "$LISTING" | sed "s|^$STAGE/||" | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//')
[ "$ACTUAL" = "$EXPECTED" ] || fail "archive holds [$ACTUAL], expected [$EXPECTED]"

# Nothing that should never ship.
echo "$LISTING" | grep -qE 'node_modules|/src/|/test/|\.map$' \
  && fail "archive contains build or development files" || true

# The bundle has to stand alone: Tropy never installs a plugin's dependencies.
unzip -p "$ZIP" "$STAGE/index.js" > /tmp/segmenter-bundle.js
grep -qE "require\(['\"][^.n]" /tmp/segmenter-bundle.js \
  && fail "bundle requires an external module at run time" || true
grep -q "module.exports" /tmp/segmenter-bundle.js \
  || fail "bundle does not export the plugin"

# What Tropy reads before it will show the plugin at all.
unzip -p "$ZIP" "$STAGE/package.json" > /tmp/segmenter-pkg.json
node -e '
  const pkg = require("/tmp/segmenter-pkg.json")
  const expect = (ok, why) => { if (!ok) { console.error("verify: " + why); process.exit(1) } }
  expect(pkg.name === process.argv[1], "name in the archive is " + pkg.name)
  expect(pkg.version === process.argv[2], "version in the archive is " + pkg.version)
  expect(pkg.main === "index.js", "main is " + pkg.main)
  expect(pkg.hooks && pkg.hooks.export === true, "the export hook is not declared")
  expect(Array.isArray(pkg.options) && pkg.options.length > 0, "no options declared")
  expect(pkg.options.some(o => o.field === "apiKey" && o.required), "apiKey is not a required option")
  expect(!pkg.dependencies, "runtime dependencies are declared but never installed")
  expect(typeof pkg.productName === "string", "no productName for the plugin list")
' "$NAME" "$VERSION"

rm -f /tmp/segmenter-bundle.js /tmp/segmenter-pkg.json

SIZE=$(du -k "$ZIP" | cut -f1)
echo "verify: $ZIP is installable (${SIZE}KB, $(echo "$LISTING" | grep -c . ) entries)"
