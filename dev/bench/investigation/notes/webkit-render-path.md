# WebKitGTK render path on software GL (source reading)

Scope: why a Tauri 2 / wry / WebKitGTK (GTK 3, API 4.1) app costs about three
cores per animated frame on Mesa llvmpipe, and which knobs or upstream changes
could reduce it. Source reading only, nothing was built or run.

Sources: release tarballs `webkitgtk-2.52.6` (primary, tagged `2.52`) and
`webkitgtk-2.54.2` (tagged `2.54`). Paths are relative to the tarball root.

Tags: `[READ]` = read in the source at the given `path:line`. `[INFERRED]` =
deduction from what was read, or knowledge about Mesa, GTK, cairo or pixman
whose source was not read here.

Shorthand for the most cited files:

| Short | Path |
| --- | --- |
| `AS.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/AcceleratedSurface.cpp` |
| `TC.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/ThreadedCompositor.cpp` |
| `LTH.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/LayerTreeHost.cpp` |
| `DACG.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/DrawingAreaCoordinatedGraphics.cpp` |
| `DACGGLib.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/DrawingAreaCoordinatedGraphicsGLib.cpp` (2.54 only) |
| `NCFR.cpp` | `Source/WebKit/WebProcess/WebPage/CoordinatedGraphics/NonCompositedFrameRenderer.cpp` |
| `ABS.cpp` | `Source/WebKit/UIProcess/gtk/AcceleratedBackingStore.cpp` |
| `HAM.cpp` | `Source/WebKit/UIProcess/gtk/HardwareAccelerationManager.cpp` |
| `Settings.cpp` | `Source/WebKit/UIProcess/API/glib/WebKitSettings.cpp` |
| `Prefs.yaml` | `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` |
| `TM.cpp` | `Source/WebCore/platform/graphics/texmap/TextureMapper.cpp` |

## 0. Verdict on the two hypotheses

- Hypothesis (a), "the whole window is recomposited through GL and the whole
  result is copied to the UI process on every frame, ignoring damage":
  **confirmed for 2.52.6**, with three refinements.
  1. The copy is a full-surface `glReadPixels` straight into the shared bitmap
     (`AS.cpp:514-518`, 2.52). `[READ]`
  2. Damage is computed and even sent to the UI process on every frame by
     default, but nothing on this path consumes it: not the compositor
     (`UseDamagingInformationForCompositing` is off by default in 2.52), not
     the readback, not GTK 3. `[READ]`, details in section 2.
  3. There is a second full-area pass in the UI process: a whole-widget
     `gtk_widget_queue_draw` followed by a cairo fill of the whole bitmap with
     a Y flip (`ABS.cpp:203-208`, `ABS.cpp:273-283`, 2.52). `[READ]`
- Hypothesis (b), "the three cores are llvmpipe rasterizer threads":
  **not provable from WebKit source, but consistent with it.** For a
  compositor-driven animation WebKit runs one busy thread per frame (the
  compositor thread, which mostly blocks in `eglClientWaitSync` then runs
  `glReadPixels`). The Skia workers and the main thread have no per-frame work
  in that case. Anything above about one core has to be inside Mesa.
  `[INFERRED]` A direct test that does not involve WebKit: run with Mesa's
  `LP_NUM_THREADS=1` (or `0`) and check whether 280 % collapses to about
  100 %. `[INFERRED, Mesa knob not read here]`
- Contradiction with an implicit assumption: Skia CPU painting is **not** the
  default on llvmpipe. The default is Skia GPU (Ganesh over GL, therefore over
  llvmpipe). `WEBKIT_SKIA_ENABLE_CPU_RENDERING` changes nothing on the
  animated page because that page does not repaint tiles, not because CPU
  painting was already on. See section 4.
- Contradiction with "disabling compositing is a stable recipe": in 2.54
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` no longer removes GL from the picture.
  It keeps "hardware acceleration" on and only switches to a non-composited
  renderer that still paints with Skia GPU into an FBO and still does a full
  readback. The pure CPU path in 2.54 is `WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER`
  (or `WEBKIT_DISABLE_DMABUF_RENDERER=1`). See section 3.

## 1. Frame pipeline in composited mode with software GL, GTK 3

### 1.1 Which swap chain is chosen without a DRM device

UI process, computed once (2.52, identical in 2.54 at `ABS.cpp:81-116`):

```cpp
// ABS.cpp:97-114 (2.52)
mode.add(RendererBufferTransportMode::SharedMemory);
const char* forceSHM = getenv("WEBKIT_DMABUF_RENDERER_FORCE_SHM");
if (forceSHM && g_strcmp0(forceSHM, "0"))
    return;
#if USE(GBM)
// Don't claim to support hardware buffers if we don't have a device to import them.
const auto& device = drmMainDevice();
if (device.isNull())
    return;
#endif
```

- `[READ]` `drmMainDevice()` asks EGL for the display's device and its render
  node. The comment says the render node is null with software rasterization
  and the primary node is then left unset
  (`Source/WebKit/UIProcess/glib/DRMMainDevice.cpp:216-229`, 2.52). The last
  fallback enumerates DRM devices with a render node
  (`DRMMainDevice.cpp:240-244`), which finds nothing without `/dev/dri`.
  `DRMDevice::isNull()` is `primaryNode.isNull()`
  (`Source/WebCore/platform/graphics/gbm/DRMDevice.h:34-37`).
- `[READ]` So the UI process advertises `{SharedMemory}` only, and sends it to
  the web process (`Source/WebKit/UIProcess/glib/WebProcessPoolGLib.cpp:198`).
- `[READ]` Web process: no `Hardware` mode means no GBM display, so
  `PlatformDisplaySurfaceless` is created (EGL `EGL_PLATFORM_SURFACELESS_MESA`)
  (`Source/WebKit/WebProcess/glib/WebProcessGLib.cpp:148-192`,
  `Source/WebCore/platform/graphics/egl/PlatformDisplaySurfaceless.cpp:36-51`).
- `[READ]` Swap chain type for a surfaceless display without `Hardware`:
  `SharedMemory` (`AS.cpp:660-665`, 2.52; `AS.cpp:607-612`, 2.54).
- `[INFERRED]` This holds for both X11/Xvfb and headless Weston: the decision
  depends only on the DRM device lookup, not on the windowing system. The only
  windowing difference is how the UI process gets its own EGL display
  (`Source/WebKit/UIProcess/gtk/DisplayX11.cpp:52-78`,
  `DisplayWayland.cpp:54-88`).
- `[READ]` This also explains two measured no-ops:
  `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` selects what is already selected, and
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` empties the mode set (`ABS.cpp:87-89`),
  which makes `checkRequirements()` false (`ABS.cpp:140-145`) and therefore
  disables compositing exactly like `WEBKIT_DISABLE_COMPOSITING_MODE`
  (`HAM.cpp:49`, 2.52).

### 1.2 Threads in the web process (2.52)

| Thread | Created at | Per-frame work for a compositor-driven animation |
| --- | --- | --- |
| Main | n/a | Almost none. Receives `willRenderFrame`/`didRenderFrame` notifications (`TC.cpp:400-403`, `TC.cpp:424-427`). Does style, layout and display-list recording only when content changes. |
| Compositor, `WorkQueue "org.webkit.ThreadedCompositor"` | `TC.cpp:67` | Everything in section 5: animation sampling, GL composition, fence wait, `glReadPixels`, IPC. |
| Skia workers, `"SkiaGPUWorker"` (2 threads with 4 or more cores) or `"SkiaCPUWorker"` (cores/2, max 8) | `Source/WebCore/platform/graphics/skia/SkiaPaintingEngine.cpp:66-77`, `:212-251` | None unless tiles are dirty. They replay recorded pictures into tile buffers (`SkiaPaintingEngine.cpp:171-210`). |
| Scrolling, `"WebCore: Scrolling"` | `Source/WebCore/page/scrolling/ScrollingThread.cpp:44` | None unless scrolling. |
| Mesa llvmpipe rasterizer threads | Mesa | `[INFERRED]` Fragment shading for every GL draw of the frame. Not WebKit code. |

- `[READ]` Transform, opacity and filter animations are sampled on the
  compositor thread (`TC.cpp:273`, `applyAnimationsRecursively`) and the
  compositor reschedules itself while any animation is running
  (`TC.cpp:329-330`). When the only reason is `Animation`, layer state is not
  even flushed (`TC.cpp:252-253`).
- `[INFERRED]` Linux thread names as seen by `perf`: WTF keeps the part after
  the last dot and the right-most 15 characters
  (`Source/WTF/wtf/Threading.cpp:179-200`), so the compositor thread should
  show as `eadedCompositor`, the workers as `SkiaGPUWorker`/`SkiaCPUWorker`,
  the scrolling thread as `Core: Scrolling`.
- `[READ]` 2.54 differs: the compositor uses Skia instead of TextureMapper by
  default (`TC.cpp:81`, `TC.cpp:126-128`, 2.54; preference
  `UseSkiaForComposition`, `Prefs.yaml:9343`, WebKit default `true`,
  status `internal`; `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` reverts,
  `DACGGLib.cpp:144-148`). It is still GL (Ganesh) on the same surfaceless
  context, so still llvmpipe.

### 1.3 Frame pacing

- `[READ]` The compositor renders from a zero-delay timer
  (`TC.cpp:146-152`). A new frame can only start after the UI process answers
  `FrameDone` (`AS.cpp:1116-1121` calls `frameComplete`, `TC.cpp:487-510`).
  There is no vblank source on this loop.
- `[READ]` The UI process sends `FrameDone` from its GTK draw handler, after
  painting the new buffer (`ABS.cpp:813-824`, `ABS.cpp:712-716`, 2.52).
- `[INFERRED]` Hence the frame rate is `min(GTK frame clock, 1 / (web frame
  time + UI paint time))`. About 29 fps means about 34 ms per round trip.
- `[READ]` `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` and
  `WEBKIT_FORCE_VBLANK_TIMER` only configure the UI-process `DisplayLink`
  that drives main-thread refresh callbacks
  (`Source/WebKit/UIProcess/glib/DisplayLinkGLib.cpp:38-64`,
  `Source/WebKit/UIProcess/glib/DisplayVBlankMonitor.cpp:48-71`). The
  compositor animation loop above does not go through it, which explains why
  neither variable changed the animated page. Without DRM the timer monitor is
  already the fallback (`DisplayVBlankMonitor.cpp:64-70`).

### 1.4 How the frame reaches the UI process (SHM path, 2.52)

Web process:

```cpp
// AS.cpp:514-518 (2.52)
void AcceleratedSurface::RenderTargetSHMImage::didRenderFrame(Vector<IntRect, 1>&& damageRects)
{
    glReadPixels(0, 0, m_bitmap->size().width(), m_bitmap->size().height(), GL_BGRA, GL_UNSIGNED_BYTE, m_bitmap->mutableSpan().data());
    RenderTargetShareableBuffer::didRenderFrame(WTF::move(damageRects));
}
```

- `[READ]` Each SHM target is an FBO with an `RGBA8` color renderbuffer and a
  `DEPTH24_STENCIL8` renderbuffer (`AS.cpp:171-184`, `AS.cpp:496-506`) plus a
  `ShareableBitmap` whose read-only handle is sent once to the UI process
  (`AS.cpp:479-494`, `AS.cpp:505`). The chain starts with 2 targets and may
  grow to 4 (`AcceleratedSurface.h:362-363`).
- `[READ]` Yes, there is a full-surface `glReadPixels` per frame, with a
  format different from the renderbuffer (`GL_BGRA` from `RGBA8`). No use of
  `damageRects` to restrict it.
- `[READ]` The `Frame(id, damageRects, fenceFD)` message follows
  (`AS.cpp:197-200`). For SHM the fence fd is always null because the SHM
  target does not support explicit sync (`AcceleratedSurface.h:282`).

UI process, GTK 3:

```cpp
// ABS.cpp:205-208 (2.52), fence monitor callback, also runs at once when there is no fence fd
, m_fenceMonitor([this] {
    if (m_webPage)
        gtk_widget_queue_draw(m_webPage->viewWidget());
})
```

```cpp
// ABS.cpp:273-283 (2.52), GTK 3 paint of an SHM or GBM-mapped buffer
cairo_matrix_init(&transform, 1, 0, 0, -1, 0, static_cast<float>(m_size.height() / m_webPage->deviceScaleFactor()));
cairo_transform(cr, &transform);
cairo_rectangle(cr, clipRect.x(), clipRect.y(), clipRect.width(), clipRect.height());
cairo_set_source_surface(cr, surface, 0, 0);
cairo_set_operator(cr, CAIRO_OPERATOR_OVER);
cairo_fill(cr);
```

- `[READ]` `frame()` stores the pending buffer and damage, then the fence
  monitor fires at once for a null fd
  (`ABS.cpp:698-710`, `Source/WebKit/UIProcess/glib/FenceMonitor.cpp:102-109`)
  and queues a redraw of the **whole widget**.
- `[READ]` `webkitWebViewBaseDraw` calls `AcceleratedBackingStore::paint`
  with the GTK clip (`Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp:929-968`).
  `swapBuffersIfNeeded` wraps the shared bitmap in a cairo image surface, no
  copy (`ABS.cpp:780-797`, `ABS.cpp:620-633`).
- `[READ]` Damage rects are passed to `didUpdateContents` but the three GTK 3
  buffer kinds ignore them (`ABS.cpp:491`, `:565`, `:620`). Only the GTK
  4.13.4+ DMA-BUF buffer uses them (`ABS.cpp:346-359`).
- `[READ]` No GL texture upload and no `gdk_cairo_draw_from_gl` on the SHM
  path: that call is for the EGLImage buffer only (`ABS.cpp:266-271`).
- `[INFERRED]` Per-frame full-window work in the UI process is therefore: one
  cairo/pixman composite of the whole bitmap, `OVER`, from an `ARGB32` source
  through a Y-flip matrix (not a plain blit), plus whatever GTK 3 does to
  present the whole widget area (X11 put-image under Xvfb, `wl_shm` commit
  under Weston).
- `[INFERRED]` App-specific: with a `GtkGLArea` in the same toplevel, GDK 3
  paints the whole window through GL, so the cairo result of the web view is
  uploaded as a texture and composited by GDK on llvmpipe too. The 2.54 source
  has a comment that confirms the mechanism ("GTK 3 only paints a window with
  GL if the window already has a GL context when the frame starts",
  `ABS.cpp:779-782`, 2.54). This cost is outside WebKit and exists in both
  composited and non-composited modes.

### 1.5 2.54 differences on this path

- `[READ]` Same SHM selection, same full readback: `glReadPixels` for the
  TextureMapper compositor, `SkSurface::readPixels` of the whole bitmap for
  the Skia compositor (`AS.cpp:444-461`, 2.54).
- `[READ]` Same whole-widget `gtk_widget_queue_draw` (`ABS.cpp:218-221`,
  2.54). GTK 3 still ignores damage rects for SHM (`UNUSED_PARAM`, in
  `BufferSHM::didUpdateContents`, 2.54); GTK 4.16+ uses
  `gdk_memory_texture_builder_set_update_region`.
- `[READ]` The SHM path is no longer mirrored (`AS.cpp:942-943`, 2.54), so the
  GTK 3 paint is `cairo_clip` + `cairo_paint` without the flip
  (`ABS.cpp:286-296`, 2.54).
- `[READ]` Composition honours damage by default (section 2).

## 2. Damage tracking

### 2.1 Where damage is computed (2.52)

- `[READ]` Build flag: `ENABLE_DAMAGE_TRACKING` is on for GTK
  (`Source/WTF/wtf/PlatformEnableGlib.h:74-76`, 2.52; `:87`, 2.54).
- `[READ]` Main thread: `CoordinatedPlatformLayer::setDirtyRegion` /
  `addDamage` record per-layer damage
  (`Source/WebCore/platform/graphics/texmap/coordinated/CoordinatedPlatformLayer.cpp:568-589`,
  `:738-743`), transferred to the compositor-side layer on flush (`:1015-1018`).
- `[READ]` Compositor thread: `TextureMapperLayer::collectDamage` maps layer
  damage to window coordinates
  (`Source/WebCore/platform/graphics/texmap/TextureMapperLayer.cpp:393-407`).
  A layer whose combined transform changed is damaged entirely, old and new
  rect (`TextureMapperLayer.cpp:306-308`). Layers with a contents layer
  (video, canvas) are fully damaged (`:493-497`).
- `[READ]` `ThreadedCompositor::paintToCurrentGLContext` builds the frame
  damage on every frame as soon as propagation is enabled, and hands it to the
  surface (`TC.cpp:281-291`). `AcceleratedSurface::didRenderFrame` turns it
  into the rect list of the `Frame` message (`AS.cpp:1074-1086`).
- `[READ]` "Buffer age" is emulated per render target: each frame's damage is
  added to every target of the chain, and a target's record is reset when it
  is rendered (`AS.cpp:155-166`, `:922-930`, `:1079`, `:1098-1103`). It works
  for SHM targets like for any other.

### 2.2 Flags

| Preference | Status | WebKit default 2.52 | WebKit default 2.54 | Read at |
| --- | --- | --- | --- | --- |
| `PropagateDamagingInformation` | testable | `true` on GTK (`Prefs.yaml:6429`) | `true` on GTK and WPE (`Prefs.yaml:6932`) | `LTH.cpp:84-88`, `:103`, `:374` |
| `UnifyDamagedRegions` | unstable | `true` on GTK (`Prefs.yaml:8442`) | `true` on GTK and WPE (`Prefs.yaml:9091`) | `LTH.cpp:105-106` |
| `UseDamagingInformationForCompositing` | testable | **`false`** (`Prefs.yaml:8553`) | **`true`** on GTK and WPE (`Prefs.yaml:9191`) | `LTH.cpp:107-108` |
| `DamageRectangleThreshold` (uint32, default 4) | unstable | absent | `Prefs.yaml:2451` | `LTH.cpp:122` (2.54) |

- `[READ]` No environment variable toggles these. `WEBKIT_SHOW_DAMAGE` only
  draws the damage, and in 2.52 it removes `UseForCompositing`
  (`TC.cpp:234-242`).
- `[READ]` The flags are sampled once, in the `LayerTreeHost` constructor
  (`LTH.cpp:100-110`, 2.52). They must be set before the page enters
  compositing, which on GTK means before the web view loads anything.

### 2.3 What consumes damage

```cpp
// TC.cpp:293-303 (2.52)
if (m_damage.flags->contains(DamagePropagationFlags::UseForCompositing)) {
    const auto& damageSinceLastSurfaceUse = m_surface->renderTargetDamage();
    if (damageSinceLastSurfaceUse && !FloatRect(damageSinceLastSurfaceUse->bounds()).contains(clipRect))
        rectContainingRegionThatActuallyChanged = FloatRoundedRect(damageSinceLastSurfaceUse->bounds());
    m_textureMapper->setDamage(damageSinceLastSurfaceUse);
}
...
if (rectContainingRegionThatActuallyChanged)
    m_textureMapper->beginClip(TransformationMatrix(), *rectContainingRegionThatActuallyChanged);
```

- `[READ]` With `UseDamagingInformationForCompositing` on, 2.52 scissors the
  whole composition, including the transparent clear (`TC.cpp:306` runs inside
  the clip), to the **bounding box** of the damage accumulated for the current
  target. Opaque, untransformed tiles are additionally drawn as fragments
  limited to that box
  (`Source/WebCore/platform/graphics/texmap/coordinated/CoordinatedBackingStore.cpp:71-97`).
  The layer tree is still walked in full, only the pixels are restricted.
- `[READ]` With the flag off (2.52 default) the whole frame is recomposited
  even though the damage is known.
- `[READ]` The flag is independent of the swap chain kind, so it applies to
  the SHM path. The `glReadPixels` stays full-surface in both versions.
- `[READ]` Damage rects reach the UI process in both versions but GTK 3 does
  not use them to limit the redraw (section 1.4).
- `[READ]` 2.54 with the Skia compositor draws only the damage rects, with a
  finer-grained per-target record
  (`TC.cpp:302-307`, `TC.cpp:458-481`, `AS.cpp:881-924`, 2.54). With
  TextureMapper it keeps the 2.52 bounding-box scissor (`TC.cpp:375-390`, 2.54).
- `[INFERRED]` Expected effect of turning the flag on in 2.52 on llvmpipe: the
  rasterization part of the cost follows the damage bounding box (small for
  the 44 px bar, nil for the full-screen zoom), while the readback and the UI
  redraw remain proportional to the window. Since `UnifyDamagedRegions` forces
  a single bounding box, two small animations in opposite corners damage
  almost the whole window.

### 2.4 Can an application turn these on through the public API

- `[READ]` Yes. Every `bool` preference exposed to the WebKit frontend is in
  the feature list, whatever its status
  (`Source/WTF/Scripts/GeneratePreferences.rb:262-263`,
  `Source/WebKit/Scripts/PreferencesTemplates/WebPreferencesFeatures.cpp.erb:39-55`).
  The three damage flags have no `exposed:` restriction.
- `[READ]` `webkit_settings_get_all_features()` returns all of them
  (`Settings.cpp:4307-4310`). `webkit_settings_get_experimental_features()`
  returns developer, testable, preview and stable ones, so it includes
  `PropagateDamagingInformation` and `UseDamagingInformationForCompositing`;
  `UnifyDamagedRegions` (unstable) is in
  `webkit_settings_get_development_features()`
  (`Source/WebKit/UIProcess/WebPreferences.cpp:95-121`).
- `[READ]` The identifier is the preference key, minus a trailing `Enabled`
  when present (`Source/WebKit/UIProcess/API/glib/WebKitFeature.cpp:130-135`),
  so here `"UseDamagingInformationForCompositing"`. The setter is
  `webkit_settings_set_feature_enabled()` (`Settings.cpp:4263-4269`). The
  functions are declared without API-version guards
  (`Source/WebKit/UIProcess/API/glib/WebKitSettings.h.in:562-577`), so they
  exist in the 4.1 API (since 2.42).
- `[INFERRED]` Risk: in 2.52 the flag is "testable, off by default"; upstream
  only flipped it in the 2.54 cycle. Expect possible stale-pixel artifacts.

## 3. What disabling compositing changes

### 3.1 `WEBKIT_DISABLE_COMPOSITING_MODE` in 2.52

```cpp
// HAM.cpp:48-55 (2.52), UI process, singleton constructor
const char* disableCompositing = getenv("WEBKIT_DISABLE_COMPOSITING_MODE");
if ((disableCompositing && strcmp(disableCompositing, "0")) || !AcceleratedBackingStore::checkRequirements())
    m_canUseHardwareAcceleration = false;
...
const char* forceCompositing = getenv("WEBKIT_FORCE_COMPOSITING_MODE");
if (forceCompositing && !strcmp(forceCompositing, "0"))
    m_forceHardwareAcceleration = false;
```

- `[READ]` Read in the UI process only. Any value other than `"0"` disables.
- `[READ]` Consequences:
  1. Every `WebPreferences` store starts with `acceleratedCompositingEnabled =
     false`, `forceCompositingMode = false`, `threadedScrollingEnabled = false`
     (`Source/WebKit/UIProcess/gtk/WebPreferencesGtk.cpp:34-49`).
  2. The policy setter cannot turn it back on: `ALWAYS` returns early and
     `ON_DEMAND` requires `canUseHardwareAcceleration()`
     (`Settings.cpp:3955-3956`, `:3981`).
  3. No `AcceleratedBackingStore` is created (`ABS.cpp:195-201`).
  4. Web process: no EGL display is initialised for the page
     (`DACG.cpp:233-236`), `m_alwaysUseCompositing` is false (`DACG.cpp:242`),
     no `LayerTreeHost` is created (`DACG.cpp:264-276`), and WebCore creates
     no composited layers because `acceleratedCompositingEnabled` is false
     (`Source/WebCore/rendering/RenderLayerCompositor.cpp:632-642`).

### 3.2 `webkit_settings_set_hardware_acceleration_policy()` on GTK 3

2.52 (`Settings.cpp:3947-3997`, enum at `WebKitSettings.h.in:85-91`):

| Value | Exists in 4.1 API | Effect |
| --- | --- | --- |
| `ALWAYS` (property default, `Settings.cpp:1603-1610`) | yes | No-op if hardware acceleration is unavailable. Otherwise AC on, forced, threaded scrolling on. |
| `NEVER` | yes | AC off, force off, threaded scrolling off. |
| `ON_DEMAND` | yes (GTK 3 only) | AC on. Force is only cleared if `!forceHardwareAcceleration()`, which is true only when `WEBKIT_FORCE_COMPOSITING_MODE=0` is in the environment. |

- `[READ]` The property is `G_PARAM_CONSTRUCT` with default `ALWAYS`
  (`Settings.cpp:664`, `:1603-1610`), so constructing a `WebKitSettings`
  always calls the setter with `ALWAYS`, which forces compositing whenever it
  is available. `WEBKIT_FORCE_COMPOSITING_MODE=0` alone is therefore undone by
  the constructor.
- `[READ]` `ON_DEMAND` is honoured in 2.52 only with **both**
  `WEBKIT_FORCE_COMPOSITING_MODE=0` and an explicit `ON_DEMAND` call. Even
  then, once a page needs a composited layer, GTK enters compositing and never
  leaves:

```cpp
// DACG.cpp:566-571 (2.52)
#if PLATFORM(GTK)
    if (!m_alwaysUseCompositing) {
        m_webPage->corePage()->settings().setForceCompositingMode(true);
        m_alwaysUseCompositing = true;
    }
#endif
```

- `[INFERRED]` For a page with transform or opacity animations `ON_DEMAND`
  buys nothing: the first animated layer switches the page to compositing for
  good.

2.54 (`Settings.cpp:3924-3968`, 2.54):

| Value | Exists in 4.1 API | Effect |
| --- | --- | --- |
| `ALWAYS` (default) | yes | `HardwareAccelerationEnabled = true`; AC, force and threaded scrolling on unless `WEBKIT_DISABLE_COMPOSITING_MODE` is set. |
| `NEVER` | yes | `HardwareAccelerationEnabled = false` **and** AC, force, threaded scrolling off. |
| `ON_DEMAND` | yes, deprecated | `g_warning`, then falls through to `ALWAYS` (`Settings.cpp:3932-3934`). |

- `[READ]` 2.54 splits two notions that were one in 2.52: "hardware
  acceleration" (may the web process use GL at all, new preference
  `HardwareAccelerationEnabled`, `Prefs.yaml:3805`, internal) and
  "accelerated compositing mode" (layer tree and compositor thread)
  (`HAM.cpp:40-47`, `Source/WebKit/UIProcess/gtk/WebPreferencesGtk.cpp:34-43`,
  2.54). `WEBKIT_FORCE_COMPOSITING_MODE` no longer exists in 2.54.

### 3.3 Is `NEVER` strictly equivalent to the environment variable

- 2.52: `[READ]` Same preference values and same web-process path. Remaining
  differences: `NEVER` is per `WebKitSettings` object while the variable is
  process-wide; with `NEVER` the UI process still creates an (unused)
  `AcceleratedBackingStore` and still considers hardware acceleration
  available, so a later `ALWAYS` can re-enable it. `[INFERRED]` Equivalent for
  rendering cost as long as `NEVER` is set before the view is created.
- 2.54: `[READ]` **Not equivalent.**
  - Variable: compositing off, hardware acceleration on. The page uses
    `NonCompositedFrameRenderer` with a GL context: Skia GPU paints the damage
    rects into the FBO, then a full `readPixels` into the SHM bitmap
    (`DACGGLib.cpp:151-167`, `NCFR.cpp:66-77`, `NCFR.cpp:211-272`,
    `AS.cpp:444-461`, 2.54). On llvmpipe this is still software GL.
  - `NEVER`: hardware acceleration off. `AcceleratedSurface::usesGL()` is
    false (`AcceleratedSurface.h:122`, 2.54), the swap chain is forced to SHM
    (`AS.cpp:597-601`), and Skia CPU draws straight into the shared bitmap
    (`AS.cpp:434-437`), only the damaged rects, unconditionally
    (`NCFR.cpp:133-137`, `NCFR.cpp:249-257`).
  - `[READ]` In 2.54 `WEBKIT_DISABLE_DMABUF_RENDERER=1` empties the transport
    mode, makes `canUseHardwareAcceleration()` false (`ABS.cpp:139-144`,
    `HAM.cpp:42-44`) and so gives the same result as `NEVER`, process-wide.
  - `[INFERRED]` This matches the measurement that on 2.54.2 with a real GPU
    disabling compositing is worse than compositing: the page is repainted by
    Skia GPU on the main thread and read back every frame.

### 3.4 The non-composited path in 2.52 and why it scales with dirty area

- `[READ]` WebCore invalidations reach
  `DrawingAreaCoordinatedGraphics::setNeedsDisplayInRect`, which accumulates
  `m_dirtyRegion` and arms a zero-delay timer (`DACG.cpp:94-120`,
  `DACG.cpp:666-682`).
- `[READ]` `display(UpdateInfo&)` allocates a `ShareableBitmap` **of the size
  of the dirty bounds**, paints the dirty rects into it and sends it:

```cpp
// DACG.cpp:776-782, 804-816 (2.52)
IntRect bounds = m_dirtyRegion.bounds();
IntSize bitmapSize = bounds.size();
bitmapSize.scale(deviceScaleFactor);
auto bitmap = ShareableBitmap::create({ bitmapSize });
...
auto graphicsContext = bitmap->createGraphicsContext();
...
for (const auto& rect : rects) {
    if (graphicsContext)
        webPage->drawRect(*graphicsContext, rect);
    updateInfo.updateRects.append(rect);
}
```

- `[READ]` The painter is Skia CPU on the **main thread**: the bitmap's
  graphics context is an unaccelerated raster surface
  (`Source/WebCore/platform/graphics/skia/ShareableBitmapSkia.cpp:60-72`,
  `RenderingMode::Unaccelerated`). No worker pool, no compositor thread, no GL
  context (`DACG.cpp:233-236`).
- `[READ]` Individual rects are painted instead of the bounds when there are
  2 to 10 of them and they cover less than 25 % of the bounds
  (`DACG.cpp:734-753`, `:791-795`).
- `[READ]` One update in flight at a time: the web process waits for
  `DisplayDidRefresh` before painting again (`DACG.cpp:421-436`,
  `DACG.cpp:730-731`), which the UI process sends on receipt of `Update`
  (`Source/WebKit/UIProcess/CoordinatedGraphics/DrawingAreaProxyCoordinatedGraphics.cpp:211-226`).
- `[READ]` UI process: the update bitmap is blitted into a persistent
  full-size cairo image backing store, rect by rect
  (`Source/WebKit/UIProcess/cairo/BackingStoreCairo.cpp:92-144`), then only the damaged region of the widget is invalidated:

```cpp
// Source/WebKit/UIProcess/API/gtk/PageClientImpl.cpp:111 (2.52), GTK 3 branch
gtk_widget_queue_draw_region(m_viewWidget, toCairoRegion(region).get());
```

  The draw handler then fills only the clip from the backing store with
  `CAIRO_OPERATOR_SOURCE`, no flip
  (`DrawingAreaProxyCoordinatedGraphics.cpp:81-95`,
  `BackingStoreCairo.cpp:82-90`).
- `[INFERRED]` Every stage (raster, IPC payload, UI blit, GTK invalidation) is
  proportional to the dirty area, which is the measured behaviour. Scrolling
  uses a `scrollRect`/`scrollOffset` blit in the UI backing store plus a
  repaint of the exposed strip (`DACG.cpp:122-177`), but the UI then
  invalidates the whole view (`DrawingAreaProxyCoordinatedGraphics.cpp:142-147`).
- `[READ]` 2.54 removed this path for GTK: the non-composited renderer also
  goes through `AcceleratedSurface` and `AcceleratedBackingStore`
  (`ABS.cpp:211-214`, 2.54; NEWS 2.53.1 "Improved non accelerated composited
  mode by using the same buffer sharing"). On GTK 3 that means a whole-widget
  `queue_draw` per frame again, even though only damaged rects are repainted
  in the web process.

### 3.5 Changing the policy at runtime

- 2.52: `[READ]` The setter only changes preferences. They are pushed to
  existing pages (`WebPage::updatePreferences`,
  `Source/WebKit/WebProcess/WebPage/WebPage.cpp:4801-4873`), where
  `DACG.cpp:230-242` recomputes `m_alwaysUseCompositing`.
  `AcceleratedCompositingEnabled` has `webcoreOnChange:
  setNeedsRecalcStyleInAllFrames` (`Prefs.yaml:99-102`), the compositor
  re-reads the flag (`RenderLayerCompositor.cpp:632-662`) and detaches its
  root layer (`RenderLayerCompositor.cpp:5305`), which lands in
  `setRootCompositingLayer(nullptr)` and schedules
  `exitAcceleratedCompositingMode` when compositing is not forced
  (`DACG.cpp:322-343`, `DACG.cpp:623-664`).
  `[INFERRED]` So `NEVER` set on a live view should take effect without
  recreating the view in 2.52, and `ALWAYS` should re-enter. Not tested, and
  the transition path is rarely exercised.
- 2.54: `[READ]` The renderer is chosen once per page
  (`DACGGLib.cpp:151-167`, the only two assignments of `m_renderer`) and
  `AcceleratedSurface` caches `hardwareAccelerationEnabled` at construction
  (`AS.cpp:121-123`). `[INFERRED]` A runtime change does not affect an
  existing page; it must be set before the web view is created.

## 4. Software-GL detection inside WebKit

- `[READ]` 2.52 has **no** software-rasterizer detection. The only hits for
  `llvmpipe|softpipe|swrast|software raster|GL_RENDERER` in `Source/WebKit`,
  `Source/WebCore/platform/graphics`, `Source/WebCore/page` are the
  `webkit://gpu` report (`TC.cpp:573`,
  `Source/WebKit/UIProcess/API/glib/WebKitProtocolHandler.cpp:597`, `:802`) and
  the comment in `DRMMainDevice.cpp:218-219`.
- `[READ]` The only behavioural consequence of software GL in 2.52 is
  indirect: no DRM render node, hence SHM transport (section 1.1).
- `[READ]` 2.54 adds `GLDisplay::isSoftwareRendered()` (EGL device type
  `EGL_DEVICE_TYPE_CPU_EXT`, `EGL_MESA_device_software`, or renderer name
  containing `llvmpipe`/`swrast`)
  (`Source/WebCore/platform/graphics/egl/GLDisplay.cpp:147-190`, 2.54). Its
  only caller picks the matching Vulkan device
  (`Source/WebCore/platform/graphics/vulkan/VulkanTypes.cpp:484`). It does not
  change the rendering path.
- `[READ]` `WEBKIT_SKIA_ENABLE_CPU_RENDERING` is read in the web process and
  only does `ProcessCapabilities::setCanUseAcceleratedBuffers(false)`
  (`WebProcessGLib.cpp:197-200`, 2.52). That flag selects:
  - tile painting mode and worker pool kind
    (`SkiaPaintingEngine.cpp:61-77`, `:128`, `:156`);
  - tile size heuristics
    (`Source/WebCore/platform/graphics/texmap/coordinated/CoordinatedBackingStoreProxy.cpp:375`);
  - accelerated `ImageBuffer`s other than canvas
    (`Source/WebCore/platform/graphics/skia/ImageBufferSkiaAcceleratedBackend.cpp:107`).
- `[READ]` It does **not** touch the compositor: `ThreadedCompositor` always
  creates a GL context and a `TextureMapper` (`TC.cpp:90-105`), and the swap
  chain selection does not look at it.
- `[READ]` Default on llvmpipe in 2.52: `canPerformAcceleratedRendering()` is
  true as soon as a Skia GL context can be created
  (`SkiaPaintingEngine.cpp:61-64`), so tiles are painted by **Skia GPU on
  llvmpipe**, with 2 `SkiaGPUWorker` threads on a 4-core machine
  (`SkiaPaintingEngine.cpp:232-251`), and a default MSAA request of 8 samples
  on x86 (`Source/WebCore/platform/graphics/skia/PlatformDisplaySkia.cpp:64-68`,
  `:199-229`).
- `[INFERRED]` Why the variable had no effect on the animated page: a
  transform or opacity animation does not repaint tiles; the per-frame cost is
  composition + readback, which the variable does not touch. Why it saves
  memory: no Ganesh contexts and GPU tile buffers in llvmpipe.
- `[INFERRED]` Where it should matter: any scenario that repaints tiles
  (scrolling into new content, non-accelerated animations such as `width`,
  `background-position`, `box-shadow`). The measured "no effect" was on the
  animated page only; worth re-measuring on the scroll scenario, where
  `WEBKIT_SKIA_MSAA_SAMPLE_COUNT=0` could also matter. Doubt: whether llvmpipe
  accepts the MSAA surface test at all (`PlatformDisplaySkia.cpp:216-225`) is
  not knowable from WebKit source.

## 5. Per-frame fixed costs in the compositor (2.52, SHM, TextureMapper)

Order of execution in `ThreadedCompositor::renderLayerTree` (`TC.cpp:346-428`):

| # | Step | Where | Proportional to window area regardless of damage |
| --- | --- | --- | --- |
| 1 | `makeContextCurrent` | `TC.cpp:380` | no |
| 2 | `willRenderFrame`: pick next target, optional release-fence `serverWait` (never for SHM, the UI sends an empty fence, `ABS.cpp:292`), `glBindFramebuffer`, `glCheckFramebufferStatus` | `TC.cpp:398`, `AS.cpp:1037-1047`, `:244-254` | no |
| 3 | `flushCompositingState`: skipped when the only reason is `Animation`; otherwise layer state sync and tile texture swap or upload | `TC.cpp:406`, `:250-264` | no (proportional to dirty tiles) |
| 4 | `applyAnimationsRecursively` | `TC.cpp:273` | no |
| 5 | `beginPainting` (GL state queries, `glEnable(GL_SCISSOR_TEST)`), `beginClip` to the viewport | `TC.cpp:275-276`, `TM.cpp:235-249` | no |
| 6 | `prepareForPainting`, `collectDamage` (CPU, walks the layer tree) | `TC.cpp:280-291` | no (proportional to layer count) |
| 7 | `m_surface->clear`: `glClear(GL_COLOR_BUFFER_BIT)` when the background is not opaque, or on async scrolling | `TC.cpp:306`, `AS.cpp:1049-1061` | **yes** (whole target, unless the damage clip is active) |
| 8 | `currentRootLayer.paint`: every visible layer, every tile, as textured quads; blending enabled for non-opaque tiles | `TC.cpp:309`, `TM.cpp:484-498`, `:575-626` | **yes** without `UseForCompositing`; damage bounding box with it |
| 9 | `endClip`, `endPainting`: `glClear(GL_STENCIL_BUFFER_BIT)` if a stencil clip was used in the frame | `TC.cpp:326-327`, `TM.cpp:251-257`, `:146-158` | **yes** when it happens |
| 10 | Reschedule if animations are running | `TC.cpp:329-330` | no |
| 11 | `swapBuffers`: no-op, the context is surfaceless (`EGL_NO_SURFACE`) | `TC.cpp:420`, `Source/WebCore/platform/graphics/egl/GLContext.cpp:444-451`, `:182-204`, `:232-235` | no |
| 12 | `sync`: `GLFence::create` = `eglCreateSync(EGL_SYNC_FENCE_KHR)` + `glFlush()`, then `clientWait` = `eglClientWaitSync(EGL_FOREVER)` because the fence cannot be exported for SHM | `TC.cpp:422`, `AS.cpp:1072`, `:256-283`, `Source/WebCore/platform/graphics/egl/GLFence.cpp:67-88`, `GLFenceEGL.cpp:37-59`, `:103-113` | **yes** (this is where the compositor thread waits for llvmpipe to rasterize the whole frame) |
| 13 | `glReadPixels` of the full surface into the shared bitmap, `GL_BGRA` | `AS.cpp:1086`, `:514-518` | **yes**, always |
| 14 | IPC `Frame(id, damageRects, fence)` | `AS.cpp:197-200` | no |
| 15 | UI: `gtk_widget_queue_draw` (whole widget), cairo fill with Y flip, `FrameDone` | `ABS.cpp:203-208`, `:261-284`, `:813-824` | **yes**, always |

Notes:

- `[READ]` There is no `glFinish` on this path. The blocking point is step 12.
  For DMA-BUF targets the fence is exported and waited on by the UI process
  instead (`AS.cpp:259-262`, `:277-280`, `FenceMonitor.cpp:102-118`).
- `[INFERRED]` About upstream bug 276580 naming `GLFence::create()`: with a
  software rasterizer the `glFlush()` inside `createEGLFence`
  (`GLFenceEGL.cpp:51`) and the following `clientWait` are where the deferred
  rendering of the whole frame is paid, so a profile attributes the frame's
  rasterization to that call. The fence itself is not the cost.
- `[INFERRED]` With a transparent background on a 1440x900 window, each frame
  touches every pixel at least five times: clear, composite with blending
  (root tiles are non-opaque), readback with channel swap, UI cairo composite
  with flip, GTK present. Only the first two shrink with
  `UseDamagingInformationForCompositing`.
- `[READ]` 2.54: same sequence. Steps 7 to 9 are replaced by Skia drawing only
  the damaged rects (`TC.cpp:449-514`, 2.54), step 12 is unchanged
  (`AS.cpp:1158-1159`, `:258-266`, 2.54), step 13 is `SkSurface::readPixels`
  of the full surface (`AS.cpp:452-454`, 2.54), step 15 loses the Y flip.

## 6. Environment variables affecting rendering (2.52 unless noted)

Obtained by grepping every `getenv("...")` in `Source/WebKit`,
`Source/WebCore/platform/graphics`, `Source/WebCore/platform/{gtk,glib}`,
`Source/WebCore/page`, `Source/WTF/wtf`. GStreamer, sandbox, inspector and
accessibility variables are left out.

| Variable | Read at | Process | Effect | Default | Tried |
| --- | --- | --- | --- | --- | --- |
| `WEBKIT_DISABLE_COMPOSITING_MODE` | `HAM.cpp:48` | UI | Any value but `0`: no hardware acceleration, no compositing (2.52). 2.54 (`HAM.cpp:45`): compositing off only, GL stays. | unset | yes |
| `WEBKIT_FORCE_COMPOSITING_MODE` | `HAM.cpp:53` | UI | `0`: compositing not forced, which allows `ON_DEMAND`. Removed in 2.54. | forced | **no** |
| `WEBKIT_DISABLE_DMABUF_RENDERER` | `ABS.cpp:87` | UI | Empties the transport modes: equals no hardware acceleration. | unset | yes (Wayland) |
| `WEBKIT_DMABUF_RENDERER_FORCE_SHM` | `ABS.cpp:99` | UI | SHM transport even with a GPU. | unset | yes |
| `WEBKIT_DMABUF_RENDERER_DISABLE_GBM` | `WebProcessGLib.cpp:157` | web | Surfaceless display instead of GBM (needs `Hardware` mode). | unset | n/a without DRM |
| `WEBKIT_DMABUF_RENDERER_BUFFER_FORMAT` | `ABS.cpp:155` | UI | Forces a DMA-BUF fourcc and modifier. | unset | n/a without DRM |
| `WEBKIT_WEB_RENDER_DEVICE_FILE` | `DRMMainDevice.cpp:205` | UI | Forces the DRM render node. | unset | n/a without DRM |
| `WEBKIT_SKIA_ENABLE_CPU_RENDERING` | `WebProcessGLib.cpp:197` | web | Tiles and non-canvas image buffers painted by Skia CPU. | GPU | yes (animated page only) |
| `WEBKIT_SKIA_CPU_PAINTING_THREADS` | `SkiaPaintingEngine.cpp:220` | web | 0 to 8, used only with CPU rendering. 0 = paint on the main thread. | cores/2, max 8 | yes |
| `WEBKIT_SKIA_GPU_PAINTING_THREADS` | `SkiaPaintingEngine.cpp:241` | web | 0 to 4, used only with GPU rendering. 0 = paint on the main thread. | 2 with 4+ cores, else 1 | **no** |
| `WEBKIT_SKIA_MSAA_SAMPLE_COUNT` | `PlatformDisplaySkia.cpp:206` | web | Skia GPU surface MSAA. 0 or 1 disables. | 8 on x86 | yes (animated page only) |
| `WEBKIT_SKIA_ENABLE_DYNAMIC_MSAA` | `ImageBufferSkiaAcceleratedBackend.cpp:86` | web | Dynamic MSAA for accelerated image buffers. | on for GTK | no (canvas only) |
| `WEBKIT_LAYERS_TILE_SIZE` | `CoordinatedBackingStoreProxy.cpp:357` | web | `WxH` tile size override. | heuristic | **no** |
| `WEBKIT_SKIA_USE_LINEAR_TILE_TEXTURES`, `..._VIVANTE_SUPER_TILED_...` | `SkiaPaintingEngine.cpp:259`, `:275` | web | DMA-BUF backed tile textures. | off | n/a without DRM |
| `WEBKIT_DISPLAY_REFRESH_THROTTLE_FPS` | `DisplayLinkGLib.cpp:49` | UI | Throttles main-thread refresh callbacks; must divide the refresh rate. Does not throttle the compositor animation loop. | unset | yes |
| `WEBKIT_FORCE_VBLANK_TIMER` | `DisplayVBlankMonitor.cpp:50` | UI | Timer instead of DRM vblank. | unset | yes |
| `WEBKIT_DISABLE_ASYNC_SCROLLING` | `DACG.cpp:247` | web | Scrolling on the main thread. Compiled only with `ENABLE(DEVELOPER_MODE)`, so absent from distribution builds. | unset | no |
| `WEBKIT_EGL_PIXEL_LAYOUT` | `GLContext.cpp:79` | web | `RGB565` EGL config. The SHM target's color buffer is hard-coded `GL_RGBA8` (`AS.cpp:502`), so no effect here. | RGBA8888 | no |
| `WEBKIT_SHOW_FPS` | `TC.cpp:540` | web | Logs compositor FPS to the page console. Diagnostic. | unset | no |
| `WEBKIT_SHOW_DAMAGE` | `TextureMapperDamageVisualizer.cpp:41` | web | Draws damage rects; disables `UseForCompositing` in 2.52. Diagnostic. | unset | no |
| `WEBKIT_SHOW_COMPOSITING_DEBUG_VISUALS` | `Settings.cpp:345` | UI | Layer borders. Diagnostic. | unset | no |
| `WEBKIT_USE_SKIA_FOR_COMPOSITION` (2.54) | `DACGGLib.cpp:145` | web | `0`: TextureMapper compositor. | Skia | no |
| `WEBKIT_SKIA_ENABLE_DDL` (2.54) | `SkiaPaintingEngine.cpp:401` | web | `0`: no deferred display lists for tiles. | on | no |
| `WEBKIT_DISABLE_DMABUF_ATLAS` (2.54) | `SkiaPaintingEngine.cpp:344` | web | No DMA-BUF image atlas. | on | n/a without DRM |
| `WEBKIT_VULKAN_ENABLED` (2.54) | `WebProcessGLib.cpp:197` | web | `1`: initialise Vulkan. | off | no |

Untried knobs that could reduce the software-rendering cost, by expected value:

1. `UseDamagingInformationForCompositing` through
   `webkit_settings_set_feature_enabled()` (not an environment variable, 2.52).
   `[INFERRED]` Removes the area-proportional clear and composite for small
   animations. Leaves readback and UI redraw.
2. `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` and `WEBKIT_SKIA_MSAA_SAMPLE_COUNT=0`
   re-measured on the **scroll** and on any tile-repainting scenario
   (section 4). `[INFERRED]`
3. `WEBKIT_SKIA_GPU_PAINTING_THREADS=0|1`. `[INFERRED]` Fewer GL contexts and
   llvmpipe thread pools competing on 4 vCPU when tiles are painted with Skia
   GPU. No effect on pure compositor animations.
4. `WEBKIT_LAYERS_TILE_SIZE`. `[INFERRED]` Fewer, larger tiles mean fewer
   draw calls in the software rasterizer; larger tiles also mean larger
   repaints. Low expected gain.
5. `WEBKIT_FORCE_COMPOSITING_MODE=0` plus policy `ON_DEMAND` (2.52 only).
   `[INFERRED]` Useful only for pages that never create a composited layer.
   The page falls back to compositing permanently at the first one
   (section 3.2).
6. Outside WebKit: Mesa `LP_NUM_THREADS`. `[INFERRED]` Caps llvmpipe's thread
   pool; trades frame time for CPU.

## 7. Transparent web views

- `[READ]` The background colour is copied into the surface at creation and
  on change (`AS.cpp:124-125`, `:959-975`). It does not change the compositing
  path or the swap chain kind. For EGLImage targets it only selects an alpha
  or opaque DMA-BUF format (`AS.cpp:127-130`, `:697-768`); the SHM target is
  always `RGBA8` + `ShareableBitmap` (`AS.cpp:479-506`).
- `[READ]` Extra per-frame cost with a non-opaque background, composited mode:

```cpp
// AS.cpp:1049-1061 (2.52)
auto backgroundColor = m_backgroundColor.load();
if (!isColorOpaque(backgroundColor)) {
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
} else if (reasons.contains(CompositionReason::AsyncScrolling)) {
```

  A full-target clear on **every** frame, where an opaque view clears only on
  async scrolling.
- `[READ]` `WebPage::setBackgroundColor` propagates the colour to the frame
  view (`Source/WebKit/WebProcess/WebPage/WebPage.cpp:4119-4134`). The root
  contents are then not opaque, their tiles get alpha
  (`SkiaPaintingEngine.cpp:110-112`, `:91-95`) and are drawn with blending
  (`TM.cpp:498`).
- `[READ]` With damage-driven composition, the tile fragment fast path
  requires opaque tiles (`CoordinatedBackingStore.cpp:87`), so a transparent
  view only benefits from the scissor, not from fragment drawing. The scissor
  is what matters on llvmpipe. `[INFERRED]`
- `[READ]` UI process: the SHM bitmap is always wrapped as `CAIRO_FORMAT_ARGB32`
  and painted with `CAIRO_OPERATOR_OVER` (`ABS.cpp:625`, `:280`), whatever the
  background, so there is no opaque fast path to lose there.
- `[READ]` Non-composited mode in 2.52 paints the backing store with
  `CAIRO_OPERATOR_SOURCE` (`BackingStoreCairo.cpp:85`), and update bitmaps
  are copied with `CompositeOperator::Copy` (`BackingStoreCairo.cpp:133`).
- `[INFERRED]` Net effect of transparency in composited mode on llvmpipe: one
  more full-area pass (clear) and blended instead of copied root tiles. It is
  an aggravating factor, not the cause: the readback and the UI redraw are the
  same for an opaque view.

## 8. Where a fix could live upstream (INFERENCE)

Everything in this section is inference from the code read above. Sizes are
rough guesses, nothing was prototyped.

| # | Change | Files | Size | Risk |
| --- | --- | --- | --- | --- |
| A | Read back only the damaged area on the SHM path. Pass the target's accumulated damage (the same record `renderTargetDamage()` returns) to `RenderTargetSHMImage::didRenderFrame` and call `glReadPixels` / `readPixels` per rect or on the bounds, with `GL_PACK_ROW_LENGTH` or a row offset into the bitmap. The record must be maintained even when `UseForCompositing` is off (today `addDamage` is only reached through `renderTargetDamage()`, `AS.cpp:1098-1103`, 2.52). | `AcceleratedSurface.{h,cpp}` | 40 to 80 lines | Low to medium. Correctness depends on the per-target damage record being exact for a 2 to 4 buffer chain; a wrong record shows as stale pixels. Needs GLES 3 for `GL_PACK_ROW_LENGTH` or a per-row loop. |
| B | Honour frame damage in the GTK 3 UI process: in the fence callback, `gtk_widget_queue_draw_region` with the pending damage rects (scaled by the device scale factor, flipped in 2.52) instead of `gtk_widget_queue_draw`; fall back to a full redraw when the rect list is empty or the buffer size changed. `Buffer::paint` already clips to the GTK clip. | `UIProcess/gtk/AcceleratedBackingStore.cpp` | 20 to 40 lines | Low. Must stay a full redraw on first frame, resize, realize, and navigation gesture snapshot (same rule as `PageClientImpl::setViewNeedsDisplay`). Requires A or full buffers to be valid everywhere, which they are. |
| C | 2.52 only: default `UseDamagingInformationForCompositing` to true on GTK. Already done upstream in 2.54 (`Prefs.yaml:9191`). | `UnifiedWebPreferences.yaml` | 1 line | Medium on a stable branch (the flag was "testable"). An application can do it itself (section 2.4). |
| D | Auto-select the CPU path when GL is a software rasterizer: in the UI process, if `Display::singleton().glDisplay()->isSoftwareRendered()` then treat hardware acceleration as unavailable. In 2.54 this is a few lines in `HardwareAccelerationManager` (or in `AcceleratedBackingStore::canUseHardwareAcceleration`) and yields the Skia-CPU-into-SHM renderer with unconditional damage. In 2.52 it needs a backport of `GLDisplay::isSoftwareRendered()` and yields the `UpdateInfo` path. | 2.54: `UIProcess/gtk/HardwareAccelerationManager.cpp`. 2.52: plus `platform/graphics/egl/GLDisplay.{h,cpp}` | 2.54: about 10 lines. 2.52: about 60 lines | Medium. Behaviour change for every llvmpipe user: no accelerated compositing means no async scrolling, CSS 3D transforms flattened, WebGL and accelerated video sinks affected. Upstream would probably want an opt-out variable. Software GL in VMs, CI and remote desktops is where it helps most. |
| E | Skip the per-frame color clear for non-opaque backgrounds when damage is used: it already happens implicitly because the clear runs inside the damage scissor. Nothing to do beyond C. | n/a | n/a | n/a |
| F | Avoid the Y flip on the GTK 3 SHM path so the UI composite is a plain blit. Done upstream in 2.54 (`AS.cpp:942-943`, NEWS 2.54.0). | `AcceleratedSurface.h`, `AcceleratedBackingStore.cpp` | backport, about 20 lines | Low. |
| G | Paint opaque SHM buffers with `CAIRO_OPERATOR_SOURCE` (and an `RGB24` surface) when the page background is opaque. | `UIProcess/gtk/AcceleratedBackingStore.cpp` | about 10 lines | Low. No help for a transparent view. |

Ranking for this application (transparent view over a `GtkGLArea`, llvmpipe):

1. D is the only change that removes llvmpipe from the WebKit side, and it is
   what `WEBKIT_DISABLE_COMPOSITING_MODE=1` (2.52) or policy `NEVER` (both)
   already achieve by hand.
2. A + B + C together make the composited path proportional to damage end to
   end. C alone only fixes steps 7 to 9 of section 5.

## 9. Open doubts

- Whether the Ubuntu 24.04 build of 2.52.6 was configured exactly like the
  defaults read here (`USE_GBM`, `ENABLE_WEBGL`, `USE_SKIA`). `HAM.cpp:45-51`
  disables hardware acceleration entirely without `ENABLE(WEBGL)`; the
  measurements show compositing is active, so WebGL is enabled.
- Whether the main thread ticks at all during an accelerated CSS animation
  (animation bookkeeping in WebCore was not read). The compositor does not
  need it (`TC.cpp:252-253`).
- Whether llvmpipe takes a fast path for `glReadPixels(GL_BGRA)` from an
  `RGBA8` renderbuffer, and what pixman does for the flipped `OVER`
  composite. Both are outside the WebKit tarball.
- In 2.54 the CPU path calls `SkSurface::readPixels` from the bitmap-backed
  surface into the same bitmap on every frame (`AS.cpp:446-457`, 2.54). It
  looks like a full-size self copy; its real cost was not determined.
- `NEVER` at runtime in 2.52 (section 3.5) is a reading of the code path, not
  a tested behaviour.

## 10. Why the damage flag changes nothing in 2.52.6

Follow-up to measurements: `UseDamagingInformationForCompositing` set through
`webkit_settings_set_feature_enabled()` right after wry created the view and
called `load_uri` gives the same web process cost as with the flag off (bar
84 % / 85 %, spinner 85 % / 88 %, `width` animation 91 % / 92 %, zoom 148 % /
140 %), and the cost follows the window area. All references are 2.52.6.

### 10.1 The flag never reached the compositor (timing)

- `[READ]` The flag has exactly one reader on GTK: the `LayerTreeHost`
  constructor (`LTH.cpp:100-110`; the only other hits in the tree are the
  PlayStation host and the WPE-only `NCFR.cpp:135`). It is copied into
  `ThreadedCompositor::m_damage.flags` (`TC.cpp:234-242`) and never refreshed.
- `[READ]` It is read from the right object: `webPage.corePage()->settings()`,
  filled from the preference store sent by the UI process
  (`Source/WebKit/WebProcess/WebPage/WebPage.cpp:4801-4807`). No other cache.
- `[READ]` The `LayerTreeHost` is created inside the `WebPage` constructor:
  `updatePreferences(parameters.store)` at `WebPage.cpp:958`, then
  `enterAcceleratedCompositingModeIfNeeded()` at `WebPage.cpp:980`, which
  creates it at once when compositing is forced (`DACG.cpp:264-276`,
  `:564-578`), the GTK default. So the only store that counts is the one inside
  `WebPageCreationParameters`.
- `[READ]` That store is captured when the UI process sends `CreateWebPage`
  (`Source/WebKit/UIProcess/WebPageProxy.cpp:1810`, `:12500`
  `parameters.store = preferencesStore()`). On GTK the web process launch is
  delayed until the first load (`Source/WebKit/UIProcess/WebProcessPool.cpp:217-225`,
  `:1353-1361`), so this happens **inside the first `load_uri`**
  (`WebPageProxy.cpp:2155-2156` -> `launchProcess` `:1378-1420` ->
  `initializeWebPage` `:1768-1810`). The message is encoded at that moment and
  queued while the process launches
  (`Source/WebKit/UIProcess/AuxiliaryProcessProxy.cpp:271-273`).
- `[READ]` A feature set afterwards goes through `WebPreferences::update()`
  (`Source/WebKit/UIProcess/WebPreferences.cpp:140-149`) to
  `WebPageProxy::preferencesDidChange()` (`WebPageProxy.cpp:6913-6939`), which
  sends `PreferencesDidChange`. It is queued behind `CreateWebPage`, so the web
  process applies it after the `LayerTreeHost` exists. `WebCore::Settings` then
  holds `true`, and nothing looks at it again.
- `[READ]` Before the first load `preferencesDidChange()` returns early
  (`!hasRunningProcess()`, `WebPageProxy.cpp:6915`), but the store itself is
  already updated, so a feature set **between view creation and the first
  load** does end up in the creation parameters.
- `[INFERRED]` Conclusion: with "create view, `load_uri`, then set the feature"
  the compositor ran with the flag off in every measured run. The numbers
  compare off with off.
- `[READ]` Why the hardware acceleration policy set at the same place works:
  it is dynamic. `DACG.cpp:230-242` re-reads it on every preference update and
  WebCore tears the layer tree down (section 3.5). The damage flags have no
  such path.
- `[INFERRED]` The X server share dropping from 27 % to 16 % in the `width`
  case has no explanation in the WebKit source: no UI process code reads the
  flag, and GTK 3 ignores damage rects (section 1.4). Worth checking the frame
  rate of that run before reading anything into it.

Ways to get the flag in without rebuilding WebKit:

1. `[READ]` Set it before the first `load_uri` of the view (any call that
   launches the web process counts as the first load).
2. `[INFERRED, untested]` If the embedder loads during construction: set the
   flag, call `webkit_web_view_terminate_web_process()`, then load again. The
   relaunch goes through `launchProcess` and a new `CreateWebPage` with the
   current store.
3. `[INFERRED, untested]` Set the flag, switch the policy to `NEVER`, wait for
   the page to leave compositing (a later main loop turn, the exit is driven by
   a style update and a zero-delay timer, `DACG.cpp:332-341`, `:518-529`), then
   back to `ALWAYS`. The new `LayerTreeHost` samples the flag. Doing both in
   the same turn does not exit compositing.

### 10.2 With the flag on, when is the full frame still repainted

Mechanics first, all `[READ]`:

- The SHM swap chain starts with 2 render targets and may grow to 4
  (`AcceleratedSurface.h:362-363`, `AS.cpp:831-860`). In steady state the two
  alternate: the UI process releases the previous buffer when it commits the
  new one (`ABS.cpp:792-795`, `AS.cpp:863-877`).
- Buffer age is emulated: each target keeps a damage record
  (`AcceleratedSurface.h:178`), `std::nullopt` meaning "unknown, repaint
  everything". `renderTargetDamage()` adds the frame damage to every target
  (`AS.cpp:1098-1103`, `:922-930`, `:156-165`) and `didRenderFrame()` resets
  the record of the target just rendered to empty (`AS.cpp:1079`). With two
  targets the record of the current target is the union of the last two frames.
- The scissor comes from `bounds()` of that record (`TC.cpp:293-303`), applied
  through `beginScissorClip()` (`TM.cpp:1348-1365`, identity matrix, so always
  the scissor path for a non-empty rect). The clear runs inside it
  (`TC.cpp:306`). A non-opaque root does not force a full repaint.
- There is no `SharedMemoryWithoutGL` target in 2.52.6. The types are
  `EGLImage`, `SharedMemory`, `Texture`, `WPEBackend`
  (`AcceleratedSurface.h:325-337`); the SHM target is always GL. The CPU-only
  SHM surface is 2.54 (`usesGL() == false`).

Conditions that still give a full-frame repaint:

| # | Condition | Where | Tag |
| --- | --- | --- | --- |
| 1 | Flag not sampled as on when the `LayerTreeHost` was built (10.1) | `LTH.cpp:100-110` | READ |
| 2 | Unknown target record: first use of each target (the first 2 frames), any target created later, after a resize (`SwapChain::resize` resets the chain), after the view was hidden 10 s (`releaseUnusedBuffers`), after the GL context is destroyed | `AcceleratedSurface.h:178`, `AS.cpp:771-785`, `:890-901`, `:1013-1016` | READ |
| 3 | **A composited frame with empty damage.** `setFrameDamage()` stores it as `std::nullopt`, `renderTargetDamage()` passes that to every target, and `RenderTarget::addDamage(std::nullopt)` resets every record to unknown. That frame and the next frame on each other target are full | `AS.cpp:1090-1096`, `:1098-1103`, `:156-165` | READ |
| 4 | Frame damage is the whole surface: any added rect that contains the damage rect switches it to `Mode::Full`; a layer covering the window whose transform, size or opacity changes (the zoom case), a full-viewport tile repaint | `Source/WebCore/platform/graphics/Damage.h:309-317`, `TextureMapperLayer.cpp:306-308`, `:1348-1350`, `:1430-1431`, `:1507-1508` | READ |
| 5 | Bounding box only. The per-target record is always `Mode::BoundingBox` and the compositor only uses `bounds()`; `UnifyDamagedRegions` (on by default) does the same to the frame damage. Two small changes far apart repaint the box containing both | `AS.cpp:1076-1079`, `TC.cpp:282`, `:295-296` | READ |
| 6 | Layers with a contents layer are damaged entirely on every composited frame unless they carry explicit damage, changed or not (video, canvas, WebGL; directly composited images are INFERRED to be in this group) | `TextureMapperLayer.cpp:493-497` | READ |
| 7 | Layers with filters or masks add their overlap region on every frame, and that region is accumulated in a member that is never cleared | `TextureMapperLayer.cpp:534-550`, `TextureMapperLayer.h:295` | READ |
| 8 | Intermediate surfaces (group opacity, filters, masks, flattened 3D) are repainted in full into their own texture; only the final blit is scissored. No damage logic in `paintIntoSurface` / `paintUsingOverlapRegions` | `TextureMapperLayer.cpp:979`, `:1082`, `:1136`, `:1177-1178` | READ |
| 9 | `WEBKIT_SHOW_DAMAGE` set: the visualizer removes `UseForCompositing` | `TC.cpp:234-242` | READ |

Not a cause of full repaint: a running accelerated animation (it damages the
layer's old and new rect, `TextureMapperLayer.cpp:560-571`), rotated or
non-integral transforms (the damage is the enclosing rect of the mapped quad,
`TextureMapperLayer.cpp:456-465`, `:499-512`), the transparent background.

`[INFERRED]` For the measured page (one full-window gradient layer, one small
animated layer, continuous transform animation) none of 2 to 9 applies after
the first two frames. Once the flag is really on, clear and composite should
shrink to the animated strip. Condition 3 matters for real pages: an animation
with a delay, a hold between keyframes or `steps()` keeps the compositor
running (`TC.cpp:329-330`) with frames that carry no damage, and each of them
costs full repaints.

`[INFERRED]` What the flag cannot change: `glReadPixels` of the whole surface
(`AS.cpp:514-518`), the fence wait before it, and the whole-widget redraw in
the UI process. A web process at 78 % of one core at 60 fps is about 13 ms of
CPU per frame over all threads; if the profile shows most of it under
`glReadPixels` on the compositor thread rather than in llvmpipe rasterizer
threads, the flag alone will bring little and patch 0003 below is the one that
matters. This split is not knowable from the source.

### 10.3 Seeing the damage at runtime without rebuilding

- `[READ]` `WEBKIT_SHOW_DAMAGE=N` (N > 0, web process environment) draws this
  frame's damage as translucent red rects, inflated by N-1 pixels
  (`Source/WebCore/platform/graphics/texmap/TextureMapperDamageVisualizer.cpp:39-57`,
  `TC.cpp:318-323`). It only needs propagation (default on), so it shows what
  the compositor computes whatever the compositing flag. Caveat: it turns
  `UseForCompositing` off and reports full damage to the UI process, so it
  shows the damage, not the scissor, and it changes the cost being measured.
- `[READ]` Sysprof marks, if the build has `USE_SYSPROF_CAPTURE` (default ON,
  `Source/cmake/OptionsGTK.cmake:74`) and the app runs under sysprof (the
  control fd is forwarded to the web process,
  `Source/WebKit/UIProcess/Launcher/glib/ProcessLauncherGLib.cpp:204`):
  `CollectDamage` (`TC.cpp:284`), `FlushCompositingState`, `PaintToGLContext`,
  `PaintTextureMapperLayerTree` (`TC.cpp:405-411`, `:308-310`), the trace
  scopes `RenderLayerTree` (`TC.cpp:351`) and `WaitForCompositionCompletion`
  (`AS.cpp:1066`, fence wait plus readback), and the `DidRenderFrame` mark with
  the composition reasons (`TC.cpp:418`). None carries the damage rect or the
  scissor. On a deferred software rasterizer the paint marks only time command
  submission; `WaitForCompositionCompletion` is where the frame is paid.
- `[READ]` No release log channel prints damage (no `RELEASE_LOG` in the damage
  code). The damage history API (`FrameDamageForTesting.h`,
  `foreachRegionInDamageHistoryForTesting`) is reachable only from the
  `internals` test object.
- `[READ]` Nothing reports whether the web process sampled the flag as on.
  `webkit_settings_get_feature_enabled()` answers from the UI process store.
- `[INFERRED]` Practical check: `WEBKIT_SHOW_DAMAGE=1` to confirm the frame
  damage is the expected strip, then a perf comparison of the llvmpipe
  rasterizer share with the flag set before and after the first load.

### 10.4 Patch drafts

Unified diffs against the 2.52.6 tarball, `-p1`, generated with `diff -u` from
scratch copies and checked with `patch` against the pristine files (series
1 to 5 in order, each independent one alone, 0002+0003, 0004 and 0005 in both
orders). **None was compiled.** They live in
`dev/bench/investigation/patch-drafts/2.52.6/`:

| File | Maps to | Touches | Depends on |
| --- | --- | --- | --- |
| `0001-damage-use-for-compositing-by-default-on-gtk.patch` | (a) the flag is on from the first frame, no timing issue | `UnifiedWebPreferences.yaml` (1 line, same change as 2.54) | none |
| `0002-damage-keep-target-records-on-empty-frames.patch` | (a) condition 3 of 10.2; a target with an empty record is clipped to one pixel instead of taking the stencil path | `AcceleratedSurface.cpp` (`renderTargetDamage`), `ThreadedCompositor.cpp` (`paintToCurrentGLContext`) | none |
| `0003-shm-read-back-changed-area-only.patch` | (b) `glReadPixels` limited to the bounds of the target's record, with `GL_PACK_ROW_LENGTH`; records maintained even with the compositing flag off | `AcceleratedSurface.{h,cpp}` (`didRenderFrame`, `setFrameDamage`, new `addFrameDamageToTargets`, `RenderTargetSHMImage::didRenderFrame`) | 0002 |
| `0004-gtk3-redraw-damaged-region-only.patch` | (c) `gtk_widget_queue_draw_region` with the frame's damage rects | `UIProcess/gtk/AcceleratedBackingStore.{h,cpp}` (fence monitor callback, `update`, `unrealize`) | none |
| `0005-disable-compositing-on-software-gl.patch` | software GL fallback, with `WEBKIT_FORCE_COMPOSITING_MODE` (any value but 0) as the override | `UIProcess/gtk/HardwareAccelerationManager.cpp`, `AcceleratedBackingStore.{h,cpp}` (new `isSoftwareRendered`) | none |

Points to verify when compiling and measuring (`[INFERRED]`):

- 0003 relies on the Y mapping "GTK 3 SHM target: buffer row = height - maxY".
  It follows from the compositor using `FlipY::No` there (`TC.cpp:71`,
  `:99-100`), the projection matrix (`TM.cpp:1303-1311`) and the inverted
  scissor (`Source/WebCore/platform/graphics/texmap/ClipStack.cpp:98-105`).
  A wrong mapping shows at once as a stale band mirrored vertically.
- 0003 and 0004 trust the damage to be exact; anything drawn outside it stays
  stale. An animated element with antialiased or rotated edges is the case to
  look at.
- 0004 can only help what GTK and the X server do with the invalidated area.
  With a `GtkGLArea` in the toplevel the GDK GL path may still present more
  than the region.
- 0005 detects the software device through `EGL_EXT_device_query` on the UI
  process display. That Mesa attaches a device with `EGL_MESA_device_software`
  to an X11 or Wayland llvmpipe display was not read (Mesa is out of scope);
  the 2.52 code already relies on the same query returning a device there
  (`DRMMainDevice.cpp:216-229`).
- With 0001 to 0004 the per-frame cost left on the SHM path is the fence
  creation and wait, the layer tree walk, and the IPC round trip, none of which
  depends on the window area.
