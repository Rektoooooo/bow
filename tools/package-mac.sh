#!/bin/zsh
# Builds release/Bow-darwin-<arch>/Bow.app: our compiled code, the icon (build/icon.icns) and
# the Info.plist entries that let macOS use it as the default browser (build/extend-info.plist). The app is signed
# ad hoc, which is enough to run it on this Mac. With BOW_SIGN_IDENTITY set (tools/release-mac.sh does that) it is
# signed with that certificate instead, with the hardened runtime and Chromium's entitlements for each helper
# (@electron/osx-sign's defaults: JIT, camera, microphone, location), as notarization needs. Of node_modules only the
# runtime dependencies go in: electron-chrome-extensions and its debug → ms (everything else in package.json is a dev
# tool).
# The bundle id keeps the app's first name (Sidebar Browser): macOS ties the default browser and website permissions
# to it. The data folder keeps that name too (main.ts keepDataFolder).
# usage: npm run package
set -e
cd "$(dirname "$0")/.."
architecture="$(uname -m)"
[[ "$architecture" == "x86_64" ]] && architecture="x64"
npm run build
# Electron's own install already downloaded and checked this zip; reusing it keeps packaging working offline (the
# packager would otherwise fetch the checksum file from GitHub on every run).
electron_version="$(node -p 'require("electron/package.json").version')"
cached_zip="$(find "$HOME/Library/Caches/electron" -name "electron-v${electron_version}-darwin-${architecture}.zip" 2>/dev/null | head -1)"
zip_options=()
[[ -n "$cached_zip" ]] && zip_options=(--electron-zip-dir="$(dirname "$cached_zip")")
sign_options=()
[[ -n "$BOW_SIGN_IDENTITY" ]] && sign_options=(--osx-sign.identity="$BOW_SIGN_IDENTITY")
npx electron-packager . "Bow" "${zip_options[@]}" "${sign_options[@]}" \
  --platform=darwin \
  --arch="$architecture" \
  --out=release \
  --overwrite \
  --icon=build/icon.icns \
  --app-bundle-id=io.github.rektoooooo.sidebar-browser \
  --extend-info=build/extend-info.plist \
  --ignore='^/(src|tests|e2e|docs|reference|tools|tasks|build|release|\.handoffs|\.claude|\.github)(/|$)' \
  --ignore='^/node_modules/(?!(electron-chrome-extensions|debug|ms)(/|$))' \
  --ignore='^/(tsconfig[^/]*\.json|vitest\.config\.ts|README\.md|CLAUDE\.md|\.nvmrc|\.gitignore)$'
app_path="release/Bow-darwin-$architecture/Bow.app"
[[ -z "$BOW_SIGN_IDENTITY" ]] && codesign --force --deep --sign - "$app_path"
echo "Built $app_path"
