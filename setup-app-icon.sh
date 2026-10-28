#!/bin/bash
# Generates AppIcon.icns from the PNGs in TaskManager.app/Contents/Resources
# Run this once on macOS after cloning: ./setup-app-icon.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RES_DIR="$SCRIPT_DIR/TaskManager.app/Contents/Resources"
ICONSET="$RES_DIR/AppIcon.iconset"

mkdir -p "$ICONSET"

# Copy PNGs into the iconset with macOS naming convention
cp "$RES_DIR/icon_16.png"   "$ICONSET/icon_16x16.png"
cp "$RES_DIR/icon_32.png"   "$ICONSET/icon_16x16@2x.png"
cp "$RES_DIR/icon_32.png"   "$ICONSET/icon_32x32.png"
cp "$RES_DIR/icon_64.png"   "$ICONSET/icon_32x32@2x.png"
cp "$RES_DIR/icon_128.png"  "$ICONSET/icon_128x128.png"
cp "$RES_DIR/icon_256.png"  "$ICONSET/icon_128x128@2x.png"
cp "$RES_DIR/icon_256.png"  "$ICONSET/icon_256x256.png"
cp "$RES_DIR/icon_512.png"  "$ICONSET/icon_256x256@2x.png"
cp "$RES_DIR/icon_512.png"  "$ICONSET/icon_512x512.png"
cp "$RES_DIR/icon_1024.png" "$ICONSET/icon_512x512@2x.png"

# Build .icns (macOS only)
if command -v iconutil &>/dev/null; then
  iconutil -c icns "$ICONSET" -o "$RES_DIR/AppIcon.icns"
  rm -rf "$ICONSET"
  echo "AppIcon.icns created successfully!"
  echo "You can now double-click TaskManager.app or drag it to your Dock."
else
  echo "iconutil not found — this script must be run on macOS."
  rm -rf "$ICONSET"
  exit 1
fi
