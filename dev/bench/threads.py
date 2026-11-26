"""CPU per thread of a process tree over a window, busiest first.

    python3 dev/bench/threads.py <root pid> <seconds>

Each line gives the thread's CPU in % of one core (total, then user and system), the process (its
name, and Chromium's --type when it has one) and the thread. Threads of one process that share a
name up to a trailing number (a pool) are also summed on a line of their own. This is how the CEF
runtime's one-core floor was traced to its main thread rather than to rendering.
"""

import os
import re
import sys
import time


def stat(path):
    with open(path) as f:
        s = f.read()
    fields = s[s.rindex(")") + 2 :].split()
    return s[s.index("(") + 1 : s.rindex(")")], int(fields[1]), (int(fields[11]), int(fields[12]))


def tree(root):
    kids = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            _, ppid, _ = stat(f"/proc/{d}/stat")
        except OSError:
            continue
        kids.setdefault(ppid, []).append(int(d))
    found, todo = [], [root]
    while todo:
        p = todo.pop()
        found.append(p)
        todo += kids.get(p, [])
    return found


def snapshot(root):
    ticks = {}
    for p in tree(root):
        try:
            with open(f"/proc/{p}/cmdline") as f:
                cmd = f.read().split("\0")
            comm, _, _ = stat(f"/proc/{p}/stat")
            kind = next((a.split("=", 1)[1] for a in cmd if a.startswith("--type=")), None)
            proc = f"{comm}:{kind}" if kind else comm
            for t in os.listdir(f"/proc/{p}/task"):
                name, _, cpu = stat(f"/proc/{p}/task/{t}/stat")
                ticks[(p, proc, name, int(t))] = cpu
        except OSError:
            continue
    return ticks


def main():
    root, seconds = int(sys.argv[1]), float(sys.argv[2])
    hz = os.sysconf("SC_CLK_TCK")
    before = snapshot(root)
    time.sleep(seconds)
    after = snapshot(root)
    pct = lambda ticks: ticks / hz / seconds * 100
    rows, pools, procs = [], {}, {}
    for key, (user, system) in after.items():
        u0, s0 = before.get(key, (0, 0))
        u, s = pct(user - u0), pct(system - s0)
        pid, proc, name, _tid = key
        rows.append((u + s, u, s, pid, proc, name))
        pool = (pid, proc, re.sub(r"[-:#/ ]?\d+$", "", name) + "*")
        a = pools.setdefault(pool, [0, 0, 0, 0])
        a[0] += u + s; a[1] += u; a[2] += s; a[3] += 1
        b = procs.setdefault((pid, proc), [0, 0, 0])
        b[0] += u + s; b[1] += u; b[2] += s
    line = lambda t, u, s, pid, proc, what: f"{t:6.1f}%  user {u:6.1f}%  sys {s:6.1f}%  pid {pid} [{proc}] {what}"
    print("# per process")
    for (pid, proc), (t, u, s) in sorted(procs.items(), key=lambda kv: -kv[1][0]):
        if t > 0:
            print(line(t, u, s, pid, proc, ""))
    print("# per thread pool (threads of one process named alike)")
    for (pid, proc, name), (t, u, s, n) in sorted(pools.items(), key=lambda kv: -kv[1][0]):
        if t > 0 and n > 1:
            print(line(t, u, s, pid, proc, f"{name} x{n}"))
    print("# per thread")
    for t, u, s, pid, proc, name in sorted(rows, reverse=True)[:40]:
        if t > 0:
            print(line(t, u, s, pid, proc, f"thread {name}"))


if __name__ == "__main__":
    main()
