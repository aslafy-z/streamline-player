# [GTK] Accelerated compositing on a software rasterizer takes up to three cores for any animation, and nothing falls back to the non-composited path

Product: WebKit, component: WebKitGTK. Versions measured: 2.52.6 (Ubuntu 24.04 package) and 2.54.3 (Arch Linux package), GTK 3 (`webkit2gtk-4.1`).

## Summary

On a machine whose OpenGL is Mesa llvmpipe (no DRM render node: a virtual machine, a container, a remote desktop, a broken driver), WebKitGTK keeps accelerated compositing on. Every frame of any animation then composites the whole view through OpenGL on the CPU, reads the whole view back with `glReadPixels`, and has the UI process redraw the whole widget. The cost follows the view's area and the frame rate, not what changed. The non-composited path, which exists and paints only what changed, costs 2.5 to 7 times less on the same pages, and is never chosen automatically.

## Setup

4 CPUs (Ryzen 7 7840U cores), no `/dev/dri`, Xvfb 1920×1080, view 1440×900, an application embedding one `WebKitWebView` (Tauri/wry, no setting changed from wry's defaults). Mesa 25.2.8 with 2.52.6, Mesa 26.3.1 with 2.54.3. CPU is in % of one core for the UI and web processes together; the X server's share is given apart.

## Reproducer

A page with one full-window `div` (a CSS gradient), one paragraph, and one element animated on the compositor:

```html
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  .backdrop { position: absolute; inset: 0; background: linear-gradient(120deg, #233, #638 45%, #c63); }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 44px; background: #e33;
         transform-origin: left; animation: grow 8s linear infinite; }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
</style>
<div class="backdrop"></div><p>text</p><div class="bar"></div>
```

Run it with `LIBGL_ALWAYS_SOFTWARE=1` (or on a machine without a GPU) and watch the CPU of `WebKitWebProcess` per thread.

## Measured

The page above, 60 fps reached in every case:

| | 2.52.6 | 2.54.3 |
|---|---|---|
| default | 84 % (+26 % X server) | 22 % (+25 % X server) |
| `UseDamagingInformationForCompositing` on (off by default in 2.52) | 20 % (+17 %) | default |
| not composited (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) | 12 % (+1 %) | 14 % (+23 %) |

The same page at three view sizes, 2.52.6 default: 32 % at 720×450, 84 % at 1440×900, 123 % at 1920×1080. Not composited: 12 % at all three.

A full-window `transform: scale()` animation in place of the bar: 148 % (2.52.6) and 115 % (2.54.3) composited, 70 % and 40 % not.

A real application page (a full-window backdrop that zooms, over a dozen rows of cards): 269 % (2.52.6) and 217 % (2.54.3) composited, 106 % and 103 % not; scrolling it reaches 26 and 35 fps composited, 50 and 45 fps not.

Per thread, 2.52.6, the application page (15 s, `perf` and `/proc`): 256 % in the four `llvmpipe-N` threads of the web process, 12 % in `ThreadedCompositor`, 7 % on the main thread. 86 % of the samples are in llvmpipe's JIT-compiled fragment shaders, 91 % under `rasterize_scene`. `LP_NUM_THREADS=1` gives the same work on one thread: a third of the CPU and half the frame rate.

## What the source says (2.52.6 tarball)

- Without a render node the UI process offers shared memory only (`UIProcess/gtk/AcceleratedBackingStore.cpp:97-114`), and the web process composites into an FBO on a surfaceless display (`WebProcess/WebPage/CoordinatedGraphics/AcceleratedSurface.cpp:660-665`).
- Each frame: the whole layer tree is painted (`ThreadedCompositor.cpp:346-428`), a fence is created and waited on (`AcceleratedSurface.cpp:266-283`), then the whole surface is read back, `glReadPixels(0, 0, width, height, GL_BGRA, …)` (`AcceleratedSurface.cpp:514-518`).
- The UI process calls `gtk_widget_queue_draw()` for the whole widget and fills it from the bitmap (`AcceleratedBackingStore.cpp:203-208`, `:273-283`).
- The frame's damage is computed and sent, and with `UseDamagingInformationForCompositing` on it limits the composition (`ThreadedCompositor.cpp:293-306`). The readback and the GTK 3 redraw stay whole-surface in 2.52.6 and in 2.54.2.
- Nothing looks at whether the GL implementation is a software rasterizer when deciding on accelerated compositing. 2.54 has `GLDisplay::isSoftwareRendered()` and uses it only to match a Vulkan device.

`GLFence::create()`, which bug 276580 points at, is where the compositor thread waits for llvmpipe's rasterizer threads; the time itself is in those threads.

## What would help

1. Not using accelerated compositing when the GL renderer is a software rasterizer, unless it is forced (`WEBKIT_FORCE_COMPOSITING_MODE`). The non-composited path is the cheaper one there on every page measured. A draft against 2.52.6 is in `../patch-drafts/2.52.6/0005-disable-compositing-on-software-gl.patch` (not compiled). One thing to settle first: an application that puts a `GtkGLArea` under a transparent web view relies on accelerated compositing to see through it (see the note below).
2. On the shared-memory path, reading back and redrawing the damaged region only (`0003` and `0004` in the same directory, not compiled). With damage-limited composition the small animation above is at 20 to 22 % in the web process and the X server still at 17 to 25 %: what is left is the whole-view readback and redraw.

## Note: related reports

Bug 276580 and bug 271201 describe the same cost from the outside (100 % and 260 % CPU for a CSS-only animation) without a profile.

Not verified, to check before posting: whether the default EGL platform path on Wayland behaves the same in 2.54 (measured on X11 only for 2.54.3; 2.52.6 was measured on both with the same result).
