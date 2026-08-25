#!/usr/bin/env bash
# Package the plugin for installation.
#
# Tropy installs a plugin from a zip: `Plugins.install` unzips it with
# `strip: true`, which unwraps a single top-level directory, and names the
# installed folder after the zip minus `.zip` and a trailing `-1.2.3`.
#
# So the zip is named `<name>-<version>.zip` and holds one folder of the same
# name. Note the version must not be prefixed with `v` — the strip pattern
# only matches a dash followed by digits, so `-v0.1.0` would survive into the
# installed folder name.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
STAGE="dist/$NAME-$VERSION"

rm -rf dist
mkdir -p "$STAGE"

# The bundle is self-contained: no requires, no node_modules, no src.
cp index.js package.json icon.svg third-party-licenses.txt LICENSE "$STAGE/"

(cd dist && zip -qr "$NAME-$VERSION.zip" "$NAME-$VERSION")

echo "dist/$NAME-$VERSION.zip"
