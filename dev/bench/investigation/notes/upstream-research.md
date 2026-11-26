# Upstream research: WebKitGTK CPU cost of per-frame animations on llvmpipe

Status: complete for the seven questions; open points are listed in section 9.
Research date: 2026-11-26. Source types: bug trackers, blog posts, release
notes, documentation. No WebKit source tree reading beyond NEWS and the
environment variable doc shipped in the tree.

Legend: [DEV] stated by an upstream developer, [REP] stated by a reporter or
user, [INF] inference made for these notes.

## 1. The two known bugs

### Bug 276580, "[WPE][GTK] 100% CPU usage for simple CSS-only transform animation"

URL: https://bugs.webkit.org/show_bug.cgi?id=276580
Status NEW, component WPE WebKit, unassigned, opened 2024-07-14, last change
2026-01-12. No duplicates, no see-also, no depends/blocks, no patch, no commit.
Five comments in total:

- [REP] 2024-07-14: a kiosk page (CSS transform animation in an iframe) loads
  the CPU fully; Blink and Gecko do not. Tested on current Cog and Epiphany.
- [DEV, Apple] 2024-07-15: on macOS the WebContent process sits at about 11 %.
- [DEV, Igalia, philn] 2024-07-15: "Here there's a CPU bottleneck due to
  GLFence::create()." No profile attached, no follow-up.
- [REP] 2024-07-15: cog 0.18.3 (WPE WebKit 2.44.1) and Epiphany 46.1
  (WebKitGTK 2.44.2); one core saturated (confirmed with taskset).
- [REP] 2024-10-01: with 2.46 the usage is drastically reduced, reporter
  assumes Skia; asks whether software rendering still deserves investigation.
  Nobody answered. The bug was touched on 2026-01-12 without a comment.

[INF] The bug never states that the reporter was on llvmpipe; the last comment
only mentions "software rendering" as an open question. The GLFence remark
dates from 2.44 (Cairo, TextureMapper). See section 2 for what changed around
fences since.

### Bug 271201, "[WebkitGTK] Ridiculous CPU consumption on some websites"

URL: https://bugs.webkit.org/show_bug.cgi?id=271201
Status NEW, component WebKitGTK, unassigned, opened 2024-03-18, last change
2024-03-22. One comment only (the report), no upstream answer.

- [REP] Telegram Desktop web apps: a static page costs about 30 % CPU in
  WebKitWebProcess, and a page with one minimal CSS animation about 260 %.
  No version, GPU or renderer information in the report.

[INF] 260 % for one small CSS animation matches our ~280 % llvmpipe figure,
but the report does not say which GL renderer was in use.

### Other open upstream bugs with the same symptom (no llvmpipe statement)

- Bug 291791, "[GTK] Constant 300% CPU usage on the Loop fintech website's
  front page due to animations", NEW, 2025-04-19, WebKitGTK 2.48.1, Wayland,
  "on any computer" [REP]. Sysprof capture attached, no developer answer.
  https://bugs.webkit.org/show_bug.cgi?id=291791
- Bug 290155, "[GTK] Constant CPU usage while idle on the front page of
  tiki.org", NEW, 2025-03-21, WebKitGTK 2.46.6, Intel and AMD GPUs [REP]. No
  developer answer. https://bugs.webkit.org/show_bug.cgi?id=290155
- Bug 322024, high CPU on wise.com, NEW, 2026-08-18, Epiphany 50.4 on Intel.
  [DEV, Apple, 2026-09-08] the page runs a rAF-driven JS animation library:
  "We can't optimize these away." Also reproduced in Safari by the reporter.
  https://bugs.webkit.org/show_bug.cgi?id=322024

[INF] There is no upstream bug that names llvmpipe as the cause of
per-frame compositing cost. The closest are 276580 (open, no owner) and the
third-party reports in section 4.

## 2. Rendering architecture since Skia, and damage

### Timeline (release notes and Igalia posts)

| Version | Change | Source |
| --- | --- | --- |
| 2.41.1 / 2.42 | DMA-BUF renderer becomes the default way to share the composited frame between web and UI process. On GTK 3 + X11 the buffer is downloaded to the CPU and painted with Cairo. | [DEV] https://blogs.igalia.com/carlosgc/2023/04/03/webkitgtk-accelerated-compositing-rendering/ |
| 2.41.x (262865@main) | With software rasterization the old fallback was the WPE renderer; replaced by the DMA-BUF code path using shared memory bitmaps. | [DEV] https://bugs.webkit.org/show_bug.cgi?id=254587 |
| 2.43.x (271134@main, 271282@main) | X11 and WPE renderers removed; the DMA-BUF renderer falls back to shared memory when DMA-BUF is unavailable, expected to perform similarly or better. | [DEV] https://bugs.webkit.org/show_bug.cgi?id=265308 and https://bugs.webkit.org/show_bug.cgi?id=265511 |
| 2.45.1 / 2.46 | Skia replaces Cairo. GPU rendering is the default; tiles are rendered as textures and the compositor waits for them with fences. | [DEV] https://blogs.igalia.com/carlosgc/2024/09/27/graphics-improvements-in-webkitgtk-and-wpewebkit-2-46/ |
| 2.45.6 | GL fences use a server-side wait where possible (bug 277134, 281396@main, glWaitSync instead of glClientWaitSync). Composition is also skipped when no layer changed even with a rAF callback scheduled. | NEWS; https://bugs.webkit.org/show_bug.cgi?id=277134 |
| 2.46 | Experimental damage tracking, off by default, runtime features `PropagateDamagingInformation` and `UnifyDamagedRegions`. | [DEV] same 2.46 post |
| 2.47.2 / 2.48 | Tile rendering moved to a secondary thread with GPU; collected damage starts being used to improve composition inside WebKit. Rendering paused when the toplevel is suspended. | NEWS; https://webkitgtk.org/2025/04/08/webkitgtk-2.48.html |
| 2.49.x / 2.50 | Explicit fence export (WPE 281640@main; GTK always polls the fence fd asynchronously in the UI process since 281744@main); hybrid CPU+GPU mode; SkPicture display lists; damage propagation to the UI process enabled by default (2.49.2, GTK only). | [DEV] https://blogs.igalia.com/carlosgc/2025/04/21/graphics-improvements-in-webkitgtk-and-wpewebkit-after-the-switch-to-skia/ ; NEWS; https://webkitgtk.org/2025/11/26/webkitgtk-2.50.html |
| 2.51.x / 2.52 | Hybrid mode removed (2.51.2); run loop observers schedule layer flush and composition; composition scheduling no longer blocks waiting for tile painting (2.51.3); no composition for non visible layers with running animations (2.51.93); damage propagation possible in non-composited mode (305510@main). | NEWS; https://webkitgtk.org/2026/03/18/webkitgtk-2.52-highlights.html |
| 2.53.x / 2.54 | Skia compositor replaces TextureMapper (2.53.3); deferred display lists; damage-aware compositing on by default; non-composited mode rewritten and shared with WPE (2.53.1); on-demand policy deprecated in the GTK 3 API (2.53.1); Cairo option removed. | https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html ; posts below |

### How damage propagation works

Sources: Pawel Lampe, "Introduction to damage propagation in WPE and GTK
WebKit ports", 2025-04-16,
https://blogs.igalia.com/plampe/introduction-to-damage-propagation-in-wpe-and-gtk-webkit-ports/
and Nikolas Zimmermann, "Bringing damage to the Skia compositor", 2026-09-21,
https://blogs.igalia.com/nzimmermann/posts/2026-09-21-skia-compositor-damaging/

- [DEV] Layer dirty rects (always tracked, used to repaint only dirty tile
  areas) are passed to the compositor thread, merged with damage inferred from
  layer property changes (transform, opacity, ...) into a per-frame "frame
  damage" in view coordinates, sent over IPC with the frame to the UI process,
  which either consumes it or drops it.
- [DEV] Lampe describes the feature as trading GPU work for more CPU and
  memory use. The stated target is embedded GPUs, not CPU savings.
- [DEV] Before the Skia compositor, the whole frame was still composited
  inside WebKit every time, and damage "mostly served to restrict the partial
  updates" sent to the windowing system (Zimmermann). The TextureMapper use of damage for
  compositing was a single glScissor on the bounding box plus tile skipping,
  and was off by default because of unfixed glitches.
- [DEV] Skia compositor (2.54): two passes per frame, a damage pass on a
  no-draw canvas, then a paint pass where every draw is split per damage
  rectangle (Skip, SplitByRect, ClipToDamage for rotated or skewed transforms).
  Each swap chain buffer keeps its own accumulated damage. Damage rectangles
  are capped by `DamageRectangleThreshold` (default 4), then gridded in 256 px
  cells.
- [DEV] Zimmermann's own partial-change demo: GPU load from about 20 % to a
  few percent with the Skia compositor and damage. MotionMark barely moves
  because it changes most of the viewport.

### Feature flags and defaults per version

Read from `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` on each
release branch (https://github.com/WebKit/WebKit/tree/webkitglib/2.52 etc.).

| Feature (WebKitFeature identifier) | 2.46 | 2.48 | 2.50 | 2.52 | 2.54 | status |
| --- | --- | --- | --- | --- | --- | --- |
| `PropagateDamagingInformation` | off | off | on (GTK only) | on (GTK only) | on (GTK, WPE) | testable |
| `UnifyDamagedRegions` | off | off | on (GTK only) | on (GTK only) | on (GTK, WPE) | unstable |
| `UseDamagingInformationForCompositing` | absent | absent | off | off | on (GTK, WPE) | testable |
| `DamageRectangleThreshold` (uint, default 4) | absent | absent | absent | absent | present | unstable |
| `UseSkiaForComposition` | absent | absent | absent | absent | on | internal |
| `HardwareAccelerationEnabled` | absent | absent | absent | absent | on | internal |

Notes:

- [DEV] `UseDamagingInformationForCompositing` was switched on, off
  (318770@main, bug 321254, because of regressions in compositing performance
  tests), and on again (318857@main) in August 2026; the 2.54 branch file
  has it on. https://bugs.webkit.org/show_bug.cgi?id=321254
- [DEV] 2.54 highlights: compositing uses the damage information by default. https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html
- [DEV] `WEBKIT_SHOW_DAMAGE=1` draws the damage rectangles and disables the
  damage-driven compositor optimizations while set (Lampe post).
- [DEV] MiniBrowser switch: `--features=+PropagateDamagingInformation`
  (comma-separated, `+`/`-` prefixes).
- [DEV] Accelerated 2D canvas was not supported by damage in April 2025
  (Lampe post asks for `-CanvasUsesAcceleratedDrawing`). Not rechecked for
  2.54.
- Open correctness bug with both features on: bug 323675 (NEW, 2026-09-08),
  incorrect painting of a 3D CSS scene.
  https://bugs.webkit.org/show_bug.cgi?id=323675

### Does GTK benefit, and does GTK 3 or the SHM path use the damage?

- [DEV] Lampe (April 2025): the GTK port consumes the damage in
  `AcceleratedBackingStoreDMABuf.cpp`; WPE only with the new platform API
  (Wayland, DRM).
- [DEV, contributor patch reviewed by Carlos Garcia Campos] Bug 324546,
  (GTK 3 repaints and uploads the whole web view every frame because the
  frame damage is ignored), fixed in 321589@main on 2026-09-22. The commit
  message states that the damage rects were only consumed by the GTK 4 code
  paths (GdkMemoryTextureBuilder, GdkDmabufTextureBuilder) and that on GTK 3
  they are dropped, so GTK repainted and uploaded the complete view
  for every frame, which it calls expensive for the shared memory buffers used
  without hardware acceleration (Cairo paint of a full image surface pushed to
  the X server per frame). https://bugs.webkit.org/show_bug.cgi?id=324546 and
  https://github.com/WebKit/WebKit/pull/74342
- [INF] So on GTK 3 with 2.52 (our case, through wry) the UI process ignores
  the damage entirely, in both the DMA-BUF and the SHM transport. Whether
  321589@main was cherry-picked to a 2.54.x release was not determined: the
  2.54.1 to 2.54.3 NEWS do not name it. 2.54.1 does list the neighbouring
  321558@main (skipping non-composited frames without damage).
- [REP, third-party source analysis of 2.48.5, unverified here] In SHM
  transport mode the web process does a full-surface synchronous
  `glReadPixels` into the shared bitmap for every composited frame, not
  limited to damage. https://github.com/unslothai/unsloth/issues/9393
- [INF] Combined, on 2.52 with llvmpipe the per-frame fixed cost in
  accelerated compositing mode is: full-frame composition in llvmpipe
  (TextureMapper, damage not used for compositing by default), a fence or
  finish, a full-frame readback into SHM, then a full-view Cairo repaint on
  GTK 3. None of it scales with the changed area, which matches the
  measurement that the cost follows the frame count.

### Statements about software rendering and llvmpipe

- [DEV] 2.46 post: on embedded systems "it's still better to use the CPU with
  several rendering threads". This is about tile painting (Skia CPU
  rasterization), not about compositing with a software GL.
- [DEV] Bug 307426 (2026-02-10, Carlos Garcia Campos), about the non-composited
  mode: damage matters with CPU rendering because fewer pixels have to be
  uploaded to the GPU by the UI process. https://bugs.webkit.org/show_bug.cgi?id=307426
- [DEV] 2.54 highlights: the mode used when hardware acceleration is not
  available was reworked and shares its code with WPE: always uses damage,
  at most one frame per vblank, MSAA when available.
- No Igalia post or release note found that discusses llvmpipe performance of
  the accelerated compositing path. [INF] The upstream performance work is
  measured on a Raspberry Pi 4 GPU (WPE dashboard), so software GL compositing
  is not a tracked configuration.
- The WPE test bots run on the Mesa software rasterizer (bug 274148).
  https://bugs.webkit.org/show_bug.cgi?id=274148

## 3. Release notes: compositing, policy, non-composited mode

Source: `Source/WebKit/gtk/NEWS` on `webkitglib/2.54` and `webkitglib/2.52`
(https://github.com/WebKit/WebKit/blob/webkitglib/2.54/Source/WebKit/gtk/NEWS)
and https://webkitgtk.org/news.html. Latest stable at research time: 2.54.3
(2026-11-18). 2.52 line: 2.52.6 (2026-08-19). No 2.55.x release listed yet.

Items relevant to this problem, beyond the timeline above:

- 2.53.1: the non-accelerated mode now uses the same buffer sharing
  implementation as the accelerated mode (306485@main, bug 305391). The
  PR adds a `UseHardwareBuffersForFrameRendering` preference that selects
  DMA-BUF or SHM for frame transfer and now determines the GTK
  hardware-acceleration-policy value.
  https://github.com/WebKit/WebKit/pull/56495
- 2.53.1: the on-demand hardware acceleration policy is deprecated in the
  GTK 3 API. [DEV] reason: "It's rarely used nowadays", and removing it
  simplifies the drawing area; on-demand now behaves as always.
  https://bugs.webkit.org/show_bug.cgi?id=307052
- 2.53.90: rendering tiles in the main thread is no longer supported in
  accelerated compositing mode.
- 2.54.0: fix for y-flipped contents on GTK 3 with SHM or GBM mapped
  buffers (bug 323313, a Skia compositor regression on the GTK 3 SHM path).
- 2.54.1: non-composited frames are skipped when the damage is empty
  (bug 323978).
- 2.54.2: performance fix for compositing layers with backdrop filters.
- 310838@main (2.54): with `HardwareAccelerationEnabled` the non-composited
  mode can keep hardware acceleration for canvas and filters.
  https://github.com/WebKit/WebKit/pull/62342
- 2.52 series NEWS (2.52.0 to 2.52.6): no compositing, damage or software
  rendering item. 2.52.x only gets fixes.

Is the non-composited mode deprecated? No. [DEV] It was reimplemented in the
2.53 cycle (NonCompositedFrameRenderer, bugs 303170, 305391, 307426, 307541,
308464, 308542, 309888, 310827, 311801) and is advertised in the 2.54
highlights. [INF] It is an invested-in path, the opposite of a removal
candidate. What was removed is the ability to switch between the two modes
at run time on demand.

Known breakage of the non-composited mode (relevant if
`WEBKIT_DISABLE_COMPOSITING_MODE=1` is shipped as a workaround):

- [REP] `document.startViewTransition()` crashes when accelerated compositing
  is unavailable or disabled: bug 304067 (NEW, 2025-12), bug 321683 (NEW,
  2.52.3 and 2.52.5, UI process SIGSEGV, GTK 3), bug 328823 (NEW, 2.54.1,
  web process abort), bug 324730 (NEW, with WEBKIT_DISABLE_DMABUF_RENDERER).
  https://bugs.webkit.org/show_bug.cgi?id=321683
  https://bugs.webkit.org/show_bug.cgi?id=328823
- [DEV, Igalia, clopez] Regressions after 306485@main with compositing
  disabled or policy NEVER on softGL (bug 306993 fixed, bug 307077 still NEW):
  these only affect 2.53/2.54, not 2.52.
  https://bugs.webkit.org/show_bug.cgi?id=307077
- Bug 324543 (fixed 324966@main, 2026-10-28): non-composited rendering wiped
  everything outside the damage with a transparent web view background, in
  2.54.0.
- Bug 329288 (NEW, 2026-10-28): non-composited Skia rendering draws into the
  wrong framebuffer with the NVIDIA driver.

Frame rate related:

- Bug 315997 (NEW): DisplayRefreshMonitor falls back to a timer and caps rAF
  at about 30 fps on some Wayland setups in 2.52.x; a reporter measured it
  fixed in 2.53.92. [REP] only, no developer comment.
  https://bugs.webkit.org/show_bug.cgi?id=315997
- Bug 309888 (fixed 309199@main): non-composited mode could render more than
  one frame per vblank.

Igalia WebKit Periodical entries on damage (2025):

- [DEV] #26: damage propagation toggled for GTK, with a single rectangle
  passed to the UI process for now.
  https://blogs.igalia.com/webkit/blog/2025/wip-26/
- [DEV] #13: `WEBKIT_SHOW_DAMAGE` visualizer added.
  https://blogs.igalia.com/webkit/blog/2025/wip-13/
- [DEV] #34: damage can be propagated from accelerated 2D canvas (PR 44192).
  https://blogs.igalia.com/webkit/blog/2025/wip-34/
- No Periodical entry found that mentions llvmpipe or software GL
  performance (searched, not read exhaustively).
- [DEV] Lampe, "The problem of storing the damage", 2025-09-05: compares
  bounding box, region, R-tree and grid storage; a small grid such as 8x4 is
  described as giving high damage resolution at low cost.
  https://blogs.igalia.com/plampe/the-problem-of-storing-the-damage/

## 4. Other reports of high CPU or breakage on software GL

### Does WebKitGTK fall back to non-accelerated mode on a software rasterizer?

Short answer from the sources read: no, not since 2.42, and no upstream
statement was found that treats llvmpipe as a reason to leave accelerated
compositing.

- [DEV] 2016, bug 154147: `WEBKIT_DISABLE_COMPOSITING_MODE` added to cope
  with bad graphics drivers and similar bugs (2.10.9 per the wiki).
  https://bugs.webkit.org/show_bug.cgi?id=154147
- [DEV] 2017, bug 167492 (2.15.4/2.16): accelerated compositing made on-demand
  again because always-on needed more memory and broke rendering on some
  drivers; the env var "was not expected to be used by users".
  https://bugs.webkit.org/show_bug.cgi?id=167492
- NEWS 2.27.2: accelerated compositing is disabled when the EGL display fails
  to initialize under Wayland. NEWS 2.27.4: on-demand never leaves AC once
  entered.
- [DEV] 2023, bug 254587: with software rasterization the code used to fall
  back to the WPE renderer because the dma-buf import extension is missing;
  replaced by shared memory bitmaps inside the same accelerated path.
  https://bugs.webkit.org/show_bug.cgi?id=254587
- [REP + webkit://gpu dump] 2023, bug 259320 (2.41.6, QEMU VM): with
  `GL_RENDERER` llvmpipe the policy reads "always" and the renderer "DMABuf".
  Fixed for the blank page (266201@main); nobody proposed leaving AC mode on
  llvmpipe. https://bugs.webkit.org/show_bug.cgi?id=259320
- [DEV] API docs: changing the policy may be impossible when the system does
  not support hardware acceleration; the getter then returns the actual
  policy.
- [DEV] 2023, bug 262607: a patch to disable the DMA-BUF renderer for the
  NVIDIA proprietary driver was proposed by the maintainer and closed WONTFIX
  after a maintainer judged it probably unnecessary; Debian reported problems again with
  2.46.0. https://bugs.webkit.org/show_bug.cgi?id=262607
- [REP, third party] Debian, Ubuntu and openSUSE are said to carry an
  `isNVIDIA()` patch that empties the transport set and so drops accelerated
  compositing for NVIDIA. Not verified against the distro patches.
  https://github.com/OrcaSlicer/OrcaSlicer/pull/16385
- [INF] The only automatic exits from accelerated compositing are "no usable
  buffer transport or EGL at all" (and distro NVIDIA patches). A working
  llvmpipe EGL counts as hardware acceleration available. What was removed is
  (a) the X11/XDamage and WPE renderers in 2.43.2, (b) the run-time on-demand
  switching in 2.53.1. No bug was found asking upstream to detect a software
  renderer and pick the non-composited mode; that request has apparently
  never been filed.

### Reports

| Where | Version, context | Symptom | Workaround that worked | Upstream answer |
| --- | --- | --- | --- | --- |
| https://github.com/yetone/magpie/issues/2827 [REP] | webkit2gtk-4.1, Ubuntu 26.04, xrdp X11, no GPU, 24 cores | WebKitWebProcess 459 to 830 % on an animated page, 24 `llvmpipe-N` threads at ~25 % each; 0 % when minimized | `WEBKIT_DISABLE_COMPOSITING_MODE=1`: 23 %, no visible difference | none (app tracker) |
| https://github.com/Psysonic/psysonic/issues/1579 [REP] | Tauri app in Flatpak without `--device=dri` | llvmpipe, 12 llvmpipe threads, ~190 % CPU at startup, 1.5 GiB RSS | add `--device=dri` | none |
| https://github.com/Keeferf/solyn/pull/106 [REP] | Tauri app on WSLg | compositing rasterizes on llvmpipe, stutter | sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` when WSL detected | none |
| https://github.com/tauri-apps/tauri/issues/15936 [REP] | 2.52.3, Debian 13, Xvfb, no GPU, tauri 2.11.1 | blank window under software GL | `WEBKIT_DISABLE_COMPOSITING_MODE=1` | open, no maintainer answer |
| https://github.com/tauri-apps/tauri/issues/14424 | feature request for hardware-acceleration-policy | n/a | [Tauri member] set `WEBKIT_DISABLE_COMPOSITING_MODE=1` before the builder, or `with_webview` and the webkit2gtk setter | open |
| https://github.com/tauri-apps/tauri/issues/3988 | 2022 to 2025, generic "bad performance on linux" | lag with many DOM nodes, laggy CSS animations | none | [Tauri member, 2025-04] plans are CEF or Servo as alternatives and a GTK 4 port; no WebKitGTK tuning |
| https://github.com/QubesOS/qubes-issues/issues/9595 [REP] | Qubes 4.2, llvmpipe | black or empty view, "Failed to get GBM device" | `WEBKIT_DISABLE_COMPOSITING_MODE=1` | open |
| https://bugs.webkit.org/show_bug.cgi?id=280386 | 2.45.91, Fedora 41, llvmpipe | blank view, "Unsupported dmabuf format" | n/a | [DEV] modifiers-unsupported case mishandled; still NEW |
| https://bugs.webkit.org/show_bug.cgi?id=278777 | 2.44.2, VMware guest with 3D | nothing rendered | `WEBKIT_DISABLE_COMPOSITING_MODE=1` | NEW, no answer |
| https://bugs.webkit.org/show_bug.cgi?id=262612 | 2023, Flatpak Canary, toolbox | llvmpipe used despite an NVIDIA GPU | n/a | NEW, no answer |
| https://github.com/unslothai/unsloth/issues/9393 [REP, source analysis] | Tauri app, 2.44 to 2.52 | `WEBKIT_DISABLE_DMABUF_RENDERER=1` empties the transport set, so AC and threaded scrolling go off (CPU painting); `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` keeps AC on with a full-frame readback | n/a | none |

Not found: reports on gitlab.gnome.org (Epiphany, Evolution, Geary, Yelp),
Launchpad, Red Hat Bugzilla or Arch that tie high CPU specifically to
llvmpipe compositing. The hits there were blank-view or driver bugs, or old
(2016 to 2022) CPU reports without a renderer statement. Search was not
exhaustive.

## 5. API documentation

### Hardware acceleration policy

- `webkit_settings_set_hardware_acceleration_policy(settings, policy)`,
  since 2.16, sets the `hardware-acceleration-policy` property.
  https://webkitgtk.org/reference/webkit2gtk/stable/method.Settings.set_hardware_acceleration_policy.html
- GTK 3 API (webkit2gtk-4.1) enum values: `ON_DEMAND` (0), `ALWAYS` (1),
  `NEVER` (2). GTK 4 API (webkitgtk-6.0): `ALWAYS` (0), `NEVER` (1) only.
  https://webkitgtk.org/reference/webkit2gtk/stable/enum.HardwareAccelerationPolicy.html
  https://webkitgtk.org/reference/webkitgtk/stable/enum.HardwareAccelerationPolicy.html
- Documented default in the current stable reference: `ALWAYS`, for both API
  versions. Property doc: disabling "might cause some websites to not render
  correctly or consume more CPU".
  https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.hardware-acceleration-policy.html
- Deprecation: `ON_DEMAND` deprecated in the GTK 3 API from 2.53.1 / 2.54 and
  behaves like `ALWAYS` (2.54 highlights). The rendered stable enum page does
  not show a deprecation marker (checked 2026-11-26).
- [INF] `NEVER` and `WEBKIT_DISABLE_COMPOSITING_MODE=1` both lead to the
  non-composited renderer. In 2.52 they go through the old GTK drawing area
  (CPU paint of the dirty region into a shared bitmap); in 2.54 through the
  new NonCompositedFrameRenderer, where `HardwareAccelerationEnabled` and
  compositing are separate (310838@main). The setter must be called on the
  settings object before or at web view creation to be safe; a Tauri member
  doubted it can be changed on a live view.

### Runtime features

- `WebKitFeature` (since 2.42): identifier, default value, status, category,
  name, details. Lists: `webkit_settings_get_all_features()`,
  `webkit_settings_get_experimental_features()`,
  `webkit_settings_get_development_features()`. Toggle with
  `webkit_settings_set_feature_enabled(settings, feature, enabled)`.
  2.54 adds `webkit_feature_list_find()` to look one up by identifier.
  https://webkitgtk.org/reference/webkit2gtk/stable/struct.Feature.html
  https://webkitgtk.org/reference/webkit2gtk/stable/method.Settings.set_feature_enabled.html
- Status enum: embedder, unstable, internal, developer, testable, preview,
  stable, mature.
  https://webkitgtk.org/reference/webkit2gtk/stable/enum.FeatureStatus.html
- The documentation does not list individual features. The damage features
  exist as preferences with status testable or unstable (section 2), so
  [INF] they should appear in `webkit_settings_get_all_features()` and be
  toggleable on 2.50+; whether "internal" ones (`UseSkiaForComposition`,
  `HardwareAccelerationEnabled`) are exposed was not verified. To be checked
  at run time by iterating the list and matching
  `webkit_feature_get_identifier()`.
- [INF] In a Tauri app this is reachable through `with_webview` and the
  webkit2gtk crate (`SettingsExt::set_feature_enabled`, crate feature for
  2.42). Not verified against the crate version in use.

## 6. Environment variables

Documented in the tree (`Source/WebKit/glib/environment-variables.md.in`,
https://github.com/WebKit/WebKit/blob/webkitglib/2.52/Source/WebKit/glib/environment-variables.md.in ),
which warns that they are not stable across versions:

| Variable | Meaning | Versions |
| --- | --- | --- |
| `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` | no GPU for tile painting and accelerated image buffers (filters); canvas may still be accelerated (main wording) | 2.46+ |
| `WEBKIT_SKIA_CPU_PAINTING_THREADS=N` | CPU tile painting workers; default cores/2 capped at 8 | 2.46 to 2.52; renamed `WEBKIT_SKIA_TILE_PAINTING_THREADS` on main |
| `WEBKIT_SKIA_GPU_PAINTING_THREADS=N` | GPU tile painting workers; default 2 with more than 3 cores, else 1; `0` means no GPU tile rendering | 2.48 to 2.52; gone on main (DDL) |
| `WEBKIT_SKIA_USE_LINEAR_TILE_TEXTURES` | linear dma-buf tile textures written without GL uploads; aimed at some i.MX8 | 2.52 doc |
| `WEBKIT_DEBUG=channels` | logging channels; main adds a `GLContext` channel that creates debug EGL contexts | all |
| `WEBKIT_DEBUG_OUTPUT=journal|stderr` | log destination | main only |
| `WPE_DRM_DEVICE`, `WPE_DRM_RENDER_NODE`, `WPE_DMABUF_BUFFER_FORMAT` | WPE only | |

From the old wiki (https://trac.webkit.org/wiki/EnvironmentVariables , marked
as possibly outdated):

| Variable | Meaning |
| --- | --- |
| `WEBKIT_DISABLE_COMPOSITING_MODE=1` | force accelerated compositing off (WebKitGTK since 2.10.9) |
| `WEBKIT_FORCE_COMPOSITING_MODE=1` | force it on (since 2.10.5) |
| `WEBKIT_SHOW_FPS=1` | FPS counter overlay |
| `WEBKIT_SAMPLE_MEMORY`, `WEBKIT_FORCE_SANDBOX`, `WEBKIT_INSPECTOR_SERVER`, `WEBKIT_GST_*` | not rendering related |

From blog posts, release notes and bug reports:

| Variable | Meaning | Source |
| --- | --- | --- |
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | originally "use the WPE renderer or X11 instead" (2.41/2.42). [REP] since 2.44 it leaves no transport and so disables accelerated compositing | [DEV] 2023 post; [REP] unsloth issue |
| `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` | force the shared memory transport, added with the X11 renderer removal as a way to test the shared memory code path | [DEV] https://github.com/WebKit/WebKit/pull/20869 (2.43.2) |
| `WEBKIT_DMABUF_RENDERER_DISABLE_GBM` | named in a Debian bug thread, effect not documented | search hit only |
| `WEBKIT_FORCE_DMABUF_RENDERER=1` | [REP] clears the distro `isNVIDIA()` early return | OrcaSlicer PR, unverified, distro patch only |
| `WEBKIT_SHOW_DAMAGE=1` | damage rectangle overlay; disables damage-driven compositor optimizations | [DEV] Lampe post, Periodical #13 |
| `WEBKIT_USE_SKIA_FOR_COMPOSITION=0` | 2.54 only: back to TextureMapper | [DEV] https://blogs.igalia.com/carlosgc/2026/09/21/skia-compositor-for-wpe-webkit-and-webkitgtk/ |
| `WEBKIT_SKIA_USE_VIVANTE_SUPER_TILED_TILE_TEXTURES=1` | Vivante only | NEWS 2.51.3 |
| `webkit://gpu`, `webkit://gpu/stdout` | not env vars: dump of policy, renderer, GL strings, buffer format; the stdout form works when nothing renders (2.46+) | [DEV] 2.46 post |
| `GDK_DEBUG=gl-egl` | GTK 4 on X11: force EGL so the dma-buf is not re-uploaded through GLX | [DEV] 2023 post |

Flagged for this problem: `WEBKIT_DISABLE_COMPOSITING_MODE`,
`WEBKIT_DMABUF_RENDERER_FORCE_SHM`, `WEBKIT_DISABLE_DMABUF_RENDERER`,
`WEBKIT_SKIA_ENABLE_CPU_RENDERING`, `WEBKIT_SKIA_GPU_PAINTING_THREADS`,
`WEBKIT_SHOW_DAMAGE`, `WEBKIT_SHOW_FPS`. No documented variable was found
for: the compositor frame rate, forcing a vblank timer, or enabling damage
features from the environment (features are API or MiniBrowser `--features`
only, as far as documented).

## 7. Mesa / llvmpipe

### Knobs

Source: https://docs.mesa3d.org/envvars.html and
`src/gallium/drivers/llvmpipe/lp_screen.c` on Mesa main.

- `LP_NUM_THREADS=N`: number of rasterizer threads; 0 turns threading off entirely; default is the number of CPU cores, capped at 32
  (`LP_MAX_THREADS`). [INF] For a compositor workload made of a few large
  textured quads per frame, the default wakes one thread per core for every
  frame (the magpie report shows 24 threads at ~25 % each). Trying
  `LP_NUM_THREADS=0`, `1`, `2` and `4` is the cheapest experiment: it should
  cut the summed CPU even if frame time rises. This is a hypothesis to
  measure, no Mesa developer statement was found for this exact workload.
- `LIBGL_ALWAYS_SOFTWARE=true`: force software rendering (useful to reproduce
  the no-GPU case on a GPU machine).
- `GALLIUM_DRIVER=llvmpipe|softpipe`: choose the software driver together with
  `LIBGL_ALWAYS_SOFTWARE`. softpipe is the slow reference rasterizer; no gain
  expected.
- `LP_NATIVE_VECTOR_WIDTH=128|256`: JIT vector width (default
  min(CPU, 256)). `GALLIVM_PERF=...` flags (`brilinear`, `rho_approx`,
  `no_quad_lod`, `no_aos_sampling`, `nopt`, ...) tune texture sampling and
  optimization passes. `LP_PERF` no-ops parts of the driver for bottleneck
  hunting (options only listed in the source). [INF] None targets blit or
  readback cost.
- `LP_DEBUG` and lavapipe variables: not relevant here.

### Symbolized perf profiles through the JIT

Sources: https://docs.mesa3d.org/drivers/llvmpipe.html (Profiling section),
and `src/gallium/auxiliary/gallivm/lp_bld_debug.cpp`, `lp_bld_init.c`,
`lp_bld_init_common.c`, `lp_bld_init_orc.cpp` on Mesa main (read 2026-11-26).

- `GALLIVM_DEBUG=perf` is not the switch. In the code that flag only prints
  how long each function took to JIT ("jitting func %s took %d msec").
- The perf map is written by `lp_profile()`, which is compiled only when Mesa
  is built with the `PROFILE` macro defined. No `PROFILE` definition was
  found in the top-level `meson.build` on main, so [INF] a normal release or
  distro build does not write it, and a debug build does not either: it needs
  a custom build with `-DPROFILE` in `c_args` and `cpp_args` (the doc's
  build-type table still mentions a "profile" build type from the old build
  system).
- With such a build, on Linux the files `/tmp/perf-<pid>.map` (and
  `/tmp/perf-<pid>.map.asm`) are created only if the environment variable
  `PERF_BUILDID_DIR` is set, which is how the code detects "running inside
  linux perf". So the application must be launched by `perf record -g -- app`
  (or the variable exported by hand); attaching with `perf record -p` to a
  running process gives no map. `bin/perf-annotate-jit.py` consumes the
  `.asm` file.
- [INF] WebKit specifics: the GL work happens in WebKitWebProcess, a child of
  the app, so the variable must be inherited, and with the bubblewrap sandbox
  the web process has its own `/tmp`, so the map may land where the host
  `perf report` cannot see it. Running with the sandbox disabled for the
  profiling session, or copying the file out, is likely needed. Unverified.
- `GALLIVM_DEBUG=symbols` exists in release builds (ignored for setuid
  processes). With MCJIT it makes gallivm keep debug info for the generated
  functions. With the ORC JIT it registers LLVM's perf support plugin
  (jitdump, for `perf record -k 1` plus `perf inject --jit`), but only when
  the JITLink layer is used, LLVM >= 18, on Linux; on Mesa main JITLink is
  only selected for RISC-V and LoongArch (and Windows), so not on x86-64.
- Without any of this, llvmpipe JIT samples show up in perf as anonymous
  `[JIT]` or unknown addresses inside the `llvmpipe-N` threads. [INF] The
  split between `llvmpipe-N` threads (rasterization, fragment shading) and
  the WebKit compositor thread (readback, `memcpy`, fence wait) is still
  visible per thread with `perf report --sort comm,dso`, which may be enough
  to attribute the cost without symbolizing the JIT.

## 8. What is planned upstream

- [DEV] Done in 2.54: Skia compositor, damage-restricted compositing by
  default, reworked non-composited mode with damage and vblank pacing.
- [DEV] On main after 2.54: TextureMapper disabled at build time
  (`USE_TEXTURE_MAPPER` CMake option, default off) and to be removed for GTK
  and WPE; the `UseSkiaForComposition` runtime switch is gone on main.
- [DEV] Future plans named in the September 2026 post: promise images for all
  external textures, Vulkan through Ganesh, later the Graphite backend.
- [DEV] April 2025 ideas: dma-buf backed tile textures so CPU-painted tiles
  avoid a GL upload; better compositor synchronization with vblank and
  animation sources.
- Nothing found that targets llvmpipe or a software-GL fallback policy.
  Bug 276580 has had no developer activity since July 2024.
- Tauri side: no WebKitGTK tuning planned; [Tauri member] GTK 4 migration
  "underway", CEF and Servo as alternatives.

## 9. Open points and doubts

- Whether 321589@main (GTK 3 partial invalidation) is in a 2.54.x tarball:
  not determined. If the target is GTK 3, this decides whether 2.54 helps the
  UI process side.
- Whether damage-restricted compositing in 2.54 actually lowers llvmpipe CPU:
  not measured by anyone upstream. In SHM transport the full-frame readback
  claim comes from a third-party reading of 2.48.5; 2.53.1 changed the buffer
  sharing code, so it may differ in 2.54.
- `UseDamagingInformationForCompositing` on 2.52 (TextureMapper): upstream
  kept it off because of glitches, and on GTK the damage is unified to one
  bounding box. Worth one test on the small progress bar case, with visual
  checks, not as a shipped default.
- The distro in use may patch WebKitGTK (NVIDIA handling); behaviour of the
  DMA-BUF variables can differ from upstream.
- Several third-party issues cited here are analyses by app authors, not
  WebKit developers; treat their mechanism claims as leads.
