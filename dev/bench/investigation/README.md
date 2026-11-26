# Why WebKitGTK is expensive without a GPU

An investigation log, kept up to date as the work goes. Question: on a machine that draws with
Mesa llvmpipe, any animation that runs on every frame costs the desktop app close to three cores.
Which code spends that time, and how far down can it be brought?

Everything here is one of three things, and says which:

- **measured**: a number from the bench (`dev/bench`, see its README), in the container described
  below unless said otherwise;
- **read**: a statement taken from source, with file, line and version (details in `notes/`);
- **assumed**: an inference nobody has checked yet.

## Setup

`dev/bench/container.sh`: Ubuntu 24.04, WebKitGTK 2.52.6 (`libwebkit2gtk-4.1-0
2.52.6-0ubuntu0.24.04.2`), GTK 3.24.41, Mesa 25.2.8 (llvmpipe), four CPUs (four cores of a Ryzen
7 7840U), no `/dev/dri`, Xvfb, window 1440×900, Tauri 2.12.5 (wry 0.57.1). These are the versions
of the cloud container `RESULTS.md` was measured in, on other hardware; the home page idles at
282 % of one core on both.

## Status

| step | state |
|---|---|
| CPU per thread and per function, `home-idle`, composited and not | done |
| WebKitGTK 2.52 and 2.54 render path, read from source | done, `notes/webkit-render-path.md` |
| What wry and Tauri set, what the app can reach | done, `notes/wry-tauri.md` |
| What upstream knows | done, `notes/upstream-research.md` |
| Candidate settings measured on 2.52 | done but for the damage flag (first run invalid, see below) |
| The same on WebKitGTK 2.54.3 (Arch image) | running |
| WebKitGTK 2.52.6 built from source, to try patches | building |
| Patch drafts for WebKitGTK | written, not compiled: `patch-drafts/2.52.6/` |
| Fix in the app | pending |
| Report (French) and upstream bug draft | pending |

## Findings so far

### The three cores are llvmpipe's rasterizer threads (measured)

`home-idle`, composited (`wry`), 15 s, CPU in % of one core (`profiles/2.52.6-x11/`):

| process, threads | CPU |
|---|---|
| `WebKitWebProcess`, 4 × `llvmpipe-N` | 255.6 % (60 to 67 % each) |
| `WebKitWebProcess`, `ThreadedCompositor` | 11.9 % |
| `WebKitWebProcess`, main thread | 6.7 % |
| `WebKitWebProcess`, 2 × `SkiaGPUWorker` | 3.9 % |
| `wry` (UI process), main thread | 2.8 % |
| whole tree | 282 % |

perf, same phase: 86 % of all samples are in code llvmpipe compiled at run time (`[JIT]`, its
fragment shaders), 91 % under `rasterize_scene`. Half of that is whole 64×64 tiles shaded
(`lp_rast_shade_tile`, 37.5 %) and the rest triangles covering part of one
(`lp_rast_shade_quads_all`, 43 %). `GLFence::create`, named in WebKit bug 276580, does not show:
it is where the compositor thread waits for those threads, not where the time goes.

With compositing off (`wry-nocomp`) the same page costs 96 % on the web process's main thread
alone, and 9 % in the UI process: no llvmpipe thread runs.

### Every frame redraws and reads back the whole window (read, 2.52.6)

From `notes/webkit-render-path.md`:

1. With no DRM render node the UI process offers shared memory only, and the web process
   composites on a surfaceless EGL display into an FBO (`AcceleratedBackingStore.cpp:97-114`,
   `AcceleratedSurface.cpp:660-665`).
2. For each frame the compositor thread paints the whole layer tree with TextureMapper through
   OpenGL (`ThreadedCompositor.cpp:346-428`), waits for it on a fence
   (`AcceleratedSurface.cpp:266-283`), then reads the whole surface back with `glReadPixels`
   into the shared bitmap (`AcceleratedSurface.cpp:514-518`).
3. The UI process queues a redraw of the whole widget and fills it from the bitmap with cairo
   (`AcceleratedBackingStore.cpp:203-208`, `:273-283`).
4. The damaged region is computed and sent with each frame, and nothing on this path uses it:
   `UseDamagingInformationForCompositing` is off in 2.52.6 (`UnifiedWebPreferences.yaml:8553`)
   and on in 2.54.2 (`:9191`); the readback and the GTK 3 redraw are whole-surface in both.

So the cost follows the number of frames and the window's area, not what changed, which is what
the bench shows (a 44 px bar costs what a full-window zoom costs).

### Nothing in WebKit, wry or Tauri looks at the renderer (read)

- WebKitGTK 2.52 has no software-rasterizer detection; 2.54 has `GLDisplay::isSoftwareRendered()`
  and uses it only to match a Vulkan device. Tiles are painted by Skia's GPU backend on llvmpipe
  too.
- wry never sets the hardware acceleration policy (`wry-0.57.1/src/webkitgtk/mod.rs:427-467`), and
  Tauri exposes neither it nor WebKit's settings. An application reaches them through
  `with_webview` (`webkit2gtk::SettingsExt::set_hardware_acceleration_policy`).

### Without compositing the time is Skia on the main thread (measured)

`home-idle`, `wry-nocomp`: 96 % on the web process's main thread, 82 % of the samples in
`libwebkit2gtk` itself. The page is repainted by Skia's CPU pipeline: its gradient stages take
about 45 % of the samples (`skx::lowp::gradient` alone 31 %), the scaled backdrop about 8 %
(`S32_alpha_D32_filter_DX`, `filter_scale`), blending and stores the rest. The UI process copies
the result with pixman (`sse2_blt`, 1.3 %). What this mode costs is what the page paints, so the
page can act on it: the billboard's gradients cost more than its picture.

## Candidates measured on the home page

WebKitGTK 2.52.6, X11, one rep, `home` scenario (`profiles/2.52.6-x11/*.json`). CPU in % of one
core for the app's process tree.

| variant | what it sets | Home idle | Home scroll | PSS MB |
|---|---|---|---|---|
| `wry` | nothing | 269 % | 264 %, 26 fps | 693 |
| `wry-nocomp` | `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 107 %, 52 fps | 370 |
| `wry-never` | policy `NEVER` set by the app through `with_webview`, after the view exists | 107 % | 106 %, 53 fps | 395 |
| `wry-lp2` | `LP_NUM_THREADS=2` | 187 % | 184 %, 18 fps | 673 |
| `wry-lp1` | `LP_NUM_THREADS=1` | 105 % | 107 %, 12 fps | 674 |

- **Policy `NEVER` set by the application is the environment variable**, to the point: same CPU,
  same frame rate, same memory. It does not have to be set before the web view is created, so the
  app needs neither an early environment variable nor a restart.
- **The damage flag is not measured yet.** A first run showed no change with
  `UseDamagingInformationForCompositing` on, and was wrong: the web process reads that feature
  once, when it creates the page (`LayerTreeHost.cpp:100-110`, read), and a feature set after
  wry's first `load_uri` arrives too late, so the run compared off with off
  (`notes/webkit-render-path.md`, section 10). The bench now restarts the web process after
  setting features; the numbers come with the next series.
- **Fewer llvmpipe threads buy CPU with frames**: one thread costs what compositing off costs
  (105 %) and scrolls at 12 fps where compositing off scrolls at 52. The work per frame is the
  same, there is only less of the machine to do it on. Composited mode takes whatever cores it is
  given: it is bound by the work, not by a frame clock.

## One animation on a still page

`pages/anim.html`: a full-window gradient, a paragraph, and one moving element. WebKitGTK 2.52.6,
X11, one rep, 60 fps reached in every cell. CPU of the app's process tree, in % of one core; the
X server's own share comes on top (26 % composited, under 1 % not, 9 % for the zoom).

| page | `wry` | `wry-never` | `wry-nocomp` |
|---|---|---|---|
| nothing moves | 0 % | 0 % | 0 % |
| 32 px spinner (`transform`) | 85 % | 14 % | 11 % |
| 44 px bar (`transform`) | 84 % | 11 % | 14 % |
| 44 px bar (`width`, repainted by the main thread) | 91 % | 10 % | 14 % |
| full-window zoom (`transform`) | 148 % | 65 % | 70 % |

The bar at three window sizes:

| window | `wry` | `wry-nocomp` |
|---|---|---|
| 720×450 | 32 % | 12 % |
| 1440×900 | 84 % | 14 % |
| 1920×1080 | 123 % | 12 % |

And the zoom: 48 %, 148 %, 230 % composited; 27 %, 70 %, 104 % not.

- **Composited, any animation costs about 85 % of one core on a trivial page**, and the cost
  grows with the window: about 60 % per megapixel at 60 fps, plus the X server. What moves does
  not matter, a spinner costs what a bar costs.
- **Not composited, the cost is what is repainted**: 10 to 14 % for the small ones whatever the
  window, and the full-window zoom costs half of what it costs composited.
- **On this page llvmpipe's thread count changes nothing**: `LP_NUM_THREADS=1` gives 82 % at
  60 fps (84 % with four). The home page needs the four threads because its layer tree is much
  heavier to composite; here the per-frame floor is elsewhere (profile pending).
- `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` is worse here (97 %), `WEBKIT_SKIA_GPU_PAINTING_THREADS=0`
  no different (84 %).

## Candidates still to measure

| candidate | where it acts | expected (assumed) |
|---|---|---|
| `UseDamagingInformationForCompositing` on a page where little changes | composition and clear limited to the damaged box | cost follows the changed area for composition; readback and UI redraw stay whole |
| window size | every stage of the composited path | cost per frame proportional to the window's area |
| WebKitGTK 2.54 | Skia compositor, damage on by default, non-composited path rewritten | to measure; the source says `WEBKIT_DISABLE_COMPOSITING_MODE=1` no longer leaves GL there, only policy `NEVER` does |

## Files

- `notes/webkit-render-path.md`: the render path of 2.52.6 and 2.54.2 read from the release
  tarballs, question by question.
- `notes/wry-tauri.md`: what wry, tao and Tauri set on Linux, and what the app can reach.
- `notes/upstream-research.md`: WebKit bugs, Igalia's posts, release notes, Mesa's knobs.
- `patch-drafts/2.52.6/`: changes to WebKitGTK that the reading suggests, as diffs against the
  release tarball. Not compiled yet: drafts until a build has measured them.
- `profiles/`: the captures the tables above come from (`*.threads.txt` from `threads.py`, the
  others from `report.sh`).
