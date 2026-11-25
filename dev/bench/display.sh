#!/usr/bin/env bash
# Starts the display server the bench draws on: dev/bench/display.sh x11|wayland
#   x11      Xvfb :99, 1920x1080, GLX (Mesa llvmpipe)
#   wayland  headless Weston, GL renderer (llvmpipe), kiosk shell, socket wayland-bench in
#            $BENCH_OUT/xdg, with XWayland: Tauri's CEF runtime is X11 only (it forces
#            --ozone-platform=x11 and GDK_BACKEND=x11), so on a Wayland session it runs there
# Neither has a GPU behind it: every pixel is drawn by the CPU (README, "What it measures").
set -eu
out=${BENCH_OUT:-/tmp/streamline-bench}
mkdir -p "$out/logs"
case ${1:?x11|wayland} in
x11)
	pgrep -x Xvfb >/dev/null || (Xvfb :99 -screen 0 1920x1080x24 +extension GLX -nolisten tcp >"$out/logs/xvfb.log" 2>&1 &)
	for _ in $(seq 1 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.2; done
	echo "DISPLAY=:99"
	;;
wayland)
	export XDG_RUNTIME_DIR=$out/xdg
	mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
	pkill -x weston || true
	pkill -x Xwayland || true
	sleep 0.5
	rm -f "$XDG_RUNTIME_DIR/wayland-bench" "$XDG_RUNTIME_DIR/wayland-bench.lock"
	weston --backend=headless --renderer=gl --width=1920 --height=1080 --socket=wayland-bench \
		--idle-time=0 --shell=kiosk --xwayland >"$out/logs/weston.log" 2>&1 &
	for _ in $(seq 1 50); do [ -S "$XDG_RUNTIME_DIR/wayland-bench" ] && break; sleep 0.2; done
	# XWayland starts on the first X client; the display number is in Weston's log.
	for _ in $(seq 1 50); do grep -q "xserver listening on display" "$out/logs/weston.log" && break; sleep 0.2; done
	x=$(grep -o "listening on display :[0-9]*" "$out/logs/weston.log" | tail -1 | grep -o ":[0-9]*")
	echo "WAYLAND_DISPLAY=wayland-bench XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR XWAYLAND_DISPLAY=${x:-}"
	;;
*) exit 2 ;;
esac
