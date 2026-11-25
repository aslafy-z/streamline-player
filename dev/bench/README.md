# Webview bench

Measures what the desktop UI costs in CPU, frame rate and memory on Linux, on each webview runtime
Tauri can host it with, and with the workarounds each one offers. It answers "is WebKitGTK the
problem, and what would fix it": the same build, the same page script, one app source built three
ways.

## What it runs

- **The page**: the desktop build (`TAURI_ENV_PLATFORM=linux`) behind the compare harness's Tauri
  shim (`dev/compare/shim.js`), talking to the mock Streamline through `dev/compare/bridge.py`,
  with the fake player plugin (a CSS picture stands in for mpv's video). Tauri freezes
  `__TAURI_INTERNALS__`, so the served build has every `__TAURI_` renamed `__BENCHT_` and so does
  the shim (`stack.sh`, `runner.mjs`).
- **The app** (`app/`): one window on that page with the shim and `driver.js` as its init script.
  `runtimes.sh` builds it on three runtimes:
  - `wry` Tauri 2.12.5 + WebKitGTK, what the player ships;
  - `cef` Tauri's CEF runtime, `tauri-apps/tauri` branch `feat/cef` (pinned), Chromium 151;
  - `qt` TauriQt (`Alper-Celik/TauriQt`, pinned), Qt 6.12 WebEngine (Chromium 140) from a pinned
    nixpkgs.
- **The script** (`driver.js`): runs inside the page, identical in every engine, no WebDriver or
  CDP. Two scenarios:
  - `nav`: home idle 20 s (the billboard rotating), home with its window out of focus 20 s (the
    billboard paused), home scroll 15 s, library scroll 15 s, detail and back 24 s, search typing
    12 s;
  - `player`: controls shown (pointer moving) 15 s, watching with controls hidden 25 s, scrubber
    hover 15 s.
- **The measure** (`runner.mjs`): at each phase boundary the driver posts a mark; the runner reads
  `/proc` for the whole process tree of the app (CPU ticks, PSS) and for the display server. The
  driver counts `requestAnimationFrame` frames and frames over 34 ms during active phases only, so
  idle phases keep the engine's frame clock quiet.

CPU is in % of one core. 100 % is one core busy, not the machine.

## What it measures, and what it does not

- **No GPU.** The container this was written in has no `/dev/dri`: Xvfb and Weston draw with Mesa's
  llvmpipe, Chromium falls back to its software compositor. Every pixel is drawn by the CPU, so the
  numbers rank the runtimes against each other; they are not what a machine with a GPU spends.
  Run it on real hardware before deciding anything.
- **No real video.** The player on Linux is libmpv in a `GtkGLArea` under the WebKitGTK webview
  (`plugins/tauri-plugin-player/src/view.rs`); here the picture is a CSS gradient. What is measured
  is the webview's own cost over the picture. CEF and Qt have no mpv path at all.
- **Wayland**: wry and Qt run native. Tauri's CEF runtime is X11 only (it forces
  `--ozone-platform=x11` and `GDK_BACKEND=x11` to reparent by XID), so it runs on XWayland, which is
  what a Wayland user gets. The display server's CPU (`display %`) counts Weston and XWayland.

## Running it

Ubuntu 24.04 packages used: `libwebkit2gtk-4.1-dev libgtk-3-dev libgtk-4-dev libmpv-dev ffmpeg
xvfb weston xwayland mesa-utils libgl1-mesa-dri dbus-x11`, plus nix for the Qt runtime. Everything
writes under `BENCH_OUT` (default `/tmp/streamline-bench`).

```sh
dev/bench/runtimes.sh                 # wry cef qt (or a subset); binaries in $BENCH_OUT/bin
dev/bench/stack.sh prepare            # engine, fixtures, the renamed desktop build
dev/bench/stack.sh up                 # engine, mock, proxy, bridge, page on :1440
dev/bench/display.sh x11              # or: wayland
dev/bench/matrix.sh x11 3             # every variant, 3 reps; a regex narrows: matrix.sh x11 1 '^wry'
python3 dev/bench/aggregate.py /tmp/streamline-bench/results/x11 > summary.md
```

One run by hand: `node dev/bench/runner.mjs --name wry --bin $BENCH_OUT/bin/wry --scenario nav`,
with the display in the environment. `--reduce` turns every animation and transition off and
reports `prefers-reduced-motion` as set. `SHOT=<dir>` grabs an X11 screenshot at each phase start:
check one before trusting a new setup, a blank page measures nothing.

Variants are the table at the top of `matrix.sh`: WebKitGTK environment variables (the names
WebKitGTK 2.52 reads, from `strings` on the library) and Chromium switches for CEF
(`BENCH_CEF_ARGS`, comma-separated, applied to the browser process).

`threads.py <pid> <seconds>` prints CPU per thread of a process tree, busiest first.

## Known traps

- CEF refuses to run as root with its sandbox: the bench app turns it off.
- A nix-built Qt finds no GL driver outside NixOS and aborts in `QGLXContext`: `qt-env.sh` points
  it at nixpkgs' Mesa.
- CEF on Linux burns about one core on its main thread at all times, rendering or not: the thread
  spins in `g_main_context_iteration` because Chromium's X11 source reports pending responses
  (`XSourcePrepare`/`XSourceCheck` → `HasPendingResponses`). No Chromium switch changes it. It is
  the runtime's event-loop integration, not Chromium's rendering.

Results: [`RESULTS.md`](RESULTS.md).
