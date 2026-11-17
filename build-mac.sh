#!/bin/zsh
# Builds Librescript.app from the web editor + the Swift shell in macos/.
# Usage: ./build-mac.sh            → build/Librescript.app
#        ./build-mac.sh --install  → also copies it to ~/Applications
set -euo pipefail
cd "${0:A:h}"

APP=build/Librescript.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" build/tmp

echo "→ Compilation Swift"
xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit \
  -o "$APP/Contents/MacOS/Librescript" macos/main.swift

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

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p ~/Applications
  rm -rf ~/Applications/Librescript.app
  cp -R "$APP" ~/Applications/
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ~/Applications/Librescript.app
  echo "✓ Installée dans ~/Applications/Librescript.app"
else
  echo "✓ $APP"
fi
