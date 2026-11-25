#!/bin/zsh
set -eu
cd "${0:A:h}"
source scripts/rust-env.sh
exec "$CAMNOTE_CARGO_BIN" run --release
