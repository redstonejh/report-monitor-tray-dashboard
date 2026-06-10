#!/usr/bin/env bash
set -e

# ── Config ─────────────────────────────────────────────────────────────────────
# Node.js 22 LTS — ABI must match (node -e "process.versions.modules")
NODE_VERSION="22.15.0"
NODE_ABI="127"

WINSW_VERSION="2.12.0"

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
INSTALLER_DIR="$ROOT/status-monitor-api/installer"
STAGING="$INSTALLER_DIR/staging"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
nvm use 22 --silent 2>/dev/null || true

mkdir -p "$DIST" "$STAGING/node" "$STAGING/app"

# ── Node.js portable (Windows x64) ────────────────────────────────────────────
NODE_ZIP="node-v${NODE_VERSION}-win-x64.zip"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}"
NODE_TMP="/tmp/${NODE_ZIP}"
NODE_EXTRACT="/tmp/node-win-extract-$$"

if [ ! -f "$NODE_TMP" ]; then
  echo "Downloading Node.js ${NODE_VERSION} for Windows…"
  curl -fL "$NODE_URL" -o "$NODE_TMP"
fi

echo "Extracting node.exe…"
mkdir -p "$NODE_EXTRACT"
unzip -q "$NODE_TMP" "node-v${NODE_VERSION}-win-x64/node.exe" -d "$NODE_EXTRACT"
cp "$NODE_EXTRACT/node-v${NODE_VERSION}-win-x64/node.exe" "$STAGING/node/"
rm -rf "$NODE_EXTRACT"

# ── API source & pure-JS node_modules ─────────────────────────────────────────
echo "Copying API source…"
cp -r "$ROOT/status-monitor-api/src"           "$STAGING/app/"
mkdir -p "$STAGING/app/config" "$STAGING/app/data"
cp "$ROOT/status-monitor-api/package.json"      "$STAGING/app/"
if [ -f "$ROOT/status-monitor-api/package-lock.json" ]; then
  cp "$ROOT/status-monitor-api/package-lock.json" "$STAGING/app/"
fi

echo "Installing npm packages (no native compilation)…"
cd "$STAGING/app"
npm install --ignore-scripts --omit=dev --no-audit --no-fund 2>&1
cd "$ROOT"

# ── better-sqlite3 Windows prebuilt ───────────────────────────────────────────
BSQ3_VERSION=$(node -e "console.log(require('$STAGING/app/node_modules/better-sqlite3/package.json').version)")
BSQ3_ASSET="better-sqlite3-v${BSQ3_VERSION}-node-v${NODE_ABI}-win32-x64.tar.gz"
BSQ3_URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${BSQ3_VERSION}/${BSQ3_ASSET}"
BSQ3_TMP="/tmp/${BSQ3_ASSET}"
BSQ3_EXTRACT="/tmp/bs3-extract-$$"

if [ ! -f "$BSQ3_TMP" ]; then
  echo "Downloading better-sqlite3 Windows prebuilt (v${BSQ3_VERSION}, ABI ${NODE_ABI})…"
  curl -fL "$BSQ3_URL" -o "$BSQ3_TMP"
else
  echo "Using cached better-sqlite3 prebuilt (v${BSQ3_VERSION})…"
fi

echo "Extracting better-sqlite3 binary…"
mkdir -p "$BSQ3_EXTRACT"
tar -xzf "$BSQ3_TMP" -C "$BSQ3_EXTRACT"

NODEFILE=$(find "$BSQ3_EXTRACT" -name "*.node" | grep -v test | head -1)
if [ -z "$NODEFILE" ]; then
  echo "ERROR: No .node file found in ${BSQ3_ASSET}"
  echo "Archive contents:"
  tar -tzf "$BSQ3_TMP"
  exit 1
fi

mkdir -p "$STAGING/app/node_modules/better-sqlite3/build/Release"
cp "$NODEFILE" "$STAGING/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
echo "  → $(basename "$NODEFILE") → staging/app/node_modules/better-sqlite3/build/Release/"
rm -rf "$BSQ3_EXTRACT"

# ── WinSW (Windows Service Wrapper) ───────────────────────────────────────────
# Requires .NET 4.5+ which is built into Windows 8 / Server 2012 and later.
WINSW_URL="https://github.com/winsw/winsw/releases/download/v${WINSW_VERSION}/WinSW.NET4.exe"
WINSW_TMP="/tmp/WinSW-${WINSW_VERSION}.NET4.exe"

if [ ! -f "$WINSW_TMP" ]; then
  echo "Downloading WinSW ${WINSW_VERSION}…"
  curl -fL "$WINSW_URL" -o "$WINSW_TMP"
fi

# WinSW must be named after the service (so it knows which XML to load)
cp "$WINSW_TMP" "$STAGING/StatusMonitorAPI.exe"

# ── Remove any Linux-compiled binaries that snuck in ─────────────────────────
find "$STAGING/app/node_modules" -name "*.node" \
  ! -path "*/better-sqlite3/build/Release/better_sqlite3.node" \
  -delete 2>/dev/null || true

# ── Build NSIS installer ───────────────────────────────────────────────────────
echo "Building NSIS installer…"
cd "$INSTALLER_DIR"
makensis StatusMonitorAPI.nsi
cd "$ROOT"

echo ""
echo "Done -> $DIST/StatusMonitorAPI-Setup.exe"
