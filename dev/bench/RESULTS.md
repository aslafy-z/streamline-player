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
- **Only the home page pays for motion when idle**: the billboard's continuous zoom over a
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

Pending.
