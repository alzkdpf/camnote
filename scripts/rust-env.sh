# Sourced by commands executed from the project root.
if [ -x "$PWD/.cargo/bin/cargo" ] && [ -d "$PWD/.rustup" ]; then
  export CARGO_HOME="$PWD/.cargo"
  export RUSTUP_HOME="$PWD/.rustup"
  CAMNOTE_CARGO_BIN="$CARGO_HOME/bin/cargo"
else
  CAMNOTE_CARGO_BIN="$(command -v cargo)"
fi
