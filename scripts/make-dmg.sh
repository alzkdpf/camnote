#!/bin/zsh
set -eu
cd "${0:A:h:h}"
app="dist/CamNote.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
arch="$(lipo -archs "$app/Contents/MacOS/CamNote")"
stage="$(mktemp -d "${TMPDIR:-/tmp/}camnote-dmg.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto --noextattr --noqtn "$app" "$stage/CamNote.app"
ln -s /Applications "$stage/Applications"
cp RIGHTS.md "$stage/RIGHTS.md"
cat > "$stage/READ ME.txt" <<'DOC'
CamNote preview for macOS 13 or later.
Drag CamNote.app to Applications. FFmpeg and a separately installed, authenticated Codex CLI are required; they are not included.
This preview is ad hoc signed and is NOT Apple notarized. macOS may block launching it. Use your organization's normal software approval process or build from source; do not disable Gatekeeper globally.
Images, notes, settings, logs and credentials are not included. New installs use the current user's Library/Application Support/CamNote directory.
License for CamNote-specific code is not specified. See RIGHTS.md and the app's Resources/THIRD_PARTY_LICENSES.txt.
DOC
hdiutil create -volname CamNote -srcfolder "$stage" -format UDZO -fs HFS+ -ov "dist/CamNote-${version}-macos-${arch}.dmg"
