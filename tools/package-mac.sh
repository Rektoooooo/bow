#!/bin/zsh
# Builds release/Sidebar Browser-darwin-<arch>/Sidebar Browser.app: our compiled code, the icon (build/icon.icns) and
# the Info.plist entries that let macOS use it as the default browser (build/extend-info.plist). The app is signed
# ad hoc, which is enough to run it on this Mac; it is not notarized for other Macs. node_modules is left out: the app
# has no runtime dependencies (everything in package.json is a dev tool).
# usage: npm run package
set -e
cd "$(dirname "$0")/.."
architecture="$(uname -m)"
[[ "$architecture" == "x86_64" ]] && architecture="x64"
npm run build
npx electron-packager . "Sidebar Browser" \
  --platform=darwin \
  --arch="$architecture" \
  --out=release \
  --overwrite \
  --icon=build/icon.icns \
  --app-bundle-id=io.github.rektoooooo.sidebar-browser \
  --extend-info=build/extend-info.plist \
  --ignore='^/(src|tests|e2e|docs|reference|tools|tasks|build|release|node_modules|\.handoffs|\.claude|\.github)(/|$)' \
  --ignore='^/(tsconfig[^/]*\.json|vitest\.config\.ts|README\.md|CLAUDE\.md|\.nvmrc|\.gitignore)$'
app_path="release/Sidebar Browser-darwin-$architecture/Sidebar Browser.app"
codesign --force --deep --sign - "$app_path"
echo "Built $app_path"
