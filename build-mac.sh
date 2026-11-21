#!/bin/zsh
# Builds Librescript.app from the web editor + the Swift shell in macos/.
# Usage: ./build-mac.sh               → build/Librescript.app (for this Mac's processor)
#        ./build-mac.sh --universal   → runs on both Apple Silicon and Intel Macs
#        ./build-mac.sh --install     → also copies it to ~/Applications
set -euo pipefail
cd "${0:A:h}"

UNIVERSAL=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --install) INSTALL=1 ;;
    *) echo "Option inconnue : $arg" >&2; exit 2 ;;
  esac
done

APP=build/Librescript.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" build/tmp

echo "→ Compilation Swift"
compile() { # $1 = arch, $2 = output
  xcrun swiftc -O -swift-version 5 -target "$1-apple-macos13.0" \
    -framework AppKit -framework WebKit -framework PDFKit \
    -o "$2" macos/main.swift
}
if (( UNIVERSAL )); then
  compile arm64 build/tmp/Librescript-arm64
  compile x86_64 build/tmp/Librescript-x86_64
  lipo -create build/tmp/Librescript-arm64 build/tmp/Librescript-x86_64 -output "$APP/Contents/MacOS/Librescript"
else
  compile "$(uname -m)" "$APP/Contents/MacOS/Librescript"
fi

echo "→ Ressources web"
cp index.html styles.css "$APP/Contents/Resources/web/"
cp -R src "$APP/Contents/Resources/web/"
cp macos/Info.plist "$APP/Contents/Info.plist"

echo "→ Icône"
ICONSET=build/tmp/AppIcon.iconset
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
xcrun swift macos/make_icon.swift build/tmp/icon.png
for s in 16 32 128 256 512; do
  sips -z $s $s build/tmp/icon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) build/tmp/icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "→ Signature locale"
codesign --force --deep --sign - "$APP" >/dev/null

if (( INSTALL )); then
  mkdir -p ~/Applications
  rm -rf ~/Applications/Librescript.app
  cp -R "$APP" ~/Applications/
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ~/Applications/Librescript.app
  echo "✓ Installée dans ~/Applications/Librescript.app"
else
  echo "✓ $APP ($(lipo -archs "$APP/Contents/MacOS/Librescript"))"
fi
