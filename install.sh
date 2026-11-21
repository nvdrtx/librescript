#!/bin/bash
# Librescript installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/nvdrtx/librescript/main/install.sh | bash
#
# Downloads the latest release, checks its SHA-256, installs Librescript.app into
# /Applications (or ~/Applications if /Applications is not writable) and opens it.
#
#   ... | bash -s -- --uninstall   removes the app (your stories in Documents/Librescript are kept)
#   ... | bash -s -- --no-open     installs without opening the app
#
# LIBRESCRIPT_INSTALL_DIR=/some/folder overrides the destination.
set -euo pipefail

REPO="nvdrtx/librescript"
APP_NAME="Librescript.app"
BASE_URL="https://github.com/$REPO/releases/latest/download"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

OPEN=1
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN=0 ;;
    --uninstall) UNINSTALL=1 ;;
    *) fail "option inconnue : $arg" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || fail "Librescript ne fonctionne que sur macOS."
MAJOR=$(sw_vers -productVersion | cut -d. -f1)
[ "$MAJOR" -ge 13 ] || fail "il faut macOS 13 (Ventura) ou plus récent (tu as $(sw_vers -productVersion))."

if [ -n "${LIBRESCRIPT_INSTALL_DIR:-}" ]; then
  DEST="$LIBRESCRIPT_INSTALL_DIR"
elif [ -w /Applications ]; then
  DEST="/Applications"
else
  DEST="$HOME/Applications"
fi

quit_running_app() {
  if pgrep -xq Librescript; then
    say "→ Fermeture de Librescript (tes histoires sont enregistrées automatiquement)…"
    osascript -e 'tell application id "local.librescript.app" to quit' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq Librescript || break; sleep 0.5; done
  fi
}

if [ "$UNINSTALL" = 1 ]; then
  quit_running_app
  removed=0
  for dir in "$DEST" /Applications "$HOME/Applications"; do
    if [ -d "$dir/$APP_NAME" ]; then rm -rf "$dir/$APP_NAME"; say "✓ Supprimée : $dir/$APP_NAME"; removed=1; fi
  done
  [ "$removed" = 1 ] || say "Librescript n'était pas installée."
  say "Tes histoires restent dans ~/Documents/Librescript."
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "→ Téléchargement de Librescript…"
curl -fL --progress-bar -o "$TMP/Librescript.zip" "$BASE_URL/Librescript.zip" \
  || fail "téléchargement impossible. Vérifie ta connexion, ou télécharge le .dmg sur https://github.com/$REPO/releases"
curl -fsSL -o "$TMP/SHA256SUMS" "$BASE_URL/SHA256SUMS" || fail "impossible de télécharger les empreintes."

say "→ Vérification de l'empreinte…"
( cd "$TMP" && grep ' Librescript.zip$' SHA256SUMS | shasum -a 256 -c - >/dev/null ) \
  || fail "le fichier téléchargé ne correspond pas à l'empreinte publiée. Installation annulée."

mkdir -p "$TMP/app"
ditto -x -k "$TMP/Librescript.zip" "$TMP/app"
[ -d "$TMP/app/$APP_NAME" ] || fail "archive inattendue (pas de $APP_NAME dedans)."

quit_running_app
say "→ Installation dans $DEST…"
mkdir -p "$DEST"
rm -rf "${DEST:?}/$APP_NAME"
ditto "$TMP/app/$APP_NAME" "$DEST/$APP_NAME"
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/$APP_NAME" 2>/dev/null || true

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$DEST/$APP_NAME/Contents/Info.plist" 2>/dev/null || echo "?")
say "✓ Librescript $VERSION installée dans $DEST"
say "  Tes histoires seront rangées dans ~/Documents/Librescript."

if [ "$OPEN" = 1 ]; then open "$DEST/$APP_NAME"; fi
