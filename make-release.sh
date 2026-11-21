#!/bin/zsh
# Builds the downloadable installers in dist/:
#   Librescript.dmg   open it, drag Librescript into Applications
#   Librescript.zip   used by install.sh
#   SHA256SUMS        checksums, verified by install.sh
#
# Usage: ./make-release.sh             → build dist/ only
#        ./make-release.sh --publish   → also create the GitHub release v<version> and upload the files
#                                        (needs the GitHub CLI "gh", signed in)
set -euo pipefail
cd "${0:A:h}"

VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" macos/Info.plist)
echo "Librescript $VERSION"

./build-mac.sh --universal

rm -rf dist build/dmg
mkdir -p dist build/dmg

echo "→ Librescript.zip"
ditto -c -k --keepParent build/Librescript.app dist/Librescript.zip

echo "→ Librescript.dmg"
cp -R build/Librescript.app build/dmg/
ln -s /Applications build/dmg/Applications
cat > "build/dmg/Comment installer.txt" <<'EOF'
INSTALLER LIBRESCRIPT

1. Glisse l'icône « Librescript » sur le dossier « Applications ».
2. Éjecte ce disque (clic droit → Éjecter).
3. Ouvre Librescript depuis le Launchpad ou le dossier Applications.

AU PREMIER LANCEMENT
Librescript n'est pas encore signée par Apple. macOS peut afficher
« Apple n'a pas pu confirmer que Librescript ne contenait pas de logiciel malveillant ».
Dans ce cas :
  - clique sur « Terminé » ;
  - ouvre Réglages Système → Confidentialité et sécurité ;
  - tout en bas, à côté de « Librescript a été bloquée », clique sur « Ouvrir quand même » ;
  - confirme avec ton mot de passe.
Il ne faut le faire qu'une seule fois.

Autre solution sans cette étape : l'installation en une ligne depuis le Terminal,
expliquée sur https://github.com/nvdrtx/librescript

Tes histoires sont rangées dans Documents/Librescript.
EOF
hdiutil create -quiet -volname "Librescript $VERSION" -srcfolder build/dmg -fs HFS+ -format UDZO -ov dist/Librescript.dmg

echo "→ SHA256SUMS"
(cd dist && shasum -a 256 Librescript.zip Librescript.dmg > SHA256SUMS && cat SHA256SUMS)

if [[ "${1:-}" == "--publish" ]]; then
  GH=$(command -v gh || echo ~/tools/gh/gh_2.104.0_macOS_arm64/bin/gh)
  TAG="v$VERSION"
  NOTES=$(cat <<EOF
## Installer Librescript $VERSION

**Le plus simple** : colle cette ligne dans le Terminal (Applications → Utilitaires → Terminal) :

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/nvdrtx/librescript/main/install.sh | bash
\`\`\`

Elle télécharge l'app, vérifie son empreinte, l'installe dans Applications et l'ouvre.

**Ou avec le .dmg** : télécharge \`Librescript.dmg\` ci-dessous, ouvre-le et glisse Librescript dans Applications.
Au premier lancement, si macOS bloque l'app : Réglages Système → Confidentialité et sécurité → « Ouvrir quand même ».

Fonctionne sur macOS 13 ou plus récent, Mac Apple Silicon et Intel.
EOF
)
  if "$GH" release view "$TAG" >/dev/null 2>&1; then
    "$GH" release upload "$TAG" dist/Librescript.dmg dist/Librescript.zip dist/SHA256SUMS --clobber
  else
    "$GH" release create "$TAG" dist/Librescript.dmg dist/Librescript.zip dist/SHA256SUMS \
      --title "Librescript $VERSION" --notes "$NOTES" --latest
  fi
  echo "✓ Release $TAG publiée"
else
  echo "✓ dist/ prêt (ajoute --publish pour l'envoyer sur GitHub)"
fi
