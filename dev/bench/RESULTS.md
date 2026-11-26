# Bench results

Measured 2026-11-25 with this harness (README) in a cloud container: 4 vCPU, no GPU (every pixel
drawn by the CPU through Mesa llvmpipe or Chromium's software compositor), Ubuntu 24.04,
WebKitGTK 2.52.6, Tauri 2.12.5; CEF 151 from `tauri-apps/tauri@9d1a5b17` (`feat/cef`); Qt 6.12.0
WebEngine (Chromium 140) from TauriQt `@db3f29b1`. Window 1440×900.

Cells are the median CPU in % of one core over the phase (the app's whole process tree, display
server excluded), with frames per second for the phases that move. "Player, watching" is playback
with the controls hidden. Medians over `n` reps; between reps the same variant moved by under 5 %.

Read them as a ranking of runtimes and workarounds without a GPU, not as what a desktop with one
spends.

## X11 (Xvfb): runtimes, and cutting motion

`-reduce`: every animation and transition off, `prefers-reduced-motion` reported as set.
`wry-nocomp`: `WEBKIT_DISABLE_COMPOSITING_MODE=1`.

| variant | n | Home idle | Home scroll | Library scroll | Detail ↔ back | Search typing | Player, controls | Player, watching | PSS MB (nav) |
|---|---|---|---|---|---|---|---|---|---|
| `cef` | 3 | 164 % | 206 %, 59 fps | 259 %, 60 fps | 137 %, 58 fps | 120 % | 120 %, 60 fps | 102 % | 858 |
| `cef-reduce` | 3 | 109 % | 283 %, 56 fps | 254 %, 60 fps | 127 %, 58 fps | 120 % | 120 %, 60 fps | 101 % | 864 |
| `qt` | 3 | 231 % | 233 %, 43 fps | 254 %, 37 fps | 74 %, 55 fps | 40 % | 212 %, 60 fps | 4 % | 714 |
| `qt-reduce` | 3 | 44 % | 272 %, 35 fps | 256 %, 38 fps | 42 %, 58 fps | 40 % | 214 %, 60 fps | 4 % | 716 |
| `wry` | 3 | 284 % | 256 %, 13 fps | 220 %, 16 fps | 94 %, 40 fps | 59 % | 288 %, 33 fps | 4 % | 883 |
| `wry-nocomp` | 3 | 103 % | 106 %, 33 fps | 107 %, 30 fps | 29 %, 56 fps | 16 % | 19 %, 64 fps | 2 % | 382 |
| `wry-reduce` | 3 | 106 % | 243 %, 19 fps | 222 %, 18 fps | 79 %, 43 fps | 57 % | 294 %, 34 fps | 4 % | 867 |

## X11 (Xvfb): WebKitGTK workarounds and CEF switches

WebKitGTK: `nocomp` `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `-t1`/`-t4`
`WEBKIT_SKIA_CPU_PAINTING_THREADS`, `skiacpu` `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`, `fps30`
`WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS=30`, `vblank` `WEBKIT_FORCE_VBLANK_TIMER=1`, `shm`
`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, `msaa0` `WEBKIT_SKIA_MSAA_SAMPLE_COUNT=0`. CEF: `raster1`/`4`
`--num-raster-threads`, `1proc` `--renderer-process-limit=1 --disable-site-isolation-trials`,
`lowend` `--enable-low-end-device-mode`, `nosmooth` `--disable-smooth-scrolling`, `swiftshader`
`--ignore-gpu-blocklist --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

| variant | n | Home idle | Home scroll | Library scroll | Detail ↔ back | Search typing | Player, controls | Player, watching | PSS MB (nav) |
|---|---|---|---|---|---|---|---|---|---|
| `cef` | 1 | 162 % | 200 %, 58 fps | 252 %, 60 fps | 133 %, 59 fps | 118 % | 118 %, 60 fps | 102 % | 858 |
| `cef-1proc` | 1 | 161 % | 199 %, 59 fps | 255 %, 60 fps | 133 %, 58 fps | 118 % | 119 %, 60 fps | 101 % | 847 |
| `cef-lowend` | 1 | 160 % | 200 %, 59 fps | 251 %, 60 fps | 135 %, 58 fps | 119 % | 118 %, 60 fps | 101 % | 870 |
| `cef-nosmooth` | 1 | 163 % | 204 %, 59 fps | 268 %, 60 fps | 136 %, 58 fps | 119 % | 118 %, 60 fps | 101 % | 852 |
| `cef-raster1` | 1 | 161 % | 191 %, 55 fps | 249 %, 60 fps | 134 %, 57 fps | 118 % | 119 %, 60 fps | 102 % | 867 |
| `cef-raster4` | 1 | 164 % | 201 %, 59 fps | 252 %, 60 fps | 133 %, 59 fps | 117 % | 118 %, 60 fps | 101 % | 847 |
| `cef-swiftshader` | 1 | 162 % | 206 %, 58 fps | 267 %, 60 fps | 134 %, 58 fps | 117 % | 118 %, 60 fps | 101 % | 843 |
| `wry` | 1 | 278 % | 255 %, 12 fps | 216 %, 15 fps | 94 %, 40 fps | 58 % | 290 %, 33 fps | 4 % | 852 |
| `wry-fps30` | 1 | 282 % | 254 %, 13 fps | 215 %, 16 fps | 92 %, 23 fps | 56 % | 257 %, 30 fps | 4 % | 905 |
| `wry-msaa0` | 1 | 286 % | 257 %, 13 fps | 218 %, 16 fps | 96 %, 40 fps | 59 % | 290 %, 33 fps | 4 % | 902 |
| `wry-nocomp` | 1 | 106 % | 105 %, 31 fps | 106 %, 28 fps | 29 %, 55 fps | 16 % | 18 %, 64 fps | 2 % | 411 |
| `wry-nocomp-t4` | 1 | 105 % | 107 %, 34 fps | 108 %, 30 fps | 28 %, 57 fps | 16 % | 19 %, 64 fps | 2 % | 413 |
| `wry-shm` | 1 | 287 % | 254 %, 13 fps | 217 %, 16 fps | 97 %, 39 fps | 59 % | 290 %, 34 fps | 4 % | 850 |
| `wry-skiacpu` | 1 | 290 % | 254 %, 14 fps | 217 %, 17 fps | 95 %, 41 fps | 47 % | 293 %, 40 fps | 4 % | 617 |
| `wry-skiacpu-t1` | 1 | 289 % | 253 %, 14 fps | 218 %, 18 fps | 85 %, 43 fps | 45 % | 285 %, 38 fps | 4 % | 618 |
| `wry-skiacpu-t4` | 1 | 288 % | 255 %, 14 fps | 219 %, 18 fps | 87 %, 44 fps | 46 % | 293 %, 40 fps | 4 % | 631 |
| `wry-vblank` | 1 | 286 % | 259 %, 13 fps | 220 %, 16 fps | 96 %, 40 fps | 57 % | 292 %, 34 fps | 4 % | 902 |

## What they say

- **WebKitGTK's composited path is the cost**: without compositing the same pages take 2 to 15
  times less CPU, scroll at twice the frame rate and use half the memory. Its scroll stays near
  30 fps, one painting thread saturated (≈ 105 %). Four painting threads (`-t4`) add a few frames
  and fewer long ones at the same CPU.
- **Only the home page pays for motion when idle, and only without a GPU** (see "With a GPU" below): the billboard's continuous zoom over a
  full-screen backdrop and its 100 ms progress tick. Cutting motion takes home idle from 284 % to
  106 % (WebKitGTK) and 231 % to 44 % (Qt); scrolling and the player do not change.
- `skiacpu` saves about a quarter of the memory and little else; `fps30` helps only the player
  controls and slows navigation; `msaa0`, `shm` and `vblank` act on a GPU/DMABUF path this machine
  does not have, so they measure nothing here.
- **CEF holds 60 fps everywhere but never drops under one core**: its main thread spins in
  `g_main_context_iteration` (README, "Known traps"). No Chromium switch moves it, and
  `--use-angle=swiftshader` does not bring up a GPU path here (no WebGL either way).
- **Qt** scrolls at 35–43 fps, holds 60 fps in the player and idles clean (4 % while watching).

## Wayland (headless Weston)

Weston 13 on its headless backend with the GL renderer (llvmpipe) and XWayland, one rep per
variant, a fresh Weston for each run. WebKitGTK and Qt run as native Wayland clients; Tauri's CEF
runtime is X11 only and runs on XWayland, as it would on a Wayland desktop. The same variants as
above, plus `wry-nodmabuf` (`WEBKIT_DISABLE_DMABUF_RENDERER=1`, the workaround Tauri's docs give)
and `nocomp` combined with `-reduce`.

| variant | n | Home idle | Home scroll | Library scroll | Detail ↔ back | Search typing | Player, controls | Player, watching | PSS MB (nav) |
|---|---|---|---|---|---|---|---|---|---|
| `cef` | 1 | 189 % | 210 %, 46 fps | 255 %, 44 fps | 136 %, 57 fps | 120 % | 121 %, 60 fps | 101 % | 882 |
| `cef-1proc` | 1 | 188 % | 208 %, 48 fps | 256 %, 44 fps | 136 %, 57 fps | 118 % | 120 %, 60 fps | 102 % | 871 |
| `cef-lowend` | 1 | 191 % | 209 %, 46 fps | 257 %, 43 fps | 137 %, 57 fps | 120 % | 120 %, 60 fps | 101 % | 855 |
| `cef-nosmooth` | 1 | 189 % | 209 %, 49 fps | 259 %, 46 fps | 136 %, 57 fps | 119 % | 121 %, 60 fps | 101 % | 898 |
| `cef-raster1` | 1 | 191 % | 200 %, 45 fps | 234 %, 38 fps | 136 %, 56 fps | 118 % | 120 %, 60 fps | 102 % | 876 |
| `cef-raster4` | 1 | 191 % | 214 %, 45 fps | 257 %, 44 fps | 136 %, 56 fps | 118 % | 119 %, 60 fps | 101 % | 873 |
| `cef-reduce` | 1 | 108 % | 266 %, 32 fps | 258 %, 45 fps | 128 %, 58 fps | 121 % | 122 %, 60 fps | 101 % | 895 |
| `cef-swiftshader` | 1 | 190 % | 210 %, 46 fps | 256 %, 44 fps | 137 %, 57 fps | 121 % | 119 %, 60 fps | 100 % | 851 |
| `qt` | 1 | 240 % | 244 %, 28 fps | 258 %, 24 fps | 85 %, 50 fps | 51 % | 217 %, 36 fps | 5 % | 852 |
| `qt-reduce` | 1 | 67 % | 283 %, 21 fps | 262 %, 24 fps | 54 %, 56 fps | 53 % | 210 %, 36 fps | 5 % | 831 |
| `wry` | 1 | 286 % | 259 %, 6 fps | 227 %, 12 fps | 107 %, 37 fps | 71 % | 275 %, 20 fps | 4 % | 960 |
| `wry-fps30` | 1 | 289 % | 260 %, 7 fps | 228 %, 12 fps | 106 %, 21 fps | 67 % | 268 %, 20 fps | 5 % | 954 |
| `wry-msaa0` | 1 | 285 % | 257 %, 10 fps | 228 %, 12 fps | 109 %, 37 fps | 70 % | 273 %, 20 fps | 5 % | 984 |
| `wry-nocomp` | 1 | 103 % | 110 %, 21 fps | 110 %, 21 fps | 34 %, 52 fps | 18 % | 16 %, 63 fps | 2 % | 438 |
| `wry-nocomp-reduce` | 1 | 5 % | 110 %, 24 fps | 110 %, 20 fps | 29 %, 54 fps | 18 % | 17 %, 63 fps | 2 % | 442 |
| `wry-nocomp-t4` | 1 | 103 % | 110 %, 21 fps | 110 %, 21 fps | 35 %, 52 fps | 18 % | 18 %, 63 fps | 2 % | 435 |
| `wry-nocomp-t4-reduce` | 1 | 5 % | 110 %, 23 fps | 111 %, 22 fps | 26 %, 55 fps | 17 % | 16 %, 64 fps | 2 % | 442 |
| `wry-nodmabuf` | 1 | 100 % | 110 %, 22 fps | 112 %, 22 fps | 31 %, 54 fps | 18 % | 17 %, 63 fps | 2 % | 431 |
| `wry-reduce` | 1 | 143 % | 248 %, 14 fps | 229 %, 13 fps | 93 %, 41 fps | 68 % | 278 %, 22 fps | 4 % | 956 |
| `wry-shm` | 1 | 289 % | 262 %, 10 fps | 229 %, 12 fps | 101 %, 40 fps | 70 % | 278 %, 21 fps | 4 % | 976 |
| `wry-skiacpu` | 1 | 283 % | 253 %, 11 fps | 228 %, 14 fps | 101 %, 41 fps | 59 % | 274 %, 23 fps | 4 % | 689 |
| `wry-skiacpu-t1` | 1 | 283 % | 254 %, 11 fps | 226 %, 13 fps | 90 %, 42 fps | 57 % | 265 %, 20 fps | 4 % | 677 |
| `wry-skiacpu-t4` | 1 | 284 % | 255 %, 11 fps | 224 %, 12 fps | 95 %, 42 fps | 58 % | 274 %, 22 fps | 4 % | 687 |
| `wry-vblank` | 1 | 286 % | 256 %, 8 fps | 229 %, 12 fps | 102 %, 39 fps | 69 % | 272 %, 22 fps | 4 % | 975 |

The display server's own CPU (Weston, plus XWayland for CEF), which the table above leaves out:

| variant | Home idle | Home scroll | Library scroll | Player, controls | Player, watching |
|---|---|---|---|---|---|
| `wry` | 22 % | 18 % | 19 % | 31 % | 1 % |
| `wry-nocomp` | 24 % | 32 % | 32 % | 2 % | 0 % |
| `wry-nodmabuf` | 24 % | 34 % | 35 % | 2 % | 0 % |
| `wry-nocomp-reduce` | 1 % | 36 % | 31 % | 2 % | 0 % |
| `cef` | 91 % | 99 % | 102 % | 3 % | 0 % |
| `cef-reduce` | 1 % | 83 % | 103 % | 3 % | 0 % |
| `qt` | 44 % | 43 % | 36 % | 58 % | 1 % |
| `qt-reduce` | 16 % | 34 % | 37 % | 57 % | 1 % |

- **Wayland is harder on WebKitGTK's composited path than X11**: home scroll at 6 fps (13 on X11),
  the player's controls at 20 fps (33), for the same CPU.
- **Without compositing it is the same win as on X11**: about 110 % and 21–24 fps while scrolling,
  16–18 % and 63 fps with the player's controls. `WEBKIT_DISABLE_DMABUF_RENDERER=1` lands on the
  same profile here: with no GPU to hand buffers to, it drops to the same CPU path.
- **The home page's idle floor is the billboard**: compositing off and motion cut,
  `wry-nocomp-reduce` idles at 5 %, Weston at 1 %. Neither alone goes under 100 %.
- **CEF on XWayland**: the player holds 60 fps and scrolling drops to 44–49 fps (60 on X11), but the
  copy through XWayland costs Weston and XWayland 90–100 % on top whenever the page moves, and the
  one-core floor of CEF's own main thread is there as on X11 (101 % while watching). No switch
  moves either.
- **Qt native on Wayland** scrolls at 24–28 fps and shows the player's controls at 36 fps (37–43 and
  60 on X11), with Weston at 35–58 %; motion cut, its home idles at 67 % (44 % on X11).
- `skiacpu`, `fps30`, `msaa0`, `shm` and `vblank` behave as on X11: memory for the first, nothing
  measurable for the others without a GPU.

## The billboard, paused when nobody can see it

Measured 2026-11-25 on the same kind of container (4 vCPU, no GPU), `wry` and `wry-nocomp`, 3 reps,
before and after the billboard change (`perf/home-billboard-idle`: the progress bar and the zoom
as CSS animations with one timeout per slide in place of a 100 ms tick, and everything paused
while the window has no focus, the page is hidden or less than half of the billboard is on
screen). "Home idle" is the billboard rotating in a focused window, as in the tables above; "Home,
out of focus" is the new `home-paused` phase, the same page after its window lost focus. Median
CPU in % of one core, with the range over the 3 reps.

| display | variant | Home idle, before | Home idle, after | Home, out of focus, before | Home, out of focus, after |
|---|---|---|---|---|---|
| X11 | `wry` | 282 % (281–283) | 282 % (277–285) | 286 % (282–286) | 0 % (0–0) |
| X11 | `wry-nocomp` | 104 % (104–105) | 105 % (104–106) | 105 % (104–105) | 0 % (0–0) |
| Wayland | `wry` | 289 % (286–294) | 286 % (286–289) | 294 % (293–294) | 0 % (0–0) |
| Wayland | `wry-nocomp` | 103 % (101–103) | 108 % (108–108) | 101 % (100–104) | 0 % (0–0) |

The display server follows: Xvfb from 19 % (`wry`) and 7 % (`wry-nocomp`) to 0 %, Weston from 23 %
to 0 %.

- **A billboard nobody can see costs nothing**: under 1 % on both variants and both display
  servers, where it cost as much out of focus as in focus.
- **A billboard in use costs what it did**: the zoom over the full-screen backdrop is the cost, and
  it is still drawn on every frame while the window has focus. Removing the 100 ms tick alone does
  not show without a GPU.
- **One regression, 5 points**: `wry-nocomp` on Wayland idles at 108 % where it idled at 103 %, and
  draws fewer frames (19.5 fps against 24 with a frame counter running). Rebuilding the old page
  the same day gives 102 % again, so it is the change and not the machine. It is not the
  `will-change` layer, the progress bar, the zoom being an animation instead of a transition, the
  frame that fades out, or the `IntersectionObserver`: taking each one out leaves 108 %. Not found.
- Every other phase is where it was, within the spread between reps:

| display | variant | Home scroll | Library scroll | Detail ↔ back | Search typing | Player, controls | Player, watching |
|---|---|---|---|---|---|---|---|
| X11 | `wry` | 243 → 254 %, 13 fps | 215 → 213 % | 95 → 93 % | 57 → 56 % | 284 → 280 % | 4 → 4 % |
| X11 | `wry-nocomp` | 106 → 106 %, 32 → 33 fps | 107 → 107 % | 29 → 29 % | 16 → 16 % | 17 → 18 % | 2 → 2 % |
| Wayland | `wry` | 260 → 261 %, 10 fps | 231 → 230 % | 104 → 104 % | 68 → 68 % | 278 → 275 % | 4 → 4 % |
| Wayland | `wry-nocomp` | 110 → 110 %, 22 → 23 fps | 111 → 111 % | 33 → 30 % | 17 → 18 % | 16 → 16 % | 2 → 2 % |

## With a GPU

Everything above is drawn by the CPU. The same home phases on a laptop with a GPU, measured
2026-11-25 by hand with `runner.mjs` on the session's own display: Arch Linux, Ryzen 7 7840U
(16 threads), Radeon 780M (radeonsi, Mesa 26.2.7), GNOME Shell 51 on Wayland, 1920×1080 at 60 Hz,
WebKitGTK 2.54.2, the host's libraries, 2 reps. The page is the billboard change with the
software-rendering path (`perf/home-billboard-software`); `-soft` tells it that it is drawn on the
CPU (`--soft`), which the real app reads from the OpenGL renderer. Another machine, another
WebKitGTK and a runner extended to read the GPU: compare the columns with each other, not with
the tables above.

| variant | Home idle | GPU | Home, out of focus | Home scroll |
|---|---|---|---|---|
| `wry` | 23 % | 7 % | 0 % | 42 %, 60 fps |
| `wry-soft` | 18 % | 3 % | 0 % | 43 %, 60 fps |
| `wry-nocomp` | 34 % | 10 % | 0 % | 58 %, 60 fps |
| `wry-nocomp-soft` | 6 % | 2 % | 0 % | 60 %, 60 fps |

GNOME Shell and XWayland add about 11 % while the page moves (2 % for `wry-nocomp-soft`).

- **The billboard is cheap with a GPU**: 23 % of one core where llvmpipe took 282 %, and scrolling
  holds 60 fps where it reached 13. The numbers above measure software rendering far more than
  they measure the page.
- **Compositing off is the wrong default with a GPU**: 34 % against 23 % idle, 58 % against 42 %
  scrolling. It is a workaround for machines that draw on the CPU, not a setting to ship.
- **The software-rendering path buys nothing there** (18 % against 23 %), for a backdrop that no
  longer zooms: it stays for machines without a GPU.
- **A build from the nix devshell does not start on that machine** (not NixOS): `Could not create
  default EGL display: EGL_BAD_PARAMETER. Aborting...`. Not looked into.

## Drawn on the CPU: a still backdrop and a stepped bar

Back on the container without a GPU, X11, 2 reps, which animation costs what while the billboard
is in use (`home-idle`):

| page | `wry` | `wry-nocomp` |
|---|---|---|
| zoom and progress bar (the billboard change) | 282 % | 105 % |
| zoom, no bar animation | 287 % | 105 % |
| bar, no zoom | 277 % | 33 % |
| no zoom, bar in steps of one second (`-soft`) | 81 % | 15 % |

- **With compositing, one running animation costs the whole window on every frame**: the 44 px
  bar alone takes what the full-screen zoom takes, and the two together take no more. Without
  compositing the cost follows the surface drawn.
- **Told it is drawn on the CPU, the page goes from 282 % to 81 %** (88 % on Wayland with a first
  version of the same page). What is left is mostly the change of slide every 8 s.

## Without a GPU, replayed: the ways of drawing the page, on two WebKitGTK releases

Measured 2026-11-26 with `replay.sh`, 2 reps, X11 (Xvfb), in `container.sh`'s two images on one
laptop (four cores of a Ryzen 7 7840U, no `/dev/dri`): Ubuntu 24.04 with WebKitGTK 2.52.6, GTK
3.24.41 and Mesa 25.2.8, the versions of the container above, and Arch Linux with WebKitGTK
2.54.3, GTK 3.24.52 and Mesa 26.3.1. The pages are those of `perf/home-billboard-software`
(`af4eb1c`), the bench app the same binary in both. Medians; between the two reps a cell moved
by 10 points at most, and by under 5 in all but a few. `-soft` tells the page it is drawn on the CPU; `wry-never-reload` sets the
hardware acceleration policy to `NEVER` on the web view and restarts its web process, so the
page starts with it.

The home page, idle (the billboard rotating) and scrolling:

| variant | 2.52.6 idle | 2.52.6 scroll | 2.52.6 PSS MB | 2.54.3 idle | 2.54.3 scroll | 2.54.3 PSS MB |
|---|---|---|---|---|---|---|
| `wry`: nothing set | 279 % | 270 %, 26 fps | 582 | 224 % | 214 %, 39 fps | 646 |
| `wry-soft`: the page told it is drawn on the CPU | 69 % | 263 %, 36 fps | 586 | 49 % | 206 %, 46 fps | 646 |
| `wry-nocomp`: `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 107 %, 49 fps | 276 | 257 % | 252 %, 18 fps | 610 |
| `wry-nodmabuf`: `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 107 %, 47 fps | 262 | 106 % | 107 %, 46 fps | 402 |
| `wry-nodmabuf-soft`: the same, and the page told | 14 % | 107 %, 51 fps | 268 | 16 % | 106 %, 45 fps | 398 |
| `wry-never-reload`: policy `NEVER`, web process restarted | 106 % | 107 %, 48 fps | 278 | 106 % | 107 %, 46 fps | 410 |

One animation on a still page (`pages/anim.html`), 60 fps reached in every cell; `wry-damage`
turns `UseDamagingInformationForCompositing` on, which 2.52 has off and 2.54 on, and
`wry-nodamage` turns it off:

| page | 2.52.6 `wry` | 2.52.6 `wry-damage` | 2.52.6 `wry-nodmabuf` | 2.54.3 `wry` | 2.54.3 `wry-nodamage` | 2.54.3 `wry-nodmabuf` |
|---|---|---|---|---|---|---|
| nothing moves | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % |
| 44 px bar | 86 % | 20 % | 12 % | 23 % | 61 % | 13 % |
| full-window zoom | 144 % | 146 % | 70 % | 118 % | 121 % | 40 % |

- **What turns compositing off depends on the release.** `WEBKIT_DISABLE_COMPOSITING_MODE=1`
  takes 2.52 to the CPU path (279 → 106 %) and makes 2.54 worse (224 → 257 %, 18 fps scrolling):
  there it keeps OpenGL for painting. `WEBKIT_DISABLE_DMABUF_RENDERER=1`, and the policy `NEVER`
  when the page starts with it, give 106 % on both.
- **The policy set on a web view that has already loaded gives a blank window in 2.54.3** and
  works in 2.52.6. wry loads the page before an application can reach the settings, hence the
  restart in `wry-never-reload`.
- **Telling the page still pays, on every path**: 279 → 69 % composited and 106 → 14 % not, in
  2.52.6; 224 → 49 % and 106 → 16 % in 2.54.3. It changes nothing while scrolling.
- **2.54 composites only what changed**: the 44 px bar costs 23 % where 2.52 takes 86 %, and
  2.52 with the same feature turned on takes 20 %. A full-window animation gains nothing.
- **Not composited, the cost is what is repainted**: 12 % for the bar, and the full-window zoom
  at half of what it costs composited.

## Without a GPU: the player's own window

The tables above are the bench app's window. The player's has a `GtkGLArea` under the web view,
where mpv draws, and GTK 3 draws a window through OpenGL for every frame once it has shown one.
`BENCH_PLAYER=1` loads the player plugin itself; two binaries, the plugin of `main` and the one of
`perf/video-layer-on-demand`, which keeps the area hidden until something plays and hides it on
stop. WebKitGTK 2.52.6, X11, 2 reps; the whole app, with the UI process's share in brackets
(the web process has the rest).

| | plugin as it is | video layer on demand |
|---|---|---|
| home idle | 287 % (UI 62) | 288 % (UI 3) |
| home scroll | 280 %, 24 fps (UI 56) | 275 %, 27 fps (UI 3) |
| home idle, the page told | 75 % (UI 19) | 71 % (UI 1) |
| bar page, nothing played yet | 197 % (UI 126) | 84 % (UI 6) |
| bar page, the area shown (playing) | 323 % (UI 305) | 323 % (UI 304) |
| bar page, stopped after playing | 199 % (UI 127) | 148 % (UI 66) |

- **The area costs the UI process about 125 % of one core on a page with one 44 px animation**,
  whether anything plays or not. Hidden until something plays, that page costs what the bench's
  own window does (84 against 86 %).
- **On the home page the four CPUs are taken either way**; what the UI process gives back goes to
  frames (24 → 27 fps scrolling). Told it is drawn on the CPU, the page draws few frames and
  the area costs little (75 → 71 %).
- **Hiding the area after a playback gives back half**: GTK 3 keeps the window on OpenGL for
  good.
- **Playing on llvmpipe takes three cores in the UI process alone**, and in about half of the
  runs on Xvfb the picture stays black, with either plugin: this row is not a usable player.

The same with the GPU (`BENCH_GPU=1`, Weston, Radeon 780M), 2 reps:

| | plugin as it is | video layer on demand | GPU load |
|---|---|---|---|
| home idle | 29 % | 28 % | |
| home scroll | 45 %, 60 fps | 44 %, 60 fps | |
| bar page, nothing played yet | 12 % | 10 % | 4 % both |
| bar page, playing | 38 % | 38 % | 19 % both |
| bar page, stopped after playing | 12 % | 10 % | 4 % both |

With the GPU the clip plays in every run, the page over it, and the area costs nothing to hide
or to show.

A web view that is not composited is not drawn at all in a window that shows a GL area
(2.52.6, X11), and with `GDK_GL=software-draw`, which brings it back, it shows black where its
page is transparent, not what is under it: the CPU path of the first table is for windows
without a video layer.

## WebKitGTK 2.52.6 built from source: what patches to it would give

`webkit.sh` builds the release tarball as Ubuntu configures it (`stock`), then the patch sets of
`webkit-patches/2.52.6` on top, each from a copy of the tree before it. Measured 2026-11-26 in
the same container, X11, no GPU, 2 reps, `BENCH_WEBKIT=2.52.6-<label>`. `stock` is the witness:
it lands on the package's numbers (286 against 279 % for the home page, 82 against 86 % for the
bar).

The app's processes, with the X server's own share after the plus sign:

| build | the 44 px bar | full-window zoom | Home idle | Home scroll |
|---|---|---|---|---|
| `stock` | 82 % + 15 % | 147 % + 15 % | 285 % + 10 % | 274 % + 8 %, 28 fps |
| `damage`: composition limited to the damaged region | 22 % + 18 % | 141 % + 16 % | 271 % + 11 % | 274 % + 9 %, 31 fps |
| `damage-readback`: and the readback | 17 % + 16 % | 141 % + 16 % | 271 % + 11 % | 274 % + 9 %, 30 fps |
| `damage-readback-redraw`: and the GTK 3 redraw | 14 % + 2 % | 136 % + 15 % | 274 % + 8 % | 276 % + 8 %, 31 fps |
| `fallback`: no compositing on a software rasterizer | 15 % + 1 % | 65 % + 9 % | 106 % + 5 % | 105 % + 8 %, 54 fps |

- **With damage carried to the end, composited costs what not composited costs when little
  changes**: 14 % + 2 % for the bar, against 15 % + 1 % for the CPU path, and 82 % + 15 % as
  shipped. The three steps each take their part: composition (the web process, 76 → 15 %), the
  readback (15 → 10 %), the redraw (the X server, 16 → 2 %).
- **Nothing of it helps when the whole window changes**: the zoom and the home page stay where
  they were. There only leaving OpenGL does, and the fallback does it by itself: 285 → 106 %
  with no variable set and no change in the application.
- **The fallback is not for a window with a video layer**: with a `GtkGLArea` under the web view
  the page is no longer drawn (checked, as with the variables that do the same);
  `WEBKIT_FORCE_COMPOSITING_MODE=1` brings compositing back, as the patch intends.
- The patched builds took 4 to 6 minutes each on four build jobs, once `stock` was built
  (about two hours on the same four jobs).
