#!/usr/bin/env bash
# Builds the bench app on each runtime: dev/bench/runtimes.sh [wry] [cef] [qt]   (all three by default)
#   wry  Tauri 2 + wry + WebKitGTK, the runtime the player ships (needs webkit2gtk-4.1 dev files)
#   cef  Tauri's CEF runtime (tauri-apps/tauri, branch feat/cef, pinned below), Chromium via CEF
#   qt   TauriQt (Alper-Celik/TauriQt, pinned below), Qt WebEngine from a pinned nixpkgs
# The app source is dev/bench/app; it is copied into each runtime's tree, built there, and the
# binaries end up at $BENCH_OUT/bin/{wry,cef,qt}. Same source, one cfg feature per runtime.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${BENCH_OUT:-/tmp/streamline-bench}
src=$out/src
mkdir -p "$src" "$out/bin"

TAURI_CEF_REV=9d1a5b176e337c8395362a4e7c99bac99b36a1d1
TAURIQT_REV=db3f29b179e77a9eecacbd14497ca09ef9d0ec85
# The nixpkgs the Qt results were measured on (Qt 6.12.0, Mesa 26.3.1).
export BENCH_NIXPKGS=${BENCH_NIXPKGS:-https://releases.nixos.org/nixos/unstable/nixos-26.11pre1125864.2786a2a72088/nixexprs.tar.xz}

checkout() { # url rev dir
	[ -d "$3/.git" ] && [ "$(git -C "$3" rev-parse HEAD)" = "$2" ] && return
	rm -rf "$3"
	git init -q "$3"
	git -C "$3" fetch -q --depth 1 "$1" "$2"
	git -C "$3" checkout -q FETCH_HEAD
}

app_into() { # dir
	rm -rf "$1"
	mkdir -p "$1/icons"
	cp -r "$here/app/src" "$here/app/build.rs" "$here/app/tauri.conf.json" "$1/"
	cp "$here/../../src-tauri/icons/128x128.png" "$1/icons/icon.png"
}

member() { # workspace Cargo.toml, member path
	grep -q "\"$2\"" "$1" || sed -i "0,/members = \[/s//members = [\n  \"$2\",/" "$1"
}

wry() {
	app_into "$src/bench-wry"
	cat >"$src/bench-wry/Cargo.toml" <<-'EOF'
		[package]
		name = "bench-wry"
		version = "0.1.0"
		edition = "2021"
		publish = false

		[workspace]

		[build-dependencies]
		tauri-build = "2"

		[dependencies]
		# The player's own pin (src-tauri/Cargo.toml).
		tauri = "=2.12.5"

		[features]
		default = ["wry"]
		wry = []
	EOF
	cargo build --release --manifest-path "$src/bench-wry/Cargo.toml"
	ln -sf "$src/bench-wry/target/release/bench-wry" "$out/bin/wry"
}

cef() {
	checkout https://github.com/tauri-apps/tauri.git "$TAURI_CEF_REV" "$src/tauri-cef"
	app_into "$src/tauri-cef/bench-cef"
	cat >"$src/tauri-cef/bench-cef/Cargo.toml" <<-'EOF'
		[package]
		name = "bench-cef"
		version = "0.1.0"
		edition = "2024"
		publish = false

		[build-dependencies]
		tauri-build = { workspace = true, default-features = true }

		[dependencies]
		tauri = { workspace = true, default-features = true }
		tauri-runtime-cef = { workspace = true, default-features = true }

		[features]
		default = ["cef"]
		cef = []
	EOF
	member "$src/tauri-cef/Cargo.toml" bench-cef
	(cd "$src/tauri-cef" && cargo build --release -p bench-cef)
	# CEF finds libcef.so and its resources beside the real executable: a symlink is enough.
	ln -sf "$src/tauri-cef/target/release/bench-cef" "$out/bin/cef"
}

qt() {
	checkout https://github.com/Alper-Celik/TauriQt.git "$TAURIQT_REV" "$src/TauriQt"
	app_into "$src/TauriQt/bench"
	cat >"$src/TauriQt/bench/Cargo.toml" <<-'EOF'
		[package]
		name = "bench-qt"
		version = "0.1.0"
		edition = "2021"
		publish = false

		[build-dependencies]
		tauri-build = { version = "2", default-features = false }

		[dependencies]
		tauri = { version = "2", default-features = false }
		tauri-runtime-qt = { path = "../tauri-runtime-qt" }

		[features]
		default = ["qt"]
		qt = []
	EOF
	member "$src/TauriQt/Cargo.toml" bench
	# A nix-built Qt finds no GL driver outside NixOS: qt-env.sh points it at nixpkgs' Mesa.
	LD_LIBRARY_PATH='' nix build --no-link --print-out-paths --impure --expr \
		"let p = import (builtins.fetchTarball \"$BENCH_NIXPKGS\") {}; in [ p.mesa p.libglvnd ]" >"$out/qt-gl.paths"
	"$here/qt-env.sh" cargo build --release -p bench-qt --manifest-path "$src/TauriQt/Cargo.toml"
	ln -sf "$src/TauriQt/target/release/bench-qt" "$out/bin/qt"
}

for r in "${@:-wry cef qt}"; do
	for one in $r; do "$one"; done
done
ls -l "$out/bin"
