#!/usr/bin/env bash
# The bench in a container that has no GPU: dev/bench/container.sh build|up|sh|run <cmd…>|root <cmd…>|down
#   build  the image (container/Dockerfile): Ubuntu 24.04, its WebKitGTK and Mesa, perf, debug symbols
#   up     starts it: BENCH_CPUS logical CPUs (default 0,2,4,6), no /dev/dri, the repository at its
#          own path, BENCH_CACHE (default ~/.cache/streamline-bench) at /bench
#   run    a command inside, as the calling user, from the repository root
#   root   the same as root: perf needs it to sample the kernel side
#   sh     a shell inside
# Inside, BENCH_OUT is /bench/out and HOME is /bench/home, so builds and results outlive the
# container and stay off /tmp.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
top=$(cd "$here/../.." && pwd)
# A git worktree keeps its metadata in the main checkout: mount that one, so git works inside.
common=$(cd "$top" && cd "$(git rev-parse --git-common-dir)/.." && pwd)
cache=${BENCH_CACHE:-$HOME/.cache/streamline-bench}
name=${BENCH_CONTAINER:-streamline-bench}
image=${BENCH_IMAGE:-streamline-bench:noble}
engine=${BENCH_ENGINE:-docker}

case ${1:-sh} in
build)
	"$engine" build -t "$image" "$here/container"
	;;
up)
	mkdir -p "$cache/home" "$cache/out"
	"$engine" rm -f "$name" >/dev/null 2>&1 || true
	# seccomp and the two capabilities are what perf_event_open and ptrace need.
	"$engine" run -d --name "$name" --init \
		--cpuset-cpus "${BENCH_CPUS:-0,2,4,6}" --shm-size 2g \
		--security-opt seccomp=unconfined --cap-add SYS_PTRACE --cap-add PERFMON \
		--user "$(id -u):$(id -g)" -e HOME=/bench/home -e BENCH_OUT=/bench/out \
		-e CARGO_HOME=/bench/home/.cargo \
		-v "$common:$common" -v "$cache:/bench" -w "$top" "$image" sleep infinity
	;;
run)
	shift
	"$engine" exec -w "$top" "$name" "$@"
	;;
root)
	shift
	"$engine" exec -u 0 -w "$top" "$name" "$@"
	;;
sh)
	"$engine" exec -it -w "$top" "$name" bash
	;;
down)
	"$engine" rm -f "$name"
	;;
*)
	exit 2
	;;
esac
