# Why WebKitGTK is expensive without a GPU

The report, in French, is [`RAPPORT.md`](RAPPORT.md): it is the one file here not in English,
because it was asked for in French. This file is the investigation log it draws on, kept up to
date as the work goes. Question: on a machine that draws with
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
| CPU per thread and per function, composited and not | done |
| WebKitGTK 2.52 and 2.54 render path, read from source | done, `notes/webkit-render-path.md` |
| What wry and Tauri set, what the app can reach | done, `notes/wry-tauri.md` |
| What upstream knows | done, `notes/upstream-research.md` |
| Candidate settings on WebKitGTK 2.52.6 and 2.54.3 | done, replayed with 2 reps: `replay/`, `dev/bench/RESULTS.md` |
| The player's window (a GL area under the web view) | done, with a stand-in and with the real plugin and mpv, with and without a GPU |
| App change: the video layer shown only while something plays | draft PRs, fork #6 and upstream #9; playback in the real app not tried |
| App change: no VA-API over Wayland where OpenGL is the CPU | draft PR, fork #7 |
| App change: compositing off where OpenGL is the CPU | withdrawn, `app-attempts/` |
| WebKitGTK 2.52.6 built from source, patches as labels | done: five builds measured, one patch corrected |
| Report (French) | `RAPPORT.md` |
| Upstream report drafts | `upstream-drafts/`, not posted |
| WebKitGTK 2.54 on Wayland without a GPU | done: same ranking as X11 (`profiles/2.54.3-wayland/`, `dev/bench/RESULTS.md`) |

The numbers under "Findings so far" are the ones taken along the way, one rep each unless said;
the replay confirmed them within 5 points wherever it covers them.

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
| `wry-nodmabuf` | `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 107 %, 50 fps | 358 |
| `wry-never-reload` | policy `NEVER`, then the web process restarted | 106 % | 107 %, 51 fps | 378 |
| `wry-damage` | `UseDamagingInformationForCompositing` on, web process restarted | 271 % | 257 %, 22 fps | 674 |
| `wry-lp2` | `LP_NUM_THREADS=2` | 187 % | 184 %, 18 fps | 673 |
| `wry-lp1` | `LP_NUM_THREADS=1` | 105 % | 107 %, 12 fps | 674 |

- **Policy `NEVER` set by the application is the environment variable**, to the point: same CPU,
  same frame rate, same memory. In 2.52 it does not have to be set before the web view is
  created. That does not hold in 2.54 (below).
- **`WEBKIT_DISABLE_DMABUF_RENDERER=1` lands on the same CPU path** on X11 as it does on
  Wayland (`RESULTS.md`): with no buffer type left to hand to the UI process, 2.52 leaves
  compositing off.
- **Limiting composition to the damaged region does nothing for this page**: its animation is a
  full-window zoom, so the damaged region is the window. It does a lot when little changes
  (below). A first run of this variant was invalid and is withdrawn: the web process reads the
  feature once, when it creates the page (`LayerTreeHost.cpp:100-110`, read), and a feature set
  after wry's first `load_uri` arrives too late (`notes/webkit-render-path.md`, section 10). The
  bench now restarts the web process after setting features.
- **Fewer llvmpipe threads buy CPU with frames**: one thread costs what compositing off costs
  (105 %) and scrolls at 12 fps where compositing off scrolls at 52. The work per frame is the
  same, there is only less of the machine to do it on. Composited mode takes whatever cores it is
  given: it is bound by the work, not by a frame clock.

## One animation on a still page

`pages/anim.html`: a full-window gradient, a paragraph, and one moving element. WebKitGTK 2.52.6,
X11, one rep, 60 fps reached in every cell. CPU of the app's process tree, in % of one core; the
X server's own share comes on top (26 % composited, under 1 % not, 9 % for the zoom).

| page | `wry` | `wry-damage` | `wry-never` | `wry-nocomp` | `wry-nodmabuf` |
|---|---|---|---|---|---|
| nothing moves | 0 % | | 0 % | 0 % | |
| 32 px spinner (`transform`) | 85 % | | 14 % | 11 % | |
| 44 px bar (`transform`) | 84 % | 20 % | 11 % | 14 % | 12 % |
| 44 px bar (`width`, repainted by the main thread) | 91 % | | 10 % | 14 % | |
| full-window zoom (`transform`) | 148 % | | 65 % | 70 % | |

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
- **Composited, the bar's 76 % in the web process are 67 % llvmpipe and 7 % the compositor
  thread** (`profiles/2.52.6-x11/wry-anim-bar-1.anim-bar.threads.txt`): four rasterizer threads
  at 17 % each. `LP_NUM_THREADS=1` gives the same 82 % at 60 fps on one thread. The whole window
  is composited for each frame even on a page of three layers; the home page takes four times
  that because its layer tree is that much heavier.
- **Composition limited to the damaged region takes the bar from 84 % to 20 %** in 2.52
  (`wry-damage`), and leaves the X server at 17 %: the readback and the UI process's redraw are
  still the whole window. This is what 2.54 does by default (22 %).
- `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` is worse here (97 %), `WEBKIT_SKIA_GPU_PAINTING_THREADS=0`
  no different (84 %).

## WebKitGTK 2.54.3

The newest release (Arch's package, Mesa 26.3.1, GTK 3.24.52; `BENCH_DISTRO=arch`), same
hardware, same bench app binary, X11, one rep (`profiles/2.54.3-x11/`). Ubuntu ships 2.52.6 in
every release up to 26.10.

| variant | Home idle | Home scroll | bar | zoom |
|---|---|---|---|---|
| `wry` | 217 % | 192 %, 35 fps | 22 % | 115 % |
| `wry-texmap` (`WEBKIT_USE_SKIA_FOR_COMPOSITION=0`) | 262 % | 250 %, 27 fps | 19 % | 153 % |
| `wry-nocomp` (`WEBKIT_DISABLE_COMPOSITING_MODE=1`) | 252 % | 234 %, 16 fps | 26 % | 66 % |
| `wry-nodmabuf` (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) | 103 % | 107 %, 45 fps | 14 % | 40 % |
| `wry-lp1` | 107 % | 108 %, 18 fps | | |
| `wry-never` (policy set once the view exists) | blank page | blank page | blank | blank |
| `wry-never-reload` (policy, then the web process restarted) | 105 % | 106 %, 45 fps | | |
| `wry-nocomp-nodmabuf` (both variables) | 105 % | 107 %, 45 fps | | |

The X server adds 13 to 25 % in every row that draws, the non-composited ones included: GTK 3
still redraws the whole widget for each frame.

- **2.54 makes a small animation cheap while composited**: 22 % for the bar where 2.52 takes
  84 %. Damage now limits composition by default. It does nothing for the home page (217 %),
  whose animation covers the window and whose layer tree is heavy: 174 % in the four llvmpipe
  threads, 28 % in the compositor thread.
- **`WEBKIT_DISABLE_COMPOSITING_MODE=1` no longer helps, it hurts**: 252 % and 16 fps while
  scrolling, worse than doing nothing. As read in the source, in 2.54 it turns compositing off
  and keeps OpenGL: the page is still drawn through llvmpipe (216 % in its threads) and read
  back. The workaround Tauri's documentation gives is the wrong one from 2.54 on.
- **`WEBKIT_DISABLE_DMABUF_RENDERER=1` is the CPU path in 2.54**: 103 % idle, 45 fps scrolling,
  half the memory. No llvmpipe thread runs.
- **Policy `NEVER` set after the view exists gives a blank window in 2.54**
  (`shots/2.54.3-wry-never-home-idle.png`, against `shots/2.54.3-wry-nodmabuf-home-idle.png`);
  the 8 % the bench reported for it measured nothing. In 2.52 the same call works. The policy
  has to be in place before the page's web process is created, and wry loads the page before an
  application can reach the settings. Restarting the web process once the policy is set
  (`wry-never-reload`) gives the CPU path on both versions.

## What works on both versions

| | 2.52.6 | 2.54.3 |
|---|---|---|
| nothing | 269 % | 217 % |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | 106 % | 252 % |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 106 % | 103 % |
| policy `NEVER` set once the view exists | 107 % | blank window |
| policy `NEVER`, web process restarted | 106 % | 105 % |

Home idle, X11, no GPU. Only the DMABuf switch and a policy the page starts with are safe on
both, and both must be decided before the page exists: an environment variable before the first
web view, or the policy before the web process is created.

## The player's window: a GL area under the web view

The bench app has no video layer; the player always has one, a `GtkGLArea` under the web view
(`plugins/tauri-plugin-player/src/view.rs`), attached at start. `BENCH_UNDERLAY` adds the same
widgets to the bench app, the area cleared to one colour. WebKitGTK 2.52.6, X11, the bar page,
60 fps everywhere (`profiles/2.52.6-x11/wry-underlay*.json`):

| the GL area | composited: total (UI process, web process) | `WEBKIT_DISABLE_DMABUF_RENDERER=1` |
|---|---|---|
| none (the bench until now) | 84 % (6, 78) | 12 %, page drawn |
| never shown | 82 % (6, 76) | 13 % (5, 8), page drawn |
| shown | 203 % (132, 71) | 139 % (133, 7), **page not drawn** |
| shown, then hidden | 143 % (65, 79) | 76 % (70, 7), **page not drawn** |
| shown, then removed | 143 % (65, 78) | 73 % (67, 7), **page not drawn** |

The home page with the area shown: 280 % composited, 186 % not (and not drawn).

- **A GL area that has been shown puts the whole window on OpenGL in the UI process**: GTK 3
  then composites the window through GL for each frame, which on llvmpipe is 132 % of one core
  for a 44 px bar, on top of what the web process costs. The numbers in `RESULTS.md` leave this
  out: the real app pays it on every page, playing or not.
- **Hiding or removing the area does not undo it**: the window keeps painting through GL (65 %).
  Only an area that was never shown costs nothing.
- **In such a window a web view that is not composited is not drawn at all**
  (`shots/2.52.6-underlay-seethrough-grid.png`: composited top left, the three ways of turning
  compositing off elsewhere, all showing the area's colour alone). The CPU path and the video
  layer do not go together in 2.52, whether the web view is transparent or not.
- What follows for the app: create the GL area at the first playback, not at start, so browsing
  pays for neither; and do not turn compositing off in a window that will show video.
  2.54, whose non-composited path was rewritten, is being measured.

### With the real plugin, and the area shown only while something plays

`BENCH_PLAYER=1` loads the player plugin itself (libmpv in its `GtkGLArea`) in the bench app,
and a page plays the bench's clip through its commands. Two binaries: the plugin as it is, and
the plugin of `perf/video-layer-on-demand`, which keeps the area hidden until something plays
and hides it again on stop. The bar page, WebKitGTK 2.52.6, CPU of the app in % of one core.

Without a GPU (X11, llvmpipe), one rep:

| | plugin as it is | area on demand |
|---|---|---|
| attached, nothing played yet | 196 % (UI process 127) | 87 % (UI process 7) |
| playing | 224 % | 225 % |
| stopped after playing | 181 % (UI process 117) | 141 % (UI process 63) |

With the GPU (Wayland, Radeon 780M, `BENCH_GPU=1`), two reps:

| | plugin as it is | area on demand | GPU load |
|---|---|---|---|
| attached, nothing played yet | 12 % | 10 % | 4 % both |
| playing | 38 % | 38 % | 19 % both |
| stopped after playing | 12 % | 10 % | 4 % both |

The same page without the plugin at all: 13 % with the GPU, 84 % without.

- **Without a GPU, a window that has not played yet costs what the page costs**: the 110 points
  the UI process spent drawing the window through llvmpipe are gone. After a first playback the
  window stays on OpenGL and half of it comes back.
- **With a GPU nothing is lost and little is gained**: that composition is cheap there.
- **Playback draws with the GPU in every run, with either plugin**
  (`shots/2.52.6-gpu-wayland-playing-changed-and-current.png`): the clip advances, the page is
  over it.
- **On Xvfb with llvmpipe the picture stays black in most runs, with either plugin**: mpv's load
  does not complete there. The playing rows without a GPU are therefore the cost of a window
  that shows the area, not of a decoded video.

### Why GTK 3 does this (read, GTK 3.24.41)

- A window paints through OpenGL as soon as it has a paint GL context:
  `window->current_paint.use_gl = window->impl_window->gl_paint_context != NULL`
  (`gdk/gdkwindow.c:2965`). `gdk_window_get_paint_gl_context` creates it on first use
  (`:2855-2888`), which a `GtkGLArea` does when it is realized, and only the window's
  destruction drops it (`:2106-2111`). That is why hiding or removing the area changes nothing:
  the toplevel keeps the context.
- At the end of each paint the window's own drawing, a cairo surface, is uploaded as a texture
  and drawn over what the GL area drew, then the buffers are swapped (`:3050-3075`).
- On X11 the region to repaint grows to the whole window whenever the back buffer's age is
  unknown: `if (buffer_age == 0) invalidate_all = TRUE`
  (`gdk/x11/gdkglcontext-x11.c:122-184`). Assumed, not checked: llvmpipe's GLX on Xvfb reports
  no buffer age, which would make every frame a whole-window upload and explain the 130 %.
- Every widget drawn after the GL area has its clip cleared to transparent in that surface and
  marked "to blend" (`gdk_window_mark_paint_from_clip`, `gdk/gdkwindow.c:3385-3436`, called from
  `gtk/gtkwidget.c:7058`). What the widget then draws is blended over the GL content.

`GDK_GL=software-draw` has GDK read the GL area back into the cairo surface and draw the window
without the texture pass. Tried on the bench's stand-in window, on two other cores (compare the
rows with each other only; `shots/2.52.6-gdk-software-draw-grid.png`):

| the bar page, composited | UI process | with `GDK_GL=software-draw` |
|---|---|---|
| no GL area | 7 % | |
| area shown | 141 % | 78 % |
| area shown and redrawn 30 times a second, page see-through | 146 % | 77 % |
| area shown, then hidden | 79 % | 72 % |

- **It halves the cost of a shown area and does not remove it**; a window that has shown one
  still pays about 70 %.
- **It brings a non-composited web view back on screen** next to a GL area (bottom row of the
  screenshot), and shows why that path cannot carry the player: where the page is transparent
  the window is black, not the video. WebKitGTK's non-composited backing store paints with
  `CAIRO_OPERATOR_SOURCE` (`UIProcess/cairo/BackingStoreCairo.cpp:82-90`), which replaces what
  is under it. Seeing through a web view takes accelerated compositing.
- Why the non-composited view is not drawn at all without that variable is not explained.

### Wayland without a GPU: the app dies at start

Under headless Weston with llvmpipe the bench app with the player plugin gets a segmentation
fault before its first frame, every time. gdb: `vaInitialize` in `libva-wayland.so.2`, under
`mpv_render_context_create`, under `view::create_render_context`. The plugin hands mpv the
Wayland display for VA-API; libva 2.20 crashes on a compositor with no DRM device to offer.
`fix/player-software-wayland` leaves the display out when `GL_RENDERER` is a CPU rasterizer:
the app starts and plays the clip (frame 152 at 6.3 s in the screenshot taken). With the area
shown on demand alone, the crash only moves to the first playback.

## WebKitGTK 2.52.6 built from source, with the patches

`dev/bench/webkit.sh` builds the release tarball as Ubuntu configures it, then the patch sets of
`dev/bench/webkit-patches/2.52.6` (the files of `patch-drafts/2.52.6` here are the same). The
unpatched build lands on the package's numbers, so it stands as the witness. 2 reps, X11, no
GPU; the app's processes, with the X server's share after the plus sign
(`profiles/webkit-built/`):

| build | the 44 px bar | full-window zoom | Home idle | Home scroll |
|---|---|---|---|---|
| `stock` | 82 % + 15 % | 147 % + 15 % | 285 % + 10 % | 274 % + 8 %, 28 fps |
| `damage` (0001, 0002) | 22 % + 18 % | 141 % + 16 % | 271 % + 11 % | 274 % + 9 %, 31 fps |
| `damage-readback` (+ 0003) | 17 % + 16 % | 141 % + 16 % | 271 % + 11 % | 274 % + 9 %, 30 fps |
| `damage-readback-redraw` (+ 0004) | 14 % + 2 % | 136 % + 15 % | 274 % + 8 % | 276 % + 8 %, 31 fps |
| `fallback` (0005) | 15 % + 1 % | 65 % + 9 % | 106 % + 5 % | 105 % + 8 %, 54 fps |

- **Damage carried to the end makes the composited path as cheap as the CPU path when little
  changes** (14 + 2 against 15 + 1), and keeps compositing, which a window with a video layer
  needs. Each step takes its part: composition in the web process (76 → 15 %), the readback
  (15 → 10 %), the redraw (the X server, 16 → 2 %).
- **It gives nothing when the whole window changes.** There only leaving OpenGL helps, and the
  fallback patch does that with no variable set: 285 → 106 %.
- **The fallback hides the page of a window that has a GL area**, as the variables that turn
  compositing off do (checked in the lab container); `WEBKIT_FORCE_COMPOSITING_MODE=1` brings
  compositing back, which the patch honours.
- All five compiled as written, in 4 to 6 minutes each from the stock tree. The redraw patch
  was wrong on screen at first (`shots/2.52.6-patched-bar-strip-*.png`): WebKitGTK's own paint
  of a shared-memory buffer adds the clip rectangle to the path after flipping the y axis
  (`AcceleratedBackingStore.cpp:273-281`, read), which is harmless while the clip is the whole
  view and fills the mirror image of anything smaller. The patch now puts the rectangle on the
  path first.

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
- `patch-drafts/2.52.6/`: changes to WebKitGTK that the reading suggested, as diffs against the
  release tarball; compiled and measured since (above). The build picks them up from
  `dev/bench/webkit-patches/2.52.6` on the harness branch.
- `profiles/`: the captures the tables above come from (`*.threads.txt` from `threads.py`, the
  others from `report.sh`).
