#!/usr/bin/env bash
# Where a phase spends its CPU: dev/bench/profile.sh <app pid> <output prefix>
# Meant as a runner hook (runner.mjs --hook home-idle:dev/bench/profile.sh). Over PROFILE_SECONDS
# (default 15) it writes, for the app's whole process tree:
#   <prefix>.threads.txt  CPU per thread, user and system (threads.py)
#   <prefix>.perf.data    perf samples with call graphs; report.sh turns them into tables
# perf samples the kernel side too where it is allowed to (the container's perf is), user space
# only otherwise: the threads file's system column has the kernel's share either way.
set -u
here=$(cd "$(dirname "$0")" && pwd)
pid=${1:?app pid}
prefix=${2:?output prefix}
secs=${PROFILE_SECONDS:-15}

tree() { # every pid under $1, itself included
	local p=$1
	echo "$p"
	for k in $(pgrep -P "$p"); do tree "$k"; done
}
pids=$(tree "$pid" | paste -sd,)

python3 "$here/threads.py" "$pid" "$secs" >"$prefix.threads.txt" &
if command -v perf >/dev/null; then
	ev=cycles
	perf stat -e cycles -p "$pid" -- true 2>/dev/null || ev=cycles:u
	perf record -q -e "$ev" -F "${PROFILE_HZ:-499}" --call-graph "${PROFILE_CALLGRAPH:-fp}" \
		-p "$pids" -o "$prefix.perf.data" -- sleep "$secs" 2>"$prefix.perf.log"
fi
wait
