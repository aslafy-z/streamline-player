#!/usr/bin/env bash
# Runs variants × scenarios × reps: dev/bench/matrix.sh x11|wayland [reps] [variant-regex]
# SCENARIOS="nav player" (the default) narrows the scenarios.
# Needs stack.sh up, display.sh <same display> started and runtimes.sh built. Results go to
# $BENCH_OUT/results/<display>/<variant>-<scenario>-<rep>.json; aggregate.py makes the tables.
# Reps are interleaved (every variant once, then again) so drift spreads across variants.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=${BENCH_OUT:-/tmp/streamline-bench}
display=${1:?x11|wayland}
reps=${2:-1}
only=${3:-.}
bin=$out/bin
res=$out/results/$display
mkdir -p "$res"

# variant -> environment. A name ending in -reduce adds --reduce (animations and transitions off).
declare -A ENVS=(
	[wry]=""
	[wry-reduce]=""
	[wry-nocomp]="WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-nocomp-t4]="WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-nocomp-reduce]="WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-nocomp-t4-reduce]="WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-nodmabuf]="WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-skiacpu]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1"
	[wry-skiacpu-t1]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=1"
	[wry-skiacpu-t4]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-fps30]="WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS=30"
	[wry-vblank]="WEBKIT_FORCE_VBLANK_TIMER=1"
	[wry-shm]="WEBKIT_DMABUF_RENDERER_FORCE_SHM=1"
	[wry-msaa0]="WEBKIT_SKIA_MSAA_SAMPLE_COUNT=0"
	[cef]=""
	[cef-reduce]=""
	[cef-swiftshader]="BENCH_CEF_ARGS=ignore-gpu-blocklist,use-gl=angle,use-angle=swiftshader,enable-unsafe-swiftshader"
	[cef-raster1]="BENCH_CEF_ARGS=num-raster-threads=1"
	[cef-raster4]="BENCH_CEF_ARGS=num-raster-threads=4"
	[cef-1proc]="BENCH_CEF_ARGS=renderer-process-limit=1,disable-site-isolation-trials"
	[cef-lowend]="BENCH_CEF_ARGS=enable-low-end-device-mode"
	[cef-nosmooth]="BENCH_CEF_ARGS=disable-smooth-scrolling"
	[qt]=""
	[qt-reduce]=""
)
ORDER="wry wry-reduce wry-nocomp wry-nocomp-t4 wry-nocomp-reduce wry-nocomp-t4-reduce wry-nodmabuf
wry-skiacpu wry-skiacpu-t1 wry-skiacpu-t4 wry-fps30 wry-vblank wry-shm wry-msaa0
cef cef-reduce cef-swiftshader cef-raster1 cef-raster4 cef-1proc cef-lowend cef-nosmooth qt qt-reduce"

# The display each runtime gets. Under Wayland, wry and Qt go native; CEF has no Wayland path in
# Tauri's runtime and runs on Weston's XWayland, which is what a Wayland user gets.
case $display in
x11)
	DISP="DISPLAY=:99 COMPOSITOR=Xvfb"
	DISP_CEF=$DISP
	QPA=xcb
	;;
wayland)
	# A client that crashes XWayland takes Weston down with it: each run gets a fresh one.
	fresh() { "$here/display.sh" wayland | grep -o "XWAYLAND_DISPLAY=:[0-9]*" | cut -d= -f2; }
	xw=$(fresh)
	base="WAYLAND_DISPLAY=wayland-bench XDG_RUNTIME_DIR=$out/xdg XDG_SESSION_TYPE=wayland COMPOSITOR=weston|Xwayland"
	DISP="$base GDK_BACKEND=wayland"
	DISP_CEF="$base DISPLAY=$xw"
	QPA=wayland
	;;
*) exit 2 ;;
esac
# No audio device: GStreamer falls back to fakesink rather than playing the clips' tone.
SILENT="GST_PLUGIN_FEATURE_RANK=pulsesink:NONE,pipewiresink:NONE,alsasink:NONE"

for rep in $(seq 1 "$reps"); do
	for sc in ${SCENARIOS:-nav player}; do
		for name in $ORDER; do
			[[ $name =~ $only ]] || continue
			red=""
			[[ $name == *-reduce ]] && red="--reduce"
			shot=""
			[ "$display" = x11 ] && [ "$rep" = 1 ] && shot="SHOT=$out/shots/$display"
			args="$here/runner.mjs --name $name --scenario $sc --out $res/$name-$sc-$rep.json --timeout 220 $red"
			if [ "$display" = wayland ]; then
				xw=$(fresh)
				DISP_CEF="$base DISPLAY=$xw"
			fi
			echo "== $display $name $sc rep$rep"
			case $name in
			qt*)
				"$here/qt-env.sh" env -u DISPLAY $DISP ${ENVS[$name]} QT_QPA_PLATFORM=$QPA $shot \
					bash -c "$(command -v node) $args --bin $bin/qt" ;;
			cef*)
				env -u DISPLAY $DISP_CEF ${ENVS[$name]} $shot dbus-run-session -- node $args --bin "$bin/cef" ;;
			*)
				env -u DISPLAY $DISP $SILENT ${ENVS[$name]} $shot dbus-run-session -- node $args --bin "$bin/wry" ;;
			esac 2>&1 | grep -E "^ |: (done|timeout|app)"
			sleep 3
		done
	done
done
echo "MATRIX DONE $display"
