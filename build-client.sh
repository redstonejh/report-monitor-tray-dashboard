#!/usr/bin/env bash
set -e

ROOT="$(dirname "$0")"
DIST="$ROOT/dist"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 --silent

cd "$ROOT/status-monitor-client"

echo "Installing dependencies…"
npm install

echo "Building for Windows x64…"
export WINEPREFIX="$HOME/.wine_build"
npm run make -- --platform win32 --arch x64

# Copy installer to dist/ — overwrites if same name, never deletes existing files
EXE=$(find out/make/squirrel.windows -name "*Setup*.exe" | head -1)
if [ -z "$EXE" ]; then
  echo "ERROR: No installer found in out/make/squirrel.windows" >&2
  exit 1
fi

cp "$EXE" "$DIST/"
echo ""
echo "Done → $DIST/$(basename "$EXE")"

# Clean up temporary build output
rm -rf out/
