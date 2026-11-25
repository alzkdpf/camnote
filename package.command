#!/bin/zsh
set -eu
cd "${0:A:h}"
source scripts/rust-env.sh
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$PWD=/build/camnote --remap-path-prefix=$HOME=/build/user"
"$CAMNOTE_CARGO_BIN" build --release --locked
"$CAMNOTE_CARGO_BIN" metadata --locked --format-version 1 > target/license-metadata.json
python3 scripts/third-party-notices.py target/license-metadata.json
mkdir -p dist/CamNote.app/Contents/MacOS
mkdir -p dist/CamNote.app/Contents/Resources
cp target/release/camnote dist/CamNote.app/Contents/MacOS/CamNote
cp Info.plist dist/CamNote.app/Contents/Info.plist
cp THIRD_PARTY_LICENSES.txt dist/CamNote.app/Contents/Resources/THIRD_PARTY_LICENSES.txt
cp RIGHTS.md dist/CamNote.app/Contents/Resources/RIGHTS.md
mkdir -p target/CamNote.iconset
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" icons/icon.png --out "target/CamNote.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" icons/icon.png --out "target/CamNote.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns target/CamNote.iconset -o dist/CamNote.app/Contents/Resources/CamNote.icns
codesign --force --deep --sign - dist/CamNote.app
echo "완료: $PWD/dist/CamNote.app"
