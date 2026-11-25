"""CPU per thread of a process tree over a window, busiest first.

    python3 dev/bench/threads.py <root pid> <seconds>

Each line names the process (Chromium's --type, "browser" when it has none) and the thread. This
is how the CEF runtime's one-core floor was traced to its main thread rather than to rendering.
"""

import os
import sys
import time


def stat(path):
    with open(path) as f:
        s = f.read()
    fields = s[s.rindex(")") + 2 :].split()
    return s[s.index("(") + 1 : s.rindex(")")], int(fields[1]), int(fields[11]) + int(fields[12])


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
            kind = next((a.split("=", 1)[1] for a in cmd if a.startswith("--type=")), "browser")
            for t in os.listdir(f"/proc/{p}/task"):
                name, _, cpu = stat(f"/proc/{p}/task/{t}/stat")
                ticks[(p, kind, name)] = ticks.get((p, kind, name), 0) + cpu
        except OSError:
            continue
    return ticks


def main():
    root, seconds = int(sys.argv[1]), float(sys.argv[2])
    hz = os.sysconf("SC_CLK_TCK")
    before = snapshot(root)
    time.sleep(seconds)
    after = snapshot(root)
    rows = sorted(((after[k] - before.get(k, 0)) / hz / seconds * 100, k) for k in after)
    for pct, (pid, kind, name) in reversed(rows[-15:]):
        if pct > 0:
            print(f"{pct:6.1f}%  pid {pid} [{kind}] thread {name}")


if __name__ == "__main__":
    main()
