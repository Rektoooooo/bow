#!/bin/zsh
# Builds the download for a release: release/Bow-<version>-<arch>.dmg with Bow.app and a link to Applications. The app
# and the disk image are signed with a Developer ID certificate and notarized by Apple, so they open on any Mac without
# a Gatekeeper warning, also offline (the notarization ticket is stapled to both).
#
# Needs, in the login keychain (never in this repository):
#   - a "Developer ID Application" certificate. BOW_SIGN_IDENTITY picks another one; the default matches any
#     certificate of that kind, so keep only one in the keychain or name yours.
#   - notarytool credentials saved under the profile "bow-notary" (BOW_NOTARY_PROFILE picks another name), made once:
#       xcrun notarytool store-credentials "bow-notary" --apple-id <your Apple ID> --team-id <your team id>
#     (it asks for an app-specific password from account.apple.com).
#
# usage: npm run release
set -e
cd "$(dirname "$0")/.."
sign_identity="${BOW_SIGN_IDENTITY:-Developer ID Application}"
notary_profile="${BOW_NOTARY_PROFILE:-bow-notary}"
version="$(node -p 'require("./package.json").version')"
architecture="$(uname -m)"
[[ "$architecture" == "x86_64" ]] && architecture="x64"
app_path="release/Bow-darwin-$architecture/Bow.app"
dmg_path="release/Bow-$version-$architecture.dmg"
work_folder="$(mktemp -d)"

# Sends a file to Apple's notary service, waits for the answer and stops the release when Apple refuses it (the log
# says which file inside was the problem).
notarize() {
  local file_path="$1"
  local answer
  answer="$(xcrun notarytool submit "$file_path" --keychain-profile "$notary_profile" --wait --output-format plist)"
  local submission_status="$(plutil -extract status raw -o - - <<< "$answer")"
  local submission_id="$(plutil -extract id raw -o - - <<< "$answer")"
  echo "Notarization of $(basename "$file_path"): $submission_status ($submission_id)"
  if [[ "$submission_status" != "Accepted" ]]; then
    xcrun notarytool log "$submission_id" --keychain-profile "$notary_profile"
    exit 1
  fi
}

if ! xcrun notarytool history --keychain-profile "$notary_profile" >/dev/null 2>&1; then
  echo "No notarytool credentials named \"$notary_profile\" in the keychain. Save them once with:"
  echo "  xcrun notarytool store-credentials \"$notary_profile\" --apple-id <your Apple ID> --team-id <your team id>"
  exit 1
fi

BOW_SIGN_IDENTITY="$sign_identity" tools/package-mac.sh
codesign --verify --deep --strict "$app_path"
signature_details="$(codesign --display --verbose=2 "$app_path" 2>&1)"
if [[ "$signature_details" != *"flags=0x10000(runtime)"* ]]; then
  echo "Bow.app is not signed with the hardened runtime, which notarization requires."
  exit 1
fi

# The app first, so its own ticket can be stapled to it: Bow.app copied out of the disk image then opens offline too.
ditto -c -k --keepParent "$app_path" "$work_folder/Bow.zip"
notarize "$work_folder/Bow.zip"
xcrun stapler staple "$app_path"

disk_folder="$work_folder/Bow"
mkdir -p "$disk_folder"
ditto "$app_path" "$disk_folder/Bow.app"
ln -s /Applications "$disk_folder/Applications"
rm -f "$dmg_path"
hdiutil create -volname "Bow" -srcfolder "$disk_folder" -fs HFS+ -format UDZO "$dmg_path"
codesign --sign "$sign_identity" --timestamp "$dmg_path"
notarize "$dmg_path"
xcrun stapler staple "$dmg_path"

spctl --assess --type execute --verbose=2 "$app_path"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg_path"
rm -rf "$work_folder"
echo "Built $dmg_path"
shasum -a 256 "$dmg_path"
