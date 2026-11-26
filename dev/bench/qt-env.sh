#!/usr/bin/env bash
# Runs a command in TauriQt's nix dev shell (Qt 6.12 from the pinned nixpkgs) under its own
# session bus, with nixpkgs' Mesa as the GL driver: a nix-built Qt finds no GL driver of the
# host's outside NixOS and aborts in QGLXContext. QT_QPA_PLATFORM defaults to xcb; pass
# QT_QPA_PLATFORM=wayland through the command (env ... cmd) for Wayland.
set -eu
out=${BENCH_OUT:-/tmp/streamline-bench}
nixpkgs=${BENCH_NIXPKGS:-https://releases.nixos.org/nixos/unstable/nixos-26.11pre1125864.2786a2a72088/nixexprs.tar.xz}
mesa=$(grep -- '-mesa-' "$out/qt-gl.paths")
glvnd=$(grep -- '-libglvnd-' "$out/qt-gl.paths")
cd "$out/src/TauriQt"
exec /usr/bin/dbus-run-session -- env LD_LIBRARY_PATH='' nix develop --override-input nixpkgs "$nixpkgs" --command \
	env LD_LIBRARY_PATH="$glvnd/lib:$mesa/lib" LIBGL_DRIVERS_PATH="$mesa/lib/dri" \
	__EGL_VENDOR_LIBRARY_FILENAMES="$mesa/share/glvnd/egl_vendor.d/50_mesa.json" GBM_BACKENDS_PATH="$mesa/lib/gbm" \
	QT_QPA_PLATFORM=xcb QTWEBENGINE_CHROMIUM_FLAGS=--no-sandbox "$@"
