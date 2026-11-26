#!/usr/bin/env bash
# Runs variants × scenarios × reps: dev/bench/matrix.sh x11|wayland [reps] [variant-regex]
# SCENARIOS="nav player" (the default) narrows the scenarios: nav, home (its two home phases
# alone), player, anim-bar|zoom|spin|width|still (one page of pages/anim.html, held), and
# attached-bar|still, play-bar|still and played-bar|still: that page with the player plugin's
# real video layer under it, nothing played yet, playing the bench's clip (the page see-through),
# or stopped again after a second of it.
# HOOK=<phase>:dev/bench/profile.sh captures that phase of every run (README).
# Needs stack.sh up, display.sh <same display> started and runtimes.sh built. Results go to
# $BENCH_RESULTS/<display>/<variant>-<scenario>-<rep>.json (BENCH_RESULTS: $BENCH_OUT/results by
# default); aggregate.py makes the tables.
# Reps are interleaved (every variant once, then again) so drift spreads across variants.
set -u
here=$(cd "$(dirname "$0")" && pwd)
out=${BENCH_OUT:-/tmp/streamline-bench}
display=${1:?x11|wayland}
reps=${2:-1}
only=${3:-.}
bin=$out/bin
# BENCH_WRY: the wry binary to run, when runtimes.sh built more than one.
wry=${BENCH_WRY:-wry}
res=${BENCH_RESULTS:-$out/results}/$display
mkdir -p "$res"

# variant -> environment. A name ending in -reduce adds --reduce (animations and transitions off);
# one ending in -soft adds --soft (the page is told it is drawn on the CPU, as the real app tells it).
# Beside WebKitGTK's own variables: BENCH_ACCEL and BENCH_FEATURES are what the bench app sets on
# the web view's settings (never: hardware acceleration policy NEVER; damage: composition limited
# to the damaged region, off by default in 2.52 and on in 2.54), LP_NUM_THREADS is llvmpipe's
# rasterizer thread count, BENCH_SIZE the window. reload: the web process is restarted once the
# settings are in, so the page starts with them (the damage variants always do). underlay: a
# GtkGLArea under the web view, as in the player; see: the web view's background transparent;
# hidden: the area never shown; hide and drop: shown, then hidden or removed before the measure;
# late and cycle: hidden at first, shown before the measure (cycle: shown, hidden, shown). texmap: WebKitGTK 2.54 composites with Skia,
# this takes it back to the TextureMapper compositor of 2.52.
declare -A ENVS=(
	[wry]=""
	[wry-reduce]=""
	[wry-soft]=""
	[wry-nocomp]="WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-nocomp-t4]="WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-nocomp-reduce]="WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-nocomp-soft]="WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-nocomp-t4-reduce]="WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-nodmabuf]="WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-nodmabuf-soft]="WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-skiacpu]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1"
	[wry-skiacpu-t1]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=1"
	[wry-skiacpu-t4]="WEBKIT_SKIA_ENABLE_CPU_RENDERING=1 WEBKIT_SKIA_CPU_PAINTING_THREADS=4"
	[wry-fps30]="WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS=30"
	[wry-vblank]="WEBKIT_FORCE_VBLANK_TIMER=1"
	[wry-shm]="WEBKIT_DMABUF_RENDERER_FORCE_SHM=1"
	[wry-msaa0]="WEBKIT_SKIA_MSAA_SAMPLE_COUNT=0"
	[wry-never]="BENCH_ACCEL=never"
	[wry-never-reload]="BENCH_ACCEL=never BENCH_RELOAD=1"
	[wry-nocomp-nodmabuf]="WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-underlay]="BENCH_UNDERLAY=opaque"
	[wry-underlay-see]="BENCH_UNDERLAY=seethrough"
	[wry-underlay-hidden]="BENCH_UNDERLAY=hidden"
	[wry-underlay-see-late]="BENCH_UNDERLAY=seethrough BENCH_UNDERLAY_THEN=show"
	[wry-underlay-see-cycle]="BENCH_UNDERLAY=seethrough BENCH_UNDERLAY_THEN=cycle"
	[wry-underlay-hide]="BENCH_UNDERLAY=opaque BENCH_UNDERLAY_THEN=hide"
	[wry-underlay-drop]="BENCH_UNDERLAY=opaque BENCH_UNDERLAY_THEN=drop"
	[wry-underlay-hidden-nodmabuf]="BENCH_UNDERLAY=hidden WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-underlay-hide-nodmabuf]="BENCH_UNDERLAY=opaque BENCH_UNDERLAY_THEN=hide WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-underlay-drop-nodmabuf]="BENCH_UNDERLAY=opaque BENCH_UNDERLAY_THEN=drop WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-underlay-never-reload]="BENCH_UNDERLAY=opaque BENCH_ACCEL=never BENCH_RELOAD=1"
	[wry-underlay-see-never-reload]="BENCH_UNDERLAY=seethrough BENCH_ACCEL=never BENCH_RELOAD=1"
	[wry-underlay-see-nodmabuf]="BENCH_UNDERLAY=seethrough WEBKIT_DISABLE_DMABUF_RENDERER=1"
	[wry-underlay-see-nocomp]="BENCH_UNDERLAY=seethrough WEBKIT_DISABLE_COMPOSITING_MODE=1"
	[wry-damage]="BENCH_FEATURES=UseDamagingInformationForCompositing=1"
	[wry-damage-skiacpu]="BENCH_FEATURES=UseDamagingInformationForCompositing=1 WEBKIT_SKIA_ENABLE_CPU_RENDERING=1"
	[wry-damage-lp1]="BENCH_FEATURES=UseDamagingInformationForCompositing=1 LP_NUM_THREADS=1"
	[wry-nodamage]="BENCH_FEATURES=UseDamagingInformationForCompositing=0"
	[wry-texmap]="WEBKIT_USE_SKIA_FOR_COMPOSITION=0"
	[wry-lp0]="LP_NUM_THREADS=0"
	[wry-lp1]="LP_NUM_THREADS=1"
	[wry-lp2]="LP_NUM_THREADS=2"
	[wry-gpupaint0]="WEBKIT_SKIA_GPU_PAINTING_THREADS=0"
	[wry-s720]="BENCH_SIZE=720x450"
	[wry-s1920]="BENCH_SIZE=1920x1080"
	[wry-nocomp-s720]="WEBKIT_DISABLE_COMPOSITING_MODE=1 BENCH_SIZE=720x450"
	[wry-nocomp-s1920]="WEBKIT_DISABLE_COMPOSITING_MODE=1 BENCH_SIZE=1920x1080"
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
ORDER="wry wry-reduce wry-soft wry-nocomp wry-nocomp-soft wry-nocomp-t4 wry-nocomp-reduce wry-nocomp-t4-reduce wry-nodmabuf wry-nodmabuf-soft
wry-skiacpu wry-skiacpu-t1 wry-skiacpu-t4 wry-fps30 wry-vblank wry-shm wry-msaa0
wry-never wry-never-reload wry-nocomp-nodmabuf wry-damage wry-damage-skiacpu wry-damage-lp1 wry-nodamage wry-texmap wry-lp0 wry-lp1 wry-lp2 wry-gpupaint0
wry-s720 wry-s1920 wry-nocomp-s720 wry-nocomp-s1920
wry-underlay-hidden wry-underlay-see-late wry-underlay-see-cycle wry-underlay-hide wry-underlay-drop wry-underlay-hidden-nodmabuf wry-underlay-hide-nodmabuf wry-underlay-drop-nodmabuf
wry-underlay wry-underlay-see wry-underlay-never-reload wry-underlay-see-never-reload wry-underlay-see-nodmabuf wry-underlay-see-nocomp
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
			[[ $name == *-soft ]] && red="--soft"
			shot=""
			[ "$rep" = 1 ] && shot="SHOT=$res-shots"
			scenario="--scenario $sc"
			[[ $sc == anim-* ]] && scenario="--scenario hold --label $sc --url http://127.0.0.1:1440/_bench/anim.html?kind=${sc#anim-}"
			player=""
			if [[ $sc == attached-* || $sc == play-* || $sc == played-* ]]; then
				page="http://127.0.0.1:1440/_bench/anim.html?kind=${sc#*-}"
				[[ $sc == play-* ]] && page="$page&bg=none&play=file://$out/media/h.mkv"
				[[ $sc == played-* ]] && page="$page&play=file://$out/media/h.mkv&stop=1000"
				scenario="--scenario hold --label $sc --url $page"
				player="BENCH_PLAYER=1"
			fi
			# Over the underlay the page is the player's: transparent but for what moves.
			[[ $sc == anim-* && $name == *-underlay-see* ]] && scenario="$scenario&bg=none"
			hook=""
			[ -n "${HOOK:-}" ] && hook="--hook $HOOK"
			args="$here/runner.mjs --name $name $scenario --out $res/$name-$sc-$rep.json --timeout 220 $red $hook"
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
				env -u DISPLAY $DISP $SILENT ${ENVS[$name]} $player $shot dbus-run-session -- node $args --bin "$bin/$wry" ;;
			esac 2>&1 | grep -E "^ |: (done|timeout|app)"
			sleep 3
		done
	done
done
echo "MATRIX DONE $display"
