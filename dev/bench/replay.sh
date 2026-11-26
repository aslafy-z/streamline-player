#!/usr/bin/env bash
# The "without a GPU" comparison of RESULTS.md, start to finish, the same way each time:
#   dev/bench/replay.sh [reps] [distro…]        (2 reps, noble and arch by default)
# For each distro it starts the container if it is not up, serves the page of REPLAY_FRONT (a
# checkout, this one by default), and runs on X11:
#   window       the bench's own window: the home page and the single-animation pages across the
#                ways of drawing the page
#   player       the same home page and the bar with the player plugin's video layer under them
#                (binary wry): attached, playing, stopped
#   player-next  the same with the binary wry-next, when runtimes.sh built one (another
#                checkout's plugin, BENCH_WRY=wry-next BENCH_PLAYER_PLUGIN=… runtimes.sh wry)
# Results go to $BENCH_CACHE/out/replay/<stamp>/<distro>/<series>/x11, one summary per series
# beside them. Needs the images (container.sh build) and the binaries (runtimes.sh wry, in the
# noble container): it measures, it does not build.
set -u
here=$(cd "$(dirname "$0")" && pwd)
reps=${1:-2}
shift || true
distros=${*:-noble arch}
front=$(cd "${REPLAY_FRONT:-$here/../..}" && pwd)
cache=${BENCH_CACHE:-$HOME/.cache/streamline-bench}
stamp=$(date +%Y%m%d-%H%M)

# The variants that draw the page differently; each WebKitGTK version ignores the ones that are
# its default (damage: on in 2.54; nodamage: off in 2.52).
WAYS='^wry(-soft|-nodmabuf|-nodmabuf-soft|-nocomp|-never-reload)?$'
DAMAGE='^wry(-damage|-nodamage|-nodmabuf)?$'

for distro in $distros; do
	export BENCH_DISTRO=$distro
	inside() { "$here/container.sh" run env "$@"; }
	docker ps --format '{{.Names}}' | grep -qx "streamline-bench-$distro" || "$here/container.sh" up >/dev/null
	# The page is built where the toolchain is, and served from the cache both images mount.
	[ "$distro" = noble ] && inside BENCH_FRONT="$front" dev/bench/stack.sh front
	inside dev/bench/stack.sh up
	inside dev/bench/display.sh x11
	results=/bench/out/replay/$stamp/$distro
	echo "## $distro: window"
	inside BENCH_RESULTS="$results/window" SCENARIOS=home dev/bench/matrix.sh x11 "$reps" "$WAYS"
	inside BENCH_RESULTS="$results/window" SCENARIOS="anim-still anim-bar anim-zoom" dev/bench/matrix.sh x11 "$reps" "$DAMAGE"
	for series in player player-next; do
		binary=wry
		[ "$series" = player-next ] && binary=wry-next
		[ -e "$cache/out/bin/$binary" ] || continue
		echo "## $distro: $series"
		inside BENCH_RESULTS="$results/$series" BENCH_WRY=$binary BENCH_PLAYER=1 SCENARIOS=home dev/bench/matrix.sh x11 "$reps" '^wry(-soft)?$'
		inside BENCH_RESULTS="$results/$series" BENCH_WRY=$binary SCENARIOS="attached-bar play-bar played-bar" dev/bench/matrix.sh x11 "$reps" '^wry$'
	done
	for series in window player player-next; do
		[ -d "$cache/out/replay/$stamp/$distro/$series/x11" ] || continue
		python3 "$here/aggregate.py" "$cache/out/replay/$stamp/$distro/$series/x11" \
			>"$cache/out/replay/$stamp/$distro/$series.md" 2>"$cache/out/replay/$stamp/$distro/$series.skipped"
	done
done
echo "REPLAY DONE $cache/out/replay/$stamp"
