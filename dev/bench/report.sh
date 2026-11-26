#!/usr/bin/env bash
# Tables from a profile.sh capture: dev/bench/report.sh <prefix>.perf.data [min %]
# Writes, beside the capture:
#   .by-thread.txt   samples per thread name and library: who spends the time
#   .self.txt        samples per thread, library and function, callers left out: where it is spent
#   .inclusive.txt   functions with their callees' time added: which call trees carry it
#   .callers.txt     the call chains under the busiest functions
# Function names need the libraries' debug symbols (container/Dockerfile installs them).
set -eu
data=${1:?perf.data}
min=${2:-0.3}
base=${data%.perf.data}
rep() { perf report -i "$data" --stdio --percent-limit "$min" "$@" 2>/dev/null | grep -v '^$'; }

rep --no-children -g none --sort comm,dso >"$base.by-thread.txt"
rep --no-children -g none --sort comm,dso,sym >"$base.self.txt"
rep --children -g none --sort sym >"$base.inclusive.txt"
rep --no-children -g caller,2,callee --max-stack 24 --sort sym --percent-limit 2 >"$base.callers.txt"
wc -l "$base".*.txt
